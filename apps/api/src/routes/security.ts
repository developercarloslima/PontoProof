import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { FacePose, LivenessAction, Role, WebAuthnChallengePurpose } from '@prisma/client';
import { z } from 'zod';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
  type AuthenticatorTransport
} from '@simplewebauthn/server';
import { prisma } from '../lib/prisma.js';
import { getOrCreateSecuritySettings } from '../services/security-settings.service.js';
import { createPresenceToken } from '../services/presence.service.js';
import { readEncryptedImage } from '../services/biometric-storage.service.js';
import { acknowledgeBiometricNotice, BIOMETRIC_NOTICE_HASH, BIOMETRIC_NOTICE_TEXT, BIOMETRIC_NOTICE_VERSION, getCurrentAcknowledgement } from '../services/biometric-notice.service.js';
import { enrollFaceReference } from '../services/face-enrollment.service.js';
import { refreshOnboardingCompletion } from '../services/onboarding.service.js';

const rpID = process.env.WEBAUTHN_RP_ID ?? 'localhost';
const rpName = process.env.WEBAUTHN_RP_NAME ?? 'PontoProof';
const expectedOrigin = process.env.WEBAUTHN_ORIGIN ?? 'http://localhost:5173';
const challengeTtlMs = 5 * 60_000;

function transports(value: unknown): AuthenticatorTransport[] | undefined {
  return Array.isArray(value) ? value as AuthenticatorTransport[] : undefined;
}

async function assertAdmin(request:any, reply:any) {
  const adminRoles: Role[] = [Role.ADMIN, Role.HR];
  if (!adminRoles.includes(request.user.role as Role)) { reply.code(403).send({error:'Sem permissão'}); return false; }
  return true;
}

export async function securityRoutes(app: FastifyInstance) {
  app.get('/security/status', { preHandler:[app.authenticate] }, async (request:any) => {
    const [policy, credentials, employee, acknowledgement] = await Promise.all([
      getOrCreateSecuritySettings(request.user.tenantId),
      prisma.webAuthnCredential.findMany({ where:{tenantId:request.user.tenantId,userId:request.user.userId}, select:{id:true,label:true,deviceType:true,backedUp:true,createdAt:true,lastUsedAt:true} }),
      request.user.employeeId ? prisma.employee.findUnique({ where:{id:request.user.employeeId}, select:{faceEnrollmentStatus:true,faceEnrolledAt:true,faceTemplateVersion:true} }) : null,
      getCurrentAcknowledgement(request.user.tenantId, request.user.userId)
    ]);
    return { policy, credentials, employee, acknowledgement, biometricNotice:{version:BIOMETRIC_NOTICE_VERSION,hash:BIOMETRIC_NOTICE_HASH,text:BIOMETRIC_NOTICE_TEXT}, webAuthn:{rpID,origin:expectedOrigin,secureContextRequired:true} }; 
  });

  app.get('/security/biometric-notice', { preHandler:[app.authenticate] }, async (request:any) => {
    const acknowledgement=await getCurrentAcknowledgement(request.user.tenantId,request.user.userId);
    return {version:BIOMETRIC_NOTICE_VERSION,hash:BIOMETRIC_NOTICE_HASH,text:BIOMETRIC_NOTICE_TEXT,acknowledged:Boolean(acknowledgement),acknowledgedAt:acknowledgement?.acknowledgedAt??null};
  });

  app.post('/security/biometric-notice/acknowledge', { preHandler:[app.authenticate] }, async (request:any, reply) => {
    const user=await prisma.user.findUnique({where:{id:request.user.userId},select:{mustChangePassword:true}});
    if(!user || user.mustChangePassword)return reply.code(409).send({error:'Troque a senha temporária antes de continuar o cadastro biométrico'});
    const item=await acknowledgeBiometricNotice({tenantId:request.user.tenantId,userId:request.user.userId,employeeId:request.user.employeeId,ip:request.ip,userAgent:String(request.headers['user-agent']??'')});
    await prisma.auditEvent.create({data:{tenantId:request.user.tenantId,actorUserId:request.user.userId,action:'BIOMETRIC_NOTICE_ACKNOWLEDGED',entityType:'User',entityId:request.user.userId,metadataJson:{policyVersion:BIOMETRIC_NOTICE_VERSION,noticeHash:BIOMETRIC_NOTICE_HASH}}});
    return {ok:true,acknowledgedAt:item.acknowledgedAt,version:item.policyVersion,onboarding:await refreshOnboardingCompletion(request.user.userId)};
  });

  app.post('/security/biometric-notice/revoke', { preHandler:[app.authenticate] }, async (request:any) => {
    await prisma.biometricNoticeAcknowledgement.updateMany({where:{tenantId:request.user.tenantId,userId:request.user.userId,revokedAt:null},data:{revokedAt:new Date()}});
    await prisma.auditEvent.create({data:{tenantId:request.user.tenantId,actorUserId:request.user.userId,action:'BIOMETRIC_NOTICE_ACKNOWLEDGEMENT_REVOKED',entityType:'User',entityId:request.user.userId}});
    return {ok:true};
  });

  app.get('/security/face-enrollment/challenge', { preHandler:[app.authenticate] }, async (request:any, reply) => {
    if(!request.user.employeeId)return reply.code(403).send({error:'Usuário sem vínculo de colaborador'});
    const user=await prisma.user.findUnique({where:{id:request.user.userId}});
    if(!user || user.mustChangePassword)return reply.code(409).send({error:'Troque a senha temporária antes de cadastrar o rosto'});
    const acknowledgement=await getCurrentAcknowledgement(request.user.tenantId,request.user.userId);
    if(!acknowledgement)return reply.code(409).send({error:'Registre a ciência do aviso biométrico antes do cadastro facial'});
    const policy=await getOrCreateSecuritySettings(request.user.tenantId);
    const refs=await prisma.faceReference.findMany({where:{tenantId:request.user.tenantId,employeeId:request.user.employeeId,revokedAt:null},select:{pose:true}});
    const currentPoses=refs.map(r=>r.pose);
    const ordered=[FacePose.FRONT,FacePose.LEFT,FacePose.RIGHT];
    const nextPose=ordered.find(p=>!currentPoses.includes(p))??FacePose.FRONT;
    const action=nextPose===FacePose.LEFT?LivenessAction.TURN_LEFT:nextPose===FacePose.RIGHT?LivenessAction.TURN_RIGHT:LivenessAction.BLINK;
    const token=app.jwt.sign({kind:'FACE_ENROLLMENT',userId:request.user.userId,tenantId:request.user.tenantId,role:request.user.role,employeeId:request.user.employeeId,livenessAction:action,facePose:nextPose,jti:crypto.randomUUID()},{expiresIn:'5m'});
    return {challengeAction:action,enrollmentToken:token,faceReferenceMin:policy.faceReferenceMin,currentPoses,nextPose};
  });

  app.post('/security/face-enrollment', { preHandler:[app.authenticate] }, async (request:any, reply) => {
    if(!request.user.employeeId)return reply.code(403).send({error:'Usuário sem vínculo de colaborador'});
    const body=z.object({enrollmentToken:z.string().min(20),pose:z.nativeEnum(FacePose),imageDataUrl:z.string().min(100),embedding:z.array(z.number()).min(64).max(4096),faceQualityScore:z.number().min(0).max(1),livenessScore:z.number().min(0).max(1),antiSpoofScore:z.number().min(0).max(1),livenessChallengePassed:z.literal(true)}).parse(request.body);
    let proof:any;try{proof=app.jwt.verify(body.enrollmentToken);}catch{return reply.code(400).send({error:'Challenge de cadastro facial inválido ou expirado'});}
    if(proof.kind!=='FACE_ENROLLMENT'||proof.userId!==request.user.userId||proof.tenantId!==request.user.tenantId||proof.employeeId!==request.user.employeeId||proof.facePose!==body.pose)return reply.code(400).send({error:'Challenge facial não pertence a este usuário ou pose'});
    const ref=await enrollFaceReference({tenantId:request.user.tenantId,employeeId:request.user.employeeId,actorUserId:request.user.userId,pose:body.pose,imageDataUrl:body.imageDataUrl,embedding:body.embedding,faceQualityScore:body.faceQualityScore,livenessScore:body.livenessScore,antiSpoofScore:body.antiSpoofScore,livenessChallengePassed:body.livenessChallengePassed});
    const onboarding=await refreshOnboardingCompletion(request.user.userId);
    return reply.code(201).send({id:ref.id,pose:ref.pose,onboarding});
  });

  app.post('/security/webauthn/register/options', { preHandler:[app.authenticate] }, async (request:any, reply) => {
    const user = await prisma.user.findUniqueOrThrow({ where:{id:request.user.userId}, include:{employee:{select:{faceEnrollmentStatus:true}}} });
    if(user.mustChangePassword)return reply.code(409).send({error:'Troque a senha temporária antes de cadastrar a biometria do dispositivo'});
    const acknowledgement=await getCurrentAcknowledgement(user.tenantId,user.id);
    if(!acknowledgement)return reply.code(409).send({error:'Registre a ciência do aviso biométrico antes de cadastrar a biometria do dispositivo'});
    if(user.employee?.faceEnrollmentStatus!=='ACTIVE')return reply.code(409).send({error:'Conclua o cadastro facial antes de cadastrar a biometria do dispositivo'});
    const existing = await prisma.webAuthnCredential.findMany({ where:{userId:user.id} });
    const options = await generateRegistrationOptions({
      rpName, rpID, userName:user.email, userDisplayName:user.email,
      userID:new TextEncoder().encode(user.id), attestationType:'none',
      authenticatorSelection:{ authenticatorAttachment:'platform', residentKey:'preferred', userVerification:'required' },
      excludeCredentials:existing.map(x=>({id:x.credentialId,transports:transports(x.transports)})),
      supportedAlgorithmIDs:[-7,-257]
    });
    await prisma.webAuthnChallenge.create({ data:{tenantId:user.tenantId,userId:user.id,challenge:options.challenge,purpose:WebAuthnChallengePurpose.REGISTRATION,expiresAt:new Date(Date.now()+challengeTtlMs)} });
    return options;
  });

  app.post('/security/webauthn/register/verify', { preHandler:[app.authenticate] }, async (request:any, reply) => {
    const body = z.object({ response:z.any(), label:z.string().max(80).optional() }).parse(request.body) as {response:RegistrationResponseJSON;label?:string};
    const challenge = await prisma.webAuthnChallenge.findFirst({ where:{tenantId:request.user.tenantId,userId:request.user.userId,purpose:'REGISTRATION',usedAt:null,expiresAt:{gt:new Date()}}, orderBy:{createdAt:'desc'} });
    if (!challenge) return reply.code(400).send({error:'Desafio WebAuthn expirado'});
    const verification = await verifyRegistrationResponse({ response:body.response, expectedChallenge:challenge.challenge, expectedOrigin, expectedRPID:rpID, requireUserVerification:true, supportedAlgorithmIDs:[-7,-257] });
    if (!verification.verified || !verification.registrationInfo) return reply.code(400).send({error:'Biometria/passkey não pôde ser validada'});
    const info = verification.registrationInfo;
    const cred = info.credential;
    await prisma.$transaction([
      prisma.webAuthnCredential.upsert({ where:{credentialId:cred.id}, update:{publicKey:Buffer.from(cred.publicKey),counter:BigInt(cred.counter),transports:cred.transports as any,deviceType:info.credentialDeviceType,backedUp:info.credentialBackedUp,label:body.label}, create:{tenantId:request.user.tenantId,userId:request.user.userId,credentialId:cred.id,publicKey:Buffer.from(cred.publicKey),counter:BigInt(cred.counter),transports:cred.transports as any,deviceType:info.credentialDeviceType,backedUp:info.credentialBackedUp,label:body.label} }),
      prisma.webAuthnChallenge.update({where:{id:challenge.id},data:{usedAt:new Date()}}),
      prisma.auditEvent.create({data:{tenantId:request.user.tenantId,actorUserId:request.user.userId,action:'WEBAUTHN_ENROLLED',entityType:'User',entityId:request.user.userId,metadataJson:{credentialId:cred.id,deviceType:info.credentialDeviceType,backedUp:info.credentialBackedUp}}})
    ]);
    return {verified:true,onboarding:await refreshOnboardingCompletion(request.user.userId)};
  });

  app.post('/security/webauthn/auth/options', { preHandler:[app.authenticate] }, async (request:any, reply) => {
    const {punchChallengeId}=z.object({punchChallengeId:z.string()}).parse(request.body);
    if(!request.user.employeeId)return reply.code(403).send({error:'Usuário sem vínculo de colaborador'});
    const punchChallenge=await prisma.punchChallenge.findFirst({where:{id:punchChallengeId,tenantId:request.user.tenantId,employeeId:request.user.employeeId,usedAt:null,expiresAt:{gt:new Date()}}});
    if(!punchChallenge)return reply.code(400).send({error:'Challenge da marcação inválido ou expirado'});
    const creds = await prisma.webAuthnCredential.findMany({ where:{tenantId:request.user.tenantId,userId:request.user.userId} });
    if (!creds.length) return reply.code(409).send({error:'Nenhuma biometria/passkey cadastrada neste usuário'});
    const options = await generateAuthenticationOptions({ rpID, userVerification:'required', allowCredentials:creds.map(x=>({id:x.credentialId,transports:transports(x.transports)})) });
    await prisma.webAuthnChallenge.create({ data:{tenantId:request.user.tenantId,userId:request.user.userId,challenge:options.challenge,purpose:WebAuthnChallengePurpose.PUNCH,boundPunchChallengeId:punchChallengeId,expiresAt:new Date(Date.now()+challengeTtlMs)} });
    return options;
  });

  app.post('/security/webauthn/auth/verify', { preHandler:[app.authenticate] }, async (request:any, reply) => {
    const response = request.body as AuthenticationResponseJSON;
    const challenge = await prisma.webAuthnChallenge.findFirst({ where:{tenantId:request.user.tenantId,userId:request.user.userId,purpose:'PUNCH',usedAt:null,expiresAt:{gt:new Date()}},orderBy:{createdAt:'desc'} });
    if (!challenge) return reply.code(400).send({error:'Desafio biométrico expirado'});
    const saved = await prisma.webAuthnCredential.findFirst({where:{tenantId:request.user.tenantId,userId:request.user.userId,credentialId:response.id}});
    if (!saved) return reply.code(404).send({error:'Credencial biométrica não reconhecida'});
    const verification = await verifyAuthenticationResponse({ response, expectedChallenge:challenge.challenge, expectedOrigin, expectedRPID:rpID, requireUserVerification:true, credential:{id:saved.credentialId,publicKey:new Uint8Array(saved.publicKey),counter:Number(saved.counter),transports:transports(saved.transports)} });
    if (!verification.verified) return reply.code(400).send({error:'Biometria do dispositivo não validada'});
    await prisma.$transaction([
      prisma.webAuthnCredential.update({where:{id:saved.id},data:{counter:BigInt(verification.authenticationInfo.newCounter),lastUsedAt:new Date()}}),
      prisma.webAuthnChallenge.update({where:{id:challenge.id},data:{usedAt:new Date()}})
    ]);
    const biometricProofToken = app.jwt.sign({kind:'PUNCH_BIOMETRIC',userId:request.user.userId,tenantId:request.user.tenantId,role:request.user.role,employeeId:request.user.employeeId,credentialId:saved.credentialId,punchChallengeId:challenge.boundPunchChallengeId,jti:crypto.randomUUID()},{expiresIn:'3m'});
    return {verified:true,biometricProofToken,credentialId:saved.credentialId};
  });

  app.delete('/security/webauthn/credentials/:id', { preHandler:[app.authenticate] }, async (request:any, reply) => {
    const {id}=z.object({id:z.string()}).parse(request.params);
    const cred=await prisma.webAuthnCredential.findFirst({where:{id,tenantId:request.user.tenantId,userId:request.user.userId}});
    if(!cred)return reply.code(404).send({error:'Credencial não encontrada'});
    await prisma.webAuthnCredential.delete({where:{id:cred.id}});
    await prisma.auditEvent.create({data:{tenantId:request.user.tenantId,actorUserId:request.user.userId,action:'WEBAUTHN_REVOKED',entityType:'WebAuthnCredential',entityId:cred.id}});
    return {ok:true};
  });

  app.get('/security/worksites/:id/presence-code', { preHandler:[app.authenticate] }, async (request:any, reply) => {
    if (!(await assertAdmin(request,reply))) return;
    const {id}=z.object({id:z.string()}).parse(request.params);
    const ws=await prisma.worksite.findFirst({where:{id,tenantId:request.user.tenantId,active:true}});
    if(!ws)return reply.code(404).send({error:'Local não encontrado'});
    return {worksiteId:id,token:createPresenceToken(id,'QR',90),expiresInSeconds:90};
  });

  app.get('/security/face-reference/:id/image', { preHandler:[app.authenticate] }, async (request:any, reply) => {
    if (!(await assertAdmin(request,reply))) return;
    const {id}=z.object({id:z.string()}).parse(request.params);
    const ref=await prisma.faceReference.findFirst({where:{id,tenantId:request.user.tenantId}});
    if(!ref)return reply.code(404).send({error:'Referência não encontrada'});
    if(ref.purgedAt||!ref.storageKey)return reply.code(410).send({error:'Referência facial revogada e expurgada conforme retenção',purgedAt:ref.purgedAt});
    const raw=await readEncryptedImage(ref.storageKey);
    return {dataUrl:`data:image/jpeg;base64,${raw.toString('base64')}`};
  });

  app.get('/security/attempts/:id/selfie', { preHandler:[app.authenticate] }, async (request:any, reply) => {
    if (!(await assertAdmin(request,reply))) return;
    const {id}=z.object({id:z.string()}).parse(request.params);
    const attempt=await prisma.punchAttempt.findFirst({where:{id,tenantId:request.user.tenantId}});
    if(!attempt?.selfieStorageKey)return reply.code(404).send({error:'Selfie não encontrada'});
    const raw=await readEncryptedImage(attempt.selfieStorageKey); return {dataUrl:`data:image/jpeg;base64,${raw.toString('base64')}`};
  });

  app.get('/security/punches/:id/selfie', { preHandler:[app.authenticate] }, async (request:any, reply) => {
    if (!(await assertAdmin(request,reply))) return;
    const {id}=z.object({id:z.string()}).parse(request.params);
    const punch=await prisma.punch.findFirst({where:{id,tenantId:request.user.tenantId},include:{evidence:true}});
    const key=punch?.evidence?.selfieStorageKey;
    if(punch?.evidence?.selfiePurgedAt)return reply.code(410).send({error:'Selfie expurgada conforme política de retenção',purgedAt:punch.evidence.selfiePurgedAt});
    if(!key)return reply.code(404).send({error:'Selfie não encontrada'});
    const raw=await readEncryptedImage(key); return {dataUrl:`data:image/jpeg;base64,${raw.toString('base64')}`};
  });
}
