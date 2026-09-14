import { Punch, Shift, TimeRuleSettings } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { addDaysKey, dateKeyToUtcNoon, listDateKeys, localDateKey, localTimeKey, minutesBetween, weekdayKey, zonedDateTimeToUtc } from '../lib/time.js';

type Interval = { start: Date; end: Date };

export type DayCalculation = {
  date: string;
  scheduledMinutes: number;
  workedMinutes: number;
  regularMinutes: number;
  overtime50Minutes: number;
  overtime100Minutes: number;
  nightMinutes: number;
  missingMinutes: number;
  bankDeltaMinutes: number;
  breakMinutes: number;
  openPunch: boolean;
  warnings: string[];
  punchCount: number;
};

export async function getOrCreateRules(tenantId: string) {
  return prisma.timeRuleSettings.upsert({
    where: { tenantId }, update: {}, create: { tenantId }
  });
}

function isOvernightShift(shift?: Shift | null) {
  return Boolean(shift && shift.endTime <= shift.startTime);
}

function workDateForPunch(punch: Punch, shift: Shift | null | undefined, timeZone: string) {
  let key = localDateKey(punch.occurredAt, timeZone);
  if (isOvernightShift(shift) && localTimeKey(punch.occurredAt, timeZone) <= (shift?.endTime ?? '00:00')) {
    key = addDaysKey(key, -1);
  }
  return key;
}

function buildIntervals(punches: Punch[]) {
  const intervals: Interval[] = [];
  const warnings: string[] = [];
  let open: Date | null = null;
  let lastBreakStart: Date | null = null;
  let lastPauseStart: Date | null = null;
  let breakMinutes = 0;

  for (const p of punches) {
    if (p.type === 'CLOCK_IN') {
      if (open) warnings.push('Existe uma nova entrada antes do fechamento da marcação anterior.');
      open = p.occurredAt;
    } else if (p.type === 'BREAK_START') {
      if (open) {
        intervals.push({ start: open, end: p.occurredAt });
        open = null;
      } else warnings.push('Início de intervalo sem período de trabalho aberto.');
      lastBreakStart = p.occurredAt;
    } else if (p.type === 'BREAK_END') {
      if (lastBreakStart) breakMinutes += minutesBetween(lastBreakStart, p.occurredAt);
      else warnings.push('Retorno de intervalo sem início correspondente.');
      lastBreakStart = null;
      open = p.occurredAt;
    } else if (p.type === 'PAUSE_START') {
      if (open) { intervals.push({ start: open, end: p.occurredAt }); open = null; }
      else warnings.push('Início de pausa sem período de trabalho aberto.');
      lastPauseStart = p.occurredAt;
    } else if (p.type === 'PAUSE_END') {
      if (!lastPauseStart) warnings.push('Retorno de pausa sem início correspondente.');
      lastPauseStart = null;
      open = p.occurredAt;
    } else if (p.type === 'CLOCK_OUT') {
      if (open) {
        intervals.push({ start: open, end: p.occurredAt });
        open = null;
      } else warnings.push('Saída sem período de trabalho aberto.');
    }
  }

  if (lastBreakStart) warnings.push('Intervalo sem retorno registrado.');
  if (lastPauseStart) warnings.push('Pausa sem retorno registrado.');
  if (open) warnings.push('Jornada possui período aberto sem saída.');
  return { intervals, warnings, breakMinutes, openPunch: Boolean(open) };
}

function overlapMinutes(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  const start = Math.max(aStart.getTime(), bStart.getTime());
  const end = Math.min(aEnd.getTime(), bEnd.getTime());
  return end > start ? Math.round((end - start) / 60000) : 0;
}

function nightMinutes(intervals: Interval[], workDate: string, timeZone: string, rules: TimeRuleSettings) {
  let total = 0;
  for (const candidateDate of [addDaysKey(workDate, -1), workDate, addDaysKey(workDate, 1)]) {
    const start = zonedDateTimeToUtc(candidateDate, rules.nightStart, timeZone);
    const endDate = rules.nightEnd <= rules.nightStart ? addDaysKey(candidateDate, 1) : candidateDate;
    const end = zonedDateTimeToUtc(endDate, rules.nightEnd, timeZone);
    for (const interval of intervals) total += overlapMinutes(interval.start, interval.end, start, end);
  }
  return total;
}

export function calculateDay(date: string, punches: Punch[], shift: Shift | null | undefined, rules: TimeRuleSettings, timeZone: string): DayCalculation {
  const ordered = [...punches].sort((a,b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const { intervals, warnings, breakMinutes, openPunch } = buildIntervals(ordered);
  const workedMinutes = intervals.reduce((sum, i) => sum + minutesBetween(i.start, i.end), 0);
  const scheduleDays = Array.isArray(shift?.scheduleDays) ? shift!.scheduleDays as string[] : [];
  const isScheduled = Boolean(shift?.active && scheduleDays.includes(weekdayKey(date)));
  const scheduledMinutes = isScheduled ? (shift?.dailyMinutes ?? 0) : 0;
  const tolerance = shift?.overtimeToleranceMin ?? rules.defaultToleranceMin;

  let overtimeMinutes = 0;
  let missingMinutes = 0;
  if (scheduledMinutes === 0) overtimeMinutes = workedMinutes;
  else {
    if (workedMinutes > scheduledMinutes + tolerance) overtimeMinutes = workedMinutes - scheduledMinutes;
    if (workedMinutes < scheduledMinutes - tolerance) missingMinutes = scheduledMinutes - workedMinutes;
  }

  const regularMinutes = scheduledMinutes ? Math.min(workedMinutes, scheduledMinutes) : 0;
  const sunday = weekdayKey(date) === 'SUN';
  const overtime100Minutes = sunday && rules.sundayOvertime100 ? overtimeMinutes : 0;
  const overtime50Minutes = overtimeMinutes - overtime100Minutes;
  const calculatedNight = nightMinutes(intervals, date, timeZone, rules);
  const bankDeltaMinutes = rules.bankHoursEnabled ? (rules.overtimeToBank ? overtimeMinutes : 0) - (rules.deficitToBank ? missingMinutes : 0) : 0;

  if (scheduledMinutes > 0 && breakMinutes > 0 && breakMinutes < rules.minBreakMinutes) warnings.push(`Intervalo abaixo do parâmetro de ${rules.minBreakMinutes} min.`);
  if (workedMinutes > rules.maxDailyMinutes) warnings.push(`Jornada acima do parâmetro de ${rules.maxDailyMinutes} min/dia.`);
  if (ordered.length % 2 !== 0) warnings.push('Quantidade ímpar de marcações; revise a jornada.');

  return {
    date, scheduledMinutes, workedMinutes, regularMinutes, overtime50Minutes, overtime100Minutes,
    nightMinutes: calculatedNight, missingMinutes, bankDeltaMinutes, breakMinutes, openPunch,
    warnings: [...new Set(warnings)], punchCount: ordered.length
  };
}

export async function calculateEmployeeRange(employeeId: string, tenantId: string, from: string, to: string) {
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, tenantId }, include: { shift: true, tenant: true }
  });
  if (!employee) throw Object.assign(new Error('Colaborador não encontrado'), { statusCode: 404 });
  const rules = await getOrCreateRules(tenantId);
  const timeZone = employee.shift?.timezone || employee.tenant.timezone || 'America/Maceio';
  const startUtc = zonedDateTimeToUtc(addDaysKey(from, -1), '00:00', timeZone);
  const endUtc = zonedDateTimeToUtc(addDaysKey(to, 2), '00:00', timeZone);
  const [rawPunches, approvedAdjustments] = await Promise.all([
    prisma.punch.findMany({
      where: { tenantId, employeeId, decision: { not: 'BLOCKED' }, occurredAt: { gte: startUtc, lt: endUtc } }, orderBy: { occurredAt: 'asc' }
    }),
    prisma.adjustmentRequest.findMany({
      where: { tenantId, employeeId, status: 'APPROVED', targetPunchId: { not: null } },
      select: { targetPunchId: true }
    })
  ]);
  const superseded = new Set(approvedAdjustments.map(a => a.targetPunchId).filter((x): x is string => Boolean(x)));
  const punches = rawPunches.filter(p => !superseded.has(p.id));
  const buckets = new Map<string, Punch[]>();
  for (const p of punches) {
    const key = workDateForPunch(p, employee.shift, timeZone);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(p);
  }
  const days = listDateKeys(from, to).map(key => calculateDay(key, buckets.get(key) ?? [], employee.shift, rules, timeZone));
  const totals = days.reduce((acc, day) => {
    acc.scheduledMinutes += day.scheduledMinutes;
    acc.workedMinutes += day.workedMinutes;
    acc.regularMinutes += day.regularMinutes;
    acc.overtime50Minutes += day.overtime50Minutes;
    acc.overtime100Minutes += day.overtime100Minutes;
    acc.nightMinutes += day.nightMinutes;
    acc.missingMinutes += day.missingMinutes;
    acc.bankDeltaMinutes += day.bankDeltaMinutes;
    acc.warningCount += day.warnings.length;
    return acc;
  }, { scheduledMinutes:0, workedMinutes:0, regularMinutes:0, overtime50Minutes:0, overtime100Minutes:0, nightMinutes:0, missingMinutes:0, bankDeltaMinutes:0, warningCount:0 });
  return { employee, rules, timeZone, days, totals };
}

export async function persistEmployeeLedger(employeeId: string, tenantId: string, from: string, to: string) {
  const result = await calculateEmployeeRange(employeeId, tenantId, from, to);
  for (const day of result.days) {
    await prisma.timeBalanceLedger.upsert({
      where: { tenantId_employeeId_workDate: { tenantId, employeeId, workDate: dateKeyToUtcNoon(day.date) } },
      update: {
        scheduledMinutes: day.scheduledMinutes, workedMinutes: day.workedMinutes, regularMinutes: day.regularMinutes,
        overtime50Minutes: day.overtime50Minutes, overtime100Minutes: day.overtime100Minutes,
        nightMinutes: day.nightMinutes, missingMinutes: day.missingMinutes, bankDeltaMinutes: day.bankDeltaMinutes,
        detailsJson: { warnings: day.warnings, breakMinutes: day.breakMinutes, punchCount: day.punchCount, openPunch: day.openPunch },
        calculatedAt: new Date()
      },
      create: {
        tenantId, employeeId, workDate: dateKeyToUtcNoon(day.date), scheduledMinutes: day.scheduledMinutes,
        workedMinutes: day.workedMinutes, regularMinutes: day.regularMinutes, overtime50Minutes: day.overtime50Minutes,
        overtime100Minutes: day.overtime100Minutes, nightMinutes: day.nightMinutes, missingMinutes: day.missingMinutes,
        bankDeltaMinutes: day.bankDeltaMinutes,
        detailsJson: { warnings: day.warnings, breakMinutes: day.breakMinutes, punchCount: day.punchCount, openPunch: day.openPunch }
      }
    });
  }
  return result;
}
