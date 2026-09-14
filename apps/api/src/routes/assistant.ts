import { FastifyInstance } from 'fastify';
import { localDateKey } from '../lib/time.js';
import { prisma } from '../lib/prisma.js';
import { calculateEmployeeRange } from '../services/time-engine.service.js';

function fmt(minutes: number) {
  const sign = minutes < 0 ? '-' : '';
  const abs = Math.abs(minutes);
  return `${sign}${Math.floor(abs / 60)}h${String(abs % 60).padStart(2,'0')}`;
}

export async function assistantRoutes(app: FastifyInstance) {
  app.get('/assistant/explain-my-day', { preHandler: [app.authenticate] }, async (request, reply) => {
    if (!request.user.employeeId) return reply.code(403).send({ error: 'Usuário sem colaborador' });
    const employee = await prisma.employee.findUnique({ where: { id: request.user.employeeId }, include: { shift: true, tenant: true } });
    const today = localDateKey(new Date(), employee?.shift?.timezone || employee?.tenant.timezone || 'America/Maceio');
    const result = await calculateEmployeeRange(request.user.employeeId, request.user.tenantId, today, today);
    const day = result.days[0];
    if (!day.punchCount) return { ...day, explanation: 'Você ainda não possui marcações hoje.' };
    const parts = [`Hoje existem ${day.punchCount} marcações e ${fmt(day.workedMinutes)} trabalhadas`];
    if (day.overtime50Minutes + day.overtime100Minutes > 0) parts.push(`${fmt(day.overtime50Minutes + day.overtime100Minutes)} em horas extras calculadas`);
    if (day.missingMinutes > 0) parts.push(`${fmt(day.missingMinutes)} abaixo da jornada prevista`);
    if (day.bankDeltaMinutes !== 0) parts.push(`impacto de ${fmt(day.bankDeltaMinutes)} no banco de horas`);
    if (day.warnings.length) parts.push(`${day.warnings.length} ponto(s) para revisão`);
    return { ...day, explanation: `${parts.join(', ')}.` };
  });
}
