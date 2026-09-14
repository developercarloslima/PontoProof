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

declare module 'jpeg-js' {
  export type DecodeResult = { width:number; height:number; data:Uint8Array };
  export function decode(data: Buffer | Uint8Array, options?: Record<string,unknown>): DecodeResult;
  const jpeg: { decode: typeof decode };
  export default jpeg;
}
