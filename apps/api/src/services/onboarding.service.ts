import { prisma } from '../lib/prisma.js';

export type OnboardingState = {
  required: boolean;
  mustChangePassword: boolean;
  passwordChanged: boolean;
  biometricNoticeAcknowledged: boolean;
  faceEnrolled: boolean;
  platformBiometricEnrolled: boolean;
  completed: boolean;
  completedAt: Date | null;
};

export async function getOnboardingState(userId: string): Promise<OnboardingState> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      employee: { select: { faceEnrollmentStatus: true } },
      webAuthnCredentials: { select: { id: true }, take: 1 },
      biometricAcknowledgements: { where: { revokedAt: null }, select: { id: true }, take: 1 }
    }
  });
  if (!user) throw new Error('Usuário não encontrado');
  const mustChangePassword = user.mustChangePassword;
  const passwordChanged = !mustChangePassword && Boolean(user.passwordChangedAt);
  const biometricNoticeAcknowledged = user.biometricAcknowledgements.length > 0;
  const faceEnrolled = user.employee?.faceEnrollmentStatus === 'ACTIVE';
  const platformBiometricEnrolled = user.webAuthnCredentials.length > 0;
  const completed = passwordChanged && biometricNoticeAcknowledged && faceEnrolled && platformBiometricEnrolled;
  return {
    required: !completed,
    mustChangePassword,
    passwordChanged,
    biometricNoticeAcknowledged,
    faceEnrolled,
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
