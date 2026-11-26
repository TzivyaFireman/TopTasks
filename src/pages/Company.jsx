import React, { useEffect, useState } from 'react';
import { api, fmtDate, fmtHours, STATUS_LABELS, todayStr } from '../api.js';
import { run, TaskForm, TaskRow, TextList, useLoad } from '../ui.jsx';

export default function Company({ id }) {
  const [data, reload, error] = useLoad(`/api/companies/${id}`);
  const [settings] = useLoad('/api/settings');

  if (error) return <p className="error">{error}</p>;
  if (!data || !settings) return <p>טוען...</p>;
  const { company, contacts, keyPoints, notes, tasks, modules, packages, logs } = data;

  return (
    <>
      <p>
        <a href="#/companies">← חזרה לחברות</a>
      </p>
      <Details company={company} team={settings.team} reload={reload} />

      <section className="card keypoints">
        <h2>נקודות חשובות</h2>
        <TextList
          items={keyPoints}
          placeholder="נקודה חשובה על החברה..."
          reload={reload}
          onAdd={(text) => api.post('/api/keypoints', { company_id: id, text })}
          onSave={(kid, text) => api.put(`/api/keypoints/${kid}`, { text })}
          onDelete={(kid) => api.del(`/api/keypoints/${kid}`)}
        />
      </section>

      <Contacts companyId={id} contacts={contacts} reload={reload} />
      <Modules companyId={id} modules={modules} team={settings.team} reload={reload} />

      <section className="card">
        <h2>משימות</h2>
        <TaskForm companyId={id} onAdded={reload} />
        {tasks.length === 0 && <p className="muted">אין משימות</p>}
        <ul className="list">
          {tasks.map((t) => (
            <TaskRow key={t.id} task={t} onChange={reload} showCompany={false} />
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>לזכור</h2>
        <TextList
          items={notes}
          placeholder="דבר שחשוב לזכור על החברה..."
          reload={reload}
          onAdd={(text) => api.post('/api/notes', { company_id: id, text })}
          onSave={(nid, text) => api.put(`/api/notes/${nid}`, { text })}
          onDelete={(nid) => api.del(`/api/notes/${nid}`)}
          onPin={(nid, pinned) => api.put(`/api/notes/${nid}`, { pinned })}
        />
      </section>

      {company.bank_enabled ? <Bank company={company} packages={packages} logs={logs} reload={reload} /> : null}
    </>
  );
}

// ---------- פרטי החברה ----------
function Details({ company, team, reload }) {
  const [info, setInfo] = useState(company);
  useEffect(() => setInfo(company), [company]);

  const save = (e) => {
    e.preventDefault();
    run(() => api.put(`/api/companies/${company.id}`, info), reload);
  };
  const remove = () => {
    if (confirm(`למחוק את ${company.name} ואת כל הנתונים שלה?`)) {
      run(
        () => api.del(`/api/companies/${company.id}`),
        () => (window.location.hash = '#/companies')
      );
    }
  };

  return (
    <section className="card">
      <h2>{company.name}</h2>
      <form className="grid" onSubmit={save}>
        <label>
          שם החברה
          <input value={info.name} onChange={(e) => setInfo({ ...info, name: e.target.value })} required />
        </label>
        <label>
          סטטוס
          <select value={info.status} onChange={(e) => setInfo({ ...info, status: e.target.value })}>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          איש מכירות אצלנו
          <select
            value={info.sales_rep_id ?? ''}
            onChange={(e) => setInfo({ ...info, sales_rep_id: e.target.value })}
          >
            <option value="">לא נבחר</option>
            {team.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={!!info.bank_enabled}
            onChange={(e) => setInfo({ ...info, bank_enabled: e.target.checked ? 1 : 0 })}
          />
          יש לחברה בנק שעות
        </label>
        {info.bank_enabled ? (
          <label>
            אזהרה כשהיתרה ≤ (שעות)
            <input
              type="number"
              step="0.5"
              value={info.low_threshold}
              onChange={(e) => setInfo({ ...info, low_threshold: e.target.value })}
            />
          </label>
        ) : null}
        {team.length === 0 && (
          <p className="muted full">
            עדיין אין אנשי צוות ברשימה. אפשר להגדיר אותם ב<a href="#/settings">הגדרות</a>.
          </p>
        )}
        <div className="full row">
          <button className="primary">שמירה</button>
          <button type="button" className="danger" onClick={remove}>
            מחיקת חברה
          </button>
        </div>
      </form>
    </section>
  );
}

// ---------- אנשי קשר ----------
function ContactForm({ initial, onSubmit, onCancel, submitLabel }) {
  const [f, setF] = useState(initial);
  return (
    <form
      className="row contact-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(f);
      }}
    >
      <input placeholder="שם *" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
      <input placeholder="תפקיד" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} />
      <input placeholder="טלפון" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
      <input placeholder="אימייל" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      <label className="check">
        <input type="checkbox" checked={!!f.is_primary} onChange={(e) => setF({ ...f, is_primary: e.target.checked })} />
        איש קשר ראשי
      </label>
      <button className="primary">{submitLabel}</button>
      {onCancel && (
        <button type="button" onClick={onCancel}>
          ביטול
        </button>
      )}
    </form>
  );
}

function Contacts({ companyId, contacts, reload }) {
  const [editId, setEditId] = useState(null);
  const blank = { name: '', role: '', phone: '', email: '', is_primary: false };

  return (
    <section className="card">
      <h2>אנשי קשר</h2>
      <ul className="list">
        {contacts.map((c) => (
          <li key={c.id} className="contact">
            {editId === c.id ? (
              <ContactForm
                initial={{ ...c, is_primary: !!c.is_primary }}
                submitLabel="שמירה"
                onCancel={() => setEditId(null)}
                onSubmit={(f) =>
                  run(
                    () => api.put(`/api/contacts/${c.id}`, f),
                    async () => {
                      setEditId(null);
                      await reload();
                    }
                  )
                }
              />
            ) : (
              <>
                <span className="grow">
                  <strong>{c.name}</strong>
                  {c.is_primary ? <span className="badge green">ראשי</span> : null}
                  {c.role && <span className="muted"> · {c.role}</span>}
                  <br />
                  {c.phone && <a href={`tel:${c.phone}`}>{c.phone}</a>}
                  {c.phone && c.email && <span className="muted"> · </span>}
                  {c.email && <a href={`mailto:${c.email}`}>{c.email}</a>}
                </span>
                {!c.is_primary && (
                  <button className="link" onClick={() => run(() => api.put(`/api/contacts/${c.id}`, { ...c, is_primary: true }), reload)}>
                    הפוך לראשי
                  </button>
                )}
                <button className="link" onClick={() => setEditId(c.id)}>
                  עריכה
                </button>
                <button
                  className="link"
                  onClick={() => confirm('למחוק את איש הקשר?') && run(() => api.del(`/api/contacts/${c.id}`), reload)}
                >
                  מחיקה
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      <h3>איש קשר חדש</h3>
      <ContactForm
        key={contacts.length}
        initial={blank}
        submitLabel="הוספה"
        onSubmit={(f) => run(() => api.post('/api/contacts', { ...f, company_id: companyId }), reload)}
      />
    </section>
  );
}

// ---------- מודולים ומנה"פ מטעמנו ----------
function Modules({ companyId, modules, team, reload }) {
  const save = (moduleId, patch) => {
    const next = modules
      .map((m) => (m.id === moduleId ? { ...m, ...patch } : m))
      .filter((m) => m.enabled)
      .map((m) => ({ module_id: m.id, pm_id: m.pm_id }));
    run(() => api.put(`/api/companies/${companyId}/modules`, { modules: next }), reload);
  };

  return (
    <section className="card">
      <h2>מודולים ומנה״פ</h2>
      {modules.length === 0 && (
        <p className="muted">
          אין מודולים ברשימה. אפשר להוסיף ב<a href="#/settings">הגדרות</a>.
        </p>
      )}
      <table className="table">
        <thead>
          <tr>
            <th>עובדים עם המודול</th>
            <th>מודול</th>
            <th>מנה״פ מטעמנו</th>
          </tr>
        </thead>
        <tbody>
          {modules.map((m) => (
            <tr key={m.id} className={m.enabled ? '' : 'off'}>
              <td>
                <input type="checkbox" checked={!!m.enabled} onChange={(e) => save(m.id, { enabled: e.target.checked ? 1 : 0 })} />
              </td>
              <td>{m.name}</td>
              <td>
                <select
                  disabled={!m.enabled}
                  value={m.pm_id ?? ''}
                  onChange={(e) => save(m.id, { pm_id: e.target.value ? Number(e.target.value) : null })}
                >
                  <option value="">לא נבחר</option>
                  {team.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ---------- בנק שעות ----------
function Bank({ company, packages, logs, reload }) {
  const [pkg, setPkg] = useState({ hours: '', purchased_at: todayStr(), note: '' });
  const [log, setLog] = useState({ hours: '', date: todayStr(), description: '' });
  const reached = company.balance <= 0;
  const low = company.balance <= company.low_threshold;

  const addPkg = (e) => {
    e.preventDefault();
    run(
      () => api.post('/api/packages', { ...pkg, company_id: company.id }),
      async () => {
        setPkg({ hours: '', purchased_at: todayStr(), note: '' });
        await reload();
      }
    );
  };
  const addLog = (e) => {
    e.preventDefault();
    run(
      () => api.post('/api/logs', { ...log, company_id: company.id }),
      async () => {
        setLog({ hours: '', date: todayStr(), description: '' });
        await reload();
      }
    );
  };

  return (
    <section className="card">
      <div className="row between">
        <h2>בנק שעות</h2>
        <span className={reached ? 'badge red big' : low ? 'badge orange big' : 'badge green big'}>
          יתרה: {fmtHours(company.balance)} שעות
        </span>
      </div>
      {reached && <div className="banner red">הגענו למכסת השעות של החברה. כדאי ליצור קשר בנושא הרחבת הבנק.</div>}
      {!reached && low && <div className="banner orange">היתרה נמוכה ({fmtHours(company.balance)} שעות). מתקרבים למכסה.</div>}

      <h3>רכישת שעות</h3>
      <form className="row" onSubmit={addPkg}>
        <input type="number" step="0.25" min="0" placeholder="שעות *" value={pkg.hours} onChange={(e) => setPkg({ ...pkg, hours: e.target.value })} required />
        <input type="date" value={pkg.purchased_at} onChange={(e) => setPkg({ ...pkg, purchased_at: e.target.value })} />
        <input className="grow" placeholder="הערה" value={pkg.note} onChange={(e) => setPkg({ ...pkg, note: e.target.value })} />
        <button className="primary">הוספה</button>
      </form>
      <ul className="list">
        {packages.map((p) => (
          <li key={p.id}>
            <span className="grow">
              +{fmtHours(p.hours)} שעות <span className="muted">{p.note}</span>
            </span>
            <span className="muted">{fmtDate(p.purchased_at)}</span>
            <button className="link" onClick={() => confirm('למחוק?') && run(() => api.del(`/api/packages/${p.id}`), reload)}>
              מחיקה
            </button>
          </li>
        ))}
      </ul>

      <h3>דיווח שעות שנוצלו</h3>
      <form className="row" onSubmit={addLog}>
        <input type="number" step="0.25" min="0" placeholder="שעות *" value={log.hours} onChange={(e) => setLog({ ...log, hours: e.target.value })} required />
        <input type="date" value={log.date} onChange={(e) => setLog({ ...log, date: e.target.value })} />
        <input className="grow" placeholder="תיאור העבודה" value={log.description} onChange={(e) => setLog({ ...log, description: e.target.value })} />
        <button className="primary">הוספה</button>
      </form>
      <ul className="list">
        {logs.map((l) => (
          <li key={l.id}>
            <span className="grow">
              −{fmtHours(l.hours)} שעות <span className="muted">{l.description}</span>
            </span>
            <span className="muted">{fmtDate(l.date)}</span>
            <button className="link" onClick={() => confirm('למחוק?') && run(() => api.del(`/api/logs/${l.id}`), reload)}>
              מחיקה
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
