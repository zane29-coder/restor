import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  PromoCodeType,
  PromotionType,
  type BranchSummary,
  type PromoCode,
  type Promotion,
} from '@restor/shared-types';
import { IconRefresh, IconSave } from '@restor/ui';
import { api, RestorApiError } from '../../lib/api';
import { WEEKDAY_SHORT } from '../../lib/labels';
import { Drawer } from '../Drawer';
import { Switch } from '../ui';
import { digits } from '../menu/CatalogManagers';

/** Blank means "no limit"; the server stores null. */
const optional = (value: string) => (value.trim() ? digits(value) || null : null);
const dayStart = (d: string) => (d ? new Date(`${d}T00:00:00`).toISOString() : null);
const dayEnd = (d: string) => (d ? new Date(`${d}T23:59:59`).toISOString() : null);
const toDay = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const PROMOTION_TYPE_LABELS: Record<string, string> = {
  PERCENTAGE_DISCOUNT: 'Foizli chegirma',
  FIXED_DISCOUNT: 'Belgilangan summa',
  FREE_DELIVERY: 'Bepul yetkazish',
  HAPPY_HOUR: 'Happy hour',
  BUY_X_GET_Y: 'X olsang — Y sovgʻa',
  COMBO: 'Kombo',
};

function BranchPicker({
  branches,
  value,
  onChange,
}: {
  branches: BranchSummary[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <div className="field">
      <span className="field__label">Filiallar</span>
      <span className="field__hint">Hech biri tanlanmasa — barcha filiallarda</span>
      <div className="row" style={{ gap: 14 }}>
        {branches.map((b) => (
          <label key={b.id} className="row" style={{ gap: 6, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={value.includes(b.id)}
              onChange={() => onChange(value.includes(b.id) ? value.filter((x) => x !== b.id) : [...value, b.id])}
            />
            {b.name}
          </label>
        ))}
      </div>
    </div>
  );
}

/**
 * Create or edit an automatic promotion.
 *
 * `value` relabels itself with the type — a percentage for one, soʻm for
 * another — because typing 50 000 into a percentage discount would take every
 * order to zero; the server refuses that combination regardless.
 */
export function PromotionForm({
  promotion,
  branches,
  happyHour,
  onClose,
  onSaved,
}: {
  promotion: Promotion | null;
  branches: BranchSummary[];
  /** Opens a new promotion preset as a time-window discount. */
  happyHour?: boolean;
  onClose: () => void;
  onSaved: (text: string) => void;
}) {
  const queryClient = useQueryClient();
  const categories = useQuery({ queryKey: ['categories', 'all'], queryFn: () => api.catalog.listCategories({ includeInactive: true }) });
  const editableTypes: PromotionType[] = [PromotionType.PERCENTAGE_DISCOUNT, PromotionType.FIXED_DISCOUNT, PromotionType.FREE_DELIVERY, PromotionType.HAPPY_HOUR];
  const [name, setName] = useState(promotion?.name ?? '');
  const [description, setDescription] = useState(promotion?.description ?? '');
  const [type, setType] = useState<PromotionType>(promotion?.type ?? (happyHour ? PromotionType.HAPPY_HOUR : PromotionType.PERCENTAGE_DISCOUNT));
  const [value, setValue] = useState(String(promotion?.value ?? 10));
  const [maxDiscount, setMaxDiscount] = useState(promotion?.maxDiscount ? String(promotion.maxDiscount) : '');
  const [minOrder, setMinOrder] = useState(promotion?.minOrderAmount ? String(promotion.minOrderAmount) : '');
  const [startsAt, setStartsAt] = useState(toDay(promotion?.startsAt));
  const [endsAt, setEndsAt] = useState(toDay(promotion?.endsAt));
  const [timeFrom, setTimeFrom] = useState(promotion?.timeFrom ?? (happyHour ? '12:00' : ''));
  const [timeTo, setTimeTo] = useState(promotion?.timeTo ?? (happyHour ? '15:00' : ''));
  const [days, setDays] = useState<number[]>(promotion?.daysOfWeek ?? (happyHour ? [1, 2, 3, 4, 5] : []));
  const [branchIds, setBranchIds] = useState<string[]>(promotion?.branchIds ?? []);
  const [categoryIds, setCategoryIds] = useState<string[]>(promotion?.categoryIds ?? []);
  const [isExclusive, setIsExclusive] = useState(promotion?.isExclusive ?? true);
  const [priority, setPriority] = useState(String(promotion?.priority ?? 0));
  const [error, setError] = useState<string | null>(null);

  const isPercent = type === PromotionType.PERCENTAGE_DISCOUNT || type === PromotionType.HAPPY_HOUR;
  const needsValue = type !== PromotionType.FREE_DELIVERY;
  const numeric = digits(value);
  const problem =
    name.trim().length < 2
      ? 'Aksiya nomini kiriting'
      : needsValue && isPercent && (numeric < 1 || numeric > 100)
        ? 'Foiz 1–100 oraligʻida boʻlishi kerak'
        : needsValue && !isPercent && numeric <= 0
          ? 'Summa noldan katta boʻlishi kerak'
          : Boolean(timeFrom) !== Boolean(timeTo)
            ? 'Vaqt oraligʻining ikkala chekkasini kiriting'
            : startsAt && endsAt && startsAt > endsAt
              ? 'Tugash sanasi boshlanishdan keyin boʻlsin'
              : null;

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        description: description.trim() || null,
        type,
        value: needsValue ? numeric : 0,
        maxDiscount: isPercent ? optional(maxDiscount) : null,
        minOrderAmount: optional(minOrder),
        startsAt: dayStart(startsAt),
        endsAt: dayEnd(endsAt),
        timeFrom: timeFrom || null,
        timeTo: timeTo || null,
        daysOfWeek: days,
        branchIds,
        categoryIds,
        priority: digits(priority),
        isExclusive,
      };
      return promotion ? api.marketing.updatePromotion(promotion.id, body) : api.marketing.createPromotion({ ...body, isActive: true });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['promotions'] });
      onSaved(promotion ? `“${name.trim()}” saqlandi` : `“${name.trim()}” aksiyasi yaratildi`);
    },
    onError: (e) => setError(e instanceof RestorApiError ? e.message : 'Saqlanmadi'),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (problem) return setError(problem);
    setError(null);
    save.mutate();
  }

  const locked = promotion && !editableTypes.includes(promotion.type);

  return (
    <Drawer
      title={promotion ? `${promotion.name} — tahrirlash` : happyHour ? 'Yangi avtomatik chegirma' : 'Yangi aksiya'}
      onClose={onClose}
      width="wide"
      footer={
        <>
          {error && <span className="field__error" style={{ flex: 1, alignSelf: 'center' }}>{error}</span>}
          <button type="button" className="btn btn--ghost" onClick={onClose}>Bekor</button>
          <button type="submit" form="promotion-form" className="btn" disabled={save.isPending}>
            <IconSave size={16} /> {save.isPending ? 'Saqlanmoqda…' : 'Saqlash'}
          </button>
        </>
      }
    >
      <form id="promotion-form" onSubmit={submit} className="stack" style={{ gap: 0 }}>
        {locked && <div className="alert alert--info">Bu turdagi aksiya (masalan, kombo) shartlari API orqali sozlanadi — bu yerda nom, muddat va filiallarni oʻzgartirish mumkin.</div>}
        <div className="form-grid">
          <div className="field">
            <label htmlFor="pr-name">Nomi</label>
            <input id="pr-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Tushlik happy hour" />
            <span className="field__hint">Mijoz chekda shu nomni koʻradi</span>
          </div>
          <div className="field">
            <label htmlFor="pr-type">Turi</label>
            <select id="pr-type" value={type} disabled={Boolean(locked)} onChange={(e) => setType(e.target.value as PromotionType)}>
              {(locked ? [promotion!.type] : editableTypes).map((t) => <option key={t} value={t}>{PROMOTION_TYPE_LABELS[t] ?? t}</option>)}
            </select>
          </div>
          {needsValue && !locked && (
            <div className="field">
              <label htmlFor="pr-value">{isPercent ? 'Chegirma (%)' : 'Chegirma (soʻm)'}</label>
              <input id="pr-value" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} />
            </div>
          )}
          {isPercent && !locked && (
            <div className="field">
              <label htmlFor="pr-max">Maksimal chegirma (soʻm)</label>
              <input id="pr-max" inputMode="numeric" value={maxDiscount} placeholder="cheklovsiz" onChange={(e) => setMaxDiscount(e.target.value)} />
            </div>
          )}
          <div className="field">
            <label htmlFor="pr-min">Minimal buyurtma (soʻm)</label>
            <input id="pr-min" inputMode="numeric" value={minOrder} placeholder="—" onChange={(e) => setMinOrder(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="pr-prio">Ustuvorlik</label>
            <input id="pr-prio" inputMode="numeric" value={priority} onChange={(e) => setPriority(e.target.value)} />
            <span className="field__hint">Kattasi birinchi tekshiriladi</span>
          </div>
        </div>
        <div className="field">
          <label htmlFor="pr-desc">Tavsif</label>
          <textarea id="pr-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Har qanday lavash va ichimlik birgalikda…" />
        </div>

        <h3 className="section-title" style={{ marginTop: 6 }}>Amal qilish muddati va vaqti</h3>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="pr-from">Boshlanish sanasi</label>
            <input id="pr-from" type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="pr-to">Tugash sanasi</label>
            <input id="pr-to" type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
            <span className="field__hint">Boʻsh — muddatsiz</span>
          </div>
          <div className="field">
            <span className="field__label">Kun ichidagi vaqt</span>
            <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
              <input type="time" value={timeFrom} onChange={(e) => setTimeFrom(e.target.value)} aria-label="Boshlanish vaqti" />
              <input type="time" value={timeTo} onChange={(e) => setTimeTo(e.target.value)} aria-label="Tugash vaqti" />
            </div>
            <span className="field__hint">Boʻsh — kun boʻyi</span>
          </div>
        </div>
        <div className="field">
          <span className="field__label">Hafta kunlari</span>
          <div className="row" style={{ gap: 6 }}>
            {[1, 2, 3, 4, 5, 6, 7].map((d) => (
              <button
                key={d}
                type="button"
                className={`pager__btn${days.includes(d) ? ' pager__btn--active' : ''}`}
                style={{ minWidth: 40 }}
                onClick={() => setDays(days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort())}
              >
                {WEEKDAY_SHORT[d]}
              </button>
            ))}
          </div>
          <span className="field__hint">Hech biri tanlanmasa — har kuni</span>
        </div>

        <h3 className="section-title" style={{ marginTop: 6 }}>Qoʻllanish doirasi</h3>
        <BranchPicker branches={branches} value={branchIds} onChange={setBranchIds} />
        <div className="field">
          <span className="field__label">Kategoriyalar</span>
          <span className="field__hint">Tanlansa — chegirma faqat shu kategoriya taomlariga</span>
          <div className="row" style={{ gap: 12 }}>
            {categories.data?.map((c) => (
              <label key={c.id} className="row" style={{ gap: 6, fontSize: 13 }}>
                <input type="checkbox" checked={categoryIds.includes(c.id)} onChange={() => setCategoryIds(categoryIds.includes(c.id) ? categoryIds.filter((x) => x !== c.id) : [...categoryIds, c.id])} />
                {c.name}
              </label>
            ))}
          </div>
        </div>
        <Switch checked={isExclusive} onChange={setIsExclusive} label="Yakka — qoʻllansa, boshqa aksiyalar qoʻshilmaydi (marjani himoya qiladi)" />
      </form>
    </Drawer>
  );
}

const CODE_TYPE_LABELS: Record<string, string> = {
  PERCENTAGE: 'Foiz (%)',
  FIXED: 'Aniq summa',
  FREE_DELIVERY: 'Bepul yetkazish',
};

function randomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

/** Create or edit a promo code. The code itself cannot change once live. */
export function PromoCodeForm({
  code,
  branches,
  onClose,
  onSaved,
}: {
  code: PromoCode | null;
  branches: BranchSummary[];
  onClose: () => void;
  onSaved: (text: string) => void;
}) {
  const queryClient = useQueryClient();
  const [text, setText] = useState(code?.code ?? '');
  const [type, setType] = useState<PromoCodeType>(code?.type ?? PromoCodeType.PERCENTAGE);
  const [discount, setDiscount] = useState(String(code?.discount ?? 10));
  const [maxDiscount, setMaxDiscount] = useState(code?.maxDiscount ? String(code.maxDiscount) : '');
  const [minOrder, setMinOrder] = useState(code?.minOrderAmount ? String(code.minOrderAmount) : '');
  const [usageLimit, setUsageLimit] = useState(code?.usageLimit ? String(code.usageLimit) : '');
  const [userLimit, setUserLimit] = useState(code?.userLimit ? String(code.userLimit) : '1');
  const [startsAt, setStartsAt] = useState(toDay(code?.startsAt));
  const [endsAt, setEndsAt] = useState(toDay(code?.endsAt));
  const [branchIds, setBranchIds] = useState<string[]>(code?.branchIds ?? []);
  const [isPublic, setIsPublic] = useState(code?.isPublic ?? false);
  const [description, setDescription] = useState(code?.description ?? '');
  const [error, setError] = useState<string | null>(null);

  const normalised = text.trim().toUpperCase();
  const isPercent = type === PromoCodeType.PERCENTAGE;
  const needsDiscount = type !== PromoCodeType.FREE_DELIVERY;
  const numeric = digits(discount);
  const problem =
    !code && !/^[A-Z0-9_-]{3,40}$/.test(normalised)
      ? 'Kod: kamida 3 belgi, faqat harf, raqam, - va _'
      : needsDiscount && isPercent && (numeric < 1 || numeric > 100)
        ? 'Foiz 1–100 oraligʻida boʻlishi kerak'
        : needsDiscount && !isPercent && numeric <= 0
          ? 'Summa noldan katta boʻlishi kerak'
          : startsAt && endsAt && startsAt > endsAt
            ? 'Tugash sanasi boshlanishdan keyin boʻlsin'
            : null;

  const save = useMutation({
    mutationFn: () => {
      const body = {
        type,
        discount: needsDiscount ? numeric : 0,
        maxDiscount: isPercent ? optional(maxDiscount) : null,
        minOrderAmount: optional(minOrder),
        usageLimit: optional(usageLimit),
        userLimit: optional(userLimit),
        startsAt: dayStart(startsAt),
        endsAt: dayEnd(endsAt),
        branchIds,
        isPublic,
        description: description.trim() || null,
      };
      return code ? api.marketing.updatePromoCode(code.id, body) : api.marketing.createPromoCode({ ...body, code: normalised, isActive: true });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['promo-codes'] });
      onSaved(code ? `${code.code}: saqlandi` : `${normalised} promokodi yaratildi`);
    },
    onError: (e) => setError(e instanceof RestorApiError ? e.message : 'Saqlanmadi'),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (problem) return setError(problem);
    setError(null);
    save.mutate();
  }

  return (
    <Drawer
      title={code ? `${code.code} — tahrirlash` : 'Yangi promokod'}
      onClose={onClose}
      footer={
        <>
          {error && <span className="field__error" style={{ flex: 1, alignSelf: 'center' }}>{error}</span>}
          <button type="button" className="btn btn--ghost" onClick={onClose}>Bekor</button>
          <button type="submit" form="promo-code-form" className="btn" disabled={save.isPending}>
            <IconSave size={16} /> {save.isPending ? 'Saqlanmoqda…' : code ? 'Saqlash' : 'Eʼlon qilish'}
          </button>
        </>
      }
    >
      <form id="promo-code-form" onSubmit={submit} className="stack" style={{ gap: 0 }}>
        <div className="field">
          <label htmlFor="pc-code">Promokod</label>
          <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
            <input
              id="pc-code"
              value={text}
              disabled={Boolean(code)}
              onChange={(e) => setText(e.target.value)}
              placeholder="KUZGI2026"
              style={{ flex: 1, letterSpacing: 1, textTransform: 'uppercase', fontWeight: 700 }}
            />
            {!code && (
              <button type="button" className="btn btn--ghost" onClick={() => setText(randomCode())}>
                <IconRefresh size={14} /> Generatsiya
              </button>
            )}
          </div>
          <span className="field__hint">{code ? 'Faol kodni oʻzgartirib boʻlmaydi — mijozlarda bor' : 'Mijoz buyurtma paytida kiritadi'}</span>
        </div>
        <div className="field">
          <span className="field__label">Chegirma turi</span>
          <div className="seg seg--quiet">
            {Object.values(PromoCodeType).map((t) => (
              <button key={t} type="button" className={`seg__btn${type === t ? ' seg__btn--active' : ''}`} onClick={() => setType(t)}>
                {CODE_TYPE_LABELS[t]}
              </button>
            ))}
          </div>
        </div>
        <div className="form-grid">
          {needsDiscount && (
            <div className="field">
              <label htmlFor="pc-disc">{isPercent ? 'Chegirma (%)' : 'Chegirma (soʻm)'}</label>
              <input id="pc-disc" inputMode="numeric" value={discount} onChange={(e) => setDiscount(e.target.value)} />
            </div>
          )}
          {isPercent && (
            <div className="field">
              <label htmlFor="pc-max">Maks. chegirma (soʻm)</label>
              <input id="pc-max" inputMode="numeric" value={maxDiscount} placeholder="cheklovsiz" onChange={(e) => setMaxDiscount(e.target.value)} />
            </div>
          )}
          <div className="field">
            <label htmlFor="pc-min">Minimal buyurtma (soʻm)</label>
            <input id="pc-min" inputMode="numeric" value={minOrder} placeholder="—" onChange={(e) => setMinOrder(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="pc-limit">Jami limit</label>
            <input id="pc-limit" inputMode="numeric" value={usageLimit} placeholder="cheksiz" onChange={(e) => setUsageLimit(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="pc-user">Bir mijozga</label>
            <input id="pc-user" inputMode="numeric" value={userLimit} onChange={(e) => setUserLimit(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="pc-from">Boshlanish</label>
            <input id="pc-from" type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="pc-to">Tugash</label>
            <input id="pc-to" type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          </div>
        </div>
        <BranchPicker branches={branches} value={branchIds} onChange={setBranchIds} />
        <Switch checked={isPublic} onChange={setIsPublic} label="Ommaviy — mijoz ilovasidagi “Promokodlar” roʻyxatida koʻrinadi" />
        {isPublic && (
          <div className="field" style={{ marginTop: 12 }}>
            <label htmlFor="pc-desc">Mijozga koʻrinadigan shart</label>
            <input id="pc-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Birinchi buyurtmaga 20% chegirma" />
          </div>
        )}
      </form>
    </Drawer>
  );
}
