import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';

export async function meRoutes(app: FastifyInstance) {
  app.get('/me', { preHandler: [app.authenticate] }, async request => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: request.user.userId },
      include: { employee: { include: { shift: true } }, tenant: true }
    });
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      tenant: { id: user.tenant.id, name: user.tenant.name },
      employee: user.employee && {
        id: user.employee.id,
        name: user.employee.name,
        employeeNumber: user.employee.employeeNumber,
        shift: user.employee.shift
      }
    };
  });
}
