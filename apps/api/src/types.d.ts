import '@fastify/jwt';

type PontoProofJwtPayload = {
  userId: string;
  tenantId: string;
  role: string;
  employeeId?: string;
  kind?: 'PUNCH_BIOMETRIC' | 'FACE_ENROLLMENT';
  livenessAction?: string;
  facePose?: string;
  credentialId?: string;
  punchChallengeId?: string | null;
  jti?: string;
};

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: PontoProofJwtPayload;
    user: PontoProofJwtPayload;
  }
}
