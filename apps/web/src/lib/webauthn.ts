import { browserSupportsWebAuthn,startAuthentication,startRegistration } from '@simplewebauthn/browser';
import { api } from './api';

export function supportsWebAuthn(){return browserSupportsWebAuthn();}
export async function enrollPlatformBiometric(label?:string){
  if(!browserSupportsWebAuthn())throw new Error('Este navegador/dispositivo não oferece WebAuthn/passkeys.');
  const options=await api<any>('/security/webauthn/register/options',{method:'POST',body:'{}'});
  const response=await startRegistration({optionsJSON:options});
  return api<{verified:boolean}>('/security/webauthn/register/verify',{method:'POST',body:JSON.stringify({response,label})});
}
export async function performPlatformBiometric(punchChallengeId:string){
  if(!browserSupportsWebAuthn())throw new Error('Biometria/passkey indisponível neste navegador.');
  const options=await api<any>('/security/webauthn/auth/options',{method:'POST',body:JSON.stringify({punchChallengeId})});
  const response=await startAuthentication({optionsJSON:options});
  return api<{verified:boolean;biometricProofToken:string;credentialId:string}>('/security/webauthn/auth/verify',{method:'POST',body:JSON.stringify(response)});
}
