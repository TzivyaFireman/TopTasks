async function req(method, url, body) {
  const r = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  // סשן שפג תוקפו: מחזירים את המשתמשת למסך הכניסה
  if (r.status === 401) window.dispatchEvent(new Event('unauthorized'));
  if (!r.ok) throw new Error((await r.text()) || 'שגיאה');
  return r.json();
}

export const api = {
  get: (u) => req('GET', u),
  post: (u, b) => req('POST', u, b ?? {}),
  put: (u, b) => req('PUT', u, b ?? {}),
  del: (u) => req('DELETE', u),
};

// ---------- תאריכים ושעות (כולם לפי שעון מקומי) ----------
const ymd = (d) => d.toLocaleDateString('sv-SE'); // YYYY-MM-DD

export const todayStr = () => ymd(new Date());

export const addDays = (dateStr, n) => {
  const d = new Date(dateStr + 'T00:00');
  d.setDate(d.getDate() + n);
  return ymd(d);
};

// ברירת מחדל למשימה חדשה: היום, בחצי השעה הקרובה
export const defaultDue = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() + 30 - (d.getMinutes() % 30), 0, 0);
  return `${ymd(d)}T${d.toTimeString().slice(0, 5)}`;
};

export const fmtDate = (d) => (d ? d.split('-').reverse().join('/') : '');
export const fmtTime = (dueAt) => (dueAt ? dueAt.slice(11, 16) : '');
export const fmtDateTime = (dueAt) => `${fmtDate(dueAt.slice(0, 10))} ${fmtTime(dueAt)}`;
export const dayTitle = (dateStr) =>
  new Date(dateStr + 'T00:00').toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });

export const fmtHours = (n) => String(Math.round(Number(n) * 100) / 100);

// משימה פתוחה שהגיע יום הטיפול שלה (או שעבר) - מוצגת באדום
export const isDue = (task) => task.status === 'open' && task.due_at.slice(0, 10) <= todayStr();

export const STATUS_LABELS = { active: 'פעיל', onboarding: 'בהטמעה', inactive: 'לא פעיל' };
