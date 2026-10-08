import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Permission,
  StockMovementType,
  StockUnit,
  type StockItem,
} from '@restor/shared-types';
import { formatMoney } from '@restor/shared-utils';
import { IconPlus } from '@restor/ui';
import { api, RestorApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ErrorState, Loading, Notice } from '../components/States';

type Tab = 'stock' | 'movements' | 'suppliers';

/**
 * Inventory (TZ §29-§31).
 *
 * The shape of this screen follows the one rule the module is built on: a
 * level moves only through a movement. There is no editable quantity field
 * anywhere here — correcting a count is an adjustment with a reason, which is
 * the honest way to record that the shelf disagreed with the books.
 */
export function InventoryPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>('stock');
  const [branchId, setBranchId] = useState('');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const branches = useQuery({
    queryKey: ['branches', 'summary'],
    queryFn: () => api.branches.summaries(),
  });

  const summary = useQuery({
    queryKey: ['stock', 'summary', branchId],
    queryFn: () => api.inventory.summary(branchId || undefined),
  });

  const canManage = can(Permission.INVENTORY_MANAGE);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {notice && <Notice notice={notice} onClose={() => setNotice(null)} />}

      {summary.data && (
        <div style={cardGrid}>
          <Stat label="Mahsulotlar" value={String(summary.data.itemsCount)} />
          <Stat
            label="Tugayapti"
            value={String(summary.data.lowCount)}
            tone={summary.data.lowCount > 0 ? 'warn' : undefined}
          />
          <Stat label="Ombor qiymati" value={formatMoney(summary.data.totalValue)} />
          <Stat
            label="30 kunlik yaroqsiz"
            value={formatMoney(summary.data.wasteValue)}
            tone={summary.data.wasteValue > 0 ? 'bad' : undefined}
          />
        </div>
      )}

      {summary.data && summary.data.lowItems.length > 0 && (
        <div className="card" style={{ borderColor: '#FDE68A', background: '#FFFBEB' }}>
          <h3 style={{ fontSize: 14, margin: '0 0 10px' }}>
            Buyurtma berish kerak <span className="muted">({summary.data.lowCount})</span>
          </h3>
          <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
            {summary.data.lowItems.slice(0, 12).map((item) => (
              <span key={item.id} style={{ fontSize: 13 }}>
                <strong>{item.name}</strong>{' '}
                <span style={{ color: '#B45309' }}>
                  {item.quantity} {UNIT_LABEL[item.unit]}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <select value={branchId} onChange={(e) => setBranchId(e.target.value)} style={control}>
          <option value="">Barcha filiallar</option>
          {branches.data?.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name}
            </option>
          ))}
        </select>

        <div className="spacer" />

        {(
          [
            ['stock', 'Ombor'],
            ['movements', 'Harakatlar'],
            ['suppliers', 'Yetkazib beruvchilar'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={tab === key ? 'btn' : 'btn btn--ghost'}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'stock' && (
        <StockTab
          branchId={branchId}
          branches={branches.data ?? []}
          canManage={canManage}
          onNotice={setNotice}
        />
      )}
      {tab === 'movements' && <MovementsTab branchId={branchId} />}
      {tab === 'suppliers' && <SuppliersTab canManage={canManage} onNotice={setNotice} />}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function StockTab({
  branchId,
  branches,
  canManage,
  onNotice,
}: {
  branchId: string;
  branches: Array<{ id: string; name: string }>;
  canManage: boolean;
  onNotice: (n: { ok: boolean; text: string }) => void;
}) {
  const queryClient = useQueryClient();
  const [isCreating, setIsCreating] = useState(false);
  const [moving, setMoving] = useState<StockItem | null>(null);

  const items = useQuery({
    queryKey: ['stock', 'items', branchId],
    queryFn: () => api.inventory.listItems({ branchId: branchId || undefined }),
  });

  if (items.isLoading) return <Loading />;
  if (items.isError) {
    return <ErrorState error={items.error} onRetry={() => void items.refetch()} />;
  }

  const rows = items.data ?? [];
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['stock'] });
  };

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {canManage && !isCreating && (
        <button type="button" className="btn" style={{ justifySelf: 'start' }} onClick={() => setIsCreating(true)}>
          <IconPlus size={16} /> Mahsulot qoʻshish
        </button>
      )}

      {isCreating && (
        <CreateItemForm
          branches={branches}
          defaultBranchId={branchId}
          onCancel={() => setIsCreating(false)}
          onSaved={(text) => {
            setIsCreating(false);
            onNotice({ ok: true, text });
            refresh();
          }}
          onError={(text) => onNotice({ ok: false, text })}
        />
      )}

      {moving && (
        <MovementForm
          item={moving}
          onClose={() => setMoving(null)}
          onSaved={(text) => {
            setMoving(null);
            onNotice({ ok: true, text });
            refresh();
          }}
          onError={(text) => onNotice({ ok: false, text })}
        />
      )}

      {rows.length === 0 ? (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            Ombor boʻsh. Mahsulot qoʻshing — keyin uni taomlar retseptiga
            ulasangiz, sotuvdan avtomatik hisobdan chiqadi.
          </p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nomi</th>
                <th>Filial</th>
                <th>Qoldiq</th>
                <th>Chegara</th>
                <th>Narxi</th>
                <th>Qiymati</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => (
                <tr key={item.id} style={item.isLow ? { background: '#FFFBEB' } : undefined}>
                  <td>
                    <strong>{item.name}</strong>
                    {item.isLow && (
                      <span
                        className="badge"
                        style={{ background: '#FEF3C7', color: '#B45309', marginLeft: 8 }}
                      >
                        tugayapti
                      </span>
                    )}
                  </td>
                  <td className="muted">{item.branchName ?? '—'}</td>
                  <td>
                    <strong>{item.quantity}</strong>{' '}
                    <span className="muted">{UNIT_LABEL[item.unit]}</span>
                  </td>
                  <td className="muted">{item.minQuantity ?? '—'}</td>
                  <td>{formatMoney(item.costPerUnit)}</td>
                  <td>{formatMoney(item.stockValue)}</td>
                  <td>
                    {canManage && (
                      <button
                        type="button"
                        className="btn btn--ghost"
                        style={smallBtn}
                        onClick={() => setMoving(item)}
                      >
                        Harakat
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Recording a movement.
 *
 * Consumption is absent from the list on purpose: it is written when an order
 * completes, and a button for it here would let anyone make stock disappear
 * with no sale behind it.
 */
function MovementForm({
  item,
  onClose,
  onSaved,
  onError,
}: {
  item: StockItem;
  onClose: () => void;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [type, setType] = useState<StockMovementType>(StockMovementType.RECEIPT);
  const [quantity, setQuantity] = useState('');
  const [costPerUnit, setCostPerUnit] = useState(String(item.costPerUnit));
  const [supplierId, setSupplierId] = useState('');
  const [comment, setComment] = useState('');

  const suppliers = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => api.inventory.listSuppliers(),
  });

  const amount = Number(quantity.replace(',', '.')) || 0;
  const isAdjustment = type === StockMovementType.ADJUSTMENT;
  const isReceipt = type === StockMovementType.RECEIPT;

  const error =
    amount === 0
      ? 'Miqdor kiriting'
      : !isAdjustment && amount < 0
        ? 'Miqdor musbat boʻlishi kerak'
        : isAdjustment && comment.trim().length === 0
          ? 'Tuzatish sababini yozing'
          : null;

  const save = useMutation({
    mutationFn: () =>
      api.inventory.addMovement({
        stockItemId: item.id,
        type,
        quantity: amount,
        ...(isReceipt && costPerUnit ? { costPerUnit: digits(costPerUnit) } : {}),
        ...(isReceipt && supplierId ? { supplierId } : {}),
        ...(comment.trim() ? { comment: comment.trim() } : {}),
      }),
    onSuccess: () => onSaved(`${item.name}: ${MOVEMENT_LABEL[type]} yozildi`),
    onError: (caught) =>
      onError(caught instanceof RestorApiError ? caught.message : 'Saqlanmadi'),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (error) return;
    save.mutate();
  }

  return (
    <form className="card" onSubmit={submit}>
      <div className="row" style={{ marginBottom: 4 }}>
        <h3 style={{ fontSize: 15, margin: 0 }}>{item.name}</h3>
        <div className="spacer" />
        <button type="button" className="btn btn--ghost" onClick={onClose}>
          Yopish
        </button>
      </div>
      <p className="muted" style={{ fontSize: 13, margin: '0 0 14px' }}>
        Hozirgi qoldiq: <strong>{item.quantity} {UNIT_LABEL[item.unit]}</strong>
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14 }}>
        <Labelled label="Turi">
          <select
            value={type}
            onChange={(e) => setType(e.target.value as StockMovementType)}
            style={field}
          >
            {MANUAL_TYPES.map((value) => (
              <option key={value} value={value}>
                {MOVEMENT_LABEL[value]}
              </option>
            ))}
          </select>
        </Labelled>

        <Labelled
          label={`Miqdor (${UNIT_LABEL[item.unit]})`}
          hint={isAdjustment ? 'Kamaytirish uchun minus bilan: -3' : undefined}
          error={error && error.includes('Miqdor') ? error : null}
        >
          <input
            inputMode="decimal"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder={isAdjustment ? '-3' : '5'}
            style={field}
          />
        </Labelled>

        {isReceipt && (
          <>
            <Labelled label="1 birlik narxi" hint="Ombor qiymati shu boʻyicha hisoblanadi">
              <input
                inputMode="numeric"
                value={costPerUnit}
                onChange={(e) => setCostPerUnit(e.target.value)}
                style={field}
              />
            </Labelled>
            <Labelled label="Yetkazib beruvchi" hint="Ixtiyoriy">
              <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} style={field}>
                <option value="">—</option>
                {(suppliers.data ?? []).filter((s) => s.isActive).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </Labelled>
          </>
        )}

        <Labelled
          label="Izoh"
          hint={isAdjustment ? 'Majburiy — nega farq chiqdi' : 'Ixtiyoriy'}
          error={error && error.includes('sabab') ? error : null}
        >
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={isAdjustment ? 'Inventarizatsiya' : '—'}
            style={field}
          />
        </Labelled>
      </div>

      <button type="submit" className="btn" style={{ marginTop: 16 }} disabled={Boolean(error) || save.isPending}>
        {save.isPending ? 'Saqlanmoqda…' : 'Yozish'}
      </button>
    </form>
  );
}

function CreateItemForm({
  branches,
  defaultBranchId,
  onCancel,
  onSaved,
  onError,
}: {
  branches: Array<{ id: string; name: string }>;
  defaultBranchId: string;
  onCancel: () => void;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [branchId, setBranchId] = useState(defaultBranchId || branches[0]?.id || '');
  const [name, setName] = useState('');
  const [unit, setUnit] = useState<StockUnit>(StockUnit.KG);
  const [quantity, setQuantity] = useState('0');
  const [minQuantity, setMinQuantity] = useState('');
  const [costPerUnit, setCostPerUnit] = useState('');

  const save = useMutation({
    mutationFn: () =>
      api.inventory.createItem({
        branchId,
        name: name.trim(),
        unit,
        quantity: Number(quantity.replace(',', '.')) || 0,
        minQuantity: minQuantity.trim() ? Number(minQuantity.replace(',', '.')) : null,
        costPerUnit: digits(costPerUnit),
      }),
    onSuccess: () => onSaved(`${name.trim()} omborga qoʻshildi`),
    onError: (caught) =>
      onError(caught instanceof RestorApiError ? caught.message : 'Saqlanmadi'),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!branchId || name.trim().length < 2) return;
    save.mutate();
  }

  return (
    <form className="card" onSubmit={submit}>
      <div className="row" style={{ marginBottom: 14 }}>
        <h3 style={{ fontSize: 15, margin: 0 }}>Yangi ombor mahsuloti</h3>
        <div className="spacer" />
        <button type="button" className="btn btn--ghost" onClick={onCancel}>Yopish</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
        <Labelled label="Filial" hint="Ombor har bir filialda alohida">
          <select value={branchId} onChange={(e) => setBranchId(e.target.value)} style={field}>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>{branch.name}</option>
            ))}
          </select>
        </Labelled>

        <Labelled label="Nomi">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Pishloq" style={field} />
        </Labelled>

        <Labelled label="Oʻlchov birligi">
          <select value={unit} onChange={(e) => setUnit(e.target.value as StockUnit)} style={field}>
            {Object.values(StockUnit).map((value) => (
              <option key={value} value={value}>{UNIT_LABEL[value]}</option>
            ))}
          </select>
        </Labelled>

        <Labelled label="Boshlangʻich qoldiq">
          <input inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} style={field} />
        </Labelled>

        <Labelled label="Chegara" hint="Shunga tushganda ogohlantiradi">
          <input inputMode="decimal" value={minQuantity} onChange={(e) => setMinQuantity(e.target.value)} placeholder="—" style={field} />
        </Labelled>

        <Labelled label="1 birlik narxi">
          <input inputMode="numeric" value={costPerUnit} onChange={(e) => setCostPerUnit(e.target.value)} placeholder="50000" style={field} />
        </Labelled>
      </div>

      <button type="submit" className="btn" style={{ marginTop: 16 }} disabled={save.isPending}>
        {save.isPending ? 'Saqlanmoqda…' : 'Saqlash'}
      </button>
    </form>
  );
}

function MovementsTab({ branchId }: { branchId: string }) {
  const movements = useQuery({
    queryKey: ['stock', 'movements', branchId],
    queryFn: () =>
      api.inventory.listMovements({ branchId: branchId || undefined, limit: 100 }),
  });

  if (movements.isLoading) return <Loading />;
  const rows = movements.data?.items ?? [];

  if (rows.length === 0) {
    return (
      <div className="card">
        <p className="muted" style={{ margin: 0 }}>Harakat yoʻq.</p>
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Vaqt</th>
            <th>Mahsulot</th>
            <th>Turi</th>
            <th>Miqdor</th>
            <th>Kim / nima</th>
            <th>Izoh</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const value = Number(row.quantity);
            return (
              <tr key={row.id}>
                <td className="muted" style={{ fontSize: 13 }}>
                  {new Date(row.createdAt).toLocaleString('uz-UZ')}
                </td>
                <td>{row.stockItemName ?? '—'}</td>
                <td>
                  <span className="badge" style={MOVEMENT_TONE[row.type]}>
                    {MOVEMENT_LABEL[row.type]}
                  </span>
                </td>
                <td>
                  {/* The sign is the direction, so it is shown as stored. */}
                  <strong style={{ color: value < 0 ? '#991B1B' : '#166534' }}>
                    {value > 0 ? '+' : ''}
                    {row.quantity}
                  </strong>{' '}
                  <span className="muted">{row.unit ? UNIT_LABEL[row.unit] : ''}</span>
                </td>
                <td className="muted" style={{ fontSize: 13 }}>
                  {row.orderNumber ?? row.supplierName ?? row.createdByName ?? '—'}
                </td>
                <td className="muted" style={{ fontSize: 13 }}>{row.comment ?? '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SuppliersTab({
  canManage,
  onNotice,
}: {
  canManage: boolean;
  onNotice: (n: { ok: boolean; text: string }) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  const suppliers = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => api.inventory.listSuppliers(),
  });

  const create = useMutation({
    mutationFn: () =>
      api.inventory.createSupplier({
        name: name.trim(),
        phone: phone.trim() || null,
      }),
    onSuccess: () => {
      setName('');
      setPhone('');
      onNotice({ ok: true, text: 'Yetkazib beruvchi qoʻshildi' });
      void queryClient.invalidateQueries({ queryKey: ['suppliers'] });
    },
    onError: (caught) =>
      onNotice({
        ok: false,
        text: caught instanceof RestorApiError ? caught.message : 'Saqlanmadi',
      }),
  });

  const toggle = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.inventory.updateSupplier(id, { isActive }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['suppliers'] }),
  });

  if (suppliers.isLoading) return <Loading />;
  const rows = suppliers.data ?? [];

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {canManage && (
        <div className="card row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Yetkazib beruvchi nomi"
            style={{ ...field, flex: 1, minWidth: 180 }}
          />
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+998 90 123 45 67"
            style={{ ...field, width: 190 }}
          />
          <button
            type="button"
            className="btn"
            disabled={name.trim().length < 2 || create.isPending}
            onClick={() => create.mutate()}
          >
            <IconPlus size={16} /> Qoʻshish
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>Yetkazib beruvchi yoʻq.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {rows.map((supplier) => (
            <div key={supplier.id} className="card row" style={{ gap: 12 }}>
              <strong style={{ fontSize: 14 }}>{supplier.name}</strong>
              <span className="muted" style={{ fontSize: 13 }}>{supplier.phone ?? '—'}</span>
              <div className="spacer" />
              {canManage && (
                <button
                  type="button"
                  className="btn btn--ghost"
                  style={smallBtn}
                  disabled={toggle.isPending}
                  onClick={() => toggle.mutate({ id: supplier.id, isActive: !supplier.isActive })}
                >
                  {supplier.isActive ? 'Oʻchirish' : 'Yoqish'}
                </button>
              )}
              <span
                className="badge"
                style={{
                  background: supplier.isActive ? '#DCFCE7' : '#F3F4F6',
                  color: supplier.isActive ? '#166534' : '#6B7280',
                }}
              >
                {supplier.isActive ? 'Faol' : 'Oʻchiq'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'warn' | 'bad' }) {
  const color = tone === 'bad' ? '#991B1B' : tone === 'warn' ? '#B45309' : undefined;
  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4, color }}>{value}</div>
    </div>
  );
}

function Labelled({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: 'grid', gap: 4 }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
      {children}
      {(error ?? hint) && (
        <span className="muted" style={{ fontSize: 12, color: error ? '#991B1B' : undefined }}>
          {error ?? hint}
        </span>
      )}
    </label>
  );
}

/** Consumption is absent: it is written by the system, never by a person. */
const MANUAL_TYPES: StockMovementType[] = [
  StockMovementType.RECEIPT,
  StockMovementType.WASTE,
  StockMovementType.ADJUSTMENT,
  StockMovementType.TRANSFER_OUT,
  StockMovementType.TRANSFER_IN,
];

const MOVEMENT_LABEL: Record<string, string> = {
  [StockMovementType.RECEIPT]: 'Kirim',
  [StockMovementType.CONSUMPTION]: 'Sarflandi',
  [StockMovementType.WASTE]: 'Yaroqsiz',
  [StockMovementType.ADJUSTMENT]: 'Tuzatish',
  [StockMovementType.TRANSFER_OUT]: 'Chiqdi',
  [StockMovementType.TRANSFER_IN]: 'Keldi',
};

const MOVEMENT_TONE: Record<string, { background: string; color: string }> = {
  [StockMovementType.RECEIPT]: { background: '#DCFCE7', color: '#166534' },
  [StockMovementType.CONSUMPTION]: { background: '#E0F2FE', color: '#075985' },
  [StockMovementType.WASTE]: { background: '#FEE2E2', color: '#991B1B' },
  [StockMovementType.ADJUSTMENT]: { background: '#FEF3C7', color: '#B45309' },
  [StockMovementType.TRANSFER_OUT]: { background: '#F3F4F6', color: '#6B7280' },
  [StockMovementType.TRANSFER_IN]: { background: '#F3F4F6', color: '#6B7280' },
};

const UNIT_LABEL: Record<string, string> = {
  [StockUnit.KG]: 'kg',
  [StockUnit.G]: 'g',
  [StockUnit.L]: 'l',
  [StockUnit.ML]: 'ml',
  [StockUnit.PCS]: 'dona',
};

const control = {
  padding: '8px 12px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  fontSize: 14,
} as const;

const field = { ...control, padding: '9px 12px' } as const;
const smallBtn = { padding: '5px 10px', minHeight: 30, fontSize: 12 } as const;
const cardGrid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
  gap: 12,
} as const;

function digits(value: string): number {
  return Number(value.replace(/\D/g, '')) || 0;
}
