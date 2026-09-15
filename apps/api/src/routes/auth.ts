import crypto from 'node:crypto';
import { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransport
} from '@simplewebauthn/server';
import { prisma } from '../lib/prisma.js';
import { getOnboardingState, refreshOnboardingCompletion } from '../services/onboarding.service.js';
import { analyzeFaceLoginDataUrl, analyzeFaceReferenceDataUrl } from '../services/face-enrollment-async.service.js';
import { decryptJson } from '../services/biometric-storage.service.js';
import { getOrCreateSecuritySettings } from '../services/security-settings.service.js';

const loginSelector=z.object({email:z.string().email(),tenantDocument:z.string().max(30).optional()});
const authChallengeTtlMs=3*60_000;

function transports(value:unknown):AuthenticatorTransport[]|undefined{
  return Array.isArray(value)?value as AuthenticatorTransport[]:undefined;
}

function getWebAuthnConfig(){
  const renderHostname=process.env.RENDER_EXTERNAL_HOSTNAME?.trim();
  const production=process.env.NODE_ENV==='production';
  const configuredRp=(process.env.WEBAUTHN_RP_ID??'').trim();
  const configuredOrigin=(process.env.WEBAUTHN_ORIGIN??'').trim();
  const useRenderRp=Boolean(renderHostname)&&(!configuredRp||(production&&['localhost','127.0.0.1'].includes(configuredRp.toLowerCase())));
  const useRenderOrigin=Boolean(renderHostname)&&(!configuredOrigin||(production&&/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(configuredOrigin)));
  const rpID=(useRenderRp?renderHostname!:(configuredRp||'localhost')).replace(/^https?:\/\//i,'').split('/')[0].split(':')[0];
  const expectedOrigin=useRenderOrigin?`https://${renderHostname}`:(configuredOrigin||'http://localhost:5173');
  return {rpID,expectedOrigin};
}

function cosine(a:number[],b:number[]){
  if(!a.length||a.length!==b.length)return 0;
  let dot=0,aa=0,bb=0;
  for(let i=0;i<a.length;i++){dot+=a[i]*b[i];aa+=a[i]*a[i];bb+=b[i]*b[i];}
  return aa&&bb?Math.max(0,Math.min(1,dot/(Math.sqrt(aa)*Math.sqrt(bb)))):0;
}

async function within<T>(promise:Promise<T>,ms:number,message:string):Promise<T>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{
    return await Promise.race([
      promise,
      new Promise<T>((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),ms);})
    ]);
  }finally{if(timer)clearTimeout(timer);}
}

async function findLoginUser(input:{email:string;tenantDocument?:string}){
  const candidates=await prisma.user.findMany({
    where:{
      email:input.email.toLowerCase(),active:true,
      ...(input.tenantDocument?{tenant:{document:input.tenantDocument.replace(/\D/g,'')}}:{})
    },
    include:{employee:true,tenant:true},take:2
  });
  if(candidates.length>1&&!input.tenantDocument)throw Object.assign(new Error('Este e-mail existe em mais de uma empresa. Informe o CNPJ/identificador da empresa.'),{statusCode:409});
  const user=candidates[0];
  if(!user||(user.employee&&!user.employee.active))throw Object.assign(new Error('Conta não encontrada ou inativa'),{statusCode:401});
  return user;
}

async function sessionResponse(app:FastifyInstance,user:any){
  const token=app.jwt.sign({userId:user.id,tenantId:user.tenantId,role:user.role,employeeId:user.employee?.id},{expiresIn:'12h'});
  const onboarding=await getOnboardingState(user.id);
  return {token,user:{id:user.id,email:user.email,role:user.role,employeeId:user.employee?.id,name:user.employee?.name??user.email,tenant:user.tenant.name,onboarding}};
}

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/login', async (request, reply) => {
    const body = z.object({ email: z.string().email(), password: z.string().min(6), tenantDocument: z.string().max(30).optional() }).parse(request.body);
    let user:any;
    try{user=await findLoginUser(body);}catch(error:any){return reply.code(error?.statusCode??401).send({error:error?.message??'Credenciais inválidas'});}
    if(!(await bcrypt.compare(body.password,user.passwordHash)))return reply.code(401).send({error:'Credenciais inválidas'});
    return sessionResponse(app,user);
  });

  // Login passwordless com Windows Hello, digital, Touch ID, Face ID ou passkey.
  app.post('/auth/webauthn/options',async(request,reply)=>{
    const body=loginSelector.parse(request.body);
    let user:any;try{user=await findLoginUser(body);}catch(error:any){return reply.code(error?.statusCode??401).send({error:error?.message??'Conta não encontrada'});}
    const creds=await prisma.webAuthnCredential.findMany({where:{tenantId:user.tenantId,userId:user.id}});
    if(!creds.length)return reply.code(409).send({error:'Este usuário ainda não cadastrou biometria/passkey para login'});
    const {rpID}=getWebAuthnConfig();
    const options=await generateAuthenticationOptions({rpID,userVerification:'required',allowCredentials:creds.map(x=>({id:x.credentialId,transports:transports(x.transports)}))});
    const challenge=await prisma.webAuthnChallenge.create({data:{tenantId:user.tenantId,userId:user.id,challenge:options.challenge,purpose:'AUTHENTICATION',expiresAt:new Date(Date.now()+authChallengeTtlMs)}});
    return {challengeId:challenge.id,options};
  });

  app.post('/auth/webauthn/verify',async(request,reply)=>{
    const body=z.object({challengeId:z.string(),response:z.any()}).parse(request.body) as {challengeId:string;response:AuthenticationResponseJSON};
    const challenge=await prisma.webAuthnChallenge.findFirst({where:{id:body.challengeId,purpose:'AUTHENTICATION',usedAt:null,expiresAt:{gt:new Date()}},include:{user:{include:{employee:true,tenant:true}}}});
    if(!challenge||challenge.challenge.startsWith('FACE_'))return reply.code(400).send({error:'Desafio de login expirado ou inválido'});
    const saved=await prisma.webAuthnCredential.findFirst({where:{tenantId:challenge.tenantId,userId:challenge.userId,credentialId:body.response.id}});
    if(!saved)return reply.code(404).send({error:'Credencial biométrica não reconhecida'});
    const {rpID,expectedOrigin}=getWebAuthnConfig();
    const verification=await verifyAuthenticationResponse({response:body.response,expectedChallenge:challenge.challenge,expectedOrigin,expectedRPID:rpID,requireUserVerification:true,credential:{id:saved.credentialId,publicKey:new Uint8Array(saved.publicKey),counter:Number(saved.counter),transports:transports(saved.transports)}});
    if(!verification.verified)return reply.code(401).send({error:'Biometria do dispositivo não validada'});
    await prisma.$transaction([
      prisma.webAuthnCredential.update({where:{id:saved.id},data:{counter:BigInt(verification.authenticationInfo.newCounter),lastUsedAt:new Date()}}),
      prisma.webAuthnChallenge.update({where:{id:challenge.id},data:{usedAt:new Date()}}),
      prisma.auditEvent.create({data:{tenantId:challenge.tenantId,actorUserId:challenge.userId,action:'LOGIN_WEBAUTHN_SUCCESS',entityType:'User',entityId:challenge.userId}})
    ]);
    return sessionResponse(app,challenge.user);
  });

  // Login facial sem carregar IA no navegador: o cliente captura duas imagens
  // rápidas e o servidor compara com o template facial ativo.
  app.post('/auth/face/options',async(request,reply)=>{
    const body=loginSelector.parse(request.body);
    let user:any;try{user=await findLoginUser(body);}catch(error:any){return reply.code(error?.statusCode??401).send({error:error?.message??'Conta não encontrada'});}
    if(!user.employee||user.employee.faceEnrollmentStatus!=='ACTIVE')return reply.code(409).send({error:'Reconhecimento facial ainda não está ativo para este usuário'});
    if(user.employee.biometricLockedUntil&&user.employee.biometricLockedUntil>new Date())return reply.code(423).send({error:'Biometria temporariamente bloqueada. Tente novamente mais tarde.'});
    const refs=await prisma.faceReference.count({where:{tenantId:user.tenantId,employeeId:user.employee.id,revokedAt:null,embeddingEncrypted:{not:null}}});
    if(!refs)return reply.code(409).send({error:'Nenhuma referência facial ativa foi encontrada'});
    const challenge=await prisma.webAuthnChallenge.create({data:{tenantId:user.tenantId,userId:user.id,challenge:`FACE_${crypto.randomBytes(32).toString('base64url')}`,purpose:'AUTHENTICATION',expiresAt:new Date(Date.now()+authChallengeTtlMs)}});
    return {challengeId:challenge.id,expiresAt:challenge.expiresAt};
  });

  app.post('/auth/face/verify',async(request,reply)=>{
    const body=z.object({challengeId:z.string(),images:z.array(z.string().min(100)).length(2)}).parse(request.body);
    const challenge=await prisma.webAuthnChallenge.findFirst({where:{id:body.challengeId,purpose:'AUTHENTICATION',usedAt:null,expiresAt:{gt:new Date()}},include:{user:{include:{employee:true,tenant:true}}}});
    if(!challenge||!challenge.challenge.startsWith('FACE_')||!challenge.user.employee)return reply.code(400).send({error:'Desafio facial expirado ou inválido'});
    const employee=challenge.user.employee;
    if(employee.faceEnrollmentStatus!=='ACTIVE')return reply.code(409).send({error:'Reconhecimento facial ainda não está ativo'});
    if(employee.biometricLockedUntil&&employee.biometricLockedUntil>new Date())return reply.code(423).send({error:'Biometria temporariamente bloqueada. Tente novamente mais tarde.'});

    // Consome o challenge antes da inferência: cada tentativa exige um nonce novo.
    const consumed=await prisma.webAuthnChallenge.updateMany({where:{id:challenge.id,usedAt:null},data:{usedAt:new Date()}});
    if(!consumed.count)return reply.code(409).send({error:'Desafio facial já utilizado'});

    try{
      const policy=await getOrCreateSecuritySettings(challenge.tenantId);
      // One secure inference (liveness + antispoof) plus one lightweight descriptor
      // is enough for a two-frame facial login and avoids running all heavy models twice.
      const [first,second]=await within(Promise.all([
        analyzeFaceLoginDataUrl(body.images[0]),
        analyzeFaceReferenceDataUrl(body.images[1])
      ]),8500,'A leitura facial excedeu 8,5 segundos');
      const basicOk=first.faceCount===1&&first.embedding.length>=64&&first.quality>=policy.minFaceQualityScore&&first.liveness>=policy.minLivenessScore&&first.antiSpoof>=policy.minAntiSpoofScore&&second.faceCount===1&&second.embedding.length>=64&&second.quality>=policy.minFaceQualityScore;
      const consistency=cosine(first.embedding,second.embedding);
      const refs=await prisma.faceReference.findMany({where:{tenantId:challenge.tenantId,employeeId:employee.id,revokedAt:null,embeddingEncrypted:{not:null}}});
      let bestMatch=0;
      for(const ref of refs){if(!ref.embeddingEncrypted)continue;const saved=decryptJson<number[]>(ref.embeddingEncrypted);bestMatch=Math.max(bestMatch,cosine(first.embedding,saved),cosine(second.embedding,saved));}
      const verified=basicOk&&consistency>=Math.max(0.58,policy.minFaceMatchScore-0.15)&&bestMatch>=policy.minFaceMatchScore;
      if(!verified){
        const failed=await prisma.employee.update({where:{id:employee.id},data:{failedBiometricAttempts:{increment:1}},select:{failedBiometricAttempts:true}});
        if(failed.failedBiometricAttempts>=policy.maxFailedBiometricAttempts){await prisma.employee.update({where:{id:employee.id},data:{biometricLockedUntil:new Date(Date.now()+policy.biometricLockoutMinutes*60_000)}});}
        await prisma.auditEvent.create({data:{tenantId:challenge.tenantId,actorUserId:challenge.userId,action:'LOGIN_FACE_FAILED',entityType:'User',entityId:challenge.userId,metadataJson:{bestMatch,consistency,basicOk}}});
        return reply.code(401).send({error:'Não foi possível confirmar sua identidade facial. Tente novamente ou use sua biometria digital/passkey.'});
      }
      await prisma.$transaction([
        prisma.employee.update({where:{id:employee.id},data:{failedBiometricAttempts:0,biometricLockedUntil:null}}),
        prisma.auditEvent.create({data:{tenantId:challenge.tenantId,actorUserId:challenge.userId,action:'LOGIN_FACE_SUCCESS',entityType:'User',entityId:challenge.userId,metadataJson:{bestMatch,consistency}}})
      ]);
      return sessionResponse(app,challenge.user);
    }catch(error){
      await prisma.auditEvent.create({data:{tenantId:challenge.tenantId,actorUserId:challenge.userId,action:'LOGIN_FACE_ERROR',entityType:'User',entityId:challenge.userId,metadataJson:{message:error instanceof Error?error.message:'Falha técnica'}}}).catch(()=>undefined);
      return reply.code(503).send({error:'O reconhecimento facial não pôde ser processado agora. Use a biometria digital/passkey ou tente novamente.'});
    }
  });

  app.get('/auth/onboarding-status', { preHandler:[app.authenticate] }, async (request:any) => {
    return refreshOnboardingCompletion(request.user.userId);
  });

  app.post('/auth/change-password', { preHandler:[app.authenticate] }, async (request:any, reply) => {
    const body = z.object({ currentPassword:z.string().min(6), newPassword:z.string().min(10).max(128) }).parse(request.body);
    if (body.currentPassword === body.newPassword) return reply.code(400).send({error:'A nova senha deve ser diferente da senha temporária.'});
    const user = await prisma.user.findUnique({where:{id:request.user.userId}});
    if(!user || !(await bcrypt.compare(body.currentPassword,user.passwordHash))) return reply.code(401).send({error:'Senha atual inválida'});
    const passwordHash=await bcrypt.hash(body.newPassword,12);
    await prisma.$transaction([
      prisma.user.update({where:{id:user.id},data:{passwordHash,mustChangePassword:false,passwordChangedAt:new Date(),onboardingCompletedAt:null}}),
      prisma.auditEvent.create({data:{tenantId:user.tenantId,actorUserId:user.id,action:'FIRST_ACCESS_PASSWORD_CHANGED',entityType:'User',entityId:user.id}})
    ]);
    return {ok:true,onboarding:await refreshOnboardingCompletion(user.id)};
  });
}
