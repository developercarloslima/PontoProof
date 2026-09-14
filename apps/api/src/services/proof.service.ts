import type { AttendanceSecuritySettings } from '@prisma/client';

type Face = {
  storageKey?: string; faceDetected: boolean; faceCount: number; faceQualityScore: number; faceMatchScore: number;
  faceVerified: boolean; livenessScore: number; livenessOk: boolean; antiSpoofScore: number; antiSpoofOk: boolean;
  missing: string[]; reasons: string[];
};
type Presence = {
  locationPresent:boolean; worksiteId?: string; geofenceOk?: boolean; accuracyOk: boolean; deviceTrusted: boolean; mockLocationRisk: boolean;
  dynamicQrAttested: boolean; networkAttested: boolean; bluetoothAttested: boolean; nfcAttested: boolean; missing: string[];
};

type Input = {
  policy: AttendanceSecuritySettings;
  offline: boolean;
  challengeVerified: boolean;
  selfiePresent: boolean;
  face: Face;
  presence: Presence;
  deviceFingerprint?: string;
  platformBiometricVerified: boolean;
  webAuthnCredentialId?: string;
  appIntegrityStatus: string;
};

type Check = { code:string; label:string; weight:number; applicable:boolean; required:boolean; passed:boolean; detail?:string };

export function evaluateProof(input: Input) {
  const p = input.policy;
  const checks: Check[] = [
    { code:'AUTH_SESSION', label:'Sessão autenticada e colaborador ativo', weight:8, applicable:true, required:true, passed:true },
    { code:'SERVER_TIME', label:'Horário do evento determinado pelo servidor', weight:5, applicable:true, required:!input.offline, passed:!input.offline },
    { code:'CHALLENGE', label:'Nonce/challenge único válido', weight:7, applicable:!input.offline, required:!input.offline, passed:input.challengeVerified },
    { code:'SELFIE', label:'Selfie capturada no ato', weight:8, applicable:p.requireSelfie || input.selfiePresent, required:p.requireSelfie, passed:input.selfiePresent },
    { code:'FACE_DETECTED', label:'Exatamente um rosto detectado', weight:5, applicable:p.requireSelfie || input.selfiePresent, required:p.requireSelfie, passed:input.face.faceDetected && input.face.faceCount === 1 },
    { code:'FACE_QUALITY', label:'Qualidade facial mínima', weight:4, applicable:p.requireSelfie || input.selfiePresent, required:p.requireSelfie, passed:input.face.faceQualityScore >= p.minFaceQualityScore, detail:`${Math.round(input.face.faceQualityScore*100)}%` },
    { code:'LIVENESS', label:'Prova de vida + desafio guiado', weight:11, applicable:p.requireLiveness || input.face.livenessScore > 0, required:p.requireLiveness, passed:input.face.livenessOk, detail:`${Math.round(input.face.livenessScore*100)}%` },
    { code:'ANTI_SPOOF', label:'Antispoof (foto/tela/máscara)', weight:9, applicable:p.requireAntiSpoof || input.face.antiSpoofScore > 0, required:p.requireAntiSpoof, passed:input.face.antiSpoofOk, detail:`${Math.round(input.face.antiSpoofScore*100)}%` },
    { code:'FACE_MATCH', label:'Correspondência com cadastro facial', weight:15, applicable:p.requireFaceMatch || input.face.faceMatchScore > 0, required:p.requireFaceMatch, passed:input.face.faceVerified, detail:`${Math.round(input.face.faceMatchScore*100)}%` },
    { code:'DEVICE_ID', label:'Identificador lógico do dispositivo', weight:3, applicable:true, required:false, passed:Boolean(input.deviceFingerprint) },
    { code:'TRUSTED_DEVICE', label:'Dispositivo previamente autorizado', weight:5, applicable:p.requireTrustedDevice || input.presence.deviceTrusted, required:p.requireTrustedDevice, passed:input.presence.deviceTrusted },
    { code:'PLATFORM_BIOMETRIC', label:'Biometria/passkey do dispositivo via WebAuthn', weight:9, applicable:p.requirePlatformBiometric || input.platformBiometricVerified, required:p.requirePlatformBiometric, passed:input.platformBiometricVerified },
    { code:'GPS', label:'Coordenadas de localização presentes', weight:4, applicable:p.requireGeofence || p.requireAccurateGps || input.presence.geofenceOk !== undefined, required:p.requireGeofence || p.requireAccurateGps, passed:input.presence.locationPresent },
    { code:'GPS_ACCURACY', label:'Precisão GPS aceitável', weight:4, applicable:p.requireAccurateGps, required:p.requireAccurateGps, passed:input.presence.accuracyOk },
    { code:'GEOFENCE', label:'Dentro da geocerca autorizada', weight:6, applicable:p.requireGeofence || input.presence.geofenceOk !== undefined, required:p.requireGeofence, passed:input.presence.geofenceOk === true },
    { code:'LOCATION_PLAUSIBILITY', label:'Sem deslocamento fisicamente implausível', weight:4, applicable:true, required:true, passed:!input.presence.mockLocationRisk },
    { code:'DYNAMIC_QR', label:'QR/código dinâmico da unidade', weight:4, applicable:p.requireDynamicQr || input.presence.dynamicQrAttested, required:p.requireDynamicQr, passed:input.presence.dynamicQrAttested },
    { code:'NETWORK', label:'Gateway de rede local atestado', weight:4, applicable:p.requireNetworkAttestation || input.presence.networkAttested, required:p.requireNetworkAttestation, passed:input.presence.networkAttested },
    { code:'BLUETOOTH', label:'Beacon Bluetooth compatível', weight:4, applicable:p.requireBluetoothBeacon || input.presence.bluetoothAttested, required:p.requireBluetoothBeacon, passed:input.presence.bluetoothAttested },
    { code:'NFC', label:'Tag NFC da unidade', weight:4, applicable:p.requireNfcTag || input.presence.nfcAttested, required:p.requireNfcTag, passed:input.presence.nfcAttested },
    { code:'WEB_CONTEXT', label:'Contexto web seguro; attestation nativa indisponível no PWA', weight:3, applicable:true, required:true, passed:input.appIntegrityStatus === 'WEB_SECURE_CONTEXT' },
    { code:'LEDGER', label:'Encadeamento criptográfico no ledger', weight:6, applicable:true, required:true, passed:true }
  ];

  const applicable = checks.filter(c=>c.applicable);
  const total = applicable.reduce((s,c)=>s+c.weight,0) || 1;
  let score = Math.round(100 * applicable.reduce((s,c)=>s+(c.passed?c.weight:0),0) / total);
  const missingRequirements = applicable.filter(c=>c.required && !c.passed).map(c=>c.code);
  const reasons = [
    ...input.face.reasons,
    ...applicable.filter(c=>c.passed).map(c=>`${c.label}${c.detail?` (${c.detail})`:''}`),
    ...applicable.filter(c=>!c.passed).map(c=>`Não validado: ${c.label}${c.detail?` (${c.detail})`:''}`)
  ];

  if (input.offline) {
    reasons.push('Marcação coletada offline: validação final ocorreu somente na sincronização');
    if (p.offlineRequiresReview) score = Math.min(score, 79);
  }

  const hardFaceFailure = missingRequirements.some(code => ['SELFIE','FACE_DETECTED','FACE_QUALITY','LIVENESS','ANTI_SPOOF','FACE_MATCH'].includes(code));
  let decision: 'APPROVED'|'REVIEW'|'BLOCKED' = 'APPROVED';
  if (input.offline && !p.allowOffline) decision = 'BLOCKED';
  else if (hardFaceFailure && p.blockOnFaceFailure) decision = 'BLOCKED';
  else if (input.offline && p.offlineRequiresReview) decision = 'REVIEW';
  else if (missingRequirements.length) decision = 'BLOCKED';
  else if (score < 85) decision = 'REVIEW';

  const proofLevel = score === 100 && missingRequirements.length === 0 ? 'INTEGRIDADE_MÁXIMA' : score >= 90 ? 'FORTE' : score >= 75 ? 'BOA' : score >= 50 ? 'MODERADA' : 'BAIXA';
  return { score, proofLevel, decision, reasons, missingRequirements, checks };
}
