import { prisma } from '../lib/prisma.js';
import { removeEncryptedEvidence } from './biometric-storage.service.js';

export async function runBiometricRetention() {
  const tenants=await prisma.tenant.findMany({select:{id:true,securitySettings:true}});
  let deletedPunchSelfies=0, deletedAttempts=0, purgedFaceReferences=0;
  for(const tenant of tenants){
    const selfieDays=tenant.securitySettings?.selfieRetentionDays ?? 90;
    const blockedDays=tenant.securitySettings?.blockedAttemptRetentionDays ?? 30;
    const revokedFaceDays=tenant.securitySettings?.revokedFaceReferenceRetentionDays ?? 30;
    const selfieCutoff=new Date(Date.now()-selfieDays*86400000);
    const attemptCutoff=new Date(Date.now()-blockedDays*86400000);
    const revokedFaceCutoff=new Date(Date.now()-revokedFaceDays*86400000);
    const evidences=await prisma.punchEvidence.findMany({where:{punch:{tenantId:tenant.id},selfieStorageKey:{not:null},selfiePurgedAt:null,createdAt:{lt:selfieCutoff}},select:{id:true,selfieStorageKey:true},take:500});
    for(const evidence of evidences){
      if(evidence.selfieStorageKey)await removeEncryptedEvidence(evidence.selfieStorageKey).catch(()=>{});
      await prisma.punchEvidence.update({where:{id:evidence.id},data:{selfiePurgedAt:new Date()}}); deletedPunchSelfies++;
    }
    const attempts=await prisma.punchAttempt.findMany({where:{tenantId:tenant.id,attemptedAt:{lt:attemptCutoff}},select:{id:true,selfieStorageKey:true},take:500});
    for(const attempt of attempts){if(attempt.selfieStorageKey)await removeEncryptedEvidence(attempt.selfieStorageKey).catch(()=>{});await prisma.punchAttempt.delete({where:{id:attempt.id}});deletedAttempts++;}
    const revoked=await prisma.faceReference.findMany({where:{tenantId:tenant.id,revokedAt:{lt:revokedFaceCutoff},purgedAt:null},select:{id:true,storageKey:true},take:500});
    for(const ref of revoked){if(ref.storageKey)await removeEncryptedEvidence(ref.storageKey).catch(()=>{});await prisma.faceReference.update({where:{id:ref.id},data:{storageKey:null,embeddingEncrypted:null,purgedAt:new Date()}});purgedFaceReferences++;}
  }
  return {deletedPunchSelfies,deletedAttempts,purgedFaceReferences};
}
