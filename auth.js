// auth.js: כניסה עם סיסמה אחת לשרת שחשוף לאינטרנט.
// בלי חבילות חיצוניות: סשן חתום ב-HMAC, השוואה בזמן קבוע, והגבלת ניסיונות כניסה.
import crypto from 'node:crypto';

const hmac = (secret, payload) => crypto.createHmac('sha256', secret).update(payload).digest();

// טוקן סשן: base64url(payload).base64url(חתימה). ה-payload כולל תוקף ומספר אקראי
export function signSession(secret, ttlMs, now = Date.now()) {
  const payload = Buffer.from(
    JSON.stringify({ exp: now + ttlMs, n: crypto.randomBytes(8).toString('hex') })
  ).toString('base64url');
  return `${payload}.${hmac(secret, payload).toString('base64url')}`;
}

export function verifySession(token, secret, now = Date.now()) {
  if (typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false;
  const given = Buffer.from(parts[1], 'base64url');
  const expected = hmac(secret, parts[0]);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    return typeof exp === 'number' && exp > now;
  } catch {
    return false;
  }
}

// משווים גיבובים באורך קבוע, כדי שזמן ההשוואה לא ידלוף מידע על הסיסמה
export function passwordMatches(input, expected) {
  const h = (s) => crypto.createHash('sha256').update(String(s)).digest();
  return crypto.timingSafeEqual(h(input), h(expected));
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const name = part.slice(0, i).trim();
    try {
      out[name] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      /* עוגיה פגומה: מתעלמים */
    }
  }
  return out;
}

// מגביל ניסיונות כושלים: אחרי max כשלונות בתוך החלון, חוסמים עד שהישן ביותר יפוג
export class LoginLimiter {
  constructor({ max = 5, windowMs = 15 * 60 * 1000 } = {}) {
    this.max = max;
    this.windowMs = windowMs;
    this.fails = new Map();
  }

  recent(key, now) {
    const arr = (this.fails.get(key) || []).filter((t) => now - t < this.windowMs);
    if (arr.length) this.fails.set(key, arr);
    else this.fails.delete(key);
    return arr;
  }

  // כמה מילישניות עוד נשארו לחסימה (0 = לא חסום)
  blockedFor(key, now = Date.now()) {
    const arr = this.recent(key, now);
    return arr.length >= this.max ? this.windowMs - (now - arr[0]) : 0;
  }

  fail(key, now = Date.now()) {
    const arr = this.recent(key, now);
    arr.push(now);
    this.fails.set(key, arr);
    if (this.fails.size > 1000) for (const k of this.fails.keys()) this.recent(k, now); // ניקוי
  }

  success(key) {
    this.fails.delete(key);
  }
}
