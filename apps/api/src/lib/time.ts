export const WEEKDAY_KEYS = ['SUN','MON','TUE','WED','THU','FRI','SAT'] as const;


export function isValidTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function isValidClockTime(value: string) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function localParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    weekday: 'short'
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value ?? '';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: get('weekday').slice(0, 3).toUpperCase()
  };
}

export function localDateKey(date: Date, timeZone: string) {
  const p = localParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2,'0')}-${String(p.day).padStart(2,'0')}`;
}

export function localTimeKey(date: Date, timeZone: string) {
  const p = localParts(date, timeZone);
  return `${String(p.hour).padStart(2,'0')}:${String(p.minute).padStart(2,'0')}`;
}

export function addDaysKey(key: string, days: number) {
  const [y,m,d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function listDateKeys(from: string, to: string) {
  const out: string[] = [];
  for (let key = from; key <= to; key = addDaysKey(key, 1)) out.push(key);
  return out;
}

export function weekdayKey(key: string) {
  const [y,m,d] = key.split('-').map(Number);
  return WEEKDAY_KEYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

function timeZoneOffsetMs(date: Date, timeZone: string) {
  const p = localParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - date.getTime();
}

export function zonedDateTimeToUtc(dateKey: string, time: string, timeZone: string) {
  const [y,m,d] = dateKey.split('-').map(Number);
  const [hh,mm] = time.split(':').map(Number);
  const wallAsUtc = Date.UTC(y, m - 1, d, hh, mm, 0);
  let candidate = new Date(wallAsUtc);
  for (let i = 0; i < 3; i++) {
    const offset = timeZoneOffsetMs(candidate, timeZone);
    candidate = new Date(wallAsUtc - offset);
  }
  return candidate;
}

export function dateKeyToUtcNoon(key: string) {
  return new Date(`${key}T12:00:00.000Z`);
}

export function minutesBetween(a: Date, b: Date) {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));
}
