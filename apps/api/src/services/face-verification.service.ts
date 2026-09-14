import { prisma } from '../lib/prisma.js';
import { decryptJson, saveEncryptedImageDataUrl } from './biometric-storage.service.js';
import { getOrCreateSecuritySettings } from './security-settings.service.js';

export type FaceTelemetry = {
  selfieDataUrl?: string;
  embedding?: number[];
  faceCount?: number;
  faceQualityScore?: number;
  livenessScore?: number;
  antiSpoofScore?: number;
  livenessChallengePassed?: boolean;
  livenessAction?: string;
  faceDetected?: boolean;
};

function cosineSimilarity(a: number[], b: number[]) {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i];
  }
  if (!aa || !bb) return 0;
  return Math.max(0, Math.min(1, dot / (Math.sqrt(aa) * Math.sqrt(bb))));
}

export async function verifyFaceEvidence(tenantId: string, employeeId: string, telemetry: FaceTelemetry, namespace: string) {
  const policy = await getOrCreateSecuritySettings(tenantId);
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, tenantId }, select: { faceEnrollmentStatus: true, selfieRequiredOnPunch: true, biometricRequired: true } });
  if (!employee) throw new Error('Colaborador não encontrado');

  const activeReferences = await prisma.faceReference.findMany({
    where: { tenantId, employeeId, revokedAt: null },
    orderBy: { createdAt: 'desc' }
  });

  const missing: string[] = [];
  const reasons: string[] = [];
  const selfieRequired = policy.requireSelfie && employee.selfieRequiredOnPunch;
  const enrollmentRequired = policy.requireFaceMatch && employee.biometricRequired;

  let storageKey: string | undefined;
  if (telemetry.selfieDataUrl) {
    storageKey = (await saveEncryptedImageDataUrl(telemetry.selfieDataUrl, namespace)).storageKey;
    reasons.push('Selfie da marcação armazenada de forma criptografada');
  } else if (selfieRequired) missing.push('SELFIE');

  if (enrollmentRequired && (employee.faceEnrollmentStatus !== 'ACTIVE' || activeReferences.length < policy.faceReferenceMin)) {
    missing.push('FACE_ENROLLMENT');
  }

  const faceCount = telemetry.faceCount ?? 0;
  const faceDetected = telemetry.faceDetected ?? faceCount === 1;
  if (selfieRequired && !faceDetected) missing.push('FACE_NOT_DETECTED');
  if (faceCount > policy.maxFaceCount) missing.push('MULTIPLE_FACES');

  const quality = telemetry.faceQualityScore ?? 0;
  if (selfieRequired && quality < policy.minFaceQualityScore) missing.push('FACE_QUALITY');

  const live = telemetry.livenessScore ?? 0;
  const antiSpoof = telemetry.antiSpoofScore ?? 0;
  if (policy.requireLiveness && (live < policy.minLivenessScore || !telemetry.livenessChallengePassed)) missing.push('LIVENESS');
  if (policy.requireAntiSpoof && antiSpoof < policy.minAntiSpoofScore) missing.push('ANTI_SPOOF');

  let faceMatchScore = 0;
  if (telemetry.embedding?.length && activeReferences.length) {
    const current = telemetry.embedding.map(Number);
    if (current.length < 64 || current.length > 4096 || current.some(v => !Number.isFinite(v))) throw new Error('Embedding facial inválido');
    for (const ref of activeReferences) {
      if(!ref.embeddingEncrypted) continue;
      const saved = decryptJson<number[]>(ref.embeddingEncrypted);
      faceMatchScore = Math.max(faceMatchScore, cosineSimilarity(saved, current));
    }
    reasons.push(`Comparação facial calculada no servidor: ${(faceMatchScore * 100).toFixed(1)}%`);
  }
  if (enrollmentRequired && faceMatchScore < policy.minFaceMatchScore) missing.push('FACE_MATCH');

  return {
    policy,
    storageKey,
    faceDetected,
    faceCount,
    faceQualityScore: quality,
    livenessScore: live,
    antiSpoofScore: antiSpoof,
    faceMatchScore,
    faceVerified: !enrollmentRequired || faceMatchScore >= policy.minFaceMatchScore,
    livenessOk: !policy.requireLiveness || (live >= policy.minLivenessScore && Boolean(telemetry.livenessChallengePassed)),
    antiSpoofOk: !policy.requireAntiSpoof || antiSpoof >= policy.minAntiSpoofScore,
    missing,
    reasons
  };
}
