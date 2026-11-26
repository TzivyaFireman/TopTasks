import React from 'react';
import { api, dayTitle, fmtHours } from '../api.js';
import { TaskForm, TaskRow, TextList, useLoad } from '../ui.jsx';

export default function Today() {
  const [data, reload, error] = useLoad('/api/attention');
  const [companies] = useLoad('/api/companies');

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p>טוען...</p>;
  const { today, due, upcoming, bankAlerts, generalNotes } = data;

  return (
    <>
      <h2 className="page-title">{dayTitle(today)}</h2>

      <section className="card">
        <h2>משימה חדשה</h2>
        <TaskForm companies={companies || []} onAdded={reload} />
      </section>

      <section className="card">
        <h2>
          דורש טיפול {due.length > 0 && <span className="badge red">{due.length}</span>}
        </h2>
        {due.length === 0 && <p className="muted">אין משימות לטיפול היום 🎉</p>}
        <ul className="list">
          {due.map((t) => (
            <TaskRow key={t.id} task={t} onChange={reload} />
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>בנקי שעות</h2>
        {bankAlerts.length === 0 && <p className="muted">כל בנקי השעות תקינים</p>}
        <ul className="list">
          {bankAlerts.map((c) => (
            <li key={c.id}>
              <a className="grow" href={`#/company/${c.id}`}>
                {c.name}
              </a>
              {c.balance <= 0 ? (
                <span className="badge red">הגענו למכסה · יתרה {fmtHours(c.balance)} שעות</span>
              ) : (
                <span className="badge orange">מתקרבים למכסה · יתרה {fmtHours(c.balance)} שעות</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>לזכור (כללי)</h2>
        <TextList
          items={generalNotes.map((n) => ({ ...n, text: n.text }))}
          placeholder="דבר שחשוב לזכור..."
          reload={reload}
          onAdd={(text) => api.post('/api/notes', { text })}
          onSave={(id, text) => api.put(`/api/notes/${id}`, { text })}
          onDelete={(id) => api.del(`/api/notes/${id}`)}
          onPin={(id, pinned) => api.put(`/api/notes/${id}`, { pinned })}
        />
      </section>

      <section className="card">
        <h2>בקרוב (7 ימים)</h2>
        {upcoming.length === 0 && <p className="muted">אין משימות בשבוע הקרוב</p>}
        <ul className="list">
          {upcoming.map((t) => (
            <TaskRow key={t.id} task={t} onChange={reload} />
          ))}
        </ul>
      </section>
    </>
  );
}
