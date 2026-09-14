import { FastifyInstance } from 'fastify';
import { PayrollStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { ADMIN_ROLES, hasRole } from '../lib/access.js';
import { persistEmployeeLedger } from '../services/time-engine.service.js';

function moneyForMinutes(salaryCents: number, divisor: number, minutes: number, additionalPercent: number) {
  if (!salaryCents || !minutes) return 0;
  const hourly = salaryCents / divisor;
  return Math.round((minutes / 60) * hourly * (1 + additionalPercent / 100));
}

function nightAdditional(salaryCents: number, divisor: number, minutes: number, percent: number) {
  if (!salaryCents || !minutes) return 0;
  return Math.round((minutes / 60) * (salaryCents / divisor) * (percent / 100));
}

export async function payrollRoutes(app: FastifyInstance) {
  app.get('/payroll/periods', { preHandler: [app.authenticate] }, async (request, reply) => {
    if (!hasRole(request.user.role, ADMIN_ROLES)) return reply.code(403).send({ error: 'Sem permissão' });
    return prisma.payrollPeriod.findMany({ where: { tenantId: request.user.tenantId }, include: { _count: { select: { previews: true } } }, orderBy: { startDate: 'desc' }, take: 24 });
  });

  app.post('/payroll/generate', { preHandler: [app.authenticate] }, async (request, reply) => {
    if (!hasRole(request.user.role, ADMIN_ROLES)) return reply.code(403).send({ error: 'Sem permissão' });
    const body = z.object({ label: z.string().min(3).max(40), from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(request.body);
    const [employees, rules] = await Promise.all([
      prisma.employee.findMany({ where: { tenantId: request.user.tenantId, active: true } }),
      prisma.timeRuleSettings.upsert({ where: { tenantId: request.user.tenantId }, update: {}, create: { tenantId: request.user.tenantId } })
    ]);
    const period = await prisma.payrollPeriod.upsert({
      where: { tenantId_label: { tenantId: request.user.tenantId, label: body.label } },
      update: { startDate: new Date(`${body.from}T12:00:00Z`), endDate: new Date(`${body.to}T12:00:00Z`), status: PayrollStatus.DRAFT },
      create: { tenantId: request.user.tenantId, label: body.label, startDate: new Date(`${body.from}T12:00:00Z`), endDate: new Date(`${body.to}T12:00:00Z`) }
    });
    const previews = [];
    for (const employee of employees) {
      const calc = await persistEmployeeLedger(employee.id, request.user.tenantId, body.from, body.to);
      const t = calc.totals;
      const payableOvertime = !rules.bankHoursEnabled || !rules.overtimeToBank;
      const overtime50Cents = payableOvertime ? moneyForMinutes(employee.salaryCents, rules.monthlyHoursDivisor, t.overtime50Minutes, rules.overtime50Percent) : 0;
      const overtime100Cents = payableOvertime ? moneyForMinutes(employee.salaryCents, rules.monthlyHoursDivisor, t.overtime100Minutes, rules.overtime100Percent) : 0;
      const nightAdditionalCents = nightAdditional(employee.salaryCents, rules.monthlyHoursDivisor, t.nightMinutes, rules.nightAdditionalPercent);
      const estimatedGrossCents = employee.salaryCents + overtime50Cents + overtime100Cents + nightAdditionalCents;
      const warnings = calc.days.flatMap(d => d.warnings.map(w => `${d.date}: ${w}`));
      const preview = await prisma.payrollPreview.upsert({
        where: { payrollPeriodId_employeeId: { payrollPeriodId: period.id, employeeId: employee.id } },
        update: { workedMinutes: t.workedMinutes, regularMinutes: t.regularMinutes, overtime50Minutes: t.overtime50Minutes, overtime100Minutes: t.overtime100Minutes, nightMinutes: t.nightMinutes, missingMinutes: t.missingMinutes, bankDeltaMinutes: t.bankDeltaMinutes, overtime50Cents, overtime100Cents, nightAdditionalCents, estimatedGrossCents, warningsJson: warnings, generatedAt: new Date() },
        create: { payrollPeriodId: period.id, employeeId: employee.id, workedMinutes: t.workedMinutes, regularMinutes: t.regularMinutes, overtime50Minutes: t.overtime50Minutes, overtime100Minutes: t.overtime100Minutes, nightMinutes: t.nightMinutes, missingMinutes: t.missingMinutes, bankDeltaMinutes: t.bankDeltaMinutes, overtime50Cents, overtime100Cents, nightAdditionalCents, estimatedGrossCents, warningsJson: warnings }
      });
      previews.push(preview);
    }
    await prisma.auditEvent.create({ data: { tenantId: request.user.tenantId, actorUserId: request.user.userId, action: 'PAYROLL_PREVIEW_GENERATED', entityType: 'PayrollPeriod', entityId: period.id, metadataJson: { from: body.from, to: body.to, employees: employees.length } } });
    return { period, count: previews.length };
  });

  app.get('/payroll/periods/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
    if (!hasRole(request.user.role, ADMIN_ROLES)) return reply.code(403).send({ error: 'Sem permissão' });
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const period = await prisma.payrollPeriod.findFirst({ where: { id, tenantId: request.user.tenantId }, include: { previews: { include: { employee: { select: { id: true, name: true, employeeNumber: true, salaryCents: true } } }, orderBy: { employee: { name: 'asc' } } } } });
    if (!period) return reply.code(404).send({ error: 'Período não encontrado' });
    return period;
  });

  app.post('/payroll/periods/:id/status', { preHandler: [app.authenticate] }, async (request, reply) => {
    if (!hasRole(request.user.role, ADMIN_ROLES)) return reply.code(403).send({ error: 'Sem permissão' });
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const { status } = z.object({ status: z.nativeEnum(PayrollStatus) }).parse(request.body);
    const result = await prisma.payrollPeriod.updateMany({ where: { id, tenantId: request.user.tenantId }, data: { status } });
    if (!result.count) return reply.code(404).send({ error: 'Período não encontrado' });
    await prisma.auditEvent.create({ data: { tenantId: request.user.tenantId, actorUserId: request.user.userId, action: 'PAYROLL_STATUS_CHANGED', entityType: 'PayrollPeriod', entityId: id, afterJson: { status } } });
    return { ok: true, status };
  });
}
