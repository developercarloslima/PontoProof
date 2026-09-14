import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authRoutes } from './routes/auth.js';
import { meRoutes } from './routes/me.js';
import { punchRoutes } from './routes/punches.js';
import { adjustmentRoutes } from './routes/adjustments.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { deviceRoutes } from './routes/devices.js';
import { assistantRoutes } from './routes/assistant.js';
import { adminRoutes } from './routes/admin.js';
import { timeRoutes } from './routes/time.js';
import { payrollRoutes } from './routes/payroll.js';
import { auditRoutes } from './routes/audit.js';
import { securityRoutes } from './routes/security.js';
import { runBiometricRetention } from './services/retention.service.js';
import { getOnboardingState } from './services/onboarding.service.js';
import { runFaceEnrollmentWorkerOnce } from './services/face-enrollment-async.service.js';

const app = Fastify({ logger: true, bodyLimit: 8 * 1024 * 1024 });

// Render exposes the public hostname automatically. In a single-service deployment
// we can derive the WebAuthn RP and browser origin from it without hardcoding a URL.
const renderHostname = process.env.RENDER_EXTERNAL_HOSTNAME?.trim();
const inferredOrigin = renderHostname ? `https://${renderHostname}` : undefined;
if (!process.env.WEB_ORIGIN && inferredOrigin) process.env.WEB_ORIGIN = inferredOrigin;
if (!process.env.WEBAUTHN_RP_ID && renderHostname) process.env.WEBAUTHN_RP_ID = renderHostname;
if (!process.env.WEBAUTHN_ORIGIN && inferredOrigin) process.env.WEBAUTHN_ORIGIN = inferredOrigin;

const jwtSecret = process.env.JWT_SECRET ?? 'dev-secret-change-me';
if (process.env.NODE_ENV === 'production') {
  if(jwtSecret.length < 32) throw new Error('JWT_SECRET deve ter pelo menos 32 caracteres em produção');
  for(const key of ['BIOMETRIC_ENCRYPTION_KEY','AUDIT_PRIVACY_HASH_KEY','PRESENCE_SIGNING_SECRET','WEBAUTHN_RP_ID','WEBAUTHN_ORIGIN'] as const){if(!process.env[key])throw new Error(`${key} é obrigatória em produção`);}
  if(!String(process.env.WEBAUTHN_ORIGIN).startsWith('https://'))throw new Error('WEBAUTHN_ORIGIN deve usar HTTPS em produção');
}
await app.register(cors, { origin: process.env.WEB_ORIGIN?.split(',') ?? true, credentials: true });
await app.register(helmet);
await app.register(rateLimit, { max: 180, timeWindow: '1 minute' });
await app.register(jwt, { secret: jwtSecret });

app.decorate('authenticate', async function(request: any, reply: any) {
  try { await request.jwtVerify(); }
  catch { return reply.code(401).send({ error: 'Não autenticado' }); }
  const path = String(request.routeOptions?.url ?? request.url ?? '').split('?')[0];
  const onboardingAllowed = [
    '/auth/onboarding-status', '/auth/change-password', '/security/status',
    '/security/biometric-notice', '/security/biometric-notice/acknowledge',
    '/security/face-enrollment/challenge', '/security/face-enrollment',
    '/security/face-enrollment/submit', '/security/face-enrollment/submission/latest',
    '/security/webauthn/register/options', '/security/webauthn/register/verify'
  ];
  const onboardingDynamicAllowed = path.startsWith('/security/face-enrollment/submission/') && path.endsWith('/retry');
  if (!onboardingAllowed.includes(path) && !onboardingDynamicAllowed) {
    const onboarding = await getOnboardingState(request.user.userId);
    if (!onboarding.accessReady) return reply.code(428).send({ error: 'Primeiro acesso incompleto. Troque a senha, reconheça o aviso, envie as fotos e cadastre a biometria do dispositivo.', code: 'ONBOARDING_REQUIRED', onboarding });
  }
});

declare module 'fastify' { interface FastifyInstance { authenticate: any } }

app.get('/health', async () => ({ ok: true, service: 'pontoproof', version: '0.4.6', at: new Date().toISOString() }));
await app.register(authRoutes);
await app.register(meRoutes);
await app.register(punchRoutes);
await app.register(adjustmentRoutes);
await app.register(dashboardRoutes);
await app.register(deviceRoutes);
await app.register(assistantRoutes);
await app.register(adminRoutes);
await app.register(timeRoutes);
await app.register(payrollRoutes);
await app.register(auditRoutes);
await app.register(securityRoutes);

// Render deployment: serve the Vite build from the same Fastify process.
// This keeps WebAuthn, cookies/CORS and the API under one HTTPS origin.
if (process.env.SERVE_WEB === 'true') {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const webDist = path.resolve(currentDir, '../../web/dist');
  await app.register(fastifyStatic, { root: webDist, prefix: '/', setHeaders(res:any,filePath:string){
    if(filePath.includes(`${path.sep}models${path.sep}human${path.sep}`)) res.setHeader('Cache-Control','public, max-age=604800, immutable');
  } });
}

app.setErrorHandler((error, _request, reply) => {
  app.log.error(error);
  const status = (error as any).statusCode ?? ((error as any).name === 'ZodError' ? 400 : 500);
  const message = status === 500 ? 'Erro interno' : (error instanceof Error ? error.message : 'Erro de requisição');
  reply.code(status >= 400 && status < 600 ? status : 500).send({ error: message });
});

const port = Number(process.env.PORT ?? process.env.API_PORT ?? 3333);
await app.listen({ port, host: '0.0.0.0' });

// Privacy-by-design: remove punch selfies and blocked attempts after the tenant retention window.
const retentionTimer=setInterval(()=>runBiometricRetention().then(r=>app.log.info({retention:r},'biometric retention completed')).catch(err=>app.log.error(err,'biometric retention failed')),6*60*60*1000);
retentionTimer.unref();
setTimeout(()=>runBiometricRetention().catch(err=>app.log.error(err,'initial biometric retention failed')),15_000).unref();

// Durable asynchronous enrollment worker: jobs live in PostgreSQL and are resumed after restarts.
const faceWorkerTimer=setInterval(()=>runFaceEnrollmentWorkerOnce().catch(err=>app.log.error(err,'async face enrollment worker failed')),2500);
faceWorkerTimer.unref();
setTimeout(()=>runFaceEnrollmentWorkerOnce().catch(err=>app.log.error(err,'initial async face enrollment worker failed')),3000).unref();
