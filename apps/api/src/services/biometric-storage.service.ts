import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const storageRoot = path.resolve(process.env.BIOMETRIC_STORAGE_DIR ?? './storage/biometrics');

function encryptionKey() {
  const configured = process.env.BIOMETRIC_ENCRYPTION_KEY;
  if (configured) {
    if (/^[a-f0-9]{64}$/i.test(configured)) return Buffer.from(configured, 'hex');
    const b64 = Buffer.from(configured, 'base64');
    if (b64.length === 32) return b64;
    // Render's generateValue creates a strong opaque secret, but does not guarantee
    // a 32-byte base64/64-char hex representation. Derive a fixed AES-256 key
    // from any sufficiently long generated secret instead of rejecting it.
    if (configured.length >= 32) return crypto.createHash('sha256').update(configured, 'utf8').digest();
    throw new Error('BIOMETRIC_ENCRYPTION_KEY inválida: use segredo com pelo menos 32 caracteres, 32 bytes em base64 ou 64 caracteres hexadecimais');
  }
  if(process.env.NODE_ENV==='production') throw new Error('BIOMETRIC_ENCRYPTION_KEY é obrigatória em produção');
  const fallback = process.env.JWT_SECRET ?? 'pontoproof-dev-only-biometric-key';
  return crypto.createHash('sha256').update(fallback).digest();
}

function encrypt(data: Buffer) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]);
}

function decrypt(data: Buffer) {
  if (data.length < 29) throw new Error('Evidência biométrica corrompida');
  const iv = data.subarray(0, 12);
  const tag = data.subarray(12, 28);
  const ciphertext = data.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function encryptJson(value: unknown) {
  return encrypt(Buffer.from(JSON.stringify(value), 'utf8')).toString('base64');
}

export function decryptJson<T>(value: string): T {
  return JSON.parse(decrypt(Buffer.from(value, 'base64')).toString('utf8')) as T;
}

function parseImageDataUrl(dataUrl: string) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw new Error('Formato de selfie inválido');
  const mime = match[1];
  const raw = Buffer.from(match[2], 'base64');
  if (raw.length < 5_000) throw new Error('Imagem muito pequena para validação');
  if (raw.length > 2_500_000) throw new Error('Imagem biométrica excede 2,5 MB');
  return { mime, raw };
}

/**
 * Persiste temporariamente uma imagem biométrica dentro de um campo Text/JSON do
 * PostgreSQL. É usado pelo onboarding assíncrono para que o job sobreviva a
 * sleep/restart/redeploy do Render. O payload permanece AES-256-GCM.
 */
export function encryptImageDataUrlForDatabase(dataUrl: string) {
  const { mime, raw } = parseImageDataUrl(dataUrl);
  return { encryptedData: encrypt(raw).toString('base64'), mime, byteLength: raw.length };
}

export function decryptDatabaseImage(encryptedData: string) {
  if (!encryptedData || encryptedData.length < 40) throw new Error('Imagem biométrica persistida inválida');
  return decrypt(Buffer.from(encryptedData, 'base64'));
}

export async function saveEncryptedImageDataUrl(dataUrl: string, namespace: string) {
  const { mime, raw } = parseImageDataUrl(dataUrl);
  await fs.mkdir(storageRoot, { recursive: true });
  const safeNamespace = namespace.replace(/[^a-zA-Z0-9_-]/g, '_');
  const key = `${safeNamespace}-${crypto.randomUUID()}.bin`;
  await fs.writeFile(path.join(storageRoot, key), encrypt(raw), { mode: 0o600 });
  return { storageKey: key, mime, byteLength: raw.length };
}

export async function readEncryptedImage(storageKey: string) {
  if (!/^[a-zA-Z0-9_.-]+$/.test(storageKey)) throw new Error('Chave de armazenamento inválida');
  const encrypted = await fs.readFile(path.join(storageRoot, storageKey));
  return decrypt(encrypted);
}

export async function removeEncryptedEvidence(storageKey?: string | null) {
  if (!storageKey || !/^[a-zA-Z0-9_.-]+$/.test(storageKey)) return;
  await fs.rm(path.join(storageRoot, storageKey), { force: true }).catch(() => undefined);
}
