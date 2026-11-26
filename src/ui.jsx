import React, { useCallback, useEffect, useState } from 'react';
import { api, defaultDue, fmtDate, fmtTime, isDue, todayStr } from './api.js';

// טעינת נתונים מהשרת
export function useLoad(url) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    try {
      setData(await api.get(url));
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, [url]);
  useEffect(() => {
    reload();
  }, [reload]);
  return [data, reload, error];
}

// מריץ פעולה, מציג שגיאה אם נכשלה, ואז מריץ פעולת המשך (בדרך כלל רענון)
export const run = async (fn, after) => {
  try {
    await fn();
    if (after) await after();
  } catch (e) {
    alert(e.message);
  }
};

// ---------- שורת משימה ----------
export function TaskRow({ task, onChange, showCompany = true }) {
  const [postponing, setPostponing] = useState(false);
  const [when, setWhen] = useState(task.due_at);
  const due = isDue(task);
  const overdue = task.status === 'open' && task.due_at.slice(0, 10) < todayStr();

  const toggle = () =>
    run(() => api.put(`/api/tasks/${task.id}`, { status: task.status === 'done' ? 'open' : 'done' }), onChange);

  const postpone = (e) => {
    e.preventDefault();
    run(
      () => api.put(`/api/tasks/${task.id}`, { due_at: when }),
      async () => {
        setPostponing(false);
        await onChange();
      }
    );
  };

  return (
    <li className={`task ${due ? 'due' : ''} ${task.status === 'done' ? 'done' : ''}`}>
      <input type="checkbox" checked={task.status === 'done'} onChange={toggle} />
      <span className="grow">
        <span className="task-title">{task.title}</span>
        {showCompany && task.company_name && (
          <>
            {' '}
            <a href={`#/company/${task.company_id}`}>{task.company_name}</a>
          </>
        )}
      </span>
      <span className={due ? 'badge red' : 'badge gray'}>
        {overdue ? 'באיחור · ' : ''}
        {fmtDate(task.due_at.slice(0, 10))} · {fmtTime(task.due_at)}
      </span>
      {task.status === 'open' && (
        <button className="link" onClick={() => setPostponing(!postponing)}>
          דחה
        </button>
      )}
      <button className="link" onClick={() => run(() => api.del(`/api/tasks/${task.id}`), onChange)}>
        מחיקה
      </button>
      {postponing && (
        <form className="row postpone" onSubmit={postpone}>
          <span className="muted">תאריך ושעה חדשים:</span>
          <input type="datetime-local" step="900" value={when} onChange={(e) => setWhen(e.target.value)} required />
          <button className="primary">שמירה</button>
          <button type="button" onClick={() => setPostponing(false)}>
            ביטול
          </button>
        </form>
      )}
    </li>
  );
}

// ---------- טופס משימה חדשה ----------
const DURATIONS = [15, 30, 45, 60, 90, 120, 180];

export function TaskForm({ companyId, companies, onAdded }) {
  const blank = () => ({ title: '', due_at: defaultDue(), duration_min: 30, company_id: companyId ?? '' });
  const [form, setForm] = useState(blank);

  const submit = (e) => {
    e.preventDefault();
    run(
      () => api.post('/api/tasks', form),
      async () => {
        setForm(blank());
        await onAdded();
      }
    );
  };

  return (
    <form className="row" onSubmit={submit}>
      <input
        className="grow"
        placeholder="משימה חדשה *"
        value={form.title}
        onChange={(e) => setForm({ ...form, title: e.target.value })}
        required
      />
      <input
        type="datetime-local"
        step="900"
        value={form.due_at}
        onChange={(e) => setForm({ ...form, due_at: e.target.value })}
        required
      />
      <select value={form.duration_min} onChange={(e) => setForm({ ...form, duration_min: e.target.value })}>
        {DURATIONS.map((d) => (
          <option key={d} value={d}>
            {d} דק׳
          </option>
        ))}
      </select>
      {companies && (
        <select value={form.company_id} onChange={(e) => setForm({ ...form, company_id: e.target.value })}>
          <option value="">ללא חברה</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
      <button className="primary">הוספה</button>
    </form>
  );
}

// ---------- רשימת טקסטים עם הוספה/עריכה/מחיקה (והצמדה אופציונלית) ----------
export function TextList({ items, onAdd, onSave, onDelete, onPin, reload, placeholder, confirmDelete }) {
  const [text, setText] = useState('');
  const [editId, setEditId] = useState(null);
  const [editText, setEditText] = useState('');

  const add = (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    run(
      () => onAdd(text.trim()),
      async () => {
        setText('');
        await reload();
      }
    );
  };
  const save = (id) =>
    run(
      () => onSave(id, editText.trim()),
      async () => {
        setEditId(null);
        await reload();
      }
    );
  const remove = (id) => {
    if (confirmDelete && !confirm('למחוק?')) return;
    run(() => onDelete(id), reload);
  };

  return (
    <>
      <ul className="list">
        {items.map((it) => (
          <li key={it.id} className={it.pinned ? 'pinned' : ''}>
            {editId === it.id ? (
              <>
                <input className="grow" value={editText} onChange={(e) => setEditText(e.target.value)} autoFocus />
                <button className="primary" onClick={() => save(it.id)}>
                  שמירה
                </button>
                <button onClick={() => setEditId(null)}>ביטול</button>
              </>
            ) : (
              <>
                <span className="grow">{it.text}</span>
                {onPin && (
                  <button className="link" onClick={() => run(() => onPin(it.id, !it.pinned), reload)}>
                    {it.pinned ? '📌 בטל הצמדה' : 'הצמד'}
                  </button>
                )}
                <button
                  className="link"
                  onClick={() => {
                    setEditId(it.id);
                    setEditText(it.text);
                  }}
                >
                  עריכה
                </button>
                <button className="link" onClick={() => remove(it.id)}>
                  מחיקה
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      <form className="row" onSubmit={add}>
        <input className="grow" placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} />
        <button className="primary">הוספה</button>
      </form>
    </>
  );
}
