import { PunchDecision, PunchType, Prisma } from '@prisma/client';
import crypto from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { canonicalize, sha256 } from '../lib/hash.js';

type EvidenceInput = {
  challengeId?:string; latitude?:number; longitude?:number; accuracyM?:number; worksiteId?:string; geofenceOk?:boolean;
  deviceFingerprint?:string; deviceTrusted:boolean; selfieStorageKey?:string; selfieCapturedAt?:Date; clientCapturedAt?:Date; faceDetected:boolean; faceCount:number;
  faceQualityScore?:number; faceMatchScore?:number; faceVerified:boolean; livenessScore?:number; livenessOk?:boolean; antiSpoofScore?:number; antiSpoofOk?:boolean;
  livenessAction?:string; livenessChallengePassed:boolean; platformBiometricVerified:boolean; webAuthnCredentialId?:string;
  mockLocationRisk:boolean; gpsAccuracyOk?:boolean; appIntegrityStatus:string; locationTelemetry?:Record<string,unknown>; riskSignals?:string[]; networkAttested?:boolean; bluetoothAttested?:boolean; nfcAttested?:boolean; dynamicQrAttested?:boolean;
  offlinePayloadHash?:string; proofScore:number; proofLevel:string; reasons:string[]; missingRequirements:string[];
};

type CreatePunchInput = {
  tenantId:string; clientEventId?:string; employeeId:string; actorUserId:string; type:PunchType; occurredAt:Date; timezone:string; source:string; offline:boolean;
  decision:PunchDecision; reviewReason?:string; evidence:EvidenceInput;
};

export function buildPunchHashPayload(input:{tenantId:string;clientEventId:string;employeeId:string;type:PunchType;occurredAt:Date;timezone:string;source:string;offline:boolean;previousHash?:string|null;evidence:EvidenceInput}) {
  const e=input.evidence;
  return {
    tenantId:input.tenantId,clientEventId:input.clientEventId,employeeId:input.employeeId,type:input.type,occurredAt:input.occurredAt.toISOString(),timezone:input.timezone,source:input.source,offline:input.offline,previousHash:input.previousHash??null,
    evidence:{
      challengeId:e.challengeId??null,latitude:e.latitude??null,longitude:e.longitude??null,accuracyM:e.accuracyM??null,worksiteId:e.worksiteId??null,geofenceOk:e.geofenceOk??null,
      deviceFingerprint:e.deviceFingerprint??null,deviceTrusted:e.deviceTrusted,selfieStorageKey:e.selfieStorageKey??null,selfieCapturedAt:e.selfieCapturedAt?.toISOString()??null,clientCapturedAt:e.clientCapturedAt?.toISOString()??null,
      faceDetected:e.faceDetected,faceCount:e.faceCount,faceQualityScore:e.faceQualityScore??null,faceMatchScore:e.faceMatchScore??null,faceVerified:e.faceVerified,
      livenessScore:e.livenessScore??null,livenessOk:e.livenessOk??null,antiSpoofScore:e.antiSpoofScore??null,antiSpoofOk:e.antiSpoofOk??null,livenessAction:e.livenessAction??null,livenessChallengePassed:e.livenessChallengePassed,
      platformBiometricVerified:e.platformBiometricVerified,webAuthnCredentialId:e.webAuthnCredentialId??null,mockLocationRisk:e.mockLocationRisk,gpsAccuracyOk:e.gpsAccuracyOk??null,appIntegrityStatus:e.appIntegrityStatus,locationTelemetry:e.locationTelemetry??null,riskSignals:e.riskSignals??[],
      networkAttested:e.networkAttested??null,bluetoothAttested:e.bluetoothAttested??null,nfcAttested:e.nfcAttested??null,dynamicQrAttested:e.dynamicQrAttested??null,offlinePayloadHash:e.offlinePayloadHash??null,
      proofScore:e.proofScore,proofLevel:e.proofLevel,reasons:e.reasons,missingRequirements:e.missingRequirements
    }
  };
}

export async function createImmutablePunch(input:CreatePunchInput) {
  const clientEventId=input.clientEventId??crypto.randomUUID();
  const existing=await prisma.punch.findUnique({where:{tenantId_clientEventId:{tenantId:input.tenantId,clientEventId}},include:{evidence:true}});
  if(existing)return existing;
  try {
    return await prisma.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.employeeId}))`;
      const duplicate=await tx.punch.findUnique({where:{tenantId_clientEventId:{tenantId:input.tenantId,clientEventId}},include:{evidence:true}}); if(duplicate)return duplicate;
      const previous=await tx.punch.findFirst({where:{tenantId:input.tenantId,employeeId:input.employeeId},orderBy:{recordNumber:'desc'}});
      const hashPayload=buildPunchHashPayload({...input,clientEventId,previousHash:previous?.integrityHash});
      const integrityHash=sha256(canonicalize(hashPayload)); const e=input.evidence;
      const punch=await tx.punch.create({data:{tenantId:input.tenantId,clientEventId,employeeId:input.employeeId,type:input.type,occurredAt:input.occurredAt,timezone:input.timezone,source:input.source,offline:input.offline,previousHash:previous?.integrityHash,integrityHash,decision:input.decision,reviewReason:input.reviewReason,evidence:{create:{
        challengeId:e.challengeId,latitude:e.latitude,longitude:e.longitude,accuracyM:e.accuracyM,worksiteId:e.worksiteId,geofenceOk:e.geofenceOk,deviceFingerprint:e.deviceFingerprint,deviceTrusted:e.deviceTrusted,
        selfieStorageKey:e.selfieStorageKey,selfieCapturedAt:e.selfieCapturedAt,clientCapturedAt:e.clientCapturedAt,faceDetected:e.faceDetected,faceCount:e.faceCount,faceQualityScore:e.faceQualityScore,faceMatchScore:e.faceMatchScore,faceVerified:e.faceVerified,
        livenessScore:e.livenessScore,livenessOk:e.livenessOk,antiSpoofScore:e.antiSpoofScore,antiSpoofOk:e.antiSpoofOk,livenessAction:e.livenessAction,livenessChallengePassed:e.livenessChallengePassed,
        platformBiometricVerified:e.platformBiometricVerified,webAuthnCredentialId:e.webAuthnCredentialId,mockLocationRisk:e.mockLocationRisk,gpsAccuracyOk:e.gpsAccuracyOk,appIntegrityStatus:e.appIntegrityStatus,locationTelemetryJson:e.locationTelemetry as any,riskSignalsJson:e.riskSignals as any,
        networkAttested:e.networkAttested,bluetoothAttested:e.bluetoothAttested,nfcAttested:e.nfcAttested,dynamicQrAttested:e.dynamicQrAttested,offlinePayloadHash:e.offlinePayloadHash,
        proofScore:e.proofScore,proofLevel:e.proofLevel,reasonsJson:e.reasons,missingRequirementsJson:e.missingRequirements
      }}},include:{evidence:true}});
      await tx.auditEvent.create({data:{tenantId:input.tenantId,punchId:punch.id,actorUserId:input.actorUserId,action:'PUNCH_CREATED',entityType:'Punch',entityId:punch.id,afterJson:{id:punch.id,recordNumber:punch.recordNumber.toString(),type:punch.type,occurredAt:punch.occurredAt.toISOString(),integrityHash:punch.integrityHash,previousHash:punch.previousHash,decision:punch.decision,proofScore:e.proofScore}}});
      return punch;
    },{isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted});
  } catch(error:any) {
    if(error?.code==='P2002'){const duplicate=await prisma.punch.findUnique({where:{tenantId_clientEventId:{tenantId:input.tenantId,clientEventId}},include:{evidence:true}});if(duplicate)return duplicate;}
    throw error;
  }
}
