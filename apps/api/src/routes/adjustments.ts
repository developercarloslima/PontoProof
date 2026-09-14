import { FastifyInstance } from 'fastify';
import { PunchDecision, PunchType, Role } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { createImmutablePunch } from '../services/punch.service.js';
import { localDateKey } from '../lib/time.js';
import { persistEmployeeLedger } from '../services/time-engine.service.js';

export async function adjustmentRoutes(app: FastifyInstance) {
  app.post('/adjustments', { preHandler: [app.authenticate] }, async (request, reply) => {
    if (!request.user.employeeId) return reply.code(403).send({ error: 'Usuário sem colaborador' });
    const body = z.object({
      targetPunchId: z.string().optional(), requestedTime: z.string().datetime(), requestedType: z.nativeEnum(PunchType), reason: z.string().min(5).max(1000)
    }).parse(request.body);

    if (body.targetPunchId) {
      const target = await prisma.punch.findFirst({ where: { id: body.targetPunchId, tenantId: request.user.tenantId, employeeId: request.user.employeeId } });
      if (!target) return reply.code(400).send({ error: 'Marcação original inválida para este colaborador' });
    }

    const item = await prisma.adjustmentRequest.create({ data: {
      tenantId: request.user.tenantId, employeeId: request.user.employeeId, targetPunchId: body.targetPunchId,
      requestedTime: new Date(body.requestedTime), requestedType: body.requestedType, reason: body.reason
    } });
    await prisma.auditEvent.create({ data: {
      tenantId: request.user.tenantId, actorUserId: request.user.userId, action: 'ADJUSTMENT_REQUESTED', entityType: 'AdjustmentRequest', entityId: item.id,
      afterJson: { targetPunchId: item.targetPunchId, requestedTime: item.requestedTime.toISOString(), requestedType: item.requestedType, reason: item.reason }
    } });
    return reply.code(201).send(item);
  });

  app.get('/adjustments', { preHandler: [app.authenticate] }, async request => {
    const managerRoles: Role[] = [Role.ADMIN, Role.HR, Role.SUPERVISOR, Role.AUDITOR];
    const where: any = { tenantId: request.user.tenantId };
    if (!managerRoles.includes(request.user.role as Role)) where.employeeId = request.user.employeeId;
    if (request.user.role === Role.SUPERVISOR && request.user.employeeId) {
      const team = await prisma.employee.findMany({ where: { tenantId: request.user.tenantId, OR: [{ id: request.user.employeeId }, { supervisorId: request.user.employeeId }] }, select: { id: true } });
      where.employeeId = { in: team.map(x => x.id) };
    }
    return prisma.adjustmentRequest.findMany({ where, include: { employee: { select: { name: true, employeeNumber: true } } }, orderBy: { requestedAt: 'desc' }, take: 200 });
  });

  app.post('/adjustments/:id/approve', { preHandler: [app.authenticate] }, async (request, reply) => {
    const approverRoles: Role[] = [Role.ADMIN, Role.HR, Role.SUPERVISOR];
    if (!approverRoles.includes(request.user.role as Role)) return reply.code(403).send({ error: 'Sem permissão para aprovar' });
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const { note } = z.object({ note: z.string().max(1000).optional() }).parse(request.body ?? {});
    const req = await prisma.adjustmentRequest.findFirst({ where: { id, tenantId: request.user.tenantId, status: 'PENDING' }, include: { employee: { include: { shift: true, tenant: true } } } });
    if (!req) return reply.code(404).send({ error: 'Solicitação pendente não encontrada' });
    if (request.user.role === Role.SUPERVISOR && req.employee.supervisorId !== request.user.employeeId && req.employee.id !== request.user.employeeId) return reply.code(403).send({ error: 'Solicitação fora da sua equipe' });

    const adjustmentSource = req.targetPunchId ? 'APPROVED_CORRECTION' : 'APPROVED_ADDITION';
    const correctionPunch = await createImmutablePunch({
      tenantId: request.user.tenantId,
      employeeId: req.employeeId,
      actorUserId: request.user.userId,
      type: req.requestedType,
      occurredAt: req.requestedTime,
      timezone: req.employee.shift?.timezone || req.employee.tenant.timezone || 'America/Maceio',
      source: adjustmentSource,
      offline: false,
      decision: PunchDecision.APPROVED,
      reviewReason: `Ajuste administrativo aprovado: ${req.reason}`,
      evidence: {
        deviceTrusted: false,
        faceDetected: false,
        faceCount: 0,
        faceVerified: false,
        livenessChallengePassed: false,
        platformBiometricVerified: false,
        mockLocationRisk: false,
        appIntegrityStatus: 'ADMIN_ADJUSTMENT_NOT_PRESENCE_PROOF',
        proofScore: 0,
        proofLevel: 'AJUSTE_ADMINISTRATIVO',
        reasons: ['Registro criado por fluxo formal de ajuste aprovado; não representa prova biométrica de presença.'],
        missingRequirements: ['SELFIE_NOT_APPLICABLE_TO_ADMIN_ADJUSTMENT','FACE_NOT_APPLICABLE_TO_ADMIN_ADJUSTMENT','LOCATION_NOT_APPLICABLE_TO_ADMIN_ADJUSTMENT']
      }
    });
    const updated = await prisma.adjustmentRequest.update({ where: { id }, data: {
      status: 'APPROVED', reviewedById: request.user.userId, reviewedAt: new Date(), reviewNote: note, resultingPunchId: correctionPunch.id
    } });
    await prisma.auditEvent.create({ data: {
      tenantId: request.user.tenantId, actorUserId: request.user.userId, action: 'ADJUSTMENT_APPROVED', entityType: 'AdjustmentRequest', entityId: id,
      afterJson: { status: 'APPROVED', targetPunchId: req.targetPunchId, resultingPunchId: correctionPunch.id, reviewNote: note ?? null }
    } });
    const workDate = localDateKey(req.requestedTime, req.employee.shift?.timezone || req.employee.tenant.timezone || 'America/Maceio');
    await persistEmployeeLedger(req.employeeId, request.user.tenantId, workDate, workDate);
    return updated;
  });

  app.post('/adjustments/:id/reject', { preHandler: [app.authenticate] }, async (request, reply) => {
    const approverRoles: Role[] = [Role.ADMIN, Role.HR, Role.SUPERVISOR];
    if (!approverRoles.includes(request.user.role as Role)) return reply.code(403).send({ error: 'Sem permissão para rejeitar' });
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const { note } = z.object({ note: z.string().min(3).max(1000) }).parse(request.body);
    const req = await prisma.adjustmentRequest.findFirst({ where: { id, tenantId: request.user.tenantId, status: 'PENDING' }, include: { employee: { include: { shift: true, tenant: true } } } });
    if (!req) return reply.code(404).send({ error: 'Solicitação pendente não encontrada' });
    if (request.user.role === Role.SUPERVISOR && req.employee.supervisorId !== request.user.employeeId && req.employee.id !== request.user.employeeId) return reply.code(403).send({ error: 'Solicitação fora da sua equipe' });
    await prisma.adjustmentRequest.update({ where: { id }, data: { status: 'REJECTED', reviewedById: request.user.userId, reviewedAt: new Date(), reviewNote: note } });
    await prisma.auditEvent.create({ data: { tenantId: request.user.tenantId, actorUserId: request.user.userId, action: 'ADJUSTMENT_REJECTED', entityType: 'AdjustmentRequest', entityId: id, afterJson: { status: 'REJECTED', reviewNote: note } } });
    return { ok: true };
  });
}
