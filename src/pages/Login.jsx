import React, { useState } from 'react';
import { api } from '../api.js';

export default function Login({ onDone }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/api/login', { password });
      onDone();
    } catch (err) {
      setError(err.message);
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app login">
      <form className="card" onSubmit={submit}>
        <h1>ניהול לקוחות</h1>
        <p className="muted">הכניסה למערכת מוגנת בסיסמה.</p>
        <div className="row">
          <input
            className="grow"
            type="password"
            autoComplete="current-password"
            autoFocus
            placeholder="סיסמה"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button className="primary" disabled={busy}>
            {busy ? 'בודק...' : 'כניסה'}
          </button>
        </div>
        {error && <div className="banner red">{error}</div>}
      </form>
    </div>
  );
}
