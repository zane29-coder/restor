import { useState, type FormEvent } from 'react';
import { RestorApiError } from '../lib/api';
import { useAuth } from '../lib/auth';

export function LoginPage() {
  const { login } = useAuth();

  const [loginValue, setLoginValue] = useState('');
  const [password, setPassword] = useState('');
  const [tenantSlug, setTenantSlug] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    setIsSubmitting(true);

    try {
      await login(loginValue.trim(), password, tenantSlug.trim() || undefined);
    } catch (caught) {
      if (caught instanceof RestorApiError) {
        setError(caught.message);
        // The backend returns per-field messages for validation failures.
        if (caught.details) setFieldErrors(caught.details);
      } else {
        setError('Serverga ulanib boʻlmadi');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="login">
      <form className="login__card" onSubmit={handleSubmit}>
        <h1 className="login__brand">
          RES<span>TOR</span>
        </h1>
        <p className="login__sub">Boshqaruv paneli</p>

        {error && <div className="alert alert--error">{error}</div>}

        <div className="field">
          <label htmlFor="login">Telefon yoki email</label>
          <input
            id="login"
            name="login"
            autoComplete="username"
            placeholder="+998 90 123 45 67"
            value={loginValue}
            onChange={(event) => setLoginValue(event.target.value)}
            required
          />
          {fieldErrors.login?.[0] && <span className="field__error">{fieldErrors.login[0]}</span>}
        </div>

        <div className="field">
          <label htmlFor="password">Parol</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </div>

        {/*
          Only needed when the same phone works at more than one restaurant —
          the backend says so explicitly rather than guessing a tenant.
        */}
        <div className="field">
          <label htmlFor="tenantSlug">
            Restoran <span className="muted">(ixtiyoriy)</span>
          </label>
          <input
            id="tenantSlug"
            name="tenantSlug"
            placeholder="demo"
            value={tenantSlug}
            onChange={(event) => setTenantSlug(event.target.value)}
          />
          {fieldErrors.tenantSlug?.[0] && (
            <span className="field__error">{fieldErrors.tenantSlug[0]}</span>
          )}
        </div>

        <button type="submit" className="btn" style={{ width: '100%' }} disabled={isSubmitting}>
          {isSubmitting ? 'Tekshirilmoqda…' : 'Kirish'}
        </button>
      </form>
    </div>
  );
}
