import { useState, type FormEvent } from 'react';
import { RestorApiError } from '@restor/api-client';
import { api } from './api';

export function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [tenantSlug, setTenantSlug] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await api.auth.login({
        login: login.trim(),
        password,
        tenantSlug: tenantSlug.trim() || undefined,
      });
      onSuccess();
    } catch (caught) {
      setError(caught instanceof RestorApiError ? caught.message : 'Kirish amalga oshmadi');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="pos__center">
      <form className="login-box" onSubmit={handleSubmit}>
        <h1>
          RES<span style={{ color: 'var(--primary)' }}>TOR</span> POS
        </h1>
        {error && <div className="pos__error" style={{ borderRadius: 10 }}>{error}</div>}

        <input
          placeholder="Telefon"
          autoComplete="username"
          value={login}
          onChange={(event) => setLogin(event.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Parol"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
        <input
          placeholder="Restoran (ixtiyoriy)"
          value={tenantSlug}
          onChange={(event) => setTenantSlug(event.target.value)}
        />

        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Tekshirilmoqda…' : 'KIRISH'}
        </button>
      </form>
    </div>
  );
}
