import { prisma } from '../lib/prisma.js';

const mandatoryCore = {
  requireSelfie:true,
  requireFaceMatch:true,
  requireLiveness:true,
  requireAntiSpoof:true,
  requirePlatformBiometric:true,
  blockWithoutEnrollment:true,
  blockOnFaceFailure:true,
  maxFaceCount:1,
  fullIntegrityRequiresAllConfigured:true
} as const;

export async function getOrCreateSecuritySettings(tenantId: string) {
  return prisma.attendanceSecuritySettings.upsert({
    where: { tenantId },
    update: mandatoryCore,
    create: { tenantId, ...mandatoryCore }
  });
}
