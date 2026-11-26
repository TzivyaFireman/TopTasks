// ics.js: קריאת יומן ICS (למשל יומן Outlook מפורסם) ושליפת האירועים של יום מסוים,
// כולל אירועים חוזרים. כל השעות מומרות לשעון המקומי של המחשב שמריץ את השרת.

const WINDOWS_TZ = {
  'Israel Standard Time': 'Asia/Jerusalem',
  'UTC': 'UTC',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw',
  'Romance Standard Time': 'Europe/Paris',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'FLE Standard Time': 'Europe/Kiev',
  'GTB Standard Time': 'Europe/Bucharest',
  'Turkey Standard Time': 'Europe/Istanbul',
  'Russian Standard Time': 'Europe/Moscow',
  'Jordan Standard Time': 'Asia/Amman',
  'Arabian Standard Time': 'Asia/Dubai',
  'Arab Standard Time': 'Asia/Riyadh',
  'Egypt Standard Time': 'Africa/Cairo',
  'South Africa Standard Time': 'Africa/Johannesburg',
  'India Standard Time': 'Asia/Kolkata',
  'China Standard Time': 'Asia/Shanghai',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'Pacific Standard Time': 'America/Los_Angeles',
};

const DAY = 864e5;
const pad = (n) => String(n).padStart(2, '0');
const dayNum = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d) / DAY);
const fromDayNum = (n) => {
  const dt = new Date(n * DAY);
  return { y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
};
const weekday = (n) => (((n + 4) % 7) + 7) % 7; // 0 = יום ראשון
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m מתחיל מ-1
const WD = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

// ---------- קישור ----------
export function normalizeUrl(u) {
  const s = String(u || '').trim().replace(/^webcal:\/\//i, 'https://');
  if (!/^https?:\/\/\S+$/i.test(s)) throw new Error('הקישור חייב להתחיל ב-https://');
  return s;
}

// ---------- אזורי זמן ----------
const zoneCache = new Map();
function resolveZone(tzid) {
  if (!tzid) return null; // ללא אזור זמן: שעון מקומי
  if (zoneCache.has(tzid)) return zoneCache.get(tzid);
  let z = WINDOWS_TZ[tzid] || tzid;
  if (/utc$/i.test(tzid)) z = 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: z });
  } catch {
    z = null; // שם לא מוכר: מתייחסים אליו כשעון מקומי
  }
  zoneCache.set(tzid, z);
  return z;
}

const dtfCache = new Map();
function offsetMs(zone, utcMs) {
  let dtf = dtfCache.get(zone);
  if (!dtf) {
    dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hourCycle: 'h23',
      year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    });
    dtfCache.set(zone, dtf);
  }
  const parts = dtf.formatToParts(new Date(utcMs));
  const g = (t) => Number(parts.find((p) => p.type === t).value);
  const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second'));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

// שעת קיר באזור זמן מסוים -> רגע בזמן (מילישניות). zone=null מייצג שעון מקומי
function wallToInstant(y, mo, d, h, mi, s, zone) {
  if (!zone) return new Date(y, mo - 1, d, h, mi, s).getTime();
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const off = offsetMs(zone, guess);
  let t = guess - off;
  const off2 = offsetMs(zone, t);
  if (off2 !== off) t = guess - off2;
  return t;
}

// ---------- פענוח שורות ----------
function parseLine(line) {
  let inQuote = false;
  let idx = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuote = !inQuote;
    else if (ch === ':' && !inQuote) {
      idx = i;
      break;
    }
  }
  if (idx < 0) return null;
  const [name, ...ps] = line.slice(0, idx).split(';');
  const params = {};
  for (const p of ps) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params, value: line.slice(idx + 1) };
}

function parseDt(value) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(String(value).trim());
  if (!m) return null;
  return {
    y: +m[1], mo: +m[2], d: +m[3], h: +(m[4] || 0), mi: +(m[5] || 0), s: +(m[6] || 0),
    utc: !!m[7], allDay: m[4] === undefined,
  };
}

const dtToMs = (dt, tzid) => {
  if (dt.allDay) return wallToInstant(dt.y, dt.mo, dt.d, 0, 0, 0, null);
  const zone = dt.utc ? 'UTC' : resolveZone(tzid);
  return wallToInstant(dt.y, dt.mo, dt.d, dt.h, dt.mi, dt.s, zone);
};

function parseDuration(v) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(v).trim());
  if (!m) return 0;
  const ms = ((+m[2] || 0) * 7 + (+m[3] || 0)) * DAY + (+m[4] || 0) * 36e5 + (+m[5] || 0) * 6e4 + (+m[6] || 0) * 1e3;
  return m[1] === '-' ? -ms : ms;
}

const unescapeText = (s) => String(s || '').replace(/\\[nN]/g, '\n').replace(/\\([,;\\])/g, '$1');

function parseRrule(value) {
  const r = { freq: '', interval: 1, count: null, until: null, byday: [], bymonthday: [], bymonth: [], wkst: 1 };
  for (const part of String(value).split(';')) {
    const [k, v = ''] = part.split('=');
    switch (k.toUpperCase()) {
      case 'FREQ': r.freq = v.toUpperCase(); break;
      case 'INTERVAL': r.interval = Math.max(1, parseInt(v, 10) || 1); break;
      case 'COUNT': r.count = parseInt(v, 10) || null; break;
      case 'UNTIL': r.until = v; break;
      case 'WKST': r.wkst = WD[v.toUpperCase()] ?? 1; break;
      case 'BYMONTH': r.bymonth = v.split(',').map(Number).filter(Boolean); break;
      case 'BYMONTHDAY': r.bymonthday = v.split(',').map(Number).filter(Boolean); break;
      case 'BYDAY':
        r.byday = v.split(',').map((t) => {
          const m = /^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/i.exec(t.trim());
          return m ? { n: m[1] ? parseInt(m[1], 10) : 0, wd: WD[m[2].toUpperCase()] } : null;
        }).filter(Boolean);
        break;
    }
  }
  return r;
}

const TEAMS_URL = /https:\/\/teams\.(?:microsoft|live)\.com\/[^\s<>"\\]+/i;

function buildEvent(lines) {
  const first = (n) => lines.find((l) => l.name === n);
  const ds = first('DTSTART');
  if (!ds) return null;
  const s = parseDt(ds.value);
  if (!s) return null;
  const zone = s.allDay ? null : s.utc ? 'UTC' : resolveZone(ds.params.TZID);
  const startMs = dtToMs(s, ds.params.TZID);

  let durationMs = 0;
  const de = first('DTEND');
  const du = first('DURATION');
  if (de) {
    const e = parseDt(de.value);
    if (e) durationMs = Math.max(0, dtToMs(e, de.params.TZID) - startMs);
  } else if (du) durationMs = Math.max(0, parseDuration(du.value));
  else if (s.allDay) durationMs = DAY;

  const rid = first('RECURRENCE-ID');
  const ridDt = rid && parseDt(rid.value);
  const recurrenceId = ridDt ? dtToMs(ridDt, rid.params.TZID || ds.params.TZID) : null;

  const exdates = [];
  for (const l of lines.filter((x) => x.name === 'EXDATE')) {
    for (const v of l.value.split(',')) {
      const dt = parseDt(v);
      if (dt) exdates.push(dtToMs(dt, l.params.TZID || ds.params.TZID));
    }
  }

  const rr = first('RRULE');
  const rrule = rr ? parseRrule(rr.value) : null;
  let untilMs = null;
  if (rrule?.until) {
    const u = parseDt(rrule.until);
    if (u) {
      untilMs = u.allDay
        ? wallToInstant(u.y, u.mo, u.d, 23, 59, 59, zone)
        : u.utc ? Date.UTC(u.y, u.mo - 1, u.d, u.h, u.mi, u.s) : wallToInstant(u.y, u.mo, u.d, u.h, u.mi, u.s, zone);
    }
  }

  const description = unescapeText(first('DESCRIPTION')?.value);
  const location = unescapeText(first('LOCATION')?.value).trim();
  const teamsUrl =
    [first('X-MICROSOFT-SKYPETEAMSMEETINGURL')?.value, description, location, first('URL')?.value]
      .map((t) => TEAMS_URL.exec(unescapeText(t || ''))?.[0])
      .find(Boolean) || '';

  return {
    uid: first('UID')?.value || '',
    title: unescapeText(first('SUMMARY')?.value).trim() || 'ללא נושא',
    location,
    teamsUrl,
    status: (first('STATUS')?.value || '').toUpperCase(),
    allDay: s.allDay,
    zone,
    startWall: s,
    startMs,
    durationMs,
    recurrenceId,
    exdates,
    rrule,
    untilMs,
  };
}

export function parseIcs(text) {
  const lines = String(text).replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const events = [];
  let cur = null;
  let alarmDepth = 0;
  for (const raw of lines) {
    if (raw === 'BEGIN:VEVENT') {
      cur = [];
      alarmDepth = 0;
    } else if (raw === 'END:VEVENT') {
      if (cur) {
        const ev = buildEvent(cur);
        if (ev) events.push(ev);
      }
      cur = null;
    } else if (cur) {
      if (raw === 'BEGIN:VALARM') alarmDepth++;
      else if (raw === 'END:VALARM') alarmDepth--;
      else if (alarmDepth === 0) {
        const l = parseLine(raw);
        if (l) cur.push(l);
      }
    }
  }
  return events;
}

// ---------- הרחבת אירועים חוזרים ----------
function monthCandidates(y, m, r, startDay) {
  // m מתחיל מ-1. מחזיר מספרי ימים בחודש, ממוינים
  const dim = daysIn(y, m);
  const days = new Set();
  if (r.bymonthday.length) {
    for (const md of r.bymonthday) {
      const d = md > 0 ? md : dim + md + 1;
      if (d >= 1 && d <= dim) days.add(d);
    }
  } else if (r.byday.length) {
    const firstWd = weekday(dayNum(y, m, 1));
    const lastWd = weekday(dayNum(y, m, dim));
    for (const { n, wd } of r.byday) {
      if (n === 0) {
        for (let d = 1 + ((wd - firstWd + 7) % 7); d <= dim; d += 7) days.add(d);
      } else if (n > 0) {
        const d = 1 + ((wd - firstWd + 7) % 7) + (n - 1) * 7;
        if (d <= dim) days.add(d);
      } else {
        const d = dim - ((lastWd - wd + 7) % 7) + (n + 1) * 7;
        if (d >= 1) days.add(d);
      }
    }
  } else if (startDay <= dim) {
    days.add(startDay);
  }
  return [...days].sort((a, b) => a - b);
}

function* naiveDays(ev) {
  const r = ev.rrule;
  const { y, mo, d } = ev.startWall;
  const startN = dayNum(y, mo, d);
  const interval = r.interval || 1;
  const LIMIT = 20000;

  if (r.freq === 'DAILY') {
    for (let i = 0; i < LIMIT; i++) {
      const n = startN + i * interval;
      if (r.byday.length && !r.byday.some((b) => b.wd === weekday(n))) continue;
      yield n;
    }
  } else if (r.freq === 'WEEKLY') {
    const startWd = weekday(startN);
    const weekStart = startN - ((startWd - r.wkst + 7) % 7);
    const wds = r.byday.length ? r.byday.map((b) => b.wd) : [startWd];
    const offsets = [...new Set(wds.map((wd) => (wd - r.wkst + 7) % 7))].sort((a, b) => a - b);
    for (let k = 0; k < LIMIT; k++) {
      for (const off of offsets) {
        const n = weekStart + k * interval * 7 + off;
        if (n >= startN) yield n;
      }
    }
  } else if (r.freq === 'MONTHLY') {
    for (let k = 0; k < LIMIT; k++) {
      const m0 = mo - 1 + k * interval;
      const yy = y + Math.floor(m0 / 12);
      const mm = (m0 % 12) + 1;
      for (const day of monthCandidates(yy, mm, r, d)) {
        const n = dayNum(yy, mm, day);
        if (n >= startN) yield n;
      }
    }
  } else if (r.freq === 'YEARLY') {
    const months = r.bymonth.length ? [...r.bymonth].sort((a, b) => a - b) : [mo];
    for (let k = 0; k < LIMIT; k++) {
      const yy = y + k * interval;
      for (const mm of months) {
        for (const day of monthCandidates(yy, mm, r, d)) {
          const n = dayNum(yy, mm, day);
          if (n >= startN) yield n;
        }
      }
    }
  } else {
    yield startN; // תדירות לא מוכרת: מתייחסים לאירוע בודד
  }
}

// ---------- אירועי יום ----------
const hm = (ms) => {
  const dt = new Date(ms);
  return `${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
};

// date בפורמט YYYY-MM-DD. מחזיר את האירועים שחופפים ליום הזה בשעון המקומי
export function meetingsForDay(events, date) {
  const [Y, M, D] = date.split('-').map(Number);
  const dayStart = new Date(Y, M - 1, D).getTime();
  const dayEnd = new Date(Y, M - 1, D + 1).getTime();
  const out = [];

  const overlaps = (s, e) => (e > s ? s < dayEnd && e > dayStart : s >= dayStart && s < dayEnd);
  const minOfDay = (ms) => {
    if (ms <= dayStart) return 0;
    if (ms >= dayEnd) return 1440;
    const dt = new Date(ms);
    return dt.getHours() * 60 + dt.getMinutes();
  };
  const push = (ev, startMs) => {
    const endMs = startMs + ev.durationMs;
    if (!overlaps(startMs, endMs)) return;
    out.push({
      id: `${ev.uid}@${startMs}`,
      title: ev.title,
      location: ev.location,
      teamsUrl: ev.teamsUrl,
      allDay: ev.allDay,
      timeLabel: ev.allDay ? 'כל היום' : `${hm(startMs)}–${hm(endMs)}`,
      startMin: ev.allDay ? 0 : minOfDay(startMs),
      endMin: ev.allDay ? 1440 : minOfDay(endMs),
    });
  };

  // שינויים בודדים באירוע חוזר (ושינויים שבוטלו) מחליפים את המופע המקורי
  const overridden = new Set();
  for (const ev of events) if (ev.recurrenceId != null) overridden.add(`${ev.uid}|${ev.recurrenceId}`);

  for (const ev of events) {
    if (ev.status === 'CANCELLED') continue;
    if (ev.recurrenceId != null || !ev.rrule) {
      push(ev, ev.startMs);
      continue;
    }
    const w = ev.startWall;
    let count = 0;
    for (const n of naiveDays(ev)) {
      count++;
      if (ev.rrule.count && count > ev.rrule.count) break;
      const { y, mo, d } = fromDayNum(n);
      const startMs = wallToInstant(y, mo, d, ev.allDay ? 0 : w.h, ev.allDay ? 0 : w.mi, ev.allDay ? 0 : w.s, ev.zone);
      if (ev.untilMs != null && startMs > ev.untilMs) break;
      if (startMs >= dayEnd) break;
      if (ev.exdates.includes(startMs) || overridden.has(`${ev.uid}|${startMs}`)) continue;
      push(ev, startMs);
    }
  }

  return out.sort((a, b) => a.startMin - b.startMin || a.title.localeCompare(b.title, 'he'));
}
