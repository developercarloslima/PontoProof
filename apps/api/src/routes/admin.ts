import { FastifyInstance } from 'fastify';
import { FacePose, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { ADMIN_ROLES, hasRole, MANAGEMENT_ROLES } from '../lib/access.js';
import { getOrCreateRules, persistEmployeeLedger } from '../services/time-engine.service.js';
import { getOrCreateSecuritySettings } from '../services/security-settings.service.js';
import { enrollFaceReference } from '../services/face-enrollment.service.js';
import { isValidClockTime, isValidTimeZone, localDateKey } from '../lib/time.js';

const scheduleDays = z.array(z.enum(['SUN','MON','TUE','WED','THU','FRI','SAT'])).min(1);

export async function adminRoutes(app: FastifyInstance) {
  app.get('/admin/company', { preHandler: [app.authenticate] }, async (request, reply) => {
    if (!hasRole(request.user.role, MANAGEMENT_ROLES)) return reply.code(403).send({ error: 'Sem permissão' });
    const [tenant, rules] = await Promise.all([
      prisma.tenant.findUniqueOrThrow({ where: { id: request.user.tenantId } }),
      getOrCreateRules(request.user.tenantId)
    ]);
    return { tenant, rules };
  });

  app.patch('/admin/company', { preHandler: [app.authenticate] }, async (request, reply) => {
    if (!hasRole(request.user.role, ADMIN_ROLES)) return reply.code(403).send({ error: 'Sem permissão' });
    const body = z.object({ name: z.string().min(2).max(120).optional(), legalName: z.string().max(180).nullable().optional(), document: z.string().max(30).nullable().optional(), timezone: z.string().min(3).max(80).refine(isValidTimeZone, 'Fuso horário inválido').optional() }).parse(request.body);
    const before = await prisma.tenant.findUniqueOrThrow({ where: { id: request.user.tenantId } });
    const tenant = await prisma.tenant.update({ where: { id: request.user.tenantId }, data: body });
    await prisma.auditEvent.create({ data: { tenantId: request.user.tenantId, actorUserId: request.user.userId, action: 'COMPANY_UPDATED', entityType: 'Tenant', entityId: tenant.id, beforeJson: before as any, afterJson: tenant as any } });
    return tenant;
  });

  app.patch('/admin/rules', { preHandler: [app.authenticate] }, async (request, reply) => {
    if (!hasRole(request.user.role, ADMIN_ROLES)) return reply.code(403).send({ error: 'Sem permissão' });
    const body = z.object({
      bankHoursEnabled: z.boolean().optional(), overtimeToBank: z.boolean().optional(), deficitToBank: z.boolean().optional(), overtime50Percent: z.number().int().min(0).max(300).optional(), overtime100Percent: z.number().int().min(0).max(300).optional(),
      sundayOvertime100: z.boolean().optional(), nightStart: z.string().refine(isValidClockTime, 'Horário noturno inicial inválido').optional(), nightEnd: z.string().refine(isValidClockTime, 'Horário noturno final inválido').optional(),
      nightAdditionalPercent: z.number().int().min(0).max(100).optional(), minBreakMinutes: z.number().int().min(0).max(240).optional(), maxDailyMinutes: z.number().int().min(60).max(1440).optional(),
      defaultToleranceMin: z.number().int().min(0).max(60).optional(), monthlyHoursDivisor: z.number().int().min(1).max(400).optional()
    }).parse(request.body);
    const before = await getOrCreateRules(request.user.tenantId);
    const rules = await prisma.timeRuleSettings.update({ where: { tenantId: request.user.tenantId }, data: body });
    await prisma.auditEvent.create({ data: { tenantId: request.user.tenantId, actorUserId: request.user.userId, action: 'TIME_RULES_UPDATED', entityType: 'TimeRuleSettings', entityId: rules.id, beforeJson: before as any, afterJson: rules as any } });
    return rules;
  });

  app.get('/admin/departments', { preHandler: [app.authenticate] }, async (request, reply) => { if (!hasRole(request.user.role, MANAGEMENT_ROLES)) return reply.code(403).send({ error: 'Sem permissão' }); return prisma.department.findMany({ where: { tenantId: request.user.tenantId }, orderBy: { name: 'asc' } }); });
  app.post('/admin/departments', { preHandler: [app.authenticate] }, async (request, reply) => {
    if (!hasRole(request.user.role, ADMIN_ROLES)) return reply.code(403).send({ error: 'Sem permissão' });
    const body = z.object({ name: z.string().min(2).max(100), code: z.string().max(30).optional() }).parse(request.body);
    const row = await prisma.department.create({ data: { tenantId: request.user.tenantId, ...body } });
    return reply.code(201).send(row);
  });
  app.patch('/admin/departments/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
    if (!hasRole(request.user.role, ADMIN_ROLES)) return reply.code(403).send({ error: 'Sem permissão' });
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ name: z.string().min(2).max(100).optional(), code: z.string().max(30).nullable().optional(), active: z.boolean().optional() }).parse(request.body);
    const result = await prisma.department.updateMany({ where: { id, tenantId: request.user.tenantId }, data: body });
    if (!result.count) return reply.code(404).send({ error: 'Setor não encontrado' });
    return prisma.department.findUnique({ where: { id } });
  });

  app.get('/admin/worksites', { preHandler: [app.authenticate] }, async (request, reply) => { if (!hasRole(request.user.role, MANAGEMENT_ROLES)) return reply.code(403).send({ error: 'Sem permissão' }); return prisma.worksite.findMany({ where: { tenantId: request.user.tenantId }, orderBy: { name: 'asc' } }); });
  app.post('/admin/worksites', { preHandler: [app.authenticate] }, async (request, reply) => {
    if (!hasRole(request.user.role, ADMIN_ROLES)) return reply.code(403).send({ error: 'Sem permissão' });
    const body = z.object({ name: z.string().min(2).max(120), latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), radiusM: z.number().int().min(20).max(10000).default(150), bluetoothNamePrefix: z.string().max(80).optional(), nfcTagId: z.string().max(120).optional(), networkGatewayId: z.string().max(120).optional() }).parse(request.body);
    const row = await prisma.worksite.create({ data: { tenantId: request.user.tenantId, ...body } });
    return reply.code(201).send(row);
  });
  app.patch('/admin/worksites/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
    if (!hasRole(request.user.role, ADMIN_ROLES)) return reply.code(403).send({ error: 'Sem permissão' });
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ name: z.string().min(2).max(120).optional(), latitude: z.number().min(-90).max(90).optional(), longitude: z.number().min(-180).max(180).optional(), radiusM: z.number().int().min(20).max(10000).optional(), bluetoothNamePrefix: z.string().max(80).nullable().optional(), nfcTagId: z.string().max(120).nullable().optional(), networkGatewayId: z.string().max(120).nullable().optional(), active: z.boolean().optional() }).parse(request.body);
    const result = await prisma.worksite.updateMany({ where: { id, tenantId: request.user.tenantId }, data: body });
    if (!result.count) return reply.code(404).send({ error: 'Local não encontrado' });
    return prisma.worksite.findUnique({ where: { id } });
  });

  app.get('/admin/shifts', { preHandler: [app.authenticate] }, async (request, reply) => { if (!hasRole(request.user.role, MANAGEMENT_ROLES)) return reply.code(403).send({ error: 'Sem permissão' }); return prisma.shift.findMany({ where: { tenantId: request.user.tenantId }, orderBy: { name: 'asc' } }); });
  app.post('/admin/shifts', { preHandler: [app.authenticate] }, async (request, reply) => {
    if (!hasRole(request.user.role, ADMIN_ROLES)) return reply.code(403).send({ error: 'Sem permissão' });
    const body = z.object({ name: z.string().min(2).max(120), timezone: z.string().min(3).max(80).refine(isValidTimeZone, 'Fuso horário inválido').default('America/Maceio'), startTime: z.string().refine(isValidClockTime, 'Horário inicial inválido'), endTime: z.string().refine(isValidClockTime, 'Horário final inválido'), breakMinutes: z.number().int().min(0).max(240), dailyMinutes: z.number().int().min(1).max(1440), weeklyMinutes: z.number().int().min(1).max(10080), overtimeToleranceMin: z.number().int().min(0).max(60).default(10), scheduleDays }).parse(request.body);
    const row = await prisma.shift.create({ data: { tenantId: request.user.tenantId, ...body } });
    return reply.code(201).send(row);
  });
  app.patch('/admin/shifts/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
    if (!hasRole(request.user.role, ADMIN_ROLES)) return reply.code(403).send({ error: 'Sem permissão' });
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ name: z.string().min(2).max(120).optional(), timezone: z.string().min(3).max(80).refine(isValidTimeZone, 'Fuso horário inválido').optional(), startTime: z.string().refine(isValidClockTime, 'Horário inicial inválido').optional(), endTime: z.string().refine(isValidClockTime, 'Horário final inválido').optional(), breakMinutes: z.number().int().min(0).max(240).optional(), dailyMinutes: z.number().int().min(1).max(1440).optional(), weeklyMinutes: z.number().int().min(1).max(10080).optional(), overtimeToleranceMin: z.number().int().min(0).max(60).optional(), scheduleDays: scheduleDays.optional(), active: z.boolean().optional() }).parse(request.body);
    const result = await prisma.shift.updateMany({ where: { id, tenantId: request.user.tenantId }, data: body });
    if (!result.count) return reply.code(404).send({ error: 'Escala não encontrada' });
    return prisma.shift.findUnique({ where: { id } });
  });

  app.get('/admin/employees', { preHandler: [app.authenticate] }, async (request, reply) => {
    if (!hasRole(request.user.role, MANAGEMENT_ROLES)) return reply.code(403).send({ error: 'Sem permissão' });
    const where: any = { tenantId: request.user.tenantId };
    if (request.user.role === Role.SUPERVISOR && request.user.employeeId) where.OR = [{ supervisorId: request.user.employeeId }, { id: request.user.employeeId }];
    const rows = await prisma.employee.findMany({ where, include: { user: { select: { email: true, role: true, active: true, mustChangePassword:true, onboardingCompletedAt:true, _count:{select:{webAuthnCredentials:true}} } }, department: true, shift: true, worksite: true, supervisor: { select: { id: true, name: true } } }, orderBy: { name: 'asc' } });
    if (request.user.role === Role.SUPERVISOR) return rows.map(({ salaryCents: _salary, ...row }) => row);
    return rows;
  });

  app.post('/admin/employees', { preHandler: [app.authenticate] }, async (request, reply) => {
    if (!hasRole(request.user.role, ADMIN_ROLES)) return reply.code(403).send({ error: 'Sem permissão' });
    const body = z.object({
      name: z.string().min(2).max(150), employeeNumber: z.string().min(1).max(40), email: z.string().email(), role: z.nativeEnum(Role).default(Role.EMPLOYEE),
      password: z.string().min(8).max(100), cpfMasked: z.string().max(30).optional(), jobTitle: z.string().max(120).optional(), admissionDate: z.string().datetime().optional(),
      salaryCents: z.number().int().min(0).default(0), shiftId: z.string().nullable().optional(), departmentId: z.string().nullable().optional(), worksiteId: z.string().nullable().optional(), supervisorId: z.string().nullable().optional()
    }).parse(request.body);
    const passwordHash = await bcrypt.hash(body.password, 12);
    const created = await prisma.$transaction(async tx => {
      const user = await tx.user.create({ data: { tenantId: request.user.tenantId, email: body.email.toLowerCase(), passwordHash, role: body.role, mustChangePassword:true } });
      return tx.employee.create({ data: { tenantId: request.user.tenantId, userId: user.id, name: body.name, employeeNumber: body.employeeNumber, cpfMasked: body.cpfMasked, jobTitle: body.jobTitle, admissionDate: body.admissionDate ? new Date(body.admissionDate) : undefined, salaryCents: body.salaryCents, shiftId: body.shiftId, departmentId: body.departmentId, worksiteId: body.worksiteId, supervisorId: body.supervisorId }, include: { user: true, department: true, shift: true, worksite: true } });
    });
    await prisma.auditEvent.create({ data: { tenantId: request.user.tenantId, actorUserId: request.user.userId, action: 'EMPLOYEE_CREATED_FIRST_ACCESS_PENDING', entityType: 'Employee', entityId: created.id, afterJson: { name: created.name, employeeNumber: created.employeeNumber, email: created.user?.email, role: created.user?.role, onboardingRequired:true } } });
    const enrolled = await prisma.employee.findUnique({ where:{id:created.id}, include:{user:{select:{email:true,role:true,active:true,mustChangePassword:true,onboardingCompletedAt:true,_count:{select:{webAuthnCredentials:true}}}},department:true,shift:true,worksite:true} });
    return reply.code(201).send(enrolled);
  });

  app.patch('/admin/employees/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
    if (!hasRole(request.user.role, ADMIN_ROLES)) return reply.code(403).send({ error: 'Sem permissão' });
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ name: z.string().min(2).max(150).optional(), employeeNumber: z.string().min(1).max(40).optional(), cpfMasked: z.string().max(30).nullable().optional(), jobTitle: z.string().max(120).nullable().optional(), admissionDate: z.string().datetime().nullable().optional(), salaryCents: z.number().int().min(0).optional(), shiftId: z.string().nullable().optional(), departmentId: z.string().nullable().optional(), worksiteId: z.string().nullable().optional(), supervisorId: z.string().nullable().optional(), active: z.boolean().optional(), role: z.nativeEnum(Role).optional() }).parse(request.body);
    const employee = await prisma.employee.findFirst({ where: { id, tenantId: request.user.tenantId }, include: { user: true } });
    if (!employee) return reply.code(404).send({ error: 'Colaborador não encontrado' });
    const { role, admissionDate, ...employeeData } = body;
    const updated = await prisma.$transaction(async tx => {
      if (employee.userId && (role !== undefined || body.active !== undefined)) await tx.user.update({ where: { id: employee.userId }, data: { ...(role ? { role } : {}), ...(body.active !== undefined ? { active: body.active } : {}) } });
      return tx.employee.update({ where: { id }, data: { ...employeeData, ...(admissionDate !== undefined ? { admissionDate: admissionDate ? new Date(admissionDate) : null } : {}) }, include: { user: { select: { email: true, role: true, active: true, mustChangePassword:true, onboardingCompletedAt:true, _count:{select:{webAuthnCredentials:true}} } }, department: true, shift: true, worksite: true, supervisor: { select: { id: true, name: true } } } });
    });
    await prisma.auditEvent.create({ data: { tenantId: request.user.tenantId, actorUserId: request.user.userId, action: 'EMPLOYEE_UPDATED', entityType: 'Employee', entityId: id, beforeJson: { name: employee.name, active: employee.active, salaryCents: employee.salaryCents }, afterJson: { name: updated.name, active: updated.active, salaryCents: updated.salaryCents } } });
    return updated;
  });

  app.post('/admin/employees/:id/biometric-unlock', { preHandler:[app.authenticate] }, async (request,reply)=>{
    if (!hasRole(request.user.role, ADMIN_ROLES)) return reply.code(403).send({error:'Sem permissão'});
    const {id}=z.object({id:z.string()}).parse(request.params);
    const employee=await prisma.employee.findFirst({where:{id,tenantId:request.user.tenantId}}); if(!employee)return reply.code(404).send({error:'Colaborador não encontrado'});
    await prisma.employee.update({where:{id},data:{failedBiometricAttempts:0,biometricLockedUntil:null}});
    await prisma.auditEvent.create({data:{tenantId:request.user.tenantId,actorUserId:request.user.userId,action:'BIOMETRIC_LOCKOUT_CLEARED',entityType:'Employee',entityId:id}});
    return {ok:true};
  });

  app.get('/admin/security-settings', { preHandler: [app.authenticate] }, async (request, reply) => {
    if (!hasRole(request.user.role, MANAGEMENT_ROLES)) return reply.code(403).send({ error: 'Sem permissão' });
    return getOrCreateSecuritySettings(request.user.tenantId);
  });

  app.patch('/admin/security-settings', { preHandler: [app.authenticate] }, async (request, reply) => {
    if (!hasRole(request.user.role, ADMIN_ROLES)) return reply.code(403).send({ error: 'Sem permissão' });
    const schema = z.object({
      requireSelfie:z.boolean().optional(), requireFaceMatch:z.boolean().optional(), requireLiveness:z.boolean().optional(), requireAntiSpoof:z.boolean().optional(),
      blockWithoutEnrollment:z.boolean().optional(), blockOnFaceFailure:z.boolean().optional(), requirePlatformBiometric:z.boolean().optional(), requireTrustedDevice:z.boolean().optional(),
      requireGeofence:z.boolean().optional(), requireAccurateGps:z.boolean().optional(), maxGpsAccuracyM:z.number().int().min(5).max(5000).optional(),
      requireDynamicQr:z.boolean().optional(), requireNetworkAttestation:z.boolean().optional(), requireBluetoothBeacon:z.boolean().optional(), requireNfcTag:z.boolean().optional(),
      allowOffline:z.boolean().optional(), offlineRequiresReview:z.boolean().optional(), minFaceMatchScore:z.number().min(0).max(1).optional(), minLivenessScore:z.number().min(0).max(1).optional(),
      minAntiSpoofScore:z.number().min(0).max(1).optional(), minFaceQualityScore:z.number().min(0).max(1).optional(), maxFaceCount:z.number().int().min(1).max(3).optional(),
      faceReferenceMin:z.number().int().min(1).max(3).optional(), faceReferenceRecommended:z.number().int().min(1).max(3).optional(), selfieRetentionDays:z.number().int().min(1).max(3650).optional(),
      blockedAttemptRetentionDays:z.number().int().min(1).max(3650).optional(), revokedFaceReferenceRetentionDays:z.number().int().min(1).max(3650).optional(), challengeTtlSeconds:z.number().int().min(30).max(900).optional(), maxFailedBiometricAttempts:z.number().int().min(1).max(20).optional(), biometricLockoutMinutes:z.number().int().min(1).max(1440).optional(), maxOfflineAgeHours:z.number().int().min(1).max(720).optional(), maxFutureClockSkewMinutes:z.number().int().min(0).max(60).optional(), fullIntegrityRequiresAllConfigured:z.boolean().optional()
    });
    const parsed=schema.parse(request.body); const before=await getOrCreateSecuritySettings(request.user.tenantId);
    const body={...parsed,requireSelfie:true,requireFaceMatch:true,requireLiveness:true,requireAntiSpoof:true,blockWithoutEnrollment:true,blockOnFaceFailure:true,maxFaceCount:1,fullIntegrityRequiresAllConfigured:true};
    const updated=await prisma.attendanceSecuritySettings.update({where:{tenantId:request.user.tenantId},data:body});
    await prisma.auditEvent.create({data:{tenantId:request.user.tenantId,actorUserId:request.user.userId,action:'SECURITY_POLICY_UPDATED',entityType:'AttendanceSecuritySettings',entityId:updated.id,beforeJson:before as any,afterJson:updated as any}});
    return updated;
  });

  app.get('/admin/employees/:id/face-references', { preHandler:[app.authenticate] }, async (request,reply)=>{
    if (!hasRole(request.user.role, ADMIN_ROLES)) return reply.code(403).send({error:'Sem permissão'});
    const {id}=z.object({id:z.string()}).parse(request.params);
    const employee=await prisma.employee.findFirst({where:{id,tenantId:request.user.tenantId},select:{id:true,name:true,faceEnrollmentStatus:true,faceEnrolledAt:true,faceTemplateVersion:true}});
    if(!employee)return reply.code(404).send({error:'Colaborador não encontrado'});
    const references=await prisma.faceReference.findMany({where:{tenantId:request.user.tenantId,employeeId:id,revokedAt:null},select:{id:true,pose:true,faceQualityScore:true,livenessScore:true,antiSpoofScore:true,createdAt:true},orderBy:{createdAt:'desc'}});
    return {employee,references};
  });

  app.post('/admin/employees/:id/face-references', { preHandler:[app.authenticate] }, async (request,reply)=>{
    if (!hasRole(request.user.role, ADMIN_ROLES)) return reply.code(403).send({error:'Sem permissão'});
    const {id}=z.object({id:z.string()}).parse(request.params);
    const body=z.object({pose:z.nativeEnum(FacePose),imageDataUrl:z.string().min(100),embedding:z.array(z.number()).min(64).max(4096),faceQualityScore:z.number().min(0).max(1),livenessScore:z.number().min(0).max(1),antiSpoofScore:z.number().min(0).max(1),livenessChallengePassed:z.literal(true)}).parse(request.body);
    const ref=await enrollFaceReference({tenantId:request.user.tenantId,employeeId:id,actorUserId:request.user.userId,...body});
    return reply.code(201).send({id:ref.id,pose:ref.pose,faceQualityScore:ref.faceQualityScore,createdAt:ref.createdAt});
  });

  app.post('/admin/employees/:id/face-reset', { preHandler:[app.authenticate] }, async (request,reply)=>{
    if (!hasRole(request.user.role, ADMIN_ROLES)) return reply.code(403).send({error:'Sem permissão'});
    const {id}=z.object({id:z.string()}).parse(request.params);
    const result=await prisma.employee.findFirst({where:{id,tenantId:request.user.tenantId}}); if(!result)return reply.code(404).send({error:'Colaborador não encontrado'});
    await prisma.$transaction([prisma.faceReference.updateMany({where:{tenantId:request.user.tenantId,employeeId:id,revokedAt:null},data:{revokedAt:new Date()}}),prisma.employee.update({where:{id},data:{faceEnrollmentStatus:'NOT_ENROLLED',faceEnrolledAt:null,faceTemplateVersion:{increment:1}}}),...(result.userId?[prisma.user.update({where:{id:result.userId},data:{onboardingCompletedAt:null}})]:[]),prisma.auditEvent.create({data:{tenantId:request.user.tenantId,actorUserId:request.user.userId,action:'FACE_ENROLLMENT_RESET',entityType:'Employee',entityId:id}})]);
    return {ok:true};
  });

  app.get('/admin/security-reviews', { preHandler:[app.authenticate] }, async (request,reply)=>{
    if (!hasRole(request.user.role, ADMIN_ROLES)) return reply.code(403).send({error:'Sem permissão'});
    const [punches,attempts]=await Promise.all([
      prisma.punch.findMany({where:{tenantId:request.user.tenantId,decision:'REVIEW'},include:{employee:{select:{id:true,name:true,employeeNumber:true}},evidence:true},orderBy:{occurredAt:'desc'},take:100}),
      prisma.punchAttempt.findMany({where:{tenantId:request.user.tenantId,decision:'BLOCKED'},include:{employee:{select:{id:true,name:true,employeeNumber:true}},},orderBy:{attemptedAt:'desc'},take:100})
    ]);
    return {punches:punches.map(x=>({...x,recordNumber:x.recordNumber.toString()})),attempts};
  });

  app.post('/admin/punches/:id/review', { preHandler:[app.authenticate] }, async (request,reply)=>{
    if (!hasRole(request.user.role, ADMIN_ROLES)) return reply.code(403).send({error:'Sem permissão'});
    const {id}=z.object({id:z.string()}).parse(request.params); const body=z.object({decision:z.enum(['APPROVED','BLOCKED']),note:z.string().min(3).max(500)}).parse(request.body);
    const punch=await prisma.punch.findFirst({where:{id,tenantId:request.user.tenantId}}); if(!punch)return reply.code(404).send({error:'Marcação não encontrada'});
    const updated=await prisma.punch.update({where:{id},data:{decision:body.decision,reviewReason:body.note}});
    await prisma.auditEvent.create({data:{tenantId:request.user.tenantId,punchId:id,actorUserId:request.user.userId,action:'PUNCH_REVIEWED',entityType:'Punch',entityId:id,beforeJson:{decision:punch.decision},afterJson:{decision:body.decision,note:body.note}}});
    const key=localDateKey(punch.occurredAt,punch.timezone); await persistEmployeeLedger(punch.employeeId,punch.tenantId,key,key);
    return {...updated,recordNumber:updated.recordNumber.toString()};
  });

  app.get('/admin/devices', { preHandler: [app.authenticate] }, async (request, reply) => {
    if (!hasRole(request.user.role, ADMIN_ROLES)) return reply.code(403).send({ error: 'Sem permissão' });
    return prisma.device.findMany({
      where: { employee: { tenantId: request.user.tenantId } },
      include: { employee: { select: { id: true, name: true, employeeNumber: true } } },
      orderBy: { lastSeenAt: 'desc' }, take: 300
    });
  });

  app.post('/admin/devices/:id/trust', { preHandler: [app.authenticate] }, async (request, reply) => {
    if (!hasRole(request.user.role, ADMIN_ROLES)) return reply.code(403).send({ error: 'Sem permissão' });
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const { trusted } = z.object({ trusted: z.boolean() }).parse(request.body);
    const device = await prisma.device.findFirst({ where: { id, employee: { tenantId: request.user.tenantId } } });
    if (!device) return reply.code(404).send({ error: 'Dispositivo não encontrado' });
    return prisma.device.update({ where: { id }, data: { trusted } });
  });
}
