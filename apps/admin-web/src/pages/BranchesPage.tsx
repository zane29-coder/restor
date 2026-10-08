import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Permission, type Branch } from '@restor/shared-types';
import { formatMoney, formatPhone } from '@restor/shared-utils';
import { api, RestorApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Drawer } from '../components/Drawer';
import { ErrorState, Empty, Loading, Notice } from '../components/States';

/** Branch list and delivery settings (TZ §8, §11). */
export function BranchesPage() {
  const { can } = useAuth();
  const [editing, setEditing] = useState<Branch | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const branches = useQuery({
    queryKey: ['branches'],
    queryFn: () => api.branches.list({ limit: 100 }),
  });

  if (branches.isLoading) return <Loading />;
  if (branches.isError) {
    return <ErrorState error={branches.error} onRetry={() => void branches.refetch()} />;
  }

  const items = branches.data?.items ?? [];
  if (items.length === 0) {
    return <Empty title="Filial yoʻq" description="Birinchi filialni qoʻshing." />;
  }

  const canManage = can(Permission.BRANCHES_UPDATE);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {notice && <Notice notice={notice} onClose={() => setNotice(null)} />}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
          gap: 14,
        }}
      >
        {items.map((branch) => (
          <div key={branch.id} className="card">
            <div className="row" style={{ marginBottom: 10 }}>
              <h2 style={{ fontSize: 16, margin: 0 }}>{branch.name}</h2>
              <div className="spacer" />
              <span
                className="badge"
                style={{
                  background: branch.isOpenNow ? '#DCFCE7' : '#FEE2E2',
                  color: branch.isOpenNow ? '#166534' : '#991B1B',
                }}
              >
                {branch.isOpenNow ? 'Ochiq' : 'Yopiq'}
              </span>
            </div>

            <p className="muted" style={{ margin: '0 0 4px' }}>{branch.address}</p>
            {branch.phone && (
              <p className="muted" style={{ margin: '0 0 12px' }}>{formatPhone(branch.phone)}</p>
            )}

            <dl style={{ display: 'grid', gap: 5, margin: 0 }}>
              <Row label="Minimal buyurtma" value={formatMoney(branch.minOrderAmount)} />
              <Row label="Yetkazish" value={deliverySummary(branch)} />
              <Row label="Radius" value={km(branch.deliveryRadiusM)} />
              {branch.freeDeliveryRadiusM != null && (
                <Row label="Bepul zona" value={km(branch.freeDeliveryRadiusM)} />
              )}
              {branch.freeDeliveryFrom != null && (
                <Row label="Bepul (summadan)" value={formatMoney(branch.freeDeliveryFrom)} />
              )}
              <Row label="Tayyorlash" value={`${branch.averagePrepMinutes} min`} />
            </dl>

            <div className="row" style={{ marginTop: 12, gap: 6 }}>
              {branch.acceptsDelivery && <span className="badge" style={tone}>Yetkazish</span>}
              {branch.acceptsPickup && <span className="badge" style={tone}>Olib ketish</span>}
              {branch.acceptsDineIn && <span className="badge" style={tone}>Zalda</span>}
            </div>

            {branch.workingHours.length > 0 && (
              <details style={{ marginTop: 12 }}>
                <summary className="muted" style={{ cursor: 'pointer', fontSize: 13 }}>
                  Ish vaqti
                </summary>
                <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13 }}>
                  {branch.workingHours.map((hours) => (
                    <li key={hours.id} className="muted">
                      {WEEKDAYS[hours.dayOfWeek - 1]}:{' '}
                      {hours.isClosed ? 'yopiq' : `${hours.opensAt}–${hours.closesAt}`}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {canManage && (
              <button
                type="button"
                className="btn btn--ghost"
                style={{ marginTop: 14, width: '100%' }}
                onClick={() => {
                  setNotice(null);
                  setEditing(branch);
                }}
              >
                Yetkazish sozlamalari
              </button>
            )}
          </div>
        ))}
      </div>

      {editing && (
        <DeliverySettings
          branch={editing}
          onClose={() => setEditing(null)}
          onSaved={(text) => {
            setEditing(null);
            setNotice({ ok: true, text });
          }}
          onError={(text) => setNotice({ ok: false, text })}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Delivery charge rules (TZ §11).
 *
 * The three settings restaurants actually ask for: deliver free, deliver free
 * nearby, and deliver only within a radius. They combine, so the form shows a
 * worked example underneath rather than making the manager reason about the
 * interaction in their head.
 */
function DeliverySettings({
  branch,
  onClose,
  onSaved,
  onError,
}: {
  branch: Branch;
  onClose: () => void;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}) {
  const queryClient = useQueryClient();

  // Metres in the database, kilometres in the form: nobody types "5000 m".
  const [radiusKm, setRadiusKm] = useState(toKm(branch.deliveryRadiusM));
  const [freeRadiusKm, setFreeRadiusKm] = useState(toKm(branch.freeDeliveryRadiusM));
  const [price, setPrice] = useState(String(branch.deliveryPrice));
  const [perKm, setPerKm] = useState(branch.deliveryPricePerKm?.toString() ?? '');
  const [freeFrom, setFreeFrom] = useState(branch.freeDeliveryFrom?.toString() ?? '');
  const [minOrder, setMinOrder] = useState(String(branch.minOrderAmount));

  const payload = {
    deliveryRadiusM: toMetres(radiusKm),
    freeDeliveryRadiusM: toMetres(freeRadiusKm),
    deliveryPrice: toAmount(price) ?? 0,
    deliveryPricePerKm: toAmount(perKm),
    freeDeliveryFrom: toAmount(freeFrom),
    minOrderAmount: toAmount(minOrder) ?? 0,
  };

  const radiusConflict =
    payload.freeDeliveryRadiusM != null &&
    payload.deliveryRadiusM != null &&
    payload.freeDeliveryRadiusM > payload.deliveryRadiusM;

  const needsCoordinates =
    (payload.deliveryRadiusM != null || payload.freeDeliveryRadiusM != null) &&
    branch.latitude == null;

  const save = useMutation({
    mutationFn: () => api.branches.update(branch.id, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['branches'] });
      onSaved(`${branch.name}: yetkazish sozlamalari saqlandi`);
    },
    onError: (error) =>
      onError(error instanceof RestorApiError ? error.message : 'Saqlanmadi'),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (radiusConflict || needsCoordinates) return;
    save.mutate();
  }

  return (
    <Drawer title={`${branch.name} — yetkazish`} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="muted" style={{ fontSize: 13, margin: '0 0 16px' }}>
          Boʻsh qoldirilgan maydon — qoida ishlatilmaydi.
        </p>

        {/* The page notice sits behind the drawer; show a failed save here too. */}
        {save.isError && (
          <div className="alert alert--error">
            {save.error instanceof RestorApiError ? save.error.message : 'Saqlanmadi'}
          </div>
        )}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 14,
          }}
        >
          <Field
            label="Yetkazish radiusi (km)"
            hint="Bundan uzoqqa buyurtma qabul qilinmaydi. Boʻsh — cheklovsiz."
            value={radiusKm}
            onChange={setRadiusKm}
            placeholder="5"
          />
          <Field
            label="Bepul zona (km)"
            hint="Shu masofagacha yetkazish bepul."
            value={freeRadiusKm}
            onChange={setFreeRadiusKm}
            placeholder="1"
          />
          <Field
            label="Yetkazish narxi"
            hint="Bepul zonadan tashqarida olinadi. 0 — har doim bepul."
            value={price}
            onChange={setPrice}
            placeholder="15000"
          />
          <Field
            label="Har km uchun qoʻshimcha"
            hint="Bepul zona chekkasidan boshlab, har boshlangan km uchun."
            value={perKm}
            onChange={setPerKm}
            placeholder="3000"
          />
          <Field
            label="Shu summadan bepul"
            hint="Buyurtma shu summaga yetsa, masofadan qatʼi nazar bepul."
            value={freeFrom}
            onChange={setFreeFrom}
            placeholder="150000"
          />
          <Field
            label="Minimal buyurtma"
            hint="Bundan kam buyurtma uchun ogohlantirish chiqadi."
            value={minOrder}
            onChange={setMinOrder}
            placeholder="50000"
          />
        </div>

        {needsCoordinates && (
          <p style={{ color: '#991B1B', fontSize: 13, marginTop: 14 }}>
            Radius ishlashi uchun filialga koordinata kiritilishi kerak.
          </p>
        )}
        {radiusConflict && (
          <p style={{ color: '#991B1B', fontSize: 13, marginTop: 14 }}>
            Bepul zona yetkazish radiusidan katta boʻlishi mumkin emas.
          </p>
        )}

        <Preview {...payload} />

        <button
          type="submit"
          className="btn"
          style={{ marginTop: 16 }}
          disabled={save.isPending || radiusConflict || needsCoordinates}
        >
          {save.isPending ? 'Saqlanmoqda…' : 'Saqlash'}
        </button>
      </form>
    </Drawer>
  );
}

/**
 * What a customer would be charged at a few distances.
 *
 * Mirrors the server's rules rather than calling it: this is a preview of an
 * unsaved form. The server remains the only authority on the real price — it
 * re-prices every order from the menu regardless of what any client says.
 */
function Preview({
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

  function feeAt(distanceM: number): number {
    if (freeDeliveryFrom != null && basket >= freeDeliveryFrom) return 0;
    if (freeDeliveryRadiusM != null && distanceM <= freeDeliveryRadiusM) return 0;
    if (deliveryPricePerKm == null) return deliveryPrice;
    const chargeableKm = Math.ceil(Math.max(0, distanceM - (freeDeliveryRadiusM ?? 0)) / 1000);
    return deliveryPrice + deliveryPricePerKm * chargeableKm;
  }

  return (
    <div
      style={{
        marginTop: 16,
        padding: 14,
        borderRadius: 10,
        background: 'var(--bg, #F9FAFB)',
        border: '1px solid var(--border)',
      }}
    >
      <p className="muted" style={{ fontSize: 12, margin: '0 0 8px', letterSpacing: 0.4 }}>
        {formatMoney(basket)} LIK BUYURTMA UCHUN
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18 }}>
        {[500, 2000, 5000].map((distanceM) => (
          <div key={distanceM}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>
              {feeAt(distanceM) === 0 ? 'Bepul' : formatMoney(feeAt(distanceM))}
            </div>
            <div className="muted" style={{ fontSize: 12 }}>{distanceM / 1000} km</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label style={{ display: 'grid', gap: 4 }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        style={{
          padding: '9px 12px',
          borderRadius: 8,
          border: '1px solid var(--border)',
          fontSize: 14,
        }}
      />
      <span className="muted" style={{ fontSize: 12 }}>{hint}</span>
    </label>
  );
}

/* -------------------------------------------------------------------------- */

const WEEKDAYS = ['Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba', 'Yakshanba'];

const tone = { background: 'var(--primary-light)', color: '#9A3412' } as const;

/** One line summarising how this branch charges, for the card. */
function deliverySummary(branch: Branch): string {
  if (branch.deliveryPrice === 0 && branch.deliveryPricePerKm == null) return 'Bepul';

  const base = formatMoney(branch.deliveryPrice);
  if (branch.deliveryPricePerKm == null) return base;
  return `${base} + ${formatMoney(branch.deliveryPricePerKm)}/km`;
}

function km(metres: number | null): string {
  return metres == null ? '—' : `${(metres / 1000).toFixed(1)} km`;
}

function toKm(metres: number | null): string {
  return metres == null ? '' : String(metres / 1000);
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between' }}>
      <dt className="muted">{label}</dt>
      <dd style={{ margin: 0 }}>{value}</dd>
    </div>
  );
}
