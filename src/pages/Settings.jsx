import React, { useState } from 'react';
import { api } from '../api.js';
import { TextList, useLoad } from '../ui.jsx';

function OutlookCalendar() {
  const [info, reload] = useLoad('/api/ics');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  if (!info) {
    return (
      <section className="card">
        <h2>יומן Outlook / Teams</h2>
        <p>טוען...</p>
      </section>
    );
  }

  const send = async (value, okText) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.put('/api/ics', { url: value });
      setMsg({ ok: true, text: okText(r) });
      setUrl('');
      await reload();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  };
  const save = (e) => {
    e.preventDefault();
    send(url, (r) => `החיבור הצליח. נמצאו ${r.count} אירועים ביומן. הקישור נשמר בשרת ולא יוצג שוב.`);
  };
  const disconnect = () => confirm('לנתק את יומן Outlook?') && send('', () => 'החיבור ליומן הוסר.');

  return (
    <section className="card">
      <h2>יומן Outlook / Teams</h2>
      <p className="muted">
        הפגישות מהיומן מופיעות בלוח היומי לצד המשימות (לקריאה בלבד). מי שמחזיק בקישור יכול לראות את היומן, ולכן הוא
        נשמר רק בשרת ולעולם לא נשלח חזרה לדפדפן.
      </p>

      {info.source === 'env' ? (
        <div className="banner green">
          היומן מחובר דרך הגדרת השרת (משתנה הסביבה <code>ICS_URL</code>) לכתובת {info.host}. הקישור מוסתר, ולשינוי
          מעדכנים אותו בהגדרות השירות ב-Render.
        </div>
      ) : (
        <>
          {info.configured && <div className="banner green">מחובר ליומן ב-{info.host}. הקישור שמור ומוסתר.</div>}
          <ol className="muted steps">
            <li>ב-Outlook באינטרנט: הגדרות ← יומן ← יומנים משותפים ← פרסום יומן.</li>
            <li>בוחרים את היומן, ובהרשאה בוחרים &quot;יכול לראות את כל הפרטים&quot; (אחרת יוצג רק &quot;עסוק&quot; בלי נושא הפגישה).</li>
            <li>לוחצים על פרסום, ומעתיקים את הקישור של <strong>ICS</strong> (לא של HTML).</li>
          </ol>
          <form className="row" onSubmit={save}>
            <input
              className="grow"
              dir="ltr"
              type="password"
              autoComplete="off"
              placeholder={info.configured ? 'הדביקי קישור חדש כדי להחליף' : 'הדביקי כאן את קישור ה-ICS'}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
            />
            <button className="primary" disabled={busy}>
              {busy ? 'בודק...' : 'שמירה ובדיקה'}
            </button>
            {info.configured && (
              <button type="button" className="danger" onClick={disconnect} disabled={busy}>
                ניתוק
              </button>
            )}
          </form>
        </>
      )}
      {msg && <div className={`banner ${msg.ok ? 'green' : 'red'}`}>{msg.text}</div>}
    </section>
  );
}

export default function Settings() {
  const [settings, reload, error] = useLoad('/api/settings');
  if (error) return <p className="error">{error}</p>;
  if (!settings) return <p>טוען...</p>;

  const asItems = (list) => list.map((x) => ({ id: x.id, text: x.name }));

  return (
    <>
      <OutlookCalendar />

      <section className="card">
        <h2>אנשי צוות שלנו</h2>
        <p className="muted">
          הרשימה משמשת לבחירת איש המכירות של כל חברה ולבחירת מנה״פ לכל מודול. מחיקה של איש צוות מנקה אותו מהחברות
          שבהן הוא נבחר.
        </p>
        <TextList
          items={asItems(settings.team)}
          placeholder="שם איש צוות..."
          reload={reload}
          confirmDelete
          onAdd={(name) => api.post('/api/team', { name })}
          onSave={(id, name) => api.put(`/api/team/${id}`, { name })}
          onDelete={(id) => api.del(`/api/team/${id}`)}
        />
      </section>

      <section className="card">
        <h2>מודולים</h2>
        <p className="muted">מחיקה של מודול מסירה אותו מכל החברות שמשתמשות בו.</p>
        <TextList
          items={asItems(settings.modules)}
          placeholder="שם מודול..."
          reload={reload}
          confirmDelete
          onAdd={(name) => api.post('/api/modules', { name })}
          onSave={(id, name) => api.put(`/api/modules/${id}`, { name })}
          onDelete={(id) => api.del(`/api/modules/${id}`)}
        />
      </section>

      <Backup />
    </>
  );
}

function Backup() {
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const restore = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!confirm('השחזור מוחק את כל הנתונים הנוכחיים ומחליף אותם בנתוני הקובץ. מומלץ להוריד גיבוי לפני כן. להמשיך?')) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.post('/api/restore', JSON.parse(await file.text()));
      setMsg({ ok: true, text: `השחזור הושלם: ${r.counts.companies} חברות, ${r.counts.tasks} משימות, ${r.counts.contacts} אנשי קשר.` });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof SyntaxError ? 'הקובץ אינו קובץ גיבוי תקין' : err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h2>גיבוי ושחזור</h2>
      <p className="muted">
        הגיבוי הוא קובץ אחד עם כל הנתונים (בלי קישור היומן והסיסמאות). מומלץ להוריד אחד מדי פעם, ולפני כל שינוי גדול.
      </p>
      <div className="row">
        <a className="btn" href="/api/backup" download>
          הורדת גיבוי
        </a>
        <label className="btn">
          {busy ? 'משחזר...' : 'שחזור מקובץ'}
          <input type="file" accept="application/json,.json" onChange={restore} disabled={busy} hidden />
        </label>
      </div>
      {msg && <div className={`banner ${msg.ok ? 'green' : 'red'}`}>{msg.text}</div>}
    </section>
  );
}
