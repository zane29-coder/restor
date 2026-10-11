import { useState } from 'react';
import { Gender, type UpdateCustomerProfileRequest } from '@restor/shared-types';
import { api } from '../api';
import { nameProblem } from '../components/ProfileGateSheet';
import { useToast } from '../components/Toast';
import { ScreenHeader, SwitchRow } from '../components/ui';
import { errorMessage, fieldErrors } from '../lib/errors';
import { formatPhoneInput, isCompletePhone, phone as formatPhone } from '../lib/format';
import { useNav } from '../lib/nav';
import { useSession } from '../state/session';
import { hapticResult } from '../telegram';

/**
 * Profile settings (TZ 48 §13, §17).
 *
 * Name, surname and phone are required for an order; the rest is optional.
 * The phone is shown as unverified because it is — there is no SMS check yet,
 * and the screen does not pretend otherwise. Notification channels that do
 * not exist yet are listed as coming, not as working switches.
 */
export function SettingsScreen() {
  const session = useSession();
  const nav = useNav();
  const toast = useToast();
  const { profile } = session;

  const [firstName, setFirstName] = useState(profile.firstName ?? '');
  const [lastName, setLastName] = useState(profile.lastName ?? '');
  const [phone, setPhone] = useState(profile.phone ? formatPhoneInput(profile.phone) : '+998 ');
  const [email, setEmail] = useState(profile.email ?? '');
  const [birthDate, setBirthDate] = useState(profile.birthDate ?? '');
  const [gender, setGender] = useState<Gender | ''>(profile.gender ?? '');
  const [notifyTelegram, setNotifyTelegram] = useState(profile.notifyTelegram);
  const [marketingOptIn, setMarketingOptIn] = useState(profile.marketingOptIn);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function save() {
    const next: Record<string, string> = {};
    const firstProblem = nameProblem(firstName);
    const lastProblem = nameProblem(lastName);
    if (firstProblem) next.firstName = firstProblem;
    if (lastProblem) next.lastName = lastProblem;
    if (!isCompletePhone(phone)) next.phone = 'Raqamni toʻliq kiriting: +998 XX XXX XX XX';
    if (email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim())) next.email = 'Email notoʻgʻri';
    setErrors(next);
    if (Object.keys(next).length > 0) {
      hapticResult('warning');
      return;
    }

    const payload: UpdateCustomerProfileRequest = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      phone: phone.replace(/\s/g, ''),
      email: email.trim() || null,
      birthDate: birthDate || null,
      gender: gender || null,
      notifyTelegram,
      marketingOptIn,
    };

    setBusy(true);
    try {
      const saved = await api.me.updateProfile(payload);
      session.setProfile(saved);
      hapticResult('success');
      toast.show('Saqlandi', 'success');
      nav.back();
    } catch (error) {
      setErrors(fieldErrors(error));
      toast.show(errorMessage(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen screen--tinted">
      <ScreenHeader title="Sozlamalar" />

      <section className="card-block form">
        <label className="field">
          <span className="field__label">Ism *</span>
          <input
            autoComplete="given-name"
            value={firstName}
            placeholder={profile.telegram.firstName ?? ''}
            onChange={(event) => setFirstName(event.target.value)}
            aria-invalid={Boolean(errors.firstName)}
          />
          {errors.firstName && <span className="field__error">{errors.firstName}</span>}
        </label>

        <label className="field">
          <span className="field__label">Familiya *</span>
          <input
            autoComplete="family-name"
            value={lastName}
            placeholder={profile.telegram.lastName ?? ''}
            onChange={(event) => setLastName(event.target.value)}
            aria-invalid={Boolean(errors.lastName)}
          />
          {errors.lastName && <span className="field__error">{errors.lastName}</span>}
        </label>

        <label className="field">
          <span className="field__label">Telefon *</span>
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
            <span className="field__hint">
              {profile.phone && !profile.phoneVerified
                ? `${formatPhone(profile.phone)} — tasdiqlanmagan. SMS orqali tasdiqlash keyinroq qoʻshiladi.`
                : 'SMS orqali tasdiqlash keyinroq qoʻshiladi.'}
            </span>
          )}
        </label>

        <label className="field">
          <span className="field__label">Email (ixtiyoriy)</span>
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={Boolean(errors.email)}
          />
          {errors.email && <span className="field__error">{errors.email}</span>}
        </label>

        <div className="field-grid">
          <label className="field">
            <span className="field__label">Tugʻilgan sana</span>
            <input
              type="date"
              value={birthDate}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(event) => setBirthDate(event.target.value)}
            />
            {errors.birthDate && <span className="field__error">{errors.birthDate}</span>}
          </label>
          <label className="field">
            <span className="field__label">Jins</span>
            <select value={gender} onChange={(event) => setGender(event.target.value as Gender | '')}>
              <option value="">Koʻrsatilmagan</option>
              <option value={Gender.MALE}>Erkak</option>
              <option value={Gender.FEMALE}>Ayol</option>
            </select>
          </label>
        </div>
      </section>

      <section className="card-block">
        <h2 className="block-title">Bildirishnomalar</h2>
        <SwitchRow
          label="Telegram bot orqali xabarlar"
          hint="Buyurtma holati va toʻlov haqida. Ilovadagi «Bildirishnomalar» boʻlimida baribir saqlanadi."
          checked={notifyTelegram}
          onChange={setNotifyTelegram}
        />
        <SwitchRow
          label="Aksiya va yangiliklar"
          hint="Yangi taomlar, chegirmalar va promo-kodlar. Buyurtma xabarlariga taʼsir qilmaydi."
          checked={marketingOptIn}
          onChange={setMarketingOptIn}
        />
        <SwitchRow label="Email xabarlari" badge="Tez orada" checked={false} disabled onChange={() => undefined} />
        <SwitchRow label="SMS" badge="Tez orada" checked={false} disabled onChange={() => undefined} />
        <SwitchRow label="Push-bildirishnomalar" badge="Tez orada" checked={false} disabled onChange={() => undefined} />
      </section>

      <div className="form-actions">
        <button type="button" className="btn btn--primary btn--block btn--large" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saqlanmoqda…' : 'Saqlash'}
        </button>
      </div>
    </div>
  );
}
