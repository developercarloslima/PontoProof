import crypto from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { LivenessAction, PunchDecision, PunchType, Role } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { buildPunchHashPayload, createImmutablePunch } from '../services/punch.service.js';
import { canonicalize, sha256 } from '../lib/hash.js';
import { isValidTimeZone, localDateKey } from '../lib/time.js';
import { persistEmployeeLedger } from '../services/time-engine.service.js';
import { getOrCreateSecuritySettings } from '../services/security-settings.service.js';
import { verifyFaceEvidence } from '../services/face-verification.service.js';
import { evaluatePresence } from '../services/presence.service.js';
import { evaluateProof } from '../services/proof.service.js';
import { getCurrentAcknowledgement } from '../services/biometric-notice.service.js';

const faceEmbedding = z.array(z.number()).min(64).max(4096).optional();
const punchSchema = z.object({
  type:z.nativeEnum(PunchType),clientEventId:z.string().uuid(),challengeId:z.string().optional(),occurredAt:z.string().datetime().optional(),
  timezone:z.string().refine(isValidTimeZone,'Fuso horário inválido').default('America/Maceio'),offline:z.boolean().default(false),
  latitude:z.number().min(-90).max(90).optional(),longitude:z.number().min(-180).max(180).optional(),accuracyM:z.number().nonnegative().max(100000).optional(),altitudeM:z.number().min(-1000).max(20000).optional(),altitudeAccuracyM:z.number().nonnegative().max(100000).optional(),headingDeg:z.number().min(0).max(360).optional(),speedMps:z.number().min(0).max(1000).optional(),locationCapturedAt:z.string().datetime().optional(),
  deviceFingerprint:z.string().max(200).optional(),offlinePayloadHash:z.string().max(128).optional(),
  selfieDataUrl:z.string().max(4_000_000).optional(),faceEmbedding,faceCount:z.number().int().min(0).max(10).optional(),faceQualityScore:z.number().min(0).max(1).optional(),
  livenessScore:z.number().min(0).max(1).optional(),antiSpoofScore:z.number().min(0).max(1).optional(),livenessChallengePassed:z.boolean().optional(),
  biometricProofToken:z.string().max(5000).optional(),dynamicQrToken:z.string().max(3000).optional(),networkGatewayToken:z.string().max(3000).optional(),
  bluetoothName:z.string().max(120).optional(),nfcTagId:z.string().max(200).optional(),clientSecureContext:z.boolean().optional()
});

const validPrevious:Record<PunchType,PunchType[]>={
  CLOCK_IN:[PunchType.CLOCK_OUT],BREAK_START:[PunchType.CLOCK_IN,PunchType.BREAK_END,PunchType.PAUSE_END],BREAK_END:[PunchType.BREAK_START],
  PAUSE_START:[PunchType.CLOCK_IN,PunchType.BREAK_END,PunchType.PAUSE_END],PAUSE_END:[PunchType.PAUSE_START],CLOCK_OUT:[PunchType.CLOCK_IN,PunchType.BREAK_END,PunchType.PAUSE_END]
};
const actions=[LivenessAction.BLINK,LivenessAction.TURN_LEFT,LivenessAction.TURN_RIGHT,LivenessAction.HEAD_UP,LivenessAction.HEAD_DOWN];

async function canSeeEmployee(user:any,employeeId:string){
  if(user.employeeId===employeeId)return true;const privilegedRoles: Role[]=[Role.ADMIN,Role.HR,Role.AUDITOR];if(privilegedRoles.includes(user.role as Role))return true;
  if(user.role===Role.SUPERVISOR&&user.employeeId)return Boolean(await prisma.employee.findFirst({where:{id:employeeId,tenantId:user.tenantId,supervisorId:user.employeeId},select:{id:true}}));
  return false;
}

function webIntegrityStatus(request:any, clientSecureContext?:boolean) {
  const origin=String(request.headers.origin??''); const proto=String(request.headers['x-forwarded-proto']??'');
  const serverSecure=origin.startsWith('https://')||origin.startsWith('http://localhost')||proto==='https';
  return serverSecure && clientSecureContext ? 'WEB_SECURE_CONTEXT' : 'WEB_UNATTESTED';
}

async function verifyBiometricProof(app:FastifyInstance, token:string|undefined, user:any, expectedPunchChallengeId?:string) {
  if(!token)return {verified:false,credentialId:undefined as string|undefined};
  try {
    const decoded=(app.jwt as any).verify(token) as any;
    const verified=decoded?.kind==='PUNCH_BIOMETRIC'&&decoded?.userId===user.userId&&decoded?.tenantId===user.tenantId&&Boolean(expectedPunchChallengeId)&&decoded?.punchChallengeId===expectedPunchChallengeId;
    return {verified,credentialId:verified?decoded.credentialId:undefined};
  } catch { return {verified:false,credentialId:undefined}; }
}

export async function punchRoutes(app:FastifyInstance){
  app.post('/punches/challenge',{preHandler:[app.authenticate]},async(request:any,reply)=>{
    if(!request.user.employeeId)return reply.code(403).send({error:'Usuário sem vínculo de colaborador'});
    const {type}=z.object({type:z.nativeEnum(PunchType)}).parse(request.body);
    const [employee,policy,credentialCount,acknowledgement,latestSubmission]=await Promise.all([
      prisma.employee.findFirst({where:{id:request.user.employeeId,tenantId:request.user.tenantId,active:true},select:{id:true,faceEnrollmentStatus:true,faceEnrolledAt:true,biometricLockedUntil:true,failedBiometricAttempts:true}}),
      getOrCreateSecuritySettings(request.user.tenantId),
      prisma.webAuthnCredential.count({where:{tenantId:request.user.tenantId,userId:request.user.userId}}),
      getCurrentAcknowledgement(request.user.tenantId,request.user.userId),
      prisma.faceEnrollmentSubmission.findFirst({where:{tenantId:request.user.tenantId,employeeId:request.user.employeeId},orderBy:{submittedAt:'desc'},select:{status:true}})
    ]);
    if(!employee)return reply.code(403).send({error:'Vínculo de colaborador inativo'});
    if(employee.biometricLockedUntil&&employee.biometricLockedUntil>new Date())return reply.code(423).send({error:`Biometria temporariamente bloqueada até ${employee.biometricLockedUntil.toISOString()} após tentativas inválidas`,code:'BIOMETRIC_LOCKED'});
    if(!acknowledgement)return reply.code(409).send({error:'Leia e reconheça o aviso de tratamento biométrico em Minha segurança antes de registrar ponto',code:'BIOMETRIC_NOTICE_REQUIRED'});
    if(!credentialCount)return reply.code(409).send({error:'Cadastre a biometria digital/passkey antes de registrar ponto',code:'PLATFORM_BIOMETRIC_REQUIRED'});
    const facePending=employee.faceEnrollmentStatus==='PENDING'&&Boolean(latestSubmission&&['PENDING','PROCESSING'].includes(latestSubmission.status));
    if(policy.blockWithoutEnrollment&&policy.requireFaceMatch&&employee.faceEnrollmentStatus!=='ACTIVE'&&!facePending)return reply.code(409).send({error:'Cadastro facial obrigatório antes de registrar ponto',code:'FACE_ENROLLMENT_REQUIRED'});
    const challenge=await prisma.punchChallenge.create({data:{tenantId:request.user.tenantId,employeeId:employee.id,type,nonce:crypto.randomBytes(24).toString('base64url'),livenessAction:actions[crypto.randomInt(actions.length)],expiresAt:new Date(Date.now()+policy.challengeTtlSeconds*1000)}});
    const verificationMode=facePending?'DEVICE_ONLY_PENDING_FACE':'DEVICE_AND_FACE';
    return {id:challenge.id,nonce:challenge.nonce,type,livenessAction:challenge.livenessAction,expiresAt:challenge.expiresAt,verificationMode,policy:{requireSelfie:facePending?false:policy.requireSelfie,requireFaceMatch:facePending?false:policy.requireFaceMatch,requireLiveness:facePending?false:policy.requireLiveness,requireAntiSpoof:facePending?false:policy.requireAntiSpoof,requirePlatformBiometric:true,requireGeofence:policy.requireGeofence,requireAccurateGps:policy.requireAccurateGps,requireDynamicQr:policy.requireDynamicQr,requireBluetoothBeacon:policy.requireBluetoothBeacon,requireNfcTag:policy.requireNfcTag,requireNetworkAttestation:policy.requireNetworkAttestation,requireTrustedDevice:policy.requireTrustedDevice,allowOffline:false,offlineRequiresReview:true,minFaceMatchScore:policy.minFaceMatchScore,minLivenessScore:policy.minLivenessScore,minAntiSpoofScore:policy.minAntiSpoofScore,minFaceQualityScore:policy.minFaceQualityScore,maxGpsAccuracyM:policy.maxGpsAccuracyM},faceEnrollmentStatus:employee.faceEnrollmentStatus,platformBiometricEnrolled:credentialCount>0};
  });

  app.post('/punches',{preHandler:[app.authenticate]},async(request:any,reply)=>{
    if(!request.user.employeeId)return reply.code(403).send({error:'Usuário sem vínculo de colaborador'});
    const employee=await prisma.employee.findFirst({where:{id:request.user.employeeId,tenantId:request.user.tenantId,active:true},select:{id:true,faceEnrollmentStatus:true,biometricLockedUntil:true,failedBiometricAttempts:true}});if(!employee)return reply.code(403).send({error:'Vínculo de colaborador inativo'});
    if(employee.biometricLockedUntil&&employee.biometricLockedUntil>new Date())return reply.code(423).send({error:`Biometria temporariamente bloqueada até ${employee.biometricLockedUntil.toISOString()}`,code:'BIOMETRIC_LOCKED'});
    const acknowledgement=await getCurrentAcknowledgement(request.user.tenantId,request.user.userId);
    if(!acknowledgement)return reply.code(409).send({error:'Ciência do aviso biométrico obrigatória antes da marcação',code:'BIOMETRIC_NOTICE_REQUIRED'});
    const body=punchSchema.parse(request.body);
    const clientCapturedAt=body.occurredAt?new Date(body.occurredAt):new Date();
    if(Number.isNaN(clientCapturedAt.getTime()))return reply.code(400).send({error:'Horário capturado inválido'});
    const duplicate=await prisma.punch.findUnique({where:{tenantId_clientEventId:{tenantId:request.user.tenantId,clientEventId:body.clientEventId}},include:{evidence:true}});
    if(duplicate)return reply.send({id:duplicate.id,recordNumber:duplicate.recordNumber.toString(),type:duplicate.type,occurredAt:duplicate.occurredAt,receivedAt:duplicate.receivedAt,integrityHash:duplicate.integrityHash,previousHash:duplicate.previousHash,decision:duplicate.decision,proof:duplicate.evidence,duplicate:true});

    const policy=await getOrCreateSecuritySettings(request.user.tenantId);
    const latestSubmission=await prisma.faceEnrollmentSubmission.findFirst({where:{tenantId:request.user.tenantId,employeeId:employee.id},orderBy:{submittedAt:'desc'},select:{status:true}});
    const facePending=employee.faceEnrollmentStatus==='PENDING'&&Boolean(latestSubmission&&['PENDING','PROCESSING'].includes(latestSubmission.status));
    const serverNow=new Date();
    if(body.offline){
      if(facePending)return reply.code(409).send({error:'Enquanto o cadastro facial está em análise, a marcação provisória exige internet para validar a biometria digital.',code:'ONLINE_REQUIRED_DURING_FACE_REVIEW'});
      const ageMs=serverNow.getTime()-clientCapturedAt.getTime();
      if(ageMs>policy.maxOfflineAgeHours*3_600_000)return reply.code(400).send({error:`Marcação offline excede ${policy.maxOfflineAgeHours}h e não pode ser sincronizada automaticamente`});
      if(ageMs<-(policy.maxFutureClockSkewMinutes*60_000))return reply.code(400).send({error:'Relógio do dispositivo está adiantado além da tolerância permitida'});
    }
    const occurredAt=body.offline?clientCapturedAt:serverNow;
    let challengeVerified=false; let livenessAction:string|undefined; let challengeId:string|undefined;
    if(!body.offline){
      if(!body.challengeId)return reply.code(400).send({error:'Desafio de marcação obrigatório'});
      const challenge=await prisma.punchChallenge.findFirst({where:{id:body.challengeId,tenantId:request.user.tenantId,employeeId:employee.id,type:body.type,usedAt:null,expiresAt:{gt:new Date()}}});
      if(!challenge)return reply.code(400).send({error:'Desafio expirado, inválido ou já utilizado'});
      const consumed=await prisma.punchChallenge.updateMany({where:{id:challenge.id,usedAt:null},data:{usedAt:new Date()}});if(!consumed.count)return reply.code(409).send({error:'Desafio já utilizado'});
      challengeVerified=true;challengeId=challenge.id;livenessAction=challenge.livenessAction;
    } else if(!policy.allowOffline) return reply.code(403).send({error:'A empresa não permite marcação offline'});

    const biometric=await verifyBiometricProof(app,body.biometricProofToken,request.user,challengeId);
    const face=facePending?{
      storageKey:undefined,faceDetected:false,faceCount:0,faceQualityScore:0,faceMatchScore:0,faceVerified:false,livenessScore:0,livenessOk:false,antiSpoofScore:0,antiSpoofOk:false,
      missing:[] as string[],reasons:['Cadastro facial ainda em análise: identidade provisoriamente confirmada pela biometria digital/passkey do dispositivo']
    }:await verifyFaceEvidence(request.user.tenantId,employee.id,{selfieDataUrl:body.selfieDataUrl,embedding:body.faceEmbedding,faceCount:body.faceCount,faceDetected:(body.faceCount??0)>0,faceQualityScore:body.faceQualityScore,livenessScore:body.livenessScore,antiSpoofScore:body.antiSpoofScore,livenessChallengePassed:body.livenessChallengePassed,livenessAction},`punch-${employee.id}`);
    const presence=await evaluatePresence({tenantId:request.user.tenantId,employeeId:employee.id,latitude:body.latitude,longitude:body.longitude,accuracyM:body.accuracyM,altitudeM:body.altitudeM,altitudeAccuracyM:body.altitudeAccuracyM,headingDeg:body.headingDeg,speedMps:body.speedMps,locationCapturedAt:body.locationCapturedAt,deviceFingerprint:body.deviceFingerprint,dynamicQrToken:body.dynamicQrToken,networkGatewayToken:body.networkGatewayToken,bluetoothName:body.bluetoothName,nfcTagId:body.nfcTagId});
    const appIntegrityStatus=webIntegrityStatus(request,body.clientSecureContext);
    const effectivePolicy={...policy,requirePlatformBiometric:true,...(facePending?{requireSelfie:false,requireFaceMatch:false,requireLiveness:false,requireAntiSpoof:false,blockWithoutEnrollment:false,blockOnFaceFailure:false}:{})};
    const evaluated=evaluateProof({policy:effectivePolicy,offline:body.offline,challengeVerified,selfiePresent:Boolean(body.selfieDataUrl),face,presence,deviceFingerprint:body.deviceFingerprint,platformBiometricVerified:biometric.verified,webAuthnCredentialId:biometric.credentialId,appIntegrityStatus});
    const proof=facePending&&evaluated.decision!=='BLOCKED'?{...evaluated,score:Math.min(evaluated.score,89),proofLevel:'PROVISORIA_BIOMETRIA_DISPOSITIVO',decision:'APPROVED' as const,reasons:[...evaluated.reasons,'Reconhecimento facial ainda em análise; esta marcação foi aceita provisoriamente com biometria digital e fica registrada com nível de prova provisório até a ativação facial.']}:evaluated;

    if(proof.decision==='BLOCKED'){
      const reason=`Marcação bloqueada: ${proof.missingRequirements.join(', ')||'política de segurança'}`;
      await prisma.punchAttempt.upsert({where:{tenantId_clientEventId:{tenantId:request.user.tenantId,clientEventId:body.clientEventId}},update:{},create:{tenantId:request.user.tenantId,employeeId:employee.id,clientEventId:body.clientEventId,type:body.type,decision:PunchDecision.BLOCKED,reason,selfieStorageKey:face.storageKey,faceMatchScore:face.faceMatchScore,livenessScore:face.livenessScore,antiSpoofScore:face.antiSpoofScore,deviceFingerprint:body.deviceFingerprint,latitude:body.latitude,longitude:body.longitude,metadataJson:{proofScore:proof.score,proofLevel:proof.proofLevel,missingRequirements:proof.missingRequirements,reasons:proof.reasons,livenessAction,challengeId}}});
      await prisma.auditEvent.create({data:{tenantId:request.user.tenantId,actorUserId:request.user.userId,action:'PUNCH_BLOCKED',entityType:'PunchAttempt',entityId:body.clientEventId,metadataJson:{type:body.type,proofScore:proof.score,missingRequirements:proof.missingRequirements}}});
      const biometricFailure=proof.missingRequirements.some(code=>['SELFIE','FACE_DETECTED','FACE_QUALITY','LIVENESS','ANTI_SPOOF','FACE_MATCH'].includes(code));
      if(biometricFailure){
        const failed=await prisma.employee.update({where:{id:employee.id},data:{failedBiometricAttempts:{increment:1}},select:{failedBiometricAttempts:true}});
        if(failed.failedBiometricAttempts>=policy.maxFailedBiometricAttempts){
          const until=new Date(Date.now()+policy.biometricLockoutMinutes*60_000);
          await prisma.employee.update({where:{id:employee.id},data:{biometricLockedUntil:until}});
          await prisma.alert.create({data:{tenantId:request.user.tenantId,employeeId:employee.id,severity:'HIGH',code:'BIOMETRIC_LOCKOUT',title:'Biometria temporariamente bloqueada',description:`${failed.failedBiometricAttempts} falhas biométricas consecutivas. Bloqueado até ${until.toISOString()}.`}});
        }
      }
      return reply.code(403).send({error:'Marcação não concluída. A validação de identidade/presença falhou.',decision:'BLOCKED',proof:{proofScore:proof.score,proofLevel:proof.proofLevel,reasonsJson:proof.reasons,missingRequirements:proof.missingRequirements,checks:proof.checks}});
    }

    if(employee.failedBiometricAttempts>0||employee.biometricLockedUntil)await prisma.employee.update({where:{id:employee.id},data:{failedBiometricAttempts:0,biometricLockedUntil:null}});
    const previous=await prisma.punch.findFirst({where:{tenantId:request.user.tenantId,employeeId:employee.id,decision:{not:'BLOCKED'}},orderBy:{recordNumber:'desc'}});
    const sequenceOdd=previous?!validPrevious[body.type].includes(previous.type):body.type!==PunchType.CLOCK_IN;
    const decision=proof.decision==='REVIEW'||sequenceOdd?PunchDecision.REVIEW:PunchDecision.APPROVED;
    const punch=await createImmutablePunch({tenantId:request.user.tenantId,clientEventId:body.clientEventId,employeeId:employee.id,actorUserId:request.user.userId,type:body.type,occurredAt,timezone:body.timezone,source:body.offline?'WEB_PWA_OFFLINE_SYNC':'WEB_PWA',offline:body.offline,decision,reviewReason:sequenceOdd?'Sequência de marcação fora do fluxo esperado':proof.decision==='REVIEW'?'Política exige revisão':undefined,evidence:{
      challengeId,latitude:body.latitude,longitude:body.longitude,accuracyM:body.accuracyM,worksiteId:presence.worksiteId,geofenceOk:presence.geofenceOk,deviceFingerprint:body.deviceFingerprint,deviceTrusted:presence.deviceTrusted,
      selfieStorageKey:face.storageKey,selfieCapturedAt:body.selfieDataUrl?new Date():undefined,clientCapturedAt,faceDetected:face.faceDetected,faceCount:face.faceCount,faceQualityScore:face.faceQualityScore,faceMatchScore:face.faceMatchScore,faceVerified:face.faceVerified,
      livenessScore:face.livenessScore,livenessOk:face.livenessOk,antiSpoofScore:face.antiSpoofScore,antiSpoofOk:face.antiSpoofOk,livenessAction,livenessChallengePassed:Boolean(body.livenessChallengePassed),platformBiometricVerified:biometric.verified,webAuthnCredentialId:biometric.credentialId,
      mockLocationRisk:presence.mockLocationRisk,gpsAccuracyOk:presence.accuracyOk,appIntegrityStatus,locationTelemetry:presence.locationTelemetry,riskSignals:presence.riskSignals,networkAttested:presence.networkAttested,bluetoothAttested:presence.bluetoothAttested,nfcAttested:presence.nfcAttested,dynamicQrAttested:presence.dynamicQrAttested,offlinePayloadHash:body.offlinePayloadHash,
      proofScore:proof.score,proofLevel:proof.proofLevel,reasons:proof.reasons,missingRequirements:proof.missingRequirements
    }});

    if(sequenceOdd)await prisma.alert.create({data:{tenantId:request.user.tenantId,employeeId:employee.id,severity:'MEDIUM',code:'PUNCH_SEQUENCE',title:'Sequência de marcação para revisar',description:`Nova marcação ${body.type} após ${previous?.type??'nenhuma marcação anterior'}.`}});
    if(decision==='REVIEW'||proof.score<75)await prisma.alert.create({data:{tenantId:request.user.tenantId,employeeId:employee.id,severity:proof.score<50?'HIGH':'MEDIUM',code:'PUNCH_REVIEW',title:'Marcação aguardando revisão de integridade',description:`A marcação #${punch.recordNumber.toString()} recebeu ${proof.score}/100 e status ${decision}.`}});
    const workDate=localDateKey(occurredAt,body.timezone);await persistEmployeeLedger(employee.id,request.user.tenantId,workDate,workDate);
    return reply.code(201).send({id:punch.id,recordNumber:punch.recordNumber.toString(),type:punch.type,occurredAt:punch.occurredAt,receivedAt:punch.receivedAt,integrityHash:punch.integrityHash,previousHash:punch.previousHash,decision:punch.decision,proof:punch.evidence,duplicate:false});
  });

  app.get('/punches/me',{preHandler:[app.authenticate]},async(request:any,reply)=>{
    if(!request.user.employeeId)return reply.code(403).send({error:'Usuário sem vínculo de colaborador'});
    const [punches,adjustments]=await Promise.all([prisma.punch.findMany({where:{tenantId:request.user.tenantId,employeeId:request.user.employeeId},include:{evidence:true},orderBy:[{occurredAt:'desc'},{recordNumber:'desc'}],take:150}),prisma.adjustmentRequest.findMany({where:{tenantId:request.user.tenantId,employeeId:request.user.employeeId,status:'APPROVED',targetPunchId:{not:null}},select:{targetPunchId:true,resultingPunchId:true}})]);
    const superseded=new Set(adjustments.map(a=>a.targetPunchId).filter(Boolean));return punches.map(p=>({...p,recordNumber:p.recordNumber.toString(),proof:p.evidence,superseded:superseded.has(p.id)}));
  });

  app.get('/punches/:id/proof',{preHandler:[app.authenticate]},async(request:any,reply)=>{
    const {id}=z.object({id:z.string()}).parse(request.params);const punch=await prisma.punch.findFirst({where:{id,tenantId:request.user.tenantId},include:{evidence:true,employee:{select:{id:true,name:true,employeeNumber:true}}}});if(!punch)return reply.code(404).send({error:'Marcação não encontrada'});if(!(await canSeeEmployee(request.user,punch.employeeId)))return reply.code(403).send({error:'Sem permissão'});return {...punch,recordNumber:punch.recordNumber.toString()};
  });

  app.get('/integrity/verify/:employeeId',{preHandler:[app.authenticate]},async(request:any,reply)=>{
    const {employeeId}=z.object({employeeId:z.string()}).parse(request.params);if(!(await canSeeEmployee(request.user,employeeId)))return reply.code(403).send({error:'Sem permissão'});
    const punches=await prisma.punch.findMany({where:{tenantId:request.user.tenantId,employeeId},include:{evidence:true},orderBy:{recordNumber:'asc'}});let previousHash:string|null=null;const failures:Array<{id:string;reason:string}>=[];
    for(const p of punches){
      if((p.previousHash??null)!==previousHash)failures.push({id:p.id,reason:'previousHash divergente'});const e=p.evidence;if(!e){failures.push({id:p.id,reason:'evidência ausente'});previousHash=p.integrityHash;continue;}
      const hashPayload=buildPunchHashPayload({tenantId:p.tenantId,clientEventId:p.clientEventId,employeeId:p.employeeId,type:p.type,occurredAt:p.occurredAt,timezone:p.timezone,source:p.source,offline:p.offline,previousHash:p.previousHash,evidence:{challengeId:e.challengeId??undefined,latitude:e.latitude??undefined,longitude:e.longitude??undefined,accuracyM:e.accuracyM??undefined,worksiteId:e.worksiteId??undefined,geofenceOk:e.geofenceOk??undefined,deviceFingerprint:e.deviceFingerprint??undefined,deviceTrusted:e.deviceTrusted,selfieStorageKey:e.selfieStorageKey??undefined,selfieCapturedAt:e.selfieCapturedAt??undefined,clientCapturedAt:e.clientCapturedAt??undefined,faceDetected:e.faceDetected,faceCount:e.faceCount,faceQualityScore:e.faceQualityScore??undefined,faceMatchScore:e.faceMatchScore??undefined,faceVerified:e.faceVerified,livenessScore:e.livenessScore??undefined,livenessOk:e.livenessOk??undefined,antiSpoofScore:e.antiSpoofScore??undefined,antiSpoofOk:e.antiSpoofOk??undefined,livenessAction:e.livenessAction??undefined,livenessChallengePassed:e.livenessChallengePassed,platformBiometricVerified:e.platformBiometricVerified,webAuthnCredentialId:e.webAuthnCredentialId??undefined,mockLocationRisk:e.mockLocationRisk,gpsAccuracyOk:e.gpsAccuracyOk??undefined,appIntegrityStatus:e.appIntegrityStatus,locationTelemetry:(e.locationTelemetryJson&&typeof e.locationTelemetryJson==='object'?e.locationTelemetryJson as Record<string,unknown>:undefined),riskSignals:Array.isArray(e.riskSignalsJson)?e.riskSignalsJson as string[]:[],networkAttested:e.networkAttested??undefined,bluetoothAttested:e.bluetoothAttested??undefined,nfcAttested:e.nfcAttested??undefined,dynamicQrAttested:e.dynamicQrAttested??undefined,offlinePayloadHash:e.offlinePayloadHash??undefined,proofScore:e.proofScore,proofLevel:e.proofLevel,reasons:Array.isArray(e.reasonsJson)?e.reasonsJson as string[]:[],missingRequirements:Array.isArray(e.missingRequirementsJson)?e.missingRequirementsJson as string[]:[]}});
      if(sha256(canonicalize(hashPayload))!==p.integrityHash)failures.push({id:p.id,reason:'integrityHash inválido'});previousHash=p.integrityHash;
    }
    return {valid:failures.length===0,records:punches.length,failures,lastHash:previousHash};
  });
}
