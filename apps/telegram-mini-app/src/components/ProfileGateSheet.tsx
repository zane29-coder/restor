import { useEffect, useState } from 'react';
import type { CustomerProfile, RequiredProfileField } from '@restor/shared-types';
import { api } from '../api';
import { errorMessage, fieldErrors } from '../lib/errors';
import { formatPhoneInput, isCompletePhone } from '../lib/format';
import { useSession } from '../state/session';
import { BottomSheet } from './BottomSheet';

/** Client-side courtesy check; the server applies the shared Zod rules again. */
export function nameProblem(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length < 2) return 'Kamida 2 ta harf kiriting';
  if (/\d/.test(trimmed)) return 'Faqat harflar kiritilishi mumkin';
  return null;
}

/**
 * "Who is this order for?" — asked at the moment it is needed (TZ 48 §14).
 *
 * Shows only the fields still missing: a customer who already gave a phone
 * is not asked for it again. Once saved, `onSaved` resumes the checkout that
 * triggered it, so the customer does not press "To'lash" twice.
 */
export function ProfileGateSheet({
  open,
  missing,
  onClose,
  onSaved,
}: {
  open: boolean;
  missing: RequiredProfileField[];
  onClose: () => void;
  onSaved: (profile: CustomerProfile) => void;
}) {
  const session = useSession();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('+998 ');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setFormError(null);
  }, [open]);

  const asks = (field: RequiredProfileField) => missing.includes(field);

  async function save() {
    const next: Record<string, string> = {};
    if (asks('firstName')) {
      const problem = nameProblem(firstName);
      if (problem) next.firstName = problem;
    }
    if (asks('lastName')) {
      const problem = nameProblem(lastName);
      if (problem) next.lastName = problem;
    }
    if (asks('phone') && !isCompletePhone(phone)) {
      next.phone = 'Raqamni toʻliq kiriting: +998 XX XXX XX XX';
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setBusy(true);
    setFormError(null);
    try {
      const profile = await api.me.updateProfile({
        ...(asks('firstName') ? { firstName: firstName.trim() } : {}),
        ...(asks('lastName') ? { lastName: lastName.trim() } : {}),
        ...(asks('phone') ? { phone: phone.replace(/\s/g, '') } : {}),
      });
      session.setProfile(profile);
      onSaved(profile);
    } catch (error) {
      setErrors(fieldErrors(error));
      setFormError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      label="Buyurtma uchun maʼlumotlar"
      footer={
        <button
          type="button"
          className="btn btn--primary btn--block btn--large"
          disabled={busy}
          onClick={() => void save()}
        >
          {busy ? 'Saqlanmoqda…' : 'Saqlash va davom etish'}
        </button>
      }
    >
      <div className="form-sheet">
        <h2 className="form-sheet__title">Buyurtma kimning nomiga?</h2>
        <p className="form-sheet__text">
          Kuryer va restoran siz bilan bogʻlanishi uchun kerak. Maʼlumotlar profilingizda saqlanadi.
        </p>

        {asks('firstName') && (
          <label className="field">
            <span className="field__label">Ism *</span>
            <input
              autoComplete="given-name"
              placeholder={session.profile.telegram.firstName ?? 'Ismingiz'}
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
              aria-invalid={Boolean(errors.firstName)}
            />
            {errors.firstName && <span className="field__error">{errors.firstName}</span>}
          </label>
        )}

        {asks('lastName') && (
          <label className="field">
            <span className="field__label">Familiya *</span>
            <input
              autoComplete="family-name"
              placeholder={session.profile.telegram.lastName ?? 'Familiyangiz'}
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
              aria-invalid={Boolean(errors.lastName)}
            />
            {errors.lastName && <span className="field__error">{errors.lastName}</span>}
          </label>
        )}

        {asks('phone') && (
          <label className="field">
            <span className="field__label">Telefon raqami *</span>
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(event) => setPhone(formatPhoneInput(event.target.value))}
              aria-invalid={Boolean(errors.phone)}
            />
            {errors.phone ? (
              <span className="field__error">{errors.phone}</span>
            ) : (
              <span className="field__hint">SMS orqali tasdiqlash hozircha mavjud emas</span>
            )}
          </label>
        )}

        {formError && <div className="notice notice--error">{formError}</div>}
      </div>
    </BottomSheet>
  );
}
