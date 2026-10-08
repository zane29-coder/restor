import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Permission,
  PromoCodeType,
  PromotionType,
  type PromoCode,
  type Promotion,
} from '@restor/shared-types';
import { formatMoney } from '@restor/shared-utils';
import { IconPlus } from '@restor/ui';
import { api, RestorApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ErrorState, Loading, Notice } from '../components/States';

type Tab = 'promotions' | 'codes';

/**
 * Promotions and promo codes (TZ §10).
 *
 * The pricing engine has always applied these; until now the only way to
 * create one was a database insert. Everything here is a thin form over that
 * existing behaviour.
 *
 * The one thing the UI must not let a manager get wrong: `value` means a
 * percentage for one type and an amount of soʻm for another. Typing 50 000
 * into a percentage discount would take every order to zero. So the field
 * relabels itself with the type, and the server refuses the combination
 * regardless of what any client sends.
 */
export function MarketingPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>('promotions');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {notice && <Notice notice={notice} onClose={() => setNotice(null)} />}

      <div className="row" style={{ gap: 8 }}>
        {(
          [
            ['promotions', 'Aksiyalar'],
            ['codes', 'Promokodlar'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={tab === key ? 'btn' : 'btn btn--ghost'}
            onClick={() => {
              setTab(key);
              setNotice(null);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'promotions' ? (
        <Promotions
          canManage={can(Permission.PROMOTIONS_MANAGE)}
          onNotice={setNotice}
        />
      ) : (
        <PromoCodes
          canManage={can(Permission.PROMO_CODES_MANAGE)}
          onNotice={setNotice}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Promotions                                                                 */
/* -------------------------------------------------------------------------- */

function Promotions({
  canManage,
  onNotice,
}: {
  canManage: boolean;
  onNotice: (n: { ok: boolean; text: string }) => void;
}) {
  const queryClient = useQueryClient();
  const [isCreating, setIsCreating] = useState(false);

  const promotions = useQuery({
    queryKey: ['promotions'],
    queryFn: () => api.marketing.listPromotions({ limit: 100 }),
  });

  const toggle = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.marketing.updatePromotion(id, { isActive }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['promotions'] }),
    onError: (error) =>
      onNotice({
        ok: false,
        text: error instanceof RestorApiError ? error.message : 'Oʻzgartirilmadi',
      }),
  });

  if (promotions.isLoading) return <Loading />;
  if (promotions.isError) {
    return <ErrorState error={promotions.error} onRetry={() => void promotions.refetch()} />;
  }

  const items = promotions.data?.items ?? [];

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {canManage && !isCreating && (
        <button type="button" className="btn" onClick={() => setIsCreating(true)}>
          <IconPlus size={16} /> Aksiya qoʻshish
        </button>
      )}

      {isCreating && (
        <PromotionForm
          onClose={() => setIsCreating(false)}
          onSaved={(text) => {
            setIsCreating(false);
            onNotice({ ok: true, text });
            void queryClient.invalidateQueries({ queryKey: ['promotions'] });
          }}
          onError={(text) => onNotice({ ok: false, text })}
        />
      )}

      {items.length === 0 ? (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            Aksiya yoʻq. Yaratilgan aksiya har bir buyurtmada avtomatik qoʻllanadi.
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {items.map((promotion) => (
            <div key={promotion.id} className="card row" style={{ gap: 12, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 200, flex: 1 }}>
                <strong>{promotion.name}</strong>
                <div className="muted" style={{ fontSize: 13 }}>
                  {describePromotion(promotion)}
                </div>
              </div>

              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {promotion.isExclusive && (
                  <span className="badge" style={{ background: '#EDE9FE', color: '#5B21B6' }}>
                    yakka
                  </span>
                )}
                {promotion.timeFrom && (
                  <span className="badge" style={{ background: '#FEF3C7', color: '#B45309' }}>
                    {promotion.timeFrom}–{promotion.timeTo}
                  </span>
                )}
                {promotion.branchIds.length > 0 && (
                  <span className="badge" style={{ background: '#E0F2FE', color: '#075985' }}>
                    {promotion.branchIds.length} filial
                  </span>
                )}
              </div>

              <div className="spacer" />
              {canManage && (
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={toggle.isPending}
                  onClick={() =>
                    toggle.mutate({ id: promotion.id, isActive: !promotion.isActive })
                  }
                >
                  {promotion.isActive ? 'Oʻchirish' : 'Yoqish'}
                </button>
              )}
              <span
                className="badge"
                style={{
                  background: promotion.isActive ? '#DCFCE7' : '#F3F4F6',
                  color: promotion.isActive ? '#166534' : '#6B7280',
                }}
              >
                {promotion.isActive ? 'Faol' : 'Oʻchiq'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const PROMOTION_TYPES: Array<{ value: PromotionType; label: string }> = [
  { value: PromotionType.PERCENTAGE_DISCOUNT, label: 'Foizli chegirma' },
  { value: PromotionType.FIXED_DISCOUNT, label: 'Belgilangan chegirma' },
  { value: PromotionType.FREE_DELIVERY, label: 'Bepul yetkazish' },
  { value: PromotionType.HAPPY_HOUR, label: 'Happy hour' },
];

function PromotionForm({
  onClose,
  onSaved,
  onError,
}: {
  onClose: () => void;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<PromotionType>(PromotionType.PERCENTAGE_DISCOUNT);
  const [value, setValue] = useState('10');
  const [minOrderAmount, setMinOrderAmount] = useState('');
  const [maxDiscount, setMaxDiscount] = useState('');
  const [timeFrom, setTimeFrom] = useState('');
  const [timeTo, setTimeTo] = useState('');
  const [isExclusive, setIsExclusive] = useState(true);

  const isPercent = type === PromotionType.PERCENTAGE_DISCOUNT;
  const needsValue = isPercent || type === PromotionType.FIXED_DISCOUNT;
  const numericValue = Number(value.replace(/\D/g, '')) || 0;

  const valueError = needsValue
    ? isPercent && (numericValue < 1 || numericValue > 100)
      ? 'Foiz 1–100 oraligʻida boʻlishi kerak'
      : !isPercent && numericValue <= 0
        ? 'Summa noldan katta boʻlishi kerak'
        : null
    : null;

  // Half a window would run all day, which is the opposite of a happy hour.
  const timeError =
    Boolean(timeFrom) !== Boolean(timeTo) ? 'Ikkala vaqtni ham kiriting' : null;

  const save = useMutation({
    mutationFn: () =>
      api.marketing.createPromotion({
        name: name.trim(),
        type,
        value: needsValue ? numericValue : 0,
        minOrderAmount: toAmount(minOrderAmount),
        maxDiscount: isPercent ? toAmount(maxDiscount) : null,
        timeFrom: timeFrom || null,
        timeTo: timeTo || null,
        isExclusive,
        isActive: true,
      }),
    onSuccess: () => onSaved(`"${name.trim()}" aksiyasi yaratildi`),
    onError: (error) =>
      onError(error instanceof RestorApiError ? error.message : 'Saqlanmadi'),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (valueError || timeError || name.trim().length < 2) return;
    save.mutate();
  }

  return (
    <form className="card" onSubmit={submit}>
      <div className="row" style={{ marginBottom: 14 }}>
        <h3 style={{ fontSize: 15, margin: 0 }}>Yangi aksiya</h3>
        <div className="spacer" />
        <button type="button" className="btn btn--ghost" onClick={onClose}>
          Yopish
        </button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
          gap: 14,
        }}
      >
        <Field label="Nomi" hint="Mijoz chekda shu nomni koʻradi.">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Dushanba chegirmasi"
            style={inputStyle}
          />
        </Field>

        <Field label="Turi" hint="Qiymat maydoni turga qarab oʻzgaradi.">
          <select
            value={type}
            onChange={(e) => setType(e.target.value as PromotionType)}
            style={inputStyle}
          >
            {PROMOTION_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>

        {needsValue && (
          <Field
            label={isPercent ? 'Chegirma (%)' : 'Chegirma (soʻm)'}
            hint={isPercent ? '1 dan 100 gacha.' : 'Buyurtmadan ayriladigan summa.'}
            error={valueError}
          >
            <input
              inputMode="numeric"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={isPercent ? '10' : '15000'}
              style={inputStyle}
            />
          </Field>
        )}

        {isPercent && (
          <Field label="Maksimal chegirma" hint="Foizni cheklaydi. Boʻsh — cheklovsiz.">
            <input
              inputMode="numeric"
              value={maxDiscount}
              onChange={(e) => setMaxDiscount(e.target.value)}
              placeholder="50000"
              style={inputStyle}
            />
          </Field>
        )}

        <Field label="Minimal buyurtma" hint="Shundan kam buyurtmaga qoʻllanmaydi.">
          <input
            inputMode="numeric"
            value={minOrderAmount}
            onChange={(e) => setMinOrderAmount(e.target.value)}
            placeholder="50000"
            style={inputStyle}
          />
        </Field>

        <Field label="Vaqt oraligʻi" hint="Faqat shu soatlarda. Boʻsh — kun boʻyi." error={timeError}>
          <div className="row" style={{ gap: 6 }}>
            <input
              type="time"
              value={timeFrom}
              onChange={(e) => setTimeFrom(e.target.value)}
              style={{ ...inputStyle, flex: 1 }}
            />
            <input
              type="time"
              value={timeTo}
              onChange={(e) => setTimeTo(e.target.value)}
              style={{ ...inputStyle, flex: 1 }}
            />
          </div>
        </Field>
      </div>

      <label className="row" style={{ gap: 8, marginTop: 14, fontSize: 13 }}>
        <input
          type="checkbox"
          checked={isExclusive}
          onChange={(e) => setIsExclusive(e.target.checked)}
        />
        Yakka — bu aksiya qoʻllansa, boshqalari qoʻshilmaydi
      </label>

      <button
        type="submit"
        className="btn"
        style={{ marginTop: 16 }}
        disabled={save.isPending || Boolean(valueError) || Boolean(timeError)}
      >
        {save.isPending ? 'Saqlanmoqda…' : 'Saqlash'}
      </button>
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/* Promo codes                                                                */
/* -------------------------------------------------------------------------- */

function PromoCodes({
  canManage,
  onNotice,
}: {
  canManage: boolean;
  onNotice: (n: { ok: boolean; text: string }) => void;
}) {
  const queryClient = useQueryClient();
  const [isCreating, setIsCreating] = useState(false);

  const codes = useQuery({
    queryKey: ['promo-codes'],
    queryFn: () => api.marketing.listPromoCodes({ limit: 100 }),
  });

  const toggle = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.marketing.updatePromoCode(id, { isActive }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['promo-codes'] }),
    onError: (error) =>
      onNotice({
        ok: false,
        text: error instanceof RestorApiError ? error.message : 'Oʻzgartirilmadi',
      }),
  });

  if (codes.isLoading) return <Loading />;
  if (codes.isError) {
    return <ErrorState error={codes.error} onRetry={() => void codes.refetch()} />;
  }

  const items = codes.data?.items ?? [];

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {canManage && !isCreating && (
        <button type="button" className="btn" onClick={() => setIsCreating(true)}>
          <IconPlus size={16} /> Promokod qoʻshish
        </button>
      )}

      {isCreating && (
        <PromoCodeForm
          onClose={() => setIsCreating(false)}
          onSaved={(text) => {
            setIsCreating(false);
            onNotice({ ok: true, text });
            void queryClient.invalidateQueries({ queryKey: ['promo-codes'] });
          }}
          onError={(text) => onNotice({ ok: false, text })}
        />
      )}

      {items.length === 0 ? (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            Promokod yoʻq.
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {items.map((code) => (
            <div key={code.id} className="card row" style={{ gap: 12, flexWrap: 'wrap' }}>
              <code
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  letterSpacing: 1,
                  padding: '4px 10px',
                  borderRadius: 6,
                  background: 'var(--primary-light)',
                  color: '#9A3412',
                }}
              >
                {code.code}
              </code>

              <div style={{ minWidth: 160 }}>
                <div style={{ fontSize: 14 }}>{describeCode(code)}</div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {/* Usage against the cap is the number a marketer checks. */}
                  {code.usedCount} marta ishlatilgan
                  {code.usageLimit != null ? ` / ${code.usageLimit}` : ''}
                </div>
              </div>

              <div className="spacer" />
              {canManage && (
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={toggle.isPending}
                  onClick={() => toggle.mutate({ id: code.id, isActive: !code.isActive })}
                >
                  {code.isActive ? 'Oʻchirish' : 'Yoqish'}
                </button>
              )}
              <span
                className="badge"
                style={{
                  background: code.isActive ? '#DCFCE7' : '#F3F4F6',
                  color: code.isActive ? '#166534' : '#6B7280',
                }}
              >
                {code.isActive ? 'Faol' : 'Oʻchiq'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const CODE_TYPES: Array<{ value: PromoCodeType; label: string }> = [
  { value: PromoCodeType.PERCENTAGE, label: 'Foizli' },
  { value: PromoCodeType.FIXED, label: 'Belgilangan summa' },
  { value: PromoCodeType.FREE_DELIVERY, label: 'Bepul yetkazish' },
];

function PromoCodeForm({
  onClose,
  onSaved,
  onError,
}: {
  onClose: () => void;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [code, setCode] = useState('');
  const [type, setType] = useState<PromoCodeType>(PromoCodeType.PERCENTAGE);
  const [discount, setDiscount] = useState('10');
  const [minOrderAmount, setMinOrderAmount] = useState('');
  const [usageLimit, setUsageLimit] = useState('');
  const [userLimit, setUserLimit] = useState('1');

  const isPercent = type === PromoCodeType.PERCENTAGE;
  const needsDiscount = isPercent || type === PromoCodeType.FIXED;
  const numeric = Number(discount.replace(/\D/g, '')) || 0;

  const normalised = code.trim().toUpperCase();
  const codeError =
    normalised.length > 0 && !/^[A-Z0-9_-]{3,40}$/.test(normalised)
      ? 'Kamida 3 belgi; faqat harf, raqam, - va _'
      : null;

  const discountError = needsDiscount
    ? isPercent && (numeric < 1 || numeric > 100)
      ? 'Foiz 1–100 oraligʻida boʻlishi kerak'
      : !isPercent && numeric <= 0
        ? 'Summa noldan katta boʻlishi kerak'
        : null
    : null;

  const save = useMutation({
    mutationFn: () =>
      api.marketing.createPromoCode({
        code: normalised,
        type,
        discount: needsDiscount ? numeric : 0,
        minOrderAmount: toAmount(minOrderAmount),
        usageLimit: toAmount(usageLimit),
        userLimit: toAmount(userLimit),
        isActive: true,
      }),
    onSuccess: () => onSaved(`"${normalised}" kodi yaratildi`),
    onError: (error) =>
      onError(error instanceof RestorApiError ? error.message : 'Saqlanmadi'),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (codeError || discountError || normalised.length < 3) return;
    save.mutate();
  }

  return (
    <form className="card" onSubmit={submit}>
      <div className="row" style={{ marginBottom: 14 }}>
        <h3 style={{ fontSize: 15, margin: 0 }}>Yangi promokod</h3>
        <div className="spacer" />
        <button type="button" className="btn btn--ghost" onClick={onClose}>
          Yopish
        </button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
          gap: 14,
        }}
      >
        <Field
          label="Kod"
          hint="Mijoz shu matnni kiritadi. Katta harfga oʻtkaziladi."
          error={codeError}
        >
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="SALOM10"
            style={{ ...inputStyle, letterSpacing: 1, textTransform: 'uppercase' }}
          />
        </Field>

        <Field label="Turi" hint="Chegirma maydoni turga qarab oʻzgaradi.">
          <select
            value={type}
            onChange={(e) => setType(e.target.value as PromoCodeType)}
            style={inputStyle}
          >
            {CODE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>

        {needsDiscount && (
          <Field
            label={isPercent ? 'Chegirma (%)' : 'Chegirma (soʻm)'}
            hint={isPercent ? '1 dan 100 gacha.' : 'Buyurtmadan ayriladi.'}
            error={discountError}
          >
            <input
              inputMode="numeric"
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
              style={inputStyle}
            />
          </Field>
        )}

        <Field label="Minimal buyurtma" hint="Boʻsh — cheklovsiz.">
          <input
            inputMode="numeric"
            value={minOrderAmount}
            onChange={(e) => setMinOrderAmount(e.target.value)}
            placeholder="50000"
            style={inputStyle}
          />
        </Field>

        <Field label="Jami limit" hint="Necha marta ishlatilishi mumkin. Boʻsh — cheksiz.">
          <input
            inputMode="numeric"
            value={usageLimit}
            onChange={(e) => setUsageLimit(e.target.value)}
            placeholder="100"
            style={inputStyle}
          />
        </Field>

        <Field label="Bir mijozga" hint="Bitta mijoz necha marta ishlata oladi.">
          <input
            inputMode="numeric"
            value={userLimit}
            onChange={(e) => setUserLimit(e.target.value)}
            style={inputStyle}
          />
        </Field>
      </div>

      <button
        type="submit"
        className="btn"
        style={{ marginTop: 16 }}
        disabled={save.isPending || Boolean(codeError) || Boolean(discountError)}
      >
        {save.isPending ? 'Saqlanmoqda…' : 'Saqlash'}
      </button>
    </form>
  );
}

/* -------------------------------------------------------------------------- */

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint: string;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: 'grid', gap: 4 }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
      {children}
      <span className="muted" style={{ fontSize: 12, color: error ? '#991B1B' : undefined }}>
        {error ?? hint}
      </span>
    </label>
  );
}

const inputStyle = {
  padding: '9px 12px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  fontSize: 14,
} as const;

/** Blank means "no limit"; the server stores null. */
function toAmount(value: string): number | null {
  const parsed = Number(value.replace(/\s/g, '').trim());
  if (!value.trim() || !Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed);
}

function describePromotion(promotion: Promotion): string {
  switch (promotion.type) {
    case PromotionType.PERCENTAGE_DISCOUNT:
      return `${promotion.value}% chegirma${
        promotion.maxDiscount ? `, maksimal ${formatMoney(promotion.maxDiscount)}` : ''
      }`;
    case PromotionType.FIXED_DISCOUNT:
      return `${formatMoney(promotion.value)} chegirma`;
    case PromotionType.FREE_DELIVERY:
      return 'Bepul yetkazish';
    case PromotionType.HAPPY_HOUR:
      return `Happy hour${promotion.value ? ` — ${promotion.value}%` : ''}`;
    default:
      return promotion.type;
  }
}

function describeCode(code: PromoCode): string {
  switch (code.type) {
    case PromoCodeType.PERCENTAGE:
      return `${code.discount}% chegirma`;
    case PromoCodeType.FIXED:
      return `${formatMoney(code.discount)} chegirma`;
    case PromoCodeType.FREE_DELIVERY:
      return 'Bepul yetkazish';
    default:
      return code.type;
  }
}
