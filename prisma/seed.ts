import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('Demo@123', 12);
  const tenant = await prisma.tenant.upsert({
    where: { document: '00000000000191' },
    update: { name: 'PontoProof Demo', legalName: 'PontoProof Tecnologia Demo Ltda', timezone: 'America/Maceio' },
    create: { name: 'PontoProof Demo', legalName: 'PontoProof Tecnologia Demo Ltda', document: '00000000000191', timezone: 'America/Maceio' }
  });

  await prisma.attendanceSecuritySettings.upsert({
    where: { tenantId: tenant.id }, update: {}, create: { tenantId: tenant.id, requireSelfie: true, requireFaceMatch: true, requireLiveness: true, requireAntiSpoof: true, blockWithoutEnrollment: true, blockOnFaceFailure: true, requireAccurateGps: true, allowOffline: true, offlineRequiresReview: true }
  });

  await prisma.timeRuleSettings.upsert({
    where: { tenantId: tenant.id }, update: {}, create: { tenantId: tenant.id, bankHoursEnabled: true, monthlyHoursDivisor: 220 }
  });

  const department = await prisma.department.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: 'Operações' } },
    update: {}, create: { tenantId: tenant.id, name: 'Operações', code: 'OPS' }
  });

  const shift = await prisma.shift.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: 'Administrativo 08h-17h' } },
    update: { scheduleDays: ['MON','TUE','WED','THU','FRI'], dailyMinutes: 480, weeklyMinutes: 2400 },
    create: {
      tenantId: tenant.id, name: 'Administrativo 08h-17h', timezone: 'America/Maceio', startTime: '08:00', endTime: '17:00',
      breakMinutes: 60, dailyMinutes: 480, weeklyMinutes: 2400, overtimeToleranceMin: 10, scheduleDays: ['MON','TUE','WED','THU','FRI']
    }
  });

  const worksite = await prisma.worksite.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: 'Unidade Maceió' } },
    update: { latitude: -9.6498, longitude: -35.7089, radiusM: 250 },
    create: { tenantId: tenant.id, name: 'Unidade Maceió', latitude: -9.6498, longitude: -35.7089, radiusM: 250 }
  });

  const users = [
    ['admin@demo.com', Role.ADMIN, 'Administrador Demo 1', 'ADM001', 650000],
    ['admin2@demo.com', Role.ADMIN, 'Administrador Demo 2', 'ADM002', 650000],
    ['rh@demo.com', Role.HR, 'RH Demo 1', 'RH001', 480000],
    ['rh2@demo.com', Role.HR, 'RH Demo 2', 'RH002', 480000],
    ['colaborador@demo.com', Role.EMPLOYEE, 'Colaborador Demo 1', 'COL001', 280000],
    ['colaborador2@demo.com', Role.EMPLOYEE, 'Colaborador Demo 2', 'COL002', 280000]
  ] as const;

  const created: Record<string, any> = {};
  for (const [email, role, name, employeeNumber, salaryCents] of users) {
    const user = await prisma.user.upsert({
      where: { tenantId_email: { tenantId: tenant.id, email } },
      update: { role, active: true },
      create: { tenantId: tenant.id, email, passwordHash, role }
    });
    const employee = await prisma.employee.upsert({
      where: { tenantId_employeeNumber: { tenantId: tenant.id, employeeNumber } },
      update: { userId: user.id, name, shiftId: shift.id, departmentId: department.id, worksiteId: worksite.id, salaryCents, active: true },
      create: { tenantId: tenant.id, userId: user.id, name, employeeNumber, shiftId: shift.id, departmentId: department.id, worksiteId: worksite.id, salaryCents, admissionDate: new Date('2026-01-05T12:00:00Z') }
    });
    created[email] = employee;
  }

  console.log('Demo pronto: 2 ADM, 2 RH e 2 colaboradores. Senha temporaria para todos: Demo@123');
}

main().finally(() => prisma.$disconnect());
