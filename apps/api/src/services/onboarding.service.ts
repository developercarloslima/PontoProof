import { prisma } from '../lib/prisma.js';
import { recoverLegacyTmpFaceEnrollmentForUser } from './face-enrollment-async.service.js';

export type OnboardingState = {
  required: boolean;
  accessReady: boolean;
  mustChangePassword: boolean;
  passwordChanged: boolean;
  biometricNoticeAcknowledged: boolean;
  faceEnrolled: boolean;
  facePending: boolean;
  faceEnrollmentStatus: string | null;
  faceEnrollmentSubmissionStatus: string | null;
  faceEnrollmentSubmissionId: string | null;
  platformBiometricEnrolled: boolean;
  completed: boolean;
  completedAt: Date | null;
};

export async function getOnboardingState(userId: string): Promise<OnboardingState> {
  // Jobs antigos do Render que dependiam de /tmp voltam somente para a etapa
  // facial. Senha, ciência biométrica e passkey permanecem intactas.
  await recoverLegacyTmpFaceEnrollmentForUser(userId);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      employee: { select: { faceEnrollmentStatus: true, faceEnrollmentSubmissions:{orderBy:{submittedAt:'desc'},take:1,select:{id:true,status:true}} } },
      webAuthnCredentials: { select: { id: true }, take: 1 },
      biometricAcknowledgements: { where: { revokedAt: null }, select: { id: true }, take: 1 }
    }
  });
  if (!user) throw new Error('Usuário não encontrado');
  const mustChangePassword = user.mustChangePassword;
  const passwordChanged = !mustChangePassword && Boolean(user.passwordChangedAt);
  const biometricNoticeAcknowledged = user.biometricAcknowledgements.length > 0;
  const faceEnrolled = user.employee?.faceEnrollmentStatus === 'ACTIVE';
  const latestSubmission=user.employee?.faceEnrollmentSubmissions?.[0]??null;
  const facePending = user.employee?.faceEnrollmentStatus === 'PENDING' && Boolean(latestSubmission && ['PENDING','PROCESSING'].includes(latestSubmission.status));
  const platformBiometricEnrolled = user.webAuthnCredentials.length > 0;

  // Usuário pode entrar no sistema enquanto as fotos estão sendo analisadas,
  // desde que senha, ciência e biometria do dispositivo já estejam concluídas.
  // Nesse período a marcação exige WebAuthn e fica provisória até a face ativar.
  const accessReady = passwordChanged && biometricNoticeAcknowledged && platformBiometricEnrolled && (faceEnrolled || facePending);
  const completed = passwordChanged && biometricNoticeAcknowledged && faceEnrolled && platformBiometricEnrolled;

  return {
    required: !accessReady,
    accessReady,
    mustChangePassword,
    passwordChanged,
    biometricNoticeAcknowledged,
    faceEnrolled,
    facePending,
    faceEnrollmentStatus:user.employee?.faceEnrollmentStatus??null,
    faceEnrollmentSubmissionStatus:latestSubmission?.status??null,
    faceEnrollmentSubmissionId:latestSubmission?.id??null,
    platformBiometricEnrolled,
    completed,
    completedAt: user.onboardingCompletedAt
  };
}

export async function refreshOnboardingCompletion(userId: string) {
  const state = await getOnboardingState(userId);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { onboardingCompletedAt: true } });
  if (state.completed && !user.onboardingCompletedAt) {
    const updated = await prisma.user.update({ where: { id: userId }, data: { onboardingCompletedAt: new Date() }, select: { onboardingCompletedAt: true } });
    return { ...state, completedAt: updated.onboardingCompletedAt };
  }
  if (!state.completed && user.onboardingCompletedAt) {
    await prisma.user.update({ where: { id: userId }, data: { onboardingCompletedAt: null } });
    return { ...state, completedAt: null };
  }
  return state;
}
