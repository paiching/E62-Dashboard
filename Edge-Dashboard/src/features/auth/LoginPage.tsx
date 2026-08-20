import { FormEvent, useState } from 'react';
import { LockKeyhole, UserRound } from 'lucide-react';
import { runtimeConfig } from '../../config/runtime';
import { login } from '../../services/authService';
import type { UserSession } from '../../types/dashboard';

export function LoginPage({ onLogin }: { onLogin: (session: UserSession) => void }) {
  const [username, setUsername] = useState(() => localStorage.getItem('edge-last-username') || '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const session = await login(username, password);
      localStorage.setItem('edge-last-username', session.username);
      onLogin(session);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '登入失敗');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-card login-card-compact">
        <div className="login-brand">
          <span>E62</span>
          <div>
            <h1>Edge Dashboard</h1>
            <p>E62 / C62 溫度感應器監控系統</p>
          </div>
        </div>
        <form id="edge-login-form" name="edge-login" method="post" action="/login" autoComplete="on" onSubmit={handleSubmit}>
          <label htmlFor="edge-login-username">
            帳號
            <div className="input-with-icon">
              <UserRound size={18} />
              <input id="edge-login-username" name="username" value={username} onChange={(event) => setUsername(event.target.value)} autoFocus autoComplete="username" placeholder="請輸入帳號" />
            </div>
          </label>
          <label htmlFor="edge-login-password">
            密碼
            <div className="input-with-icon">
              <LockKeyhole size={18} />
              <input id="edge-login-password" name="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" placeholder="請輸入密碼" />
            </div>
          </label>
          {error && <div className="form-error" role="alert">{error}</div>}
          <button type="submit" className="primary-button login-submit" disabled={submitting}>
            {submitting ? '驗證中…' : '登入系統'}
          </button>
        </form>
      </section>
      <p className="login-mode">{runtimeConfig.dataMode === 'mock' ? 'DEMO · 200 點模擬資料' : 'LIVE · EC62 API'}</p>
    </main>
  );
}
