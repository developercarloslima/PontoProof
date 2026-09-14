import { FastifyInstance } from 'fastify';
import { Role } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

const AUDIT_ROLES: Role[] = [Role.ADMIN, Role.HR, Role.AUDITOR];
const SENSITIVE_KEYS = new Set(['salaryCents', 'email', 'cpf', 'cpfMasked', 'password', 'passwordHash']);

function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
    key,
    SENSITIVE_KEYS.has(key) ? '[REDACTED]' : redactSensitive(item)
  ]));
}

export async function auditRoutes(app: FastifyInstance) {
  app.get('/audit/events', { preHandler: [app.authenticate] }, async (request, reply) => {
    if (!AUDIT_ROLES.includes(request.user.role as Role)) return reply.code(403).send({ error: 'Sem permissão' });
    const events = await prisma.auditEvent.findMany({
      where: { tenantId: request.user.tenantId },
      orderBy: { createdAt: 'desc' }, take: 250
    });
    if (request.user.role !== Role.AUDITOR) return events;
    return events.map(event => ({
      ...event,
      beforeJson: redactSensitive(event.beforeJson),
      afterJson: redactSensitive(event.afterJson),
      metadataJson: redactSensitive(event.metadataJson)
    }));
  });

  app.get('/audit/employees', { preHandler: [app.authenticate] }, async (request, reply) => {
    if (!AUDIT_ROLES.includes(request.user.role as Role)) return reply.code(403).send({ error: 'Sem permissão' });
    return prisma.employee.findMany({
      where: { tenantId: request.user.tenantId },
      select: { id: true, name: true, employeeNumber: true, active: true }, orderBy: { name: 'asc' }
    });
  });
}
