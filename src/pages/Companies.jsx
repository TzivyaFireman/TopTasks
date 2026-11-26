import React, { useState } from 'react';
import { api, fmtHours, STATUS_LABELS } from '../api.js';
import { run, useLoad } from '../ui.jsx';

export default function Companies() {
  const [companies, , error] = useLoad('/api/companies');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [name, setName] = useState('');

  if (error) return <p className="error">{error}</p>;
  if (!companies) return <p>טוען...</p>;

  const shown = companies.filter(
    (c) =>
      (!status || c.status === status) &&
      [c.name, c.primary_contact].join(' ').toLowerCase().includes(q.toLowerCase())
  );

  const add = (e) => {
    e.preventDefault();
    run(async () => {
      const { id } = await api.post('/api/companies', { name });
      setName('');
      window.location.hash = `#/company/${id}`;
    });
  };

  return (
    <>
      <section className="card">
        <h2>חברה חדשה</h2>
        <form className="row" onSubmit={add}>
          <input className="grow" placeholder="שם החברה *" value={name} onChange={(e) => setName(e.target.value)} required />
          <button className="primary">הוספה</button>
        </form>
      </section>

      <section className="card">
        <div className="row between">
          <h2>חברות ({shown.length})</h2>
          <div className="row">
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">כל הסטטוסים</option>
              {Object.entries(STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <input placeholder="חיפוש חברה או איש קשר..." value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        {shown.length === 0 && <p className="muted">לא נמצאו חברות</p>}
        <ul className="list">
          {shown.map((c) => (
            <li key={c.id} className="clickable" onClick={() => (window.location.hash = `#/company/${c.id}`)}>
              <span className="grow">
                <strong>{c.name}</strong>
                {c.primary_contact && <span className="muted"> · {c.primary_contact}</span>}
                {c.status !== 'active' && <span className="badge gray">{STATUS_LABELS[c.status]}</span>}
              </span>
              {c.due_tasks > 0 && <span className="badge red">{c.due_tasks} לטיפול</span>}
              {c.open_tasks > 0 && <span className="badge gray">{c.open_tasks} משימות פתוחות</span>}
              {c.bank_enabled ? (
                <span
                  className={
                    c.balance <= 0 ? 'badge red' : c.balance <= c.low_threshold ? 'badge orange' : 'badge green'
                  }
                >
                  בנק: {fmtHours(c.balance)} ש׳
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
