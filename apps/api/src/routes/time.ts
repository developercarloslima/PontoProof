import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { ADMIN_ROLES, MANAGEMENT_ROLES, hasRole } from '../lib/access.js';
import { calculateEmployeeRange, persistEmployeeLedger } from '../services/time-engine.service.js';
import { localDateKey } from '../lib/time.js';

const dateRange = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

async function currentMonthRange(tenantId: string) {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const today = localDateKey(new Date(), tenant.timezone || 'America/Maceio');
  const [y,m] = today.split('-').map(Number);
  const from = `${y}-${String(m).padStart(2,'0')}-01`;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from, to: `${y}-${String(m).padStart(2,'0')}-${String(last).padStart(2,'0')}` };
}

export async function timeRoutes(app: FastifyInstance) {
  app.get('/time/me', { preHandler: [app.authenticate] }, async (request, reply) => {
    if (!request.user.employeeId) return reply.code(403).send({ error: 'Usuário sem colaborador' });
    const q = dateRange.partial().parse(request.query);
    const range = { ...(await currentMonthRange(request.user.tenantId)), ...q };
    const result = await calculateEmployeeRange(request.user.employeeId, request.user.tenantId, range.from, range.to);
    return { employee: { id: result.employee.id, name: result.employee.name }, days: result.days, totals: result.totals, from: range.from, to: range.to };
  });

  app.get('/time/employees/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
    if (!hasRole(request.user.role, MANAGEMENT_ROLES)) return reply.code(403).send({ error: 'Sem permissão' });
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const q = dateRange.partial().parse(request.query);
    const range = { ...(await currentMonthRange(request.user.tenantId)), ...q };
    if (request.user.role === 'SUPERVISOR' && request.user.employeeId) {
      const target = await prisma.employee.findFirst({ where: { id, tenantId: request.user.tenantId } });
      if (!target || (target.id !== request.user.employeeId && target.supervisorId !== request.user.employeeId)) return reply.code(403).send({ error: 'Colaborador fora da sua equipe' });
    }
    const result = await calculateEmployeeRange(id, request.user.tenantId, range.from, range.to);
    return { employee: { id: result.employee.id, name: result.employee.name, employeeNumber: result.employee.employeeNumber }, days: result.days, totals: result.totals, from: range.from, to: range.to };
  });

  app.post('/time/recalculate', { preHandler: [app.authenticate] }, async (request, reply) => {
    if (!hasRole(request.user.role, MANAGEMENT_ROLES)) return reply.code(403).send({ error: 'Sem permissão' });
    const body = z.object({ employeeId: z.string().optional(), from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(request.body);
    let employeeIds: string[];
    if (body.employeeId) {
      if (request.user.role === 'SUPERVISOR' && request.user.employeeId) {
        const target = await prisma.employee.findFirst({ where: { id: body.employeeId, tenantId: request.user.tenantId } });
        if (!target || (target.id !== request.user.employeeId && target.supervisorId !== request.user.employeeId)) return reply.code(403).send({ error: 'Colaborador fora da sua equipe' });
      }
      employeeIds = [body.employeeId];
    } else {
      const where: any = { tenantId: request.user.tenantId, active: true };
      if (request.user.role === 'SUPERVISOR' && request.user.employeeId) where.OR = [{ id: request.user.employeeId }, { supervisorId: request.user.employeeId }];
      employeeIds = (await prisma.employee.findMany({ where, select: { id: true } })).map(x => x.id);
    }
    const results = [];
    for (const employeeId of employeeIds) {
      const r = await persistEmployeeLedger(employeeId, request.user.tenantId, body.from, body.to);
      results.push({ employeeId, totals: r.totals });
    }
    await prisma.auditEvent.create({ data: { tenantId: request.user.tenantId, actorUserId: request.user.userId, action: 'TIME_RECALCULATED', entityType: 'TimeBalanceLedger', entityId: body.employeeId ?? 'ALL', metadataJson: { from: body.from, to: body.to, employees: employeeIds.length } } });
    return { ok: true, results };
  });

  app.get('/bank/me', { preHandler: [app.authenticate] }, async (request, reply) => {
    if (!request.user.employeeId) return reply.code(403).send({ error: 'Usuário sem colaborador' });
    const [rows, manual] = await Promise.all([
      prisma.timeBalanceLedger.findMany({ where: { tenantId: request.user.tenantId, employeeId: request.user.employeeId }, orderBy: { workDate: 'desc' }, take: 120 }),
      prisma.bankHourAdjustment.findMany({ where: { tenantId: request.user.tenantId, employeeId: request.user.employeeId }, orderBy: { effectiveAt: 'desc' }, take: 100 })
    ]);
    const balanceMinutes = rows.reduce((sum, r) => sum + r.bankDeltaMinutes, 0) + manual.reduce((sum, r) => sum + r.minutes, 0);
    return { balanceMinutes, rows, manual };
  });

  app.get('/bank/overview', { preHandler: [app.authenticate] }, async (request, reply) => {
    if (!hasRole(request.user.role, MANAGEMENT_ROLES)) return reply.code(403).send({ error: 'Sem permissão' });
    const where: any = { tenantId: request.user.tenantId, active: true };
    if (request.user.role === 'SUPERVISOR' && request.user.employeeId) where.OR = [{ id: request.user.employeeId }, { supervisorId: request.user.employeeId }];
    const employees = await prisma.employee.findMany({ where, select: { id: true, name: true, employeeNumber: true } });
    const [ledgers, manual] = await Promise.all([
      prisma.timeBalanceLedger.groupBy({ by: ['employeeId'], where: { tenantId: request.user.tenantId }, _sum: { bankDeltaMinutes: true, overtime50Minutes: true, overtime100Minutes: true, missingMinutes: true } }),
      prisma.bankHourAdjustment.groupBy({ by: ['employeeId'], where: { tenantId: request.user.tenantId }, _sum: { minutes: true } })
    ]);
    const map = new Map(ledgers.map(x => [x.employeeId, x]));
    const manualMap = new Map(manual.map(x => [x.employeeId, x._sum.minutes ?? 0]));
    return employees.map(e => ({ ...e, balanceMinutes: (map.get(e.id)?._sum.bankDeltaMinutes ?? 0) + (manualMap.get(e.id) ?? 0), manualMinutes: manualMap.get(e.id) ?? 0, overtime50Minutes: map.get(e.id)?._sum.overtime50Minutes ?? 0, overtime100Minutes: map.get(e.id)?._sum.overtime100Minutes ?? 0, missingMinutes: map.get(e.id)?._sum.missingMinutes ?? 0 }));
  });

  app.post('/bank/adjustments', { preHandler: [app.authenticate] }, async (request, reply) => {
    if (!hasRole(request.user.role, ADMIN_ROLES)) return reply.code(403).send({ error: 'Sem permissão' });
    const body = z.object({ employeeId: z.string(), minutes: z.number().int().min(-100000).max(100000).refine(v => v !== 0), reason: z.string().min(5).max(500), effectiveAt: z.string().datetime().optional() }).parse(request.body);
    const employee = await prisma.employee.findFirst({ where: { id: body.employeeId, tenantId: request.user.tenantId } });
    if (!employee) return reply.code(404).send({ error: 'Colaborador não encontrado' });
    const item = await prisma.bankHourAdjustment.create({ data: { tenantId: request.user.tenantId, employeeId: body.employeeId, minutes: body.minutes, reason: body.reason, effectiveAt: body.effectiveAt ? new Date(body.effectiveAt) : new Date(), actorUserId: request.user.userId } });
    await prisma.auditEvent.create({ data: { tenantId: request.user.tenantId, actorUserId: request.user.userId, action: 'BANK_HOURS_MANUAL_ADJUSTMENT', entityType: 'BankHourAdjustment', entityId: item.id, afterJson: { employeeId: body.employeeId, minutes: body.minutes, reason: body.reason, effectiveAt: item.effectiveAt.toISOString() } } });
    return reply.code(201).send(item);
  });
}
