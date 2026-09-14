import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

export async function deviceRoutes(app: FastifyInstance) {
  app.post('/devices/register', { preHandler: [app.authenticate] }, async (request, reply) => {
    if (!request.user.employeeId) return reply.code(403).send({ error: 'Usuário sem colaborador' });
    const body = z.object({ fingerprint: z.string().min(8).max(200), label: z.string().max(100).optional() }).parse(request.body);
    const device = await prisma.device.upsert({
      where: { employeeId_fingerprint: { employeeId: request.user.employeeId, fingerprint: body.fingerprint } },
      update: { label: body.label, lastSeenAt: new Date() },
      create: { employeeId: request.user.employeeId, fingerprint: body.fingerprint, label: body.label, lastSeenAt: new Date() }
    });
    return reply.code(201).send(device);
  });
}
