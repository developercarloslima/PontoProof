import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  const tenantName = process.env.BOOTSTRAP_TENANT_NAME?.trim();
  const tenantDocument = process.env.BOOTSTRAP_TENANT_DOCUMENT?.replace(/\D/g, '');
  if (!email || !password || !tenantName || !tenantDocument) throw new Error('Defina BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_PASSWORD, BOOTSTRAP_TENANT_NAME e BOOTSTRAP_TENANT_DOCUMENT.');
  if (password.length < 12) throw new Error('BOOTSTRAP_ADMIN_PASSWORD deve ter ao menos 12 caracteres.');

  const tenant = await prisma.tenant.upsert({
    where: { document: tenantDocument },
    update: { name: tenantName },
    create: { name: tenantName, document: tenantDocument, timezone: process.env.BOOTSTRAP_TIMEZONE || 'America/Maceio' }
  });
  await prisma.timeRuleSettings.upsert({ where: { tenantId: tenant.id }, update: {}, create: { tenantId: tenant.id } });

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email } },
    update: { role: Role.ADMIN, active: true },
    create: { tenantId: tenant.id, email, passwordHash, role: Role.ADMIN }
  });
  await prisma.employee.upsert({
    where: { tenantId_employeeNumber: { tenantId: tenant.id, employeeNumber: 'ADMIN001' } },
    update: { userId: user.id, name: process.env.BOOTSTRAP_ADMIN_NAME || 'Administrador', active: true },
    create: { tenantId: tenant.id, userId: user.id, employeeNumber: 'ADMIN001', name: process.env.BOOTSTRAP_ADMIN_NAME || 'Administrador' }
  });
  console.log(`Bootstrap concluído para ${tenant.name}: ${email}`);
}

main().finally(() => prisma.$disconnect());
