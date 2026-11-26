import React, { useEffect, useState } from 'react';
import { addDays, api, dayTitle, fmtDate, fmtTime, isDue, todayStr } from '../api.js';
import { run, useLoad } from '../ui.jsx';

const START = 8 * 60; // 08:00
const END = 18 * 60; // 18:00
const SLOT = 30; // דקות למשבצת
const SLOT_H = 44; // גובה משבצת בפיקסלים
const SLOTS = (END - START) / SLOT;

const toMins = (dueAt) => Number(dueAt.slice(11, 13)) * 60 + Number(dueAt.slice(14, 16));
const hhmm = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

// מחלק פריטים חופפים (משימות ופגישות) לעמודות כדי שלא יסתירו אחד את השני.
// כל פריט: { s, e } בדקות מתחילת היום. מוסיף לו c (עמודה) ו-n (כמה עמודות בקבוצה)
function layout(items) {
  const sorted = [...items].sort((a, b) => a.s - b.s || a.e - b.e);
  const out = [];
  let cluster = [];
  let clusterEnd = -1;
  let colsEnd = [];
  const flush = () => {
    cluster.forEach((i) => (i.n = colsEnd.length));
    out.push(...cluster);
    cluster = [];
    colsEnd = [];
    clusterEnd = -1;
  };
  for (const it of sorted) {
    if (cluster.length && it.s >= clusterEnd) flush();
    let c = colsEnd.findIndex((end) => end <= it.s);
    if (c === -1) {
      c = colsEnd.length;
      colsEnd.push(it.e);
    } else {
      colsEnd[c] = it.e;
    }
    it.c = c;
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.e);
  }
  flush();
  return out;
}

export default function CalendarPage() {
  const [date, setDate] = useState(todayStr());
  const [data, reload, error] = useLoad(`/api/calendar?date=${date}`);
  const [dragId, setDragId] = useState(null);
  const [over, setOver] = useState(null);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p>טוען...</p>;

  const inRange = (t) => {
    const m = toMins(t.due_at);
    return m >= START && m < END;
  };
  const inGrid = data.tasks.filter(inRange);
  const outside = data.tasks.filter((t) => !inRange(t) && t.status === 'open');
  const tray = [...data.overdue, ...outside];

  const meetings = data.meetings || [];
  const allDayMeetings = meetings.filter((m) => m.allDay);
  const timed = meetings.filter((m) => !m.allDay);
  const meetingInGrid = (m) => m.endMin > START && m.startMin < END;
  const meetingsInGrid = timed.filter(meetingInGrid);
  const meetingsOutside = timed.filter((m) => !meetingInGrid(m));

  const items = [
    ...inGrid.map((t) => ({ kind: 'task', t, s: toMins(t.due_at), e: toMins(t.due_at) + (t.duration_min || SLOT) })),
    ...meetingsInGrid.map((m) => ({
      kind: 'meeting',
      m,
      s: Math.max(m.startMin, START),
      e: Math.min(Math.max(m.endMin, m.startMin + 15), END),
    })),
  ];

  const moveTask = (id, slotIndex) => {
    const due_at = `${date}T${hhmm(START + slotIndex * SLOT)}`;
    run(() => api.put(`/api/tasks/${id}`, { due_at }), reload);
  };
  const onDrop = (e, slotIndex) => {
    e.preventDefault();
    const id = Number(e.dataTransfer.getData('text/plain')) || dragId;
    setDragId(null);
    setOver(null);
    if (id) moveTask(id, slotIndex);
  };
  const startDrag = (e, id) => {
    e.dataTransfer.setData('text/plain', String(id));
    e.dataTransfer.effectAllowed = 'move';
    // מכבים את אירועי העכבר של הבלוקים רק אחרי תחילת הגרירה, כדי שהשחרור יגיע למשבצת שמתחתיהם
    setTimeout(() => setDragId(id), 0);
  };
  const endDrag = () => {
    setDragId(null);
    setOver(null);
  };
  const toggleDone = (t) =>
    run(() => api.put(`/api/tasks/${t.id}`, { status: t.status === 'done' ? 'open' : 'done' }), reload);
  // רענון מיידי של יומן Outlook (בלי להמתין לחמש דקות)
  const refreshFeed = () => run(() => api.get(`/api/calendar?date=${date}&refresh=1`), reload);

  const nowMins = now.getHours() * 60 + now.getMinutes();
  const showNow = date === todayStr() && nowMins >= START && nowMins < END;

  return (
    <>
      <div className="row between">
        <h2 className="page-title">{dayTitle(date)}</h2>
        <div className="row">
          <button onClick={() => setDate(addDays(date, -1))}>→ יום קודם</button>
          <button onClick={() => setDate(todayStr())}>היום</button>
          <button onClick={() => setDate(addDays(date, 1))}>יום הבא ←</button>
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          {data.hasFeed && <button onClick={refreshFeed}>רענון יומן Outlook</button>}
        </div>
      </div>
      <p className="muted">
        גוררים משימה למשבצת אחרת כדי לשנות את השעה שלה. משימה שעברה זמנה אפשר לגרור מהרשימה שבצד אל היום הזה.
        {!data.hasFeed && (
          <>
            {' '}
            <a href="#/settings">חיבור יומן Outlook</a> יציג כאן גם את הפגישות שלך.
          </>
        )}
      </p>

      {data.meetingsError && (
        <div className="banner orange">
          לא הצלחתי לטעון את יומן Outlook: {data.meetingsError} <a href="#/settings">להגדרות</a>
        </div>
      )}
      {allDayMeetings.length > 0 && (
        <div className="cal-allday">
          {allDayMeetings.map((m) => (
            <span key={m.id} className="badge gray">
              כל היום · {m.title}
            </span>
          ))}
        </div>
      )}
      {meetingsOutside.length > 0 && (
        <p className="muted">
          פגישות מחוץ לשעות הלוח:{' '}
          {meetingsOutside.map((m) => `${m.timeLabel} ${m.title}`).join(' | ')}
        </p>
      )}

      <div className="cal">
        <div className="cal-grid" style={{ height: SLOTS * SLOT_H }}>
          {Array.from({ length: SLOTS }, (_, i) => (
            <div
              key={i}
              className={`cal-slot ${i % 2 === 0 ? 'hour' : ''} ${over === i ? 'over' : ''}`}
              style={{ top: i * SLOT_H, height: SLOT_H }}
              onDragOver={(e) => {
                e.preventDefault();
                if (over !== i) setOver(i);
              }}
              onDrop={(e) => onDrop(e, i)}
            >
              <span className="cal-time">{hhmm(START + i * SLOT)}</span>
            </div>
          ))}

          <div className="cal-events">
            {layout(items).map((it) => {
              const top = ((it.s - START) / SLOT) * SLOT_H;
              const height = Math.max(((Math.min(it.e, END) - it.s) / SLOT) * SLOT_H - 2, 22);
              const pos = {
                top,
                height,
                insetInlineStart: `${(it.c / it.n) * 100}%`,
                width: `${100 / it.n}%`,
                pointerEvents: dragId ? 'none' : 'auto',
              };

              if (it.kind === 'meeting') {
                const m = it.m;
                return (
                  <div
                    key={`m-${m.id}`}
                    className="cal-task meeting"
                    style={pos}
                    title={`${m.title}\n${m.timeLabel}${m.location ? `\n${m.location}` : ''}`}
                  >
                    <span className="cal-task-text">
                      <strong>{m.timeLabel}</strong> {m.title}
                      {m.location && !m.teamsUrl && <span className="muted"> · {m.location}</span>}
                      {m.teamsUrl && (
                        <a className="join" href={m.teamsUrl} target="_blank" rel="noreferrer">
                          הצטרפות ל-Teams
                        </a>
                      )}
                    </span>
                  </div>
                );
              }

              const t = it.t;
              return (
                <div
                  key={t.id}
                  draggable={t.status === 'open'}
                  onDragStart={(ev) => startDrag(ev, t.id)}
                  onDragEnd={endDrag}
                  className={`cal-task ${isDue(t) ? 'due' : ''} ${t.status === 'done' ? 'done' : ''} ${dragId === t.id ? 'dragging' : ''}`}
                  style={pos}
                >
                  <input type="checkbox" checked={t.status === 'done'} onChange={() => toggleDone(t)} />
                  <span className="cal-task-text">
                    <strong>{fmtTime(t.due_at)}</strong> {t.title}
                    {t.company_name && <span className="muted"> · {t.company_name}</span>}
                  </span>
                </div>
              );
            })}
            {showNow && <div className="cal-now" style={{ top: ((nowMins - START) / SLOT) * SLOT_H }} />}
          </div>
        </div>

        <aside className="cal-tray card">
          <h3>ממתינות לשיבוץ</h3>
          {tray.length === 0 && <p className="muted">אין משימות באיחור או מחוץ לשעות הלוח</p>}
          <ul className="list">
            {tray.map((t) => (
              <li
                key={t.id}
                className={`tray-item ${isDue(t) ? 'due' : ''} ${dragId === t.id ? 'dragging' : ''}`}
                draggable
                onDragStart={(ev) => startDrag(ev, t.id)}
                onDragEnd={endDrag}
              >
                <span className="grow">
                  {t.title}
                  {t.company_name && <span className="muted"> · {t.company_name}</span>}
                  <br />
                  <span className="muted">
                    {fmtDate(t.due_at.slice(0, 10))} · {fmtTime(t.due_at)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </>
  );
}
