import crypto from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { haversineMeters } from '../lib/geo.js';
import { getOrCreateSecuritySettings } from './security-settings.service.js';

function sign(value: string) {
  const secret=process.env.PRESENCE_SIGNING_SECRET ?? (process.env.NODE_ENV==='production'?undefined:process.env.JWT_SECRET ?? 'dev-presence-secret');
  if(!secret) throw new Error('PRESENCE_SIGNING_SECRET é obrigatório em produção');
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

export function createPresenceToken(worksiteId: string, kind: 'QR'|'NETWORK', ttlSeconds = 90, gatewayId?: string) {
  const payload = Buffer.from(JSON.stringify({ worksiteId, kind, gatewayId: gatewayId??null, exp: Math.floor(Date.now()/1000)+ttlSeconds, nonce: crypto.randomUUID() })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function verifyPresenceToken(token: string | undefined, expectedKind: 'QR'|'NETWORK') {
  if (!token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = sign(payload);
  const a = Buffer.from(signature); const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a,b)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {worksiteId:string;kind:string;gatewayId?:string|null;exp:number};
    if (decoded.kind !== expectedKind || decoded.exp < Math.floor(Date.now()/1000)) return null;
    return decoded;
  } catch { return null; }
}

export async function evaluatePresence(input: {
  tenantId: string; employeeId: string; latitude?: number; longitude?: number; accuracyM?: number; altitudeM?:number; altitudeAccuracyM?:number; headingDeg?:number; speedMps?:number; locationCapturedAt?:string;
  deviceFingerprint?: string; dynamicQrToken?: string; networkGatewayToken?: string;
  bluetoothName?: string; nfcTagId?: string;
}) {
  const policy = await getOrCreateSecuritySettings(input.tenantId);
  const [employee, device, previousPunch] = await Promise.all([
    prisma.employee.findFirst({ where: { id: input.employeeId, tenantId: input.tenantId }, include: { worksite: true } }),
    input.deviceFingerprint ? prisma.device.findUnique({ where: { employeeId_fingerprint: { employeeId: input.employeeId, fingerprint: input.deviceFingerprint } } }) : null,
    prisma.punch.findFirst({ where: { tenantId: input.tenantId, employeeId: input.employeeId }, include: { evidence: true }, orderBy: { recordNumber: 'desc' } })
  ]);
  if (!employee) throw new Error('Colaborador não encontrado');

  const locationPresent = input.latitude != null && input.longitude != null;
  let worksiteId: string | undefined;
  let geofenceOk: boolean | undefined;
  let distanceM: number | undefined;
  if (input.latitude != null && input.longitude != null) {
    const worksites = employee.worksite?.active ? [employee.worksite] : await prisma.worksite.findMany({ where: { tenantId: input.tenantId, active: true } });
    const nearest = worksites.map(w => ({w,d:haversineMeters(input.latitude!,input.longitude!,w.latitude,w.longitude)})).sort((a,b)=>a.d-b.d)[0];
    if (nearest) { worksiteId = nearest.w.id; distanceM = nearest.d; geofenceOk = nearest.d <= nearest.w.radiusM + Math.min(input.accuracyM ?? 0, 250); }
  }
  const accuracyOk = input.accuracyM != null ? input.accuracyM <= policy.maxGpsAccuracyM : false;
  const riskSignals:string[]=[];
  let mockLocationRisk = false;
  if (input.accuracyM != null && (input.accuracyM <= 0 || !Number.isFinite(input.accuracyM))) riskSignals.push('GPS_ACCURACY_INVALID');
  if (input.speedMps != null && input.speedMps > 100) riskSignals.push('GPS_REPORTED_SPEED_EXTREME');
  if (input.locationCapturedAt) { const ageMs=Date.now()-new Date(input.locationCapturedAt).getTime(); if(Number.isFinite(ageMs)&&ageMs>60_000) riskSignals.push('GPS_POSITION_STALE'); }
  if (previousPunch?.evidence?.latitude != null && previousPunch.evidence.longitude != null && input.latitude != null && input.longitude != null) {
    const meters = haversineMeters(previousPunch.evidence.latitude, previousPunch.evidence.longitude, input.latitude, input.longitude);
    const hours = Math.max(1/3600, (Date.now() - previousPunch.receivedAt.getTime()) / 3_600_000);
    if ((meters/1000)/hours > 350) { mockLocationRisk = true; riskSignals.push('IMPOSSIBLE_TRAVEL_BETWEEN_PUNCHES'); }
  }

  const qr = verifyPresenceToken(input.dynamicQrToken, 'QR');
  const network = verifyPresenceToken(input.networkGatewayToken, 'NETWORK');
  const expectedWorksite = employee.worksite;
  const dynamicQrAttested = Boolean(qr && (!expectedWorksite || qr.worksiteId === expectedWorksite.id));
  const networkAttested = Boolean(network && (!expectedWorksite || (network.worksiteId === expectedWorksite.id && (!expectedWorksite.networkGatewayId || network.gatewayId === expectedWorksite.networkGatewayId))));
  const bluetoothAttested = Boolean(expectedWorksite?.bluetoothNamePrefix && input.bluetoothName?.startsWith(expectedWorksite.bluetoothNamePrefix));
  const nfcAttested = Boolean(expectedWorksite?.nfcTagId && input.nfcTagId === expectedWorksite.nfcTagId);

  const missing: string[] = [];
  if (policy.requireGeofence && !geofenceOk) missing.push('GEOFENCE');
  if (policy.requireAccurateGps && !accuracyOk) missing.push('GPS_ACCURACY');
  if (policy.requireTrustedDevice && !device?.trusted) missing.push('TRUSTED_DEVICE');
  if (policy.requireDynamicQr && !dynamicQrAttested) missing.push('DYNAMIC_QR');
  if (policy.requireNetworkAttestation && !networkAttested) missing.push('NETWORK_ATTESTATION');
  if (policy.requireBluetoothBeacon && !bluetoothAttested) missing.push('BLUETOOTH_BEACON');
  if (policy.requireNfcTag && !nfcAttested) missing.push('NFC_TAG');
  if (riskSignals.length) mockLocationRisk = true;
  if (mockLocationRisk) missing.push('LOCATION_PLAUSIBILITY');

  return { policy, locationPresent, worksiteId, geofenceOk, distanceM, accuracyOk, deviceTrusted:Boolean(device?.trusted), mockLocationRisk, riskSignals, locationTelemetry:{accuracyM:input.accuracyM??null,altitudeM:input.altitudeM??null,altitudeAccuracyM:input.altitudeAccuracyM??null,headingDeg:input.headingDeg??null,speedMps:input.speedMps??null,locationCapturedAt:input.locationCapturedAt??null,distanceToWorksiteM:distanceM??null}, dynamicQrAttested, networkAttested, bluetoothAttested, nfcAttested, missing };
}
