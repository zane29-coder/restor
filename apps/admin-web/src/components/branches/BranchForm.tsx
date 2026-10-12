import { useEffect, useState, type FormEvent } from 'react';
import L from 'leaflet';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Branch, BranchWorkingHours, Weekday } from '@restor/shared-types';
import { formatMoney } from '@restor/shared-utils';
import { IconSave } from '@restor/ui';
import { api, RestorApiError } from '../../lib/api';
import { Drawer } from '../Drawer';
import { Switch } from '../ui';
import { DEFAULT_CENTER, LeafletMap, dotIcon } from '../map/LeafletMap';

const WEEKDAYS = ['Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba', 'Yakshanba'];

type Hours = Omit<BranchWorkingHours, 'id' | 'branchId'>;

function defaultHours(): Hours[] {
  return [1, 2, 3, 4, 5, 6, 7].map((d) => ({ dayOfWeek: d as Weekday, opensAt: '09:00', closesAt: '23:00', isClosed: false }));
}

/** Kilometres in the form, metres in the database. Blank means "no rule". */
function toMetres(value: string): number | null {
  const parsed = Number(value.replace(',', '.').trim());
  if (!value.trim() || !Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed * 1000);
}

/** Blank means "no rule"; zero is a real amount and must survive. */
function toAmount(value: string): number | null {
  const parsed = Number(value.replace(/\s/g, '').trim());
  if (!value.trim() || !Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed);
}

const km = (metres: number | null | undefined) => (metres == null ? '' : String(metres / 1000));
const str = (n: number | null | undefined) => (n == null ? '' : String(n));

/**
 * Create a branch or change any of its settings (TZ §8, §11).
 *
 * One form in sections rather than several dialogs: opening a branch means
 * setting all of it at once, and a later change is usually "hours and the
 * delivery price together".
 */
export function BranchForm({
  branch,
  section,
  onClose,
  onSaved,
}: {
  /** `null` creates a new branch. */
  branch: Branch | null;
  /** Scroll to this part on open, e.g. "hours" from the card's button. */
  section?: 'hours' | 'delivery';
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(branch?.name ?? '');
  const [address, setAddress] = useState(branch?.address ?? '');
  const [phone, setPhone] = useState(branch?.phone ?? '');
  const [point, setPoint] = useState<[number, number] | null>(
    branch?.latitude != null && branch.longitude != null ? [branch.latitude, branch.longitude] : null,
  );
  const [acceptsDelivery, setAcceptsDelivery] = useState(branch?.acceptsDelivery ?? true);
  const [acceptsPickup, setAcceptsPickup] = useState(branch?.acceptsPickup ?? true);
  const [acceptsDineIn, setAcceptsDineIn] = useState(branch?.acceptsDineIn ?? false);
  const [prep, setPrep] = useState(str(branch?.averagePrepMinutes ?? 20));
  const [target, setTarget] = useState(str(branch?.dailyRevenueTarget));
  const [radiusKm, setRadiusKm] = useState(km(branch?.deliveryRadiusM));
  const [freeRadiusKm, setFreeRadiusKm] = useState(km(branch?.freeDeliveryRadiusM));
  const [price, setPrice] = useState(str(branch?.deliveryPrice ?? 0));
  const [perKm, setPerKm] = useState(str(branch?.deliveryPricePerKm));
  const [freeFrom, setFreeFrom] = useState(str(branch?.freeDeliveryFrom));
  const [minOrder, setMinOrder] = useState(str(branch?.minOrderAmount ?? 0));
  const [hours, setHours] = useState<Hours[]>(() => {
    const base = defaultHours();
    for (const h of branch?.workingHours ?? []) {
      base[h.dayOfWeek - 1] = { dayOfWeek: h.dayOfWeek, opensAt: h.opensAt, closesAt: h.closesAt, isClosed: h.isClosed };
    }
    return base;
  });
  const [isActive, setIsActive] = useState(branch?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (section) document.getElementById(`branch-${section}`)?.scrollIntoView({ block: 'start' });
  }, [section]);

  const delivery = {
    deliveryRadiusM: toMetres(radiusKm),
    freeDeliveryRadiusM: toMetres(freeRadiusKm),
    deliveryPrice: toAmount(price) ?? 0,
    deliveryPricePerKm: toAmount(perKm) || null,
    freeDeliveryFrom: toAmount(freeFrom) || null,
    minOrderAmount: toAmount(minOrder) ?? 0,
  };

  const problem =
    name.trim().length < 2
      ? 'Filial nomini kiriting'
      : address.trim().length < 5
        ? 'Manzilni toʻliqroq kiriting'
        : (delivery.deliveryRadiusM != null || delivery.freeDeliveryRadiusM != null) && !point
          ? 'Radius ishlashi uchun xaritada filial joyini belgilang'
          : delivery.freeDeliveryRadiusM != null && delivery.deliveryRadiusM != null && delivery.freeDeliveryRadiusM > delivery.deliveryRadiusM
            ? 'Bepul zona yetkazish radiusidan katta boʻlishi mumkin emas'
            : hours.some((h) => !h.isClosed && h.opensAt === h.closesAt)
              ? 'Ochilish va yopilish vaqti bir xil boʻlmasligi kerak'
              : null;

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        address: address.trim(),
        phone: phone.trim() || undefined,
        ...(point ? { latitude: point[0], longitude: point[1] } : {}),
        ...delivery,
        averagePrepMinutes: Number(prep) || 20,
        dailyRevenueTarget: toAmount(target) || null,
        acceptsDelivery,
        acceptsPickup,
        acceptsDineIn,
        workingHours: hours,
      };
      return branch ? api.branches.update(branch.id, { ...body, isActive }) : api.branches.create(body);
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ['branches'] });
      void queryClient.invalidateQueries({ queryKey: ['reports', 'branches'] });
      onSaved(branch ? `${saved.name}: sozlamalar saqlandi` : `${saved.name} filiali qoʻshildi`);
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
      title={branch ? `${branch.name} — sozlamalar` : 'Yangi filial'}
      onClose={onClose}
      width="wide"
      footer={
        <>
          {error && <span className="field__error" style={{ flex: 1, alignSelf: 'center' }}>{error}</span>}
          <button type="button" className="btn btn--ghost" onClick={onClose}>Bekor</button>
          <button type="submit" form="branch-form" className="btn" disabled={save.isPending}>
            <IconSave size={16} />
            {save.isPending ? 'Saqlanmoqda…' : branch ? 'Saqlash' : 'Filialni qoʻshish'}
          </button>
        </>
      }
    >
      <form id="branch-form" onSubmit={submit} className="stack" style={{ gap: 22 }}>
        <section className="stack">
          <h3 className="section-title">Asosiy maʼlumotlar</h3>
          <div className="form-grid">
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="b-name">Nomi</label>
              <input id="b-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Chilonzor" />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="b-phone">Telefon</label>
              <input id="b-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+998 71 200 45 67" />
            </div>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="b-address">Manzil</label>
            <input id="b-address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Chilonzor 9-mavze, 24-uy" />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <span className="field__label">Xaritadagi joyi</span>
            <PointPicker point={point} onChange={setPoint} />
            <span className="field__hint">
              {point ? `${point[0].toFixed(5)}, ${point[1].toFixed(5)} — markerni sudrab aniqlashtiring` : 'Xaritaga bosib filial joyini belgilang'}
            </span>
          </div>
          {branch && <Switch checked={isActive} onChange={setIsActive} label="Buyurtma qabul qilish (faol)" />}
        </section>

        <section className="stack">
          <h3 className="section-title">Xizmat turlari</h3>
          <div className="row" style={{ gap: 18 }}>
            <Switch checked={acceptsDelivery} onChange={setAcceptsDelivery} label="Yetkazib berish" />
            <Switch checked={acceptsPickup} onChange={setAcceptsPickup} label="Olib ketish" />
            <Switch checked={acceptsDineIn} onChange={setAcceptsDineIn} label="Zalda / QR stol" />
          </div>
          <div className="form-grid">
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="b-prep">Oʻrtacha tayyorlash (daq)</label>
              <input id="b-prep" inputMode="numeric" value={prep} onChange={(e) => setPrep(e.target.value)} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="b-target">Kunlik tushum rejasi (soʻm)</label>
              <input id="b-target" inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Masalan 20 000 000" />
              <span className="field__hint">Dashboarddagi filiallar reytingida koʻrinadi</span>
            </div>
          </div>
        </section>

        <section className="stack" id="branch-delivery">
          <h3 className="section-title">Yetkazish narxi</h3>
          <p className="muted" style={{ fontSize: 12.5 }}>
            Boʻsh qoldirilgan maydon — qoida ishlatilmaydi. Xaritada zona chizilgan boʻlsa, zonalar radius oʻrniga amal qiladi.
          </p>
          <div className="form-grid">
            <NumberField id="b-radius" label="Yetkazish radiusi (km)" hint="Bundan uzoqqa qabul qilinmaydi" value={radiusKm} onChange={setRadiusKm} placeholder="5" />
            <NumberField id="b-free-radius" label="Bepul zona (km)" hint="Shu masofagacha bepul" value={freeRadiusKm} onChange={setFreeRadiusKm} placeholder="1" />
            <NumberField id="b-price" label="Yetkazish narxi" hint="0 — har doim bepul" value={price} onChange={setPrice} placeholder="10000" />
            <NumberField id="b-perkm" label="Har km uchun qoʻshimcha" hint="Bepul zona chekkasidan" value={perKm} onChange={setPerKm} placeholder="3000" />
            <NumberField id="b-free-from" label="Shu summadan bepul" hint="Masofadan qatʼi nazar" value={freeFrom} onChange={setFreeFrom} placeholder="150000" />
            <NumberField id="b-min" label="Minimal buyurtma" hint="Yetkazish uchun" value={minOrder} onChange={setMinOrder} placeholder="40000" />
          </div>
          <FeePreview {...delivery} />
        </section>

        <section className="stack" id="branch-hours">
          <h3 className="section-title">Ish vaqti</h3>
          <div className="stack" style={{ gap: 6 }}>
            {hours.map((h, i) => (
              <div key={h.dayOfWeek} className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
                <span style={{ width: 96, fontWeight: 600, fontSize: 13 }}>{WEEKDAYS[i]}</span>
                <input
                  type="time"
                  value={h.opensAt}
                  disabled={h.isClosed}
                  aria-label={`${WEEKDAYS[i]} ochilish`}
                  onChange={(e) => setHours(hours.map((x, j) => (j === i ? { ...x, opensAt: e.target.value } : x)))}
                />
                <span className="muted">—</span>
                <input
                  type="time"
                  value={h.closesAt}
                  disabled={h.isClosed}
                  aria-label={`${WEEKDAYS[i]} yopilish`}
                  onChange={(e) => setHours(hours.map((x, j) => (j === i ? { ...x, closesAt: e.target.value } : x)))}
                />
                <Switch
                  checked={!h.isClosed}
                  onChange={(open) => setHours(hours.map((x, j) => (j === i ? { ...x, isClosed: !open } : x)))}
                  label={h.isClosed ? 'Dam olish' : 'Ochiq'}
                />
              </div>
            ))}
          </div>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            style={{ justifySelf: 'start' }}
            onClick={() => setHours(hours.map((x) => ({ ...x, opensAt: hours[0]!.opensAt, closesAt: hours[0]!.closesAt })))}
          >
            Dushanba vaqtini hamma kunlarga qoʻllash
          </button>
          <p className="field__hint">Yarim tundan keyin yopilsa (masalan 10:00 — 02:00) shunday kiriting — tizim ertasi kunga oʻtkazadi.</p>
        </section>
      </form>
    </Drawer>
  );
}

function NumberField({
  id,
  label,
  hint,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="field" style={{ margin: 0 }}>
      <label htmlFor={id}>{label}</label>
      <input id={id} inputMode="decimal" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      <span className="field__hint">{hint}</span>
    </div>
  );
}

/**
 * What a customer would be charged at a few distances.
 *
 * Mirrors the server's rules rather than calling it: this previews an unsaved
 * form. The server remains the only authority on the real price — it
 * re-prices every order from the menu regardless of what any client says.
 */
function FeePreview({
  deliveryPrice,
  freeDeliveryRadiusM,
  freeDeliveryFrom,
  deliveryPricePerKm,
}: {
  deliveryPrice: number;
  freeDeliveryRadiusM: number | null;
  freeDeliveryFrom: number | null;
  deliveryPricePerKm: number | null;
}) {
  const basket = 60_000;
  const feeAt = (distanceM: number) => {
    if (freeDeliveryFrom != null && basket >= freeDeliveryFrom) return 0;
    if (freeDeliveryRadiusM != null && distanceM <= freeDeliveryRadiusM) return 0;
    if (deliveryPricePerKm == null) return deliveryPrice;
    return deliveryPrice + deliveryPricePerKm * Math.ceil(Math.max(0, distanceM - (freeDeliveryRadiusM ?? 0)) / 1000);
  };
  return (
    <div className="soft-box">
      <div className="section-title" style={{ marginBottom: 8 }}>{formatMoney(basket, 'UZS', { withCurrency: false })} soʻmlik buyurtma uchun</div>
      <div className="row" style={{ gap: 24 }}>
        {[500, 2000, 5000].map((d) => (
          <div key={d}>
            <div className="strong num">{feeAt(d) === 0 ? 'Bepul' : `${formatMoney(feeAt(d), 'UZS', { withCurrency: false })} soʻm`}</div>
            <div className="cell-sub">{d / 1000} km</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Click to place the branch, drag to refine. */
function PointPicker({ point, onChange }: { point: [number, number] | null; onChange: (p: [number, number]) => void }) {
  return (
    <LeafletMap
      center={point ?? DEFAULT_CENTER}
      zoom={point ? 15 : 12}
      height={260}
      onReady={(map) => {
        let marker: L.Marker | null = null;
        const place = (p: [number, number]) => {
          if (!marker) {
            marker = L.marker(p, { draggable: true, icon: dotIcon('#ff6b00', undefined, 20) }).addTo(map);
            marker.on('dragend', () => {
              const ll = marker!.getLatLng();
              onChange([round(ll.lat), round(ll.lng)]);
            });
          } else marker.setLatLng(p);
        };
        if (point) place(point);
        map.on('click', (e: L.LeafletMouseEvent) => {
          const p: [number, number] = [round(e.latlng.lat), round(e.latlng.lng)];
          place(p);
          onChange(p);
        });
      }}
    />
  );
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
