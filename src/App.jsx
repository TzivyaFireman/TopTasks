import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import Today from './pages/Today.jsx';
import CalendarPage from './pages/CalendarPage.jsx';
import Companies from './pages/Companies.jsx';
import Company from './pages/Company.jsx';
import Settings from './pages/Settings.jsx';
import Login from './pages/Login.jsx';

// ניווט לפי ה-hash שבכתובת, כך שרענון הדף והחזרה אחורה עובדים
function useRoute() {
  const read = () => (window.location.hash || '#/today').replace(/^#\//, '').split('/');
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

const TABS = [
  ['today', 'היום'],
  ['calendar', 'לוח יומי'],
  ['companies', 'חברות'],
  ['settings', 'הגדרות'],
];

export default function App() {
  const [page, param] = useRoute();
  // null = טוען. אחרת: { authRequired, authenticated } או { error: true }
  const [auth, setAuth] = useState(null);

  useEffect(() => {
    api.get('/api/me').then(setAuth).catch(() => setAuth({ error: true }));
    const onUnauthorized = () => setAuth((a) => ({ ...(a || {}), authRequired: true, authenticated: false }));
    window.addEventListener('unauthorized', onUnauthorized);
    return () => window.removeEventListener('unauthorized', onUnauthorized);
  }, []);

  const logout = async () => {
    try {
      await api.post('/api/logout');
    } catch {
      /* גם אם נכשל, חוזרים למסך הכניסה */
    }
    window.location.hash = '#/today';
    setAuth({ authRequired: true, authenticated: false });
  };

  if (!auth) return <div className="app"><p>טוען...</p></div>;
  if (auth.error) return <div className="app"><p className="error">אין חיבור לשרת. בדקי שהוא פועל ורענני את הדף.</p></div>;
  if (auth.authRequired && !auth.authenticated) {
    return <Login onDone={() => setAuth({ authRequired: true, authenticated: true })} />;
  }

  const active = page === 'company' ? 'companies' : page;

  return (
    <div className="app">
      <header>
        <h1>ניהול לקוחות</h1>
        <nav>
          {TABS.map(([key, label]) => (
            <a key={key} href={`#/${key}`} className={active === key ? 'active' : ''}>
              {label}
            </a>
          ))}
          {auth.authRequired && (
            <button className="link" onClick={logout}>
              יציאה
            </button>
          )}
        </nav>
      </header>
      <main>
        {page === 'calendar' && <CalendarPage />}
        {page === 'companies' && <Companies />}
        {page === 'company' && <Company key={param} id={Number(param)} />}
        {page === 'settings' && <Settings />}
        {!['calendar', 'companies', 'company', 'settings'].includes(page) && <Today />}
      </main>
    </div>
  );
}
