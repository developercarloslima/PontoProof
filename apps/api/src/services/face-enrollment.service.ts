import { FacePose } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { encryptJson, saveEncryptedImageDataUrl } from './biometric-storage.service.js';
import { getOrCreateSecuritySettings } from './security-settings.service.js';

export async function enrollFaceReference(input: {
  tenantId:string; employeeId:string; actorUserId:string; pose:FacePose; imageDataUrl:string; embedding:number[];
  faceQualityScore:number; livenessScore:number; antiSpoofScore:number; livenessChallengePassed:boolean;
}) {
  const employee = await prisma.employee.findFirst({ where:{id:input.employeeId,tenantId:input.tenantId} });
  if (!employee) throw new Error('Colaborador não encontrado');
  if (input.embedding.length < 64 || input.embedding.length > 4096 || input.embedding.some(v=>!Number.isFinite(v))) throw new Error('Embedding facial inválido');
  const policy = await getOrCreateSecuritySettings(input.tenantId);
  if (input.faceQualityScore < policy.minFaceQualityScore) throw new Error('Qualidade da foto insuficiente para cadastro facial');
  if (input.livenessScore < policy.minLivenessScore || !input.livenessChallengePassed) throw new Error('Prova de vida insuficiente no cadastro facial');
  if (input.antiSpoofScore < policy.minAntiSpoofScore) throw new Error('Antispoof insuficiente no cadastro facial');
  const stored = await saveEncryptedImageDataUrl(input.imageDataUrl, `enroll-${input.employeeId}-${input.pose}`);
  const created = await prisma.$transaction(async tx => {
    await tx.faceReference.updateMany({ where:{tenantId:input.tenantId,employeeId:input.employeeId,pose:input.pose,revokedAt:null}, data:{revokedAt:new Date()} });
    const ref = await tx.faceReference.create({ data:{
      tenantId:input.tenantId, employeeId:input.employeeId, pose:input.pose, storageKey:stored.storageKey,
      embeddingEncrypted:encryptJson(input.embedding), faceQualityScore:input.faceQualityScore,
      livenessScore:input.livenessScore, antiSpoofScore:input.antiSpoofScore, createdByUserId:input.actorUserId
    }});
    const count = await tx.faceReference.count({ where:{tenantId:input.tenantId,employeeId:input.employeeId,revokedAt:null} });
    await tx.employee.update({ where:{id:input.employeeId}, data:{
      faceEnrollmentStatus: count >= policy.faceReferenceMin ? 'ACTIVE' : 'PENDING',
      faceEnrolledAt: count >= policy.faceReferenceMin ? new Date() : null,
      faceTemplateVersion:{increment:1}
    }});
    await tx.auditEvent.create({ data:{tenantId:input.tenantId,actorUserId:input.actorUserId,action:'FACE_REFERENCE_ENROLLED',entityType:'Employee',entityId:input.employeeId,metadataJson:{pose:input.pose,referenceId:ref.id,quality:input.faceQualityScore,liveness:input.livenessScore,antiSpoof:input.antiSpoofScore,challengePassed:input.livenessChallengePassed}} });
    return ref;
  });
  return created;
}
