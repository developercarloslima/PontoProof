import crypto from 'node:crypto';
import { prisma } from '../lib/prisma.js';

export const BIOMETRIC_NOTICE_VERSION = process.env.BIOMETRIC_NOTICE_VERSION ?? '2026-09-v1';
export const BIOMETRIC_NOTICE_TEXT = process.env.BIOMETRIC_NOTICE_TEXT ?? `O PontoProof utiliza câmera, características faciais, prova de vida, dados do dispositivo e, conforme a política da empresa, localização e outras provas de presença para confirmar a identidade do colaborador no registro da jornada. Dados biométricos são tratados como dados sensíveis e devem ser protegidos, acessados somente por perfis autorizados e mantidos apenas pelo período necessário. A biometria do dispositivo (como impressão digital, Windows Hello, Touch ID ou Face ID) é validada pelo autenticador do sistema via WebAuthn; o PontoProof não recebe a impressão digital bruta. Esta ciência registra que o colaborador recebeu o aviso de tratamento biométrico; ela não substitui a definição da base legal, deveres de transparência ou demais obrigações aplicáveis da organização.`;
export const BIOMETRIC_NOTICE_HASH = crypto.createHash('sha256').update(BIOMETRIC_NOTICE_TEXT).digest('hex');

function privacyHash(value:string|undefined) {
  if(!value) return undefined;
  const secret=process.env.AUDIT_PRIVACY_HASH_KEY ?? (process.env.NODE_ENV==='production'?undefined:process.env.JWT_SECRET ?? 'pontoproof-dev-only');
  if(!secret) throw new Error('AUDIT_PRIVACY_HASH_KEY é obrigatória em produção');
  return crypto.createHmac('sha256', secret).update(value).digest('hex');
}

export async function getCurrentAcknowledgement(tenantId:string,userId:string) {
  return prisma.biometricNoticeAcknowledgement.findFirst({where:{tenantId,userId,policyVersion:BIOMETRIC_NOTICE_VERSION,noticeHash:BIOMETRIC_NOTICE_HASH,revokedAt:null},orderBy:{acknowledgedAt:'desc'}});
}

export async function acknowledgeBiometricNotice(input:{tenantId:string;userId:string;employeeId?:string;ip?:string;userAgent?:string}) {
  const existing=await getCurrentAcknowledgement(input.tenantId,input.userId); if(existing)return existing;
  return prisma.biometricNoticeAcknowledgement.create({data:{tenantId:input.tenantId,userId:input.userId,employeeId:input.employeeId,policyVersion:BIOMETRIC_NOTICE_VERSION,noticeHash:BIOMETRIC_NOTICE_HASH,ipAddressHash:privacyHash(input.ip),userAgentHash:privacyHash(input.userAgent)}});
}
