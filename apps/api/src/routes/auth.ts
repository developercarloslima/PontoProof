import { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { getOnboardingState, refreshOnboardingCompletion } from '../services/onboarding.service.js';

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/login', async (request, reply) => {
    const body = z.object({ email: z.string().email(), password: z.string().min(6), tenantDocument: z.string().max(30).optional() }).parse(request.body);
    const candidates = await prisma.user.findMany({
      where: {
        email: body.email.toLowerCase(), active: true,
        ...(body.tenantDocument ? { tenant: { document: body.tenantDocument.replace(/\D/g, '') } } : {})
      },
      include: { employee: true, tenant: true }, take: 2
    });
    if (candidates.length > 1 && !body.tenantDocument) return reply.code(409).send({ error: 'Este e-mail existe em mais de uma empresa. Informe o CNPJ/identificador da empresa.' });
    const user = candidates[0];
    if (!user || (user.employee && !user.employee.active) || !(await bcrypt.compare(body.password, user.passwordHash))) return reply.code(401).send({ error: 'Credenciais inválidas' });

    const token = app.jwt.sign({ userId: user.id, tenantId: user.tenantId, role: user.role, employeeId: user.employee?.id }, { expiresIn: '12h' });
    const onboarding = await getOnboardingState(user.id);
    return { token, user: { id: user.id, email: user.email, role: user.role, employeeId: user.employee?.id, name: user.employee?.name ?? user.email, tenant: user.tenant.name, onboarding } };
  });

  app.get('/auth/onboarding-status', { preHandler:[app.authenticate] }, async (request:any) => {
    return refreshOnboardingCompletion(request.user.userId);
  });

  app.post('/auth/change-password', { preHandler:[app.authenticate] }, async (request:any, reply) => {
    const body = z.object({ currentPassword:z.string().min(6), newPassword:z.string().min(10).max(128) }).parse(request.body);
    if (body.currentPassword === body.newPassword) return reply.code(400).send({error:'A nova senha deve ser diferente da senha temporária.'});
    const user = await prisma.user.findUnique({where:{id:request.user.userId}});
    if(!user || !(await bcrypt.compare(body.currentPassword,user.passwordHash))) return reply.code(401).send({error:'Senha atual inválida'});
    const passwordHash=await bcrypt.hash(body.newPassword,12);
    await prisma.$transaction([
      prisma.user.update({where:{id:user.id},data:{passwordHash,mustChangePassword:false,passwordChangedAt:new Date(),onboardingCompletedAt:null}}),
      prisma.auditEvent.create({data:{tenantId:user.tenantId,actorUserId:user.id,action:'FIRST_ACCESS_PASSWORD_CHANGED',entityType:'User',entityId:user.id}})
    ]);
    return {ok:true,onboarding:await refreshOnboardingCompletion(user.id)};
  });
}
