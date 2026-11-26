import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { meetingsForDay, normalizeUrl, parseIcs } from './ics.js';
import { LoginLimiter, parseCookies, passwordMatches, signSession, verifySession } from './auth.js';
import { closeDb, col, connectDb, nextId } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// בענן (Render) השרת רץ ב-UTC כברירת מחדל. אזור הזמן קובע מהו "היום" ובאיזו שעה מוצגות הפגישות
if (process.env.RENDER && !process.env.TZ) process.env.TZ = 'Asia/Jerusalem';

// ---------- הגדרות סביבה ----------
// MONGODB_URI: כתובת החיבור ל-MongoDB (מכילה סיסמה, ולכן היא סוד). MONGODB_DB: שם המסד
const MONGODB_URI = process.env.MONGODB_URI || '';
if (!MONGODB_URI) {
  console.error('חסר MONGODB_URI. צריך להגדיר את כתובת החיבור ל-MongoDB (בקובץ .env מקומית, או ב-Environment ב-Render).');
  process.exit(1);
}

// APP_PASSWORD: סיסמת כניסה. אם לא מוגדרת (שימוש מקומי) אין מסך כניסה. בענן חובה להגדיר אותה
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const AUTH_ON = APP_PASSWORD !== '';
if (process.env.RENDER) {
  if (!AUTH_ON) {
    console.error('חסר APP_PASSWORD. בלי סיסמה כל אחד היה יכול לראות את נתוני הלקוחות, ולכן השרת לא עולה.');
    process.exit(1);
  }
  if (APP_PASSWORD.length < 12) {
    console.error('APP_PASSWORD קצרה מדי. נדרשות לפחות 12 תווים.');
    process.exit(1);
  }
}
// SESSION_SECRET: מפתח החתימה של עוגיית הכניסה. אם חסר, נוצר מפתח זמני והכניסות מתאפסות בכל הפעלה מחדש
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

try {
  await connectDb(MONGODB_URI, process.env.MONGODB_DB || 'clientmanager');
} catch (e) {
  console.error('לא הצלחתי להתחבר ל-MongoDB:', String(e.message).split(MONGODB_URI).join('[MONGODB_URI]'));
  process.exit(1);
}

// מודולים התחלתיים (אפשר לערוך בהגדרות)
if (!(await col('modules').findOne({}))) {
  for (const name of ['תקציב', 'מסמכים', 'יומני עבודה', 'בטיחות', 'איכות', 'תהליכים']) {
    await col('modules').insertOne({ _id: await nextId('modules'), name });
  }
}

// ---------- עזרים ----------
const fmt = (d) => d.toLocaleDateString('sv-SE'); // YYYY-MM-DD לפי שעון מקומי
const today = () => fmt(new Date());
const plusDays = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return fmt(d);
};
const endOfDay = (date) => `${date}T23:59`; // השוואת מחרוזות: כל משימה עד סוף היום הזה
const nowIso = () => new Date().toISOString();
const str = (v) => (v ?? '').toString().trim();
const idOrNull = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
};
const okDateTime = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v);
const okDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const STATUSES = ['active', 'onboarding', 'inactive'];
const bad = (res, msg) => res.status(400).send(msg);
const round = (n) => Math.round(n * 1e6) / 1e6;
const byName = (a, b) => a.name.localeCompare(b.name, 'he', { sensitivity: 'base' });

// מעטפת לנקודות קצה אסינכרוניות: שגיאה מגיעה למטפל השגיאות במקום להפיל את השרת
const h = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res)).catch((e) => (next ? next(e) : Promise.reject(e)));

// _id הפנימי של המסד מוחזר ללקוח בשם id (כמו קודם)
const out = (d) => {
  const { _id, ...rest } = d;
  return { id: _id, ...rest };
};

// יתרת שעות לכל חברה: סך הרכישות פחות סך הדיווחים
async function balances() {
  const sum = (name) =>
    col(name).aggregate([{ $group: { _id: '$company_id', total: { $sum: '$hours' } } }]).toArray();
  const [bought, used] = await Promise.all([sum('hour_packages'), sum('hour_logs')]);
  const map = new Map();
  for (const r of bought) map.set(r._id, (map.get(r._id) || 0) + r.total);
  for (const r of used) map.set(r._id, (map.get(r._id) || 0) - r.total);
  return (id) => round(map.get(id) || 0);
}

// משימות עם שם החברה (null למשימה כללית)
async function withCompany(tasks) {
  const ids = [...new Set(tasks.map((t) => t.company_id).filter((v) => v != null))];
  const names = new Map();
  if (ids.length) {
    const companies = await col('companies').find({ _id: { $in: ids } }, { projection: { name: 1 } }).toArray();
    for (const c of companies) names.set(c._id, c.name);
  }
  return tasks.map((t) => ({ ...out(t), company_name: t.company_id != null ? names.get(t.company_id) ?? null : null }));
}

// מזהה חברה חובה: מחזיר את המזהה, או שולח 400 ומחזיר null
async function requireCompany(v, res) {
  const id = Number(v);
  if (!Number.isInteger(id) || !(await col('companies').findOne({ _id: id }, { projection: { _id: 1 } }))) {
    bad(res, 'החברה לא קיימת');
    return null;
  }
  return id;
}
// מזהה חברה אופציונלי: ריק = ללא חברה
async function companyOrNone(v, res) {
  if (v === '' || v === null || v === undefined) return { id: null };
  const id = await requireCompany(v, res);
  return id === null ? { error: true } : { id };
}

const app = express();
app.disable?.('x-powered-by');
app.use(express.json({ limit: '20mb' })); // גודל נדרש לשחזור מגיבוי

// ---------- אבטחה: כותרות, כניסה וסשן ----------
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const loginLimiter = new LoginLimiter({ max: 5 }); // לפי כתובת
const globalLimiter = new LoginLimiter({ max: 30 }); // סך הכול, למקרה שהכתובת מזויפת

const isSecure = (req) => !!process.env.RENDER || req.headers['x-forwarded-proto'] === 'https';
// הכתובת האחרונה ב-X-Forwarded-For נוספה על ידי השרת של Render, ולכן אי אפשר לזייף אותה מבחוץ
const clientKey = (req) => String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',').pop().trim();
const isAuthed = (req) => verifySession(parseCookies(req.headers.cookie).sid, SESSION_SECRET);
const sessionCookie = (value, maxAgeSec, req) =>
  `sid=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${isSecure(req) ? '; Secure' : ''}`;

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
  );
  if (isSecure(req)) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
});

// כל ה-API סגור בלי כניסה. רק שלוש הנקודות האלה פתוחות
const PUBLIC_API = new Set(['/api/login', '/api/logout', '/api/me']);
app.use((req, res, next) => {
  if (!AUTH_ON || !req.path.startsWith('/api/') || PUBLIC_API.has(req.path)) return next();
  if (isAuthed(req)) return next();
  res.status(401).send('נדרשת כניסה');
});

app.get('/api/me', (req, res) => {
  res.json({ authRequired: AUTH_ON, authenticated: !AUTH_ON || isAuthed(req) });
});

app.post('/api/login', h(async (req, res) => {
  if (!AUTH_ON) return res.json({ ok: true });
  const key = clientKey(req);
  const wait = Math.max(loginLimiter.blockedFor(key), globalLimiter.blockedFor('all'));
  if (wait > 0) {
    return res.status(429).send(`יותר מדי ניסיונות כושלים. אפשר לנסות שוב בעוד ${Math.ceil(wait / 60000)} דקות.`);
  }
  if (!passwordMatches(String(req.body.password ?? ''), APP_PASSWORD)) {
    loginLimiter.fail(key);
    globalLimiter.fail('all');
    await new Promise((r) => setTimeout(r, 400)); // מאט ניחושים
    return res.status(401).send('סיסמה שגויה');
  }
  loginLimiter.success(key);
  res.setHeader('Set-Cookie', sessionCookie(signSession(SESSION_SECRET, SESSION_TTL_MS), SESSION_TTL_MS / 1000, req));
  res.json({ ok: true });
}));

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', sessionCookie('', 0, req));
  res.json({ ok: true });
});

// ---------- הגדרות: צוות ומודולים ----------
app.get('/api/settings', h(async (req, res) => {
  const [team, modules] = await Promise.all([
    col('team_members').find({}).toArray(),
    col('modules').find({}).sort({ _id: 1 }).toArray(),
  ]);
  res.json({ team: team.sort(byName).map(out), modules: modules.map(out) });
}));

app.post('/api/team', h(async (req, res) => {
  const name = str(req.body.name);
  if (!name) return bad(res, 'חסר שם');
  const id = await nextId('team_members');
  await col('team_members').insertOne({ _id: id, name });
  res.json({ id });
}));
app.put('/api/team/:id', h(async (req, res) => {
  const name = str(req.body.name);
  if (!name) return bad(res, 'חסר שם');
  await col('team_members').updateOne({ _id: Number(req.params.id) }, { $set: { name } });
  res.json({ ok: true });
}));
app.delete('/api/team/:id', h(async (req, res) => {
  const id = Number(req.params.id);
  await col('companies').updateMany({ sales_rep_id: id }, { $set: { sales_rep_id: null } });
  await col('company_modules').updateMany({ pm_id: id }, { $set: { pm_id: null } });
  await col('team_members').deleteOne({ _id: id });
  res.json({ ok: true });
}));

app.post('/api/modules', h(async (req, res) => {
  const name = str(req.body.name);
  if (!name) return bad(res, 'חסר שם');
  const id = await nextId('modules');
  await col('modules').insertOne({ _id: id, name });
  res.json({ id });
}));
app.put('/api/modules/:id', h(async (req, res) => {
  const name = str(req.body.name);
  if (!name) return bad(res, 'חסר שם');
  await col('modules').updateOne({ _id: Number(req.params.id) }, { $set: { name } });
  res.json({ ok: true });
}));
app.delete('/api/modules/:id', h(async (req, res) => {
  const id = Number(req.params.id);
  await col('company_modules').deleteMany({ module_id: id });
  await col('modules').deleteOne({ _id: id });
  res.json({ ok: true });
}));

// ---------- חברות ----------
app.get('/api/companies', h(async (req, res) => {
  const limit = endOfDay(today());
  const [companies, contacts, openTasks, balanceOf] = await Promise.all([
    col('companies').find({}).toArray(),
    col('contacts').find({}).sort({ is_primary: -1, _id: 1 }).toArray(),
    col('tasks').find({ status: 'open' }, { projection: { company_id: 1, due_at: 1 } }).toArray(),
    balances(),
  ]);
  const primary = new Map();
  for (const c of contacts) if (!primary.has(c.company_id)) primary.set(c.company_id, c.name);
  const open = new Map();
  const due = new Map();
  for (const t of openTasks) {
    if (t.company_id == null) continue;
    open.set(t.company_id, (open.get(t.company_id) || 0) + 1);
    if (t.due_at <= limit) due.set(t.company_id, (due.get(t.company_id) || 0) + 1);
  }
  const rows = companies.map((c) => ({
    id: c._id,
    name: c.name,
    status: c.status,
    bank_enabled: c.bank_enabled,
    low_threshold: c.low_threshold,
    primary_contact: primary.get(c._id) ?? null,
    open_tasks: open.get(c._id) || 0,
    due_tasks: due.get(c._id) || 0,
    balance: balanceOf(c._id),
  }));
  res.json(rows.sort(byName));
}));

app.post('/api/companies', h(async (req, res) => {
  const name = str(req.body.name);
  if (!name) return bad(res, 'חסר שם חברה');
  const id = await nextId('companies');
  await col('companies').insertOne({
    _id: id, name, status: 'active', sales_rep_id: null, bank_enabled: 0, low_threshold: 2, created_at: nowIso(),
  });
  res.json({ id });
}));

app.get('/api/companies/:id', h(async (req, res) => {
  const id = Number(req.params.id);
  const company = await col('companies').findOne({ _id: id });
  if (!company) return res.status(404).send('החברה לא נמצאה');
  const [contacts, keyPoints, notes, tasks, allModules, links, packages, logs, balanceOf] = await Promise.all([
    col('contacts').find({ company_id: id }).sort({ is_primary: -1, _id: 1 }).toArray(),
    col('key_points').find({ company_id: id }).sort({ _id: 1 }).toArray(),
    col('notes').find({ company_id: id }).sort({ pinned: -1, _id: -1 }).toArray(),
    col('tasks').find({ company_id: id }).sort({ status: -1, due_at: 1 }).toArray(),
    col('modules').find({}).sort({ _id: 1 }).toArray(),
    col('company_modules').find({ company_id: id }).toArray(),
    col('hour_packages').find({ company_id: id }).sort({ purchased_at: -1, _id: -1 }).toArray(),
    col('hour_logs').find({ company_id: id }).sort({ date: -1, _id: -1 }).toArray(),
    balances(),
  ]);
  const pm = new Map(links.map((l) => [l.module_id, l.pm_id ?? null]));
  res.json({
    company: { ...out(company), balance: balanceOf(id) },
    contacts: contacts.map(out),
    keyPoints: keyPoints.map(out),
    notes: notes.map(out),
    tasks: (await withCompany(tasks)),
    modules: allModules.map((m) => ({ id: m._id, name: m.name, pm_id: pm.get(m._id) ?? null, enabled: pm.has(m._id) ? 1 : 0 })),
    packages: packages.map(out),
    logs: logs.map(out),
  });
}));

app.put('/api/companies/:id', h(async (req, res) => {
  const b = req.body;
  const name = str(b.name);
  if (!name) return bad(res, 'חסר שם חברה');
  const status = STATUSES.includes(b.status) ? b.status : 'active';
  await col('companies').updateOne(
    { _id: Number(req.params.id) },
    {
      $set: {
        name,
        status,
        sales_rep_id: idOrNull(b.sales_rep_id),
        bank_enabled: b.bank_enabled ? 1 : 0,
        low_threshold: Number.isFinite(Number(b.low_threshold)) ? Number(b.low_threshold) : 2,
      },
    }
  );
  res.json({ ok: true });
}));

app.delete('/api/companies/:id', h(async (req, res) => {
  const id = Number(req.params.id);
  // קודם הילדים ואז החברה, כדי שאם משהו נכשל אפשר פשוט לנסות שוב
  for (const c of ['contacts', 'company_modules', 'key_points', 'notes', 'tasks', 'hour_packages', 'hour_logs']) {
    await col(c).deleteMany({ company_id: id });
  }
  await col('companies').deleteOne({ _id: id });
  res.json({ ok: true });
}));

// מודולים של חברה + מנה"פ לכל מודול. גוף הבקשה: { modules: [{ module_id, pm_id }] }
app.put('/api/companies/:id/modules', h(async (req, res) => {
  const id = Number(req.params.id);
  const list = Array.isArray(req.body.modules) ? req.body.modules : [];
  const wanted = new Map();
  for (const m of list) {
    const moduleId = Number(m.module_id);
    if (Number.isInteger(moduleId)) wanted.set(moduleId, idOrNull(m.pm_id));
  }
  await col('company_modules').deleteMany({ company_id: id, module_id: { $nin: [...wanted.keys()] } });
  await Promise.all(
    [...wanted].map(([module_id, pm_id]) =>
      col('company_modules').updateOne({ company_id: id, module_id }, { $set: { pm_id } }, { upsert: true })
    )
  );
  res.json({ ok: true });
}));

// ---------- אנשי קשר ----------
const setPrimary = async (companyId, contactId) => {
  await col('contacts').updateMany({ company_id: companyId }, { $set: { is_primary: 0 } });
  await col('contacts').updateOne({ _id: contactId }, { $set: { is_primary: 1 } });
};

app.post('/api/contacts', h(async (req, res) => {
  const b = req.body;
  if (!str(b.name)) return bad(res, 'חסר שם איש קשר');
  const companyId = await requireCompany(b.company_id, res);
  if (companyId === null) return;
  const hasAny = !!(await col('contacts').findOne({ company_id: companyId }, { projection: { _id: 1 } }));
  const id = await nextId('contacts');
  await col('contacts').insertOne({
    _id: id, company_id: companyId, name: str(b.name), role: str(b.role), phone: str(b.phone), email: str(b.email), is_primary: 0,
  });
  if (b.is_primary || !hasAny) await setPrimary(companyId, id);
  res.json({ id });
}));

app.put('/api/contacts/:id', h(async (req, res) => {
  const b = req.body;
  const id = Number(req.params.id);
  const contact = await col('contacts').findOne({ _id: id });
  if (!contact) return res.status(404).send('לא נמצא');
  if (!str(b.name)) return bad(res, 'חסר שם איש קשר');
  await col('contacts').updateOne(
    { _id: id },
    { $set: { name: str(b.name), role: str(b.role), phone: str(b.phone), email: str(b.email) } }
  );
  if (b.is_primary) await setPrimary(contact.company_id, id);
  res.json({ ok: true });
}));

app.delete('/api/contacts/:id', h(async (req, res) => {
  const id = Number(req.params.id);
  const contact = await col('contacts').findOne({ _id: id });
  await col('contacts').deleteOne({ _id: id });
  // אם נמחק איש הקשר הראשי, הראשון שנשאר הופך לראשי
  if (contact?.is_primary) {
    const rest = await col('contacts').find({ company_id: contact.company_id }).sort({ _id: 1 }).toArray();
    if (rest.length) await setPrimary(contact.company_id, rest[0]._id);
  }
  res.json({ ok: true });
}));

// ---------- נקודות חשובות על חברה ----------
app.post('/api/keypoints', h(async (req, res) => {
  if (!str(req.body.text)) return bad(res, 'חסר טקסט');
  const companyId = await requireCompany(req.body.company_id, res);
  if (companyId === null) return;
  await col('key_points').insertOne({
    _id: await nextId('key_points'), company_id: companyId, text: str(req.body.text), created_at: nowIso(),
  });
  res.json({ ok: true });
}));
app.put('/api/keypoints/:id', h(async (req, res) => {
  if (!str(req.body.text)) return bad(res, 'חסר טקסט');
  await col('key_points').updateOne({ _id: Number(req.params.id) }, { $set: { text: str(req.body.text) } });
  res.json({ ok: true });
}));
app.delete('/api/keypoints/:id', h(async (req, res) => {
  await col('key_points').deleteOne({ _id: Number(req.params.id) });
  res.json({ ok: true });
}));

// ---------- "לזכור" (של חברה, או כלליות כשאין company_id) ----------
app.post('/api/notes', h(async (req, res) => {
  if (!str(req.body.text)) return bad(res, 'חסר טקסט');
  const c = await companyOrNone(req.body.company_id, res);
  if (c.error) return;
  await col('notes').insertOne({
    _id: await nextId('notes'), company_id: c.id, text: str(req.body.text), pinned: 0, created_at: nowIso(),
  });
  res.json({ ok: true });
}));
app.put('/api/notes/:id', h(async (req, res) => {
  const b = req.body;
  const id = Number(req.params.id);
  const set = {};
  if ('text' in b) {
    if (!str(b.text)) return bad(res, 'חסר טקסט');
    set.text = str(b.text);
  }
  if ('pinned' in b) set.pinned = b.pinned ? 1 : 0;
  if (Object.keys(set).length) await col('notes').updateOne({ _id: id }, { $set: set });
  res.json({ ok: true });
}));
app.delete('/api/notes/:id', h(async (req, res) => {
  await col('notes').deleteOne({ _id: Number(req.params.id) });
  res.json({ ok: true });
}));

// ---------- משימות (תאריך + שעה) ----------
app.post('/api/tasks', h(async (req, res) => {
  const b = req.body;
  if (!str(b.title)) return bad(res, 'חסרה כותרת');
  if (!okDateTime(b.due_at)) return bad(res, 'תאריך ושעה לא תקינים');
  const c = await companyOrNone(b.company_id, res);
  if (c.error) return;
  const dur = Math.round(Number(b.duration_min)) || 30;
  await col('tasks').insertOne({
    _id: await nextId('tasks'), company_id: c.id, title: str(b.title), due_at: b.due_at,
    duration_min: dur > 0 ? dur : 30, status: 'open', created_at: nowIso(),
  });
  res.json({ ok: true });
}));

app.put('/api/tasks/:id', h(async (req, res) => {
  const b = req.body;
  const set = {};
  if ('title' in b) {
    if (!str(b.title)) return bad(res, 'חסרה כותרת');
    set.title = str(b.title);
  }
  if ('due_at' in b) {
    if (!okDateTime(b.due_at)) return bad(res, 'תאריך ושעה לא תקינים');
    set.due_at = b.due_at;
  }
  if ('duration_min' in b) {
    const n = Math.round(Number(b.duration_min));
    if (!(n > 0)) return bad(res, 'משך לא תקין');
    set.duration_min = n;
  }
  if ('status' in b) {
    if (!['open', 'done'].includes(b.status)) return bad(res, 'סטטוס לא תקין');
    set.status = b.status;
  }
  if ('company_id' in b) {
    const c = await companyOrNone(b.company_id, res);
    if (c.error) return;
    set.company_id = c.id;
  }
  if (!Object.keys(set).length) return bad(res, 'אין מה לעדכן');
  await col('tasks').updateOne({ _id: Number(req.params.id) }, { $set: set });
  res.json({ ok: true });
}));

app.delete('/api/tasks/:id', h(async (req, res) => {
  await col('tasks').deleteOne({ _id: Number(req.params.id) });
  res.json({ ok: true });
}));

// ---------- בנק שעות ----------
app.post('/api/packages', h(async (req, res) => {
  const { company_id, hours, purchased_at, note } = req.body;
  if (!(Number(hours) > 0)) return bad(res, 'כמות שעות לא תקינה');
  const companyId = await requireCompany(company_id, res);
  if (companyId === null) return;
  await col('hour_packages').insertOne({
    _id: await nextId('hour_packages'), company_id: companyId, hours: Number(hours),
    purchased_at: okDate(purchased_at) ? purchased_at : today(), note: str(note),
  });
  res.json({ ok: true });
}));
app.delete('/api/packages/:id', h(async (req, res) => {
  await col('hour_packages').deleteOne({ _id: Number(req.params.id) });
  res.json({ ok: true });
}));
app.post('/api/logs', h(async (req, res) => {
  const { company_id, hours, date, description } = req.body;
  if (!(Number(hours) > 0)) return bad(res, 'כמות שעות לא תקינה');
  const companyId = await requireCompany(company_id, res);
  if (companyId === null) return;
  await col('hour_logs').insertOne({
    _id: await nextId('hour_logs'), company_id: companyId, hours: Number(hours),
    date: okDate(date) ? date : today(), description: str(description),
  });
  res.json({ ok: true });
}));
app.delete('/api/logs/:id', h(async (req, res) => {
  await col('hour_logs').deleteOne({ _id: Number(req.params.id) });
  res.json({ ok: true });
}));

// ---------- מסך "היום" ----------
app.get('/api/attention', h(async (req, res) => {
  const t = today();
  const sort = { due_at: 1, _id: 1 };
  const [due, upcoming, companies, generalNotes, balanceOf] = await Promise.all([
    col('tasks').find({ status: 'open', due_at: { $lte: endOfDay(t) } }).sort(sort).toArray(),
    col('tasks').find({ status: 'open', due_at: { $gt: endOfDay(t), $lte: endOfDay(plusDays(7)) } }).sort(sort).toArray(),
    col('companies').find({ bank_enabled: 1 }).toArray(),
    col('notes').find({ company_id: null }).sort({ pinned: -1, _id: -1 }).toArray(),
    balances(),
  ]);
  const bankAlerts = companies
    .map((c) => ({ id: c._id, name: c.name, low_threshold: c.low_threshold, balance: balanceOf(c._id) }))
    .filter((c) => c.balance <= c.low_threshold)
    .sort((a, b) => a.balance - b.balance);
  res.json({
    today: t,
    due: await withCompany(due),
    upcoming: await withCompany(upcoming),
    bankAlerts,
    generalNotes: generalNotes.map(out),
  });
}));

// ---------- יומן Outlook (קישור ICS מפורסם) ----------
const getSetting = async (key) => (await col('app_settings').findOne({ _id: key }))?.value ?? '';
const setSetting = (key, value) => col('app_settings').updateOne({ _id: key }, { $set: { value } }, { upsert: true });

// הקישור מגיע בעדיפות ממשתנה הסביבה ICS_URL (מומלץ בענן: הוא נשאר סוד בשרת). אחרת מהמסד.
// הקישור המלא לעולם לא נשלח לדפדפן.
const feedUrl = async () => {
  const fromEnv = str(process.env.ICS_URL);
  if (!fromEnv) return getSetting('ics_url');
  try {
    return normalizeUrl(fromEnv);
  } catch {
    return fromEnv;
  }
};
const feedSource = async () => (str(process.env.ICS_URL) ? 'env' : (await getSetting('ics_url')) ? 'db' : 'none');
const hostOf = (u) => {
  try {
    return new URL(u).host;
  } catch {
    return '';
  }
};

// בדיקת בריאות ל-Render (פתוחה, ללא נתונים)
app.get('/health', (req, res) => res.send('ok'));

const FEED_TTL_MS = 5 * 60 * 1000; // היומן נטען מחדש לכל היותר פעם בחמש דקות
let feedCache = { url: '', at: 0, events: [] };

async function loadFeed(url, force = false) {
  if (!force && feedCache.url === url && Date.now() - feedCache.at < FEED_TTL_MS) return feedCache.events;
  let text;
  try {
    const r = await fetch(url, {
      signal: AbortSignal.timeout(20000),
      headers: { Accept: 'text/calendar, text/plain, */*' },
    });
    if (!r.ok) throw new Error(`השרת של היומן החזיר שגיאה ${r.status}`);
    text = await r.text();
  } catch (e) {
    // הודעות שגיאה של fetch עלולות לכלול את הכתובת המלאה, והיא סוד
    throw new Error(`לא הצלחתי לקרוא את היומן: ${String(e.message).split(url).join('[הקישור]')}`);
  }
  if (!/BEGIN:VCALENDAR/i.test(text)) {
    throw new Error('הקישור לא מחזיר יומן בפורמט ICS. ב-Outlook יש שני קישורים, HTML ו-ICS, וצריך להעתיק את הקישור של ICS.');
  }
  const events = parseIcs(text);
  feedCache = { url, at: Date.now(), events };
  return events;
}

// מחזיר רק מצב וכתובת השרת (host), בלי הקישור עצמו
app.get('/api/ics', h(async (req, res) => {
  const source = await feedSource();
  res.json({ source, configured: source !== 'none', host: hostOf(await feedUrl()) });
}));

// קישור ריק מנתק את היומן. קישור חדש נבדק (נטען בפועל) לפני שהוא נשמר
app.put('/api/ics', h(async (req, res) => {
  if (str(process.env.ICS_URL)) return bad(res, 'הקישור מוגדר בשרת (ICS_URL) ולא ניתן לשינוי מכאן');
  const raw = str(req.body.url);
  if (!raw) {
    await setSetting('ics_url', '');
    feedCache = { url: '', at: 0, events: [] };
    return res.json({ ok: true, count: 0 });
  }
  let url;
  try {
    url = normalizeUrl(raw);
  } catch (e) {
    return bad(res, e.message);
  }
  try {
    const events = await loadFeed(url, true);
    await setSetting('ics_url', url);
    res.json({ ok: true, count: events.length });
  } catch (e) {
    bad(res, e.message);
  }
}));

// ---------- לוח יומי ----------
app.get('/api/calendar', h(async (req, res) => {
  const date = okDate(req.query.date) ? req.query.date : today();
  const url = await feedUrl();
  let meetings = [];
  let meetingsError = '';
  if (url) {
    try {
      meetings = meetingsForDay(await loadFeed(url, req.query.refresh === '1'), date);
    } catch (e) {
      meetingsError = e.message; // תקלה ביומן לא מפילה את שאר הלוח
    }
  }
  const [tasks, overdue] = await Promise.all([
    col('tasks').find({ due_at: { $gte: `${date}T00:00`, $lte: endOfDay(date) } }).sort({ due_at: 1, _id: 1 }).toArray(),
    col('tasks').find({ status: 'open', due_at: { $lt: `${date}T00:00` } }).sort({ due_at: 1, _id: 1 }).toArray(),
  ]);
  res.json({
    date,
    tasks: await withCompany(tasks),
    overdue: await withCompany(overdue),
    meetings,
    hasFeed: !!url,
    meetingsError,
  });
}));

// ---------- גיבוי ושחזור (קובץ JSON אחד) ----------
// השדות של כל אוסף. קישור היומן לא נכלל בגיבוי, ושחזור לא נוגע בו
const BACKUP_FIELDS = {
  team_members: ['name'],
  modules: ['name'],
  companies: ['name', 'status', 'sales_rep_id', 'bank_enabled', 'low_threshold', 'created_at'],
  contacts: ['company_id', 'name', 'role', 'phone', 'email', 'is_primary'],
  company_modules: ['company_id', 'module_id', 'pm_id'],
  key_points: ['company_id', 'text', 'created_at'],
  notes: ['company_id', 'text', 'pinned', 'created_at'],
  tasks: ['company_id', 'title', 'due_at', 'duration_min', 'status', 'created_at'],
  hour_packages: ['company_id', 'hours', 'purchased_at', 'note'],
  hour_logs: ['company_id', 'date', 'description', 'hours'],
};
const KEYED = Object.keys(BACKUP_FIELDS).filter((n) => n !== 'company_modules'); // אוספים עם מזהה מספרי

app.get('/api/backup', h(async (req, res) => {
  const collections = {};
  for (const [name, fields] of Object.entries(BACKUP_FIELDS)) {
    const docs = await col(name).find({}).sort({ _id: 1 }).toArray();
    collections[name] = docs.map((d) => {
      const o = name === 'company_modules' ? {} : { _id: d._id };
      for (const f of fields) if (f in d) o[f] = d[f];
      return o;
    });
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="crm-backup-${today()}.json"`);
  res.end(JSON.stringify({ version: 1, exported_at: nowIso(), collections }));
}));

// שחזור: מחליף את כל הנתונים בנתוני הקובץ. קודם בודקים את כל הקובץ, ורק אז מוחקים
app.post('/api/restore', h(async (req, res) => {
  const data = req.body?.collections;
  if (req.body?.version !== 1 || !data || typeof data !== 'object') return bad(res, 'קובץ הגיבוי לא תקין');
  const clean = {};
  for (const [name, fields] of Object.entries(BACKUP_FIELDS)) {
    if (!Array.isArray(data[name])) return bad(res, `בקובץ הגיבוי חסר האוסף ${name}`);
    const seen = new Set();
    clean[name] = [];
    for (const d of data[name]) {
      if (!d || typeof d !== 'object') return bad(res, `רשומה לא תקינה באוסף ${name}`);
      const doc = {};
      for (const f of fields) if (f in d) doc[f] = d[f];
      if (name !== 'company_modules') {
        if (!Number.isInteger(d._id) || seen.has(d._id)) return bad(res, `מזהה לא תקין או כפול באוסף ${name}`);
        seen.add(d._id);
        doc._id = d._id;
      }
      if ((name === 'team_members' || name === 'modules') && !str(doc.name)) return bad(res, `שם חסר באוסף ${name}`);
      clean[name].push(doc);
    }
    if (name === 'team_members' || name === 'modules') {
      if (new Set(clean[name].map((d) => d.name)).size !== clean[name].length) return bad(res, `שמות כפולים באוסף ${name}`);
    }
  }
  for (const name of Object.keys(BACKUP_FIELDS)) {
    await col(name).deleteMany({});
    if (clean[name].length) await col(name).insertMany(clean[name]);
  }
  for (const name of KEYED) {
    const max = clean[name].reduce((m, d) => Math.max(m, d._id), 0);
    await col('counters').updateOne({ _id: name }, { $set: { seq: max } }, { upsert: true });
  }
  feedCache = { url: '', at: 0, events: [] };
  res.json({ ok: true, counts: Object.fromEntries(Object.entries(clean).map(([k, v]) => [k, v.length])) });
}));

// ---------- שגיאות ----------
app.use('/api', (err, req, res, next) => {
  if (err?.code === 11000) return res.status(400).send('השם כבר קיים');
  if (err?.status >= 400 && err.status < 500) return res.status(err.status).send('בקשה לא תקינה');
  console.error(err);
  res.status(500).send('שגיאת שרת');
});

// ---------- הגשת הממשק לאחר build ----------
const dist = path.join(__dirname, 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  console.log(`השרת רץ על http://localhost:${PORT}`);
  console.log(`כניסה עם סיסמה: ${AUTH_ON ? 'כן' : 'לא'} | מסד נתונים: MongoDB | אזור זמן: ${tz}`);
});

// Render שולח SIGTERM בכל פריסה: סוגרים את החיבור למסד בנחת
process.on('SIGTERM', async () => {
  await closeDb().catch(() => {});
  process.exit(0);
});
