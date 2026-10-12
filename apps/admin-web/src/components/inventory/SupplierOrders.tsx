import { Fragment, useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  SupplierOrderStatus,
  type StockItem,
  type Supplier,
  type SupplierOrder,
} from '@restor/shared-types';
import { IconCheck, IconCopy, IconPlus, IconSave, IconTelegram, IconTrash } from '@restor/ui';
import { api, RestorApiError } from '../../lib/api';
import { dateOf, dateTimeOf, qty, som } from '../../lib/format';
import {
  amountOf,
  endOfDayIso,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_TONES,
  parseQty,
  unitOf,
} from '../../lib/inventory';
import { Drawer } from '../Drawer';
import { ErrorState, Loading } from '../States';
import { Seg } from '../ui';

type Notify = (n: { ok: boolean; text: string }) => void;
const failText = (e: unknown, fallback: string) => (e instanceof RestorApiError ? e.message : fallback);

const TELEGRAM_NOTE: Record<SupplierOrder['telegramStatus'], string> = {
  QUEUED: 'Telegramga yuborildi',
  NO_CHAT: 'Telegram chat yoʻq',
  NO_BOT: 'Bot sozlanmagan',
};

/** Purchase orders: what was asked for, from whom, and whether it came. */
export function SupplierOrdersTab({
  branchId,
  items,
  suppliers,
  canManage,
  onNew,
  onNotice,
}: {
  branchId: string;
  items: StockItem[];
  suppliers: Supplier[];
  canManage: boolean;
  onNew: () => void;
  onNotice: Notify;
}) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<SupplierOrderStatus | ''>(SupplierOrderStatus.SENT);
  const [receiving, setReceiving] = useState<SupplierOrder | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const orders = useQuery({
    queryKey: ['stock', 'orders', branchId, status],
    queryFn: () => api.inventory.listOrders({ branchId: branchId || undefined, status: status || undefined }),
  });

  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'cancel' | 'resend' }) =>
      action === 'cancel' ? api.inventory.cancelOrder(id) : api.inventory.resendOrder(id),
    onSuccess: (order, { action }) => {
      void queryClient.invalidateQueries({ queryKey: ['stock', 'orders'] });
      onNotice({ ok: true, text: action === 'cancel' ? `№${order.number} bekor qilindi` : `№${order.number} Telegramga qayta yuborildi` });
    },
    onError: (e) => onNotice({ ok: false, text: failText(e, 'Bajarilmadi') }),
  });

  const copy = (order: SupplierOrder) => {
    // The saved message is HTML for Telegram; a person pasting it wants text.
    const text = order.messageText.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    void navigator.clipboard?.writeText(text).then(() => onNotice({ ok: true, text: 'Buyurtma matni nusxalandi' }));
  };

  return (
    <section className="stack" style={{ gap: 12 }}>
      <div className="toolbar" style={{ justifyContent: 'space-between' }}>
        <Seg
          label="Holat"
          quiet
          options={[
            { value: SupplierOrderStatus.SENT, label: 'Kutilmoqda' },
            { value: SupplierOrderStatus.RECEIVED, label: 'Qabul qilingan' },
            { value: SupplierOrderStatus.CANCELLED, label: 'Bekor qilingan' },
            { value: '' as const, label: 'Barchasi' },
          ]}
          value={status}
          onChange={setStatus}
        />
        {canManage && (
          <button type="button" className="btn" onClick={onNew} disabled={suppliers.length === 0} title={suppliers.length === 0 ? 'Avval taʼminotchi qoʻshing' : undefined}>
            <IconPlus size={16} /> Taʼminotchiga buyurtma
          </button>
        )}
      </div>

      {orders.isLoading ? (
        <Loading />
      ) : orders.isError ? (
        <ErrorState error={orders.error} onRetry={() => void orders.refetch()} />
      ) : (orders.data ?? []).length === 0 ? (
        <p className="card muted" style={{ textAlign: 'center' }}>Buyurtma yoʻq</p>
      ) : (
        <div className="card card--flush">
          <div className="table-wrap">
            <table style={{ minWidth: 720 }}>
              <thead>
                <tr><th>№</th><th>Taʼminotchi</th><th>Mahsulotlar</th><th className="td-right">Taxminiy summa</th><th>Holat</th><th /></tr>
              </thead>
              <tbody>
                {orders.data!.map((o) => (
                  <Fragment key={o.id}>
                    <tr className="row--clickable" onClick={() => setOpenId(openId === o.id ? null : o.id)}>
                      <td className="cell-main num">№{o.number}<div className="cell-sub">{dateTimeOf(o.createdAt)}</div></td>
                      <td>
                        <div className="cell-main">{o.supplierName}</div>
                        <div className="cell-sub">{o.branchName}{o.expectedAt ? ` · ${dateOf(o.expectedAt)} gacha` : ''}</div>
                      </td>
                      <td className="cell-sub">{o.lines.map((l) => `${l.name} ${amountOf(l.quantity, l.unit)}`).join(', ')}</td>
                      <td className="td-right num">{som(o.total)}</td>
                      <td>
                        <span className={`pill ${ORDER_STATUS_TONES[o.status]}`}>{ORDER_STATUS_LABELS[o.status]}</span>
                        {o.status === SupplierOrderStatus.SENT && (
                          <div className="cell-sub" style={{ marginTop: 4 }}>
                            <IconTelegram size={12} /> {TELEGRAM_NOTE[o.telegramStatus]}
                          </div>
                        )}
                      </td>
                      <td className="td-right" onClick={(e) => e.stopPropagation()}>
                        {canManage && o.status === SupplierOrderStatus.SENT && (
                          <button type="button" className="btn btn--sm" onClick={() => setReceiving(o)}>
                            <IconCheck size={13} /> Qabul qilish
                          </button>
                        )}
                      </td>
                    </tr>
                    {openId === o.id && (
                      <tr>
                        <td colSpan={6} style={{ background: 'var(--surface-low)' }}>
                          <div className="row" style={{ gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                            <pre className="order-message">{o.messageText.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')}</pre>
                            <div className="stack" style={{ gap: 6 }}>
                              <button type="button" className="btn btn--sm btn--ghost" onClick={() => copy(o)}><IconCopy size={13} /> Matnni nusxalash</button>
                              {canManage && o.status === SupplierOrderStatus.SENT && (
                                <>
                                  <button type="button" className="btn btn--sm btn--ghost" disabled={act.isPending} onClick={() => act.mutate({ id: o.id, action: 'resend' })}>
                                    <IconTelegram size={13} /> Telegramga qayta yuborish
                                  </button>
                                  <button type="button" className="btn btn--sm btn--danger-soft" disabled={act.isPending} onClick={() => act.mutate({ id: o.id, action: 'cancel' })}>
                                    <IconTrash size={13} /> Bekor qilish
                                  </button>
                                </>
                              )}
                              {o.createdByName && <span className="cell-sub">Tuzdi: {o.createdByName}</span>}
                              {o.receivedAt && <span className="cell-sub">Qabul: {dateTimeOf(o.receivedAt)}</span>}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {receiving && (
        <ReceiveForm
          order={receiving}
          items={items}
          onClose={() => setReceiving(null)}
          onSaved={(text) => {
            setReceiving(null);
            onNotice({ ok: true, text });
          }}
        />
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * A new purchase order. Quantities only — the estimate beside each line is
 * the item's last known cost, and the server works out the total itself.
 */
export function OrderForm({
  branchId,
  branchName,
  items,
  suppliers,
  preset,
  onClose,
  onSaved,
}: {
  branchId: string;
  branchName: string;
  items: StockItem[];
  suppliers: Supplier[];
  preset?: { supplierId?: string | null; stockItemId: string; quantity: string };
  onClose: () => void;
  onSaved: (order: SupplierOrder) => void;
}) {
  const queryClient = useQueryClient();
  const branchItems = useMemo(() => items.filter((i) => i.branchId === branchId && i.isActive), [items, branchId]);
  const active = suppliers.filter((s) => s.isActive);
  const [supplierId, setSupplierId] = useState(preset?.supplierId ?? active[0]?.id ?? '');
  const [lines, setLines] = useState<Array<{ stockItemId: string; quantity: string }>>(
    preset ? [{ stockItemId: preset.stockItemId, quantity: preset.quantity }] : [{ stockItemId: '', quantity: '' }],
  );
  const [expected, setExpected] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const supplier = active.find((s) => s.id === supplierId);
  const estimate = lines.reduce((sum, l) => {
    const item = branchItems.find((i) => i.id === l.stockItemId);
    const q = parseQty(l.quantity);
    return item && q > 0 ? sum + Math.round(q * item.costPerUnit) : sum;
  }, 0);

  const save = useMutation({
    mutationFn: () =>
      api.inventory.createOrder({
        branchId,
        supplierId,
        lines: lines.filter((l) => l.stockItemId).map((l) => ({ stockItemId: l.stockItemId, quantity: parseQty(l.quantity) })),
        note: note.trim() || null,
        expectedAt: endOfDayIso(expected),
      }),
    onSuccess: (order) => {
      void queryClient.invalidateQueries({ queryKey: ['stock', 'orders'] });
      onSaved(order);
    },
    onError: (e) => setError(failText(e, 'Yuborilmadi')),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const filled = lines.filter((l) => l.stockItemId);
    if (!supplierId) return setError('Taʼminotchini tanlang');
    if (filled.length === 0) return setError('Kamida bitta mahsulot qoʻshing');
    if (filled.some((l) => !(parseQty(l.quantity) > 0))) return setError('Har bir qatorga miqdor kiriting');
    if (new Set(filled.map((l) => l.stockItemId)).size !== filled.length) return setError('Bir mahsulot ikki marta kiritilgan');
    setError(null);
    save.mutate();
  }

  return (
    <Drawer
      title={`Taʼminotchiga buyurtma — ${branchName}`}
      width="wide"
      onClose={onClose}
      footer={
        <>
          {error && <span className="field__error" style={{ flex: 1, alignSelf: 'center' }}>{error}</span>}
          <span className="muted" style={{ alignSelf: 'center', marginRight: 'auto' }}>Taxminan: <b>{som(estimate)}</b></span>
          <button type="button" className="btn btn--ghost" onClick={onClose}>Bekor</button>
          <button type="submit" form="order-form" className="btn" disabled={save.isPending}>
            <IconTelegram size={16} /> {save.isPending ? 'Yuborilmoqda…' : supplier?.telegramChatId ? 'Telegram orqali yuborish' : 'Buyurtmani saqlash'}
          </button>
        </>
      }
    >
      <form id="order-form" className="stack" style={{ gap: 14 }} onSubmit={submit}>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="of-sup">Taʼminotchi</label>
            <select id="of-sup" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              {active.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {supplier && !supplier.telegramChatId && (
              <span className="field__hint" style={{ color: 'var(--warning)' }}>Telegram chat kiritilmagan — buyurtma saqlanadi, matnini nusxalab yuborasiz.</span>
            )}
          </div>
          <div className="field">
            <label htmlFor="of-exp">Qachongacha kerak</label>
            <input id="of-exp" type="date" value={expected} onChange={(e) => setExpected(e.target.value)} />
          </div>
        </div>

        <div className="stack" style={{ gap: 8 }}>
          <span className="field__label">Mahsulotlar</span>
          {lines.map((line, index) => {
            const item = branchItems.find((i) => i.id === line.stockItemId);
            const q = parseQty(line.quantity);
            return (
              <div key={index} className="order-line">
                <select
                  aria-label="Mahsulot"
                  value={line.stockItemId}
                  onChange={(e) => setLines((ls) => ls.map((l, i) => (i === index ? { ...l, stockItemId: e.target.value } : l)))}
                >
                  <option value="">Tanlang…</option>
                  {branchItems.map((i) => (
                    <option key={i.id} value={i.id}>{i.name} — qoldiq {amountOf(i.quantity, i.unit)}</option>
                  ))}
                </select>
                <input
                  aria-label="Miqdor"
                  inputMode="decimal"
                  value={line.quantity}
                  placeholder={item ? unitOf(item.unit) : 'miqdor'}
                  onChange={(e) => setLines((ls) => ls.map((l, i) => (i === index ? { ...l, quantity: e.target.value } : l)))}
                />
                <span className="num muted" style={{ fontSize: 12.5, textAlign: 'right' }}>{item && q > 0 ? som(Math.round(q * item.costPerUnit)) : ''}</span>
                <button type="button" className="icon-btn icon-btn--sm" aria-label="Qatorni olib tashlash" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, i) => i !== index))}>
                  <IconTrash size={14} />
                </button>
              </div>
            );
          })}
          <button type="button" className="btn btn--sm btn--ghost" style={{ justifySelf: 'start' }} onClick={() => setLines((ls) => [...ls, { stockItemId: '', quantity: '' }])}>
            <IconPlus size={14} /> Qator qoʻshish
          </button>
        </div>

        <div className="field">
          <label htmlFor="of-note">Izoh taʼminotchiga</label>
          <input id="of-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ertalab 9:00 gacha olib keling" />
        </div>
      </form>
    </Drawer>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Receiving a delivery: what actually came, at what invoice price, with
 * which use-by dates. Every line becomes a receipt in one transaction.
 */
function ReceiveForm({
  order,
  items,
  onClose,
  onSaved,
}: {
  order: SupplierOrder;
  items: StockItem[];
  onClose: () => void;
  onSaved: (text: string) => void;
}) {
  const queryClient = useQueryClient();
  const [lines, setLines] = useState(
    order.lines.map((l) => ({
      stockItemId: l.stockItemId,
      name: l.name,
      unit: l.unit,
      quantity: qty(l.quantity),
      cost: String(items.find((i) => i.id === l.stockItemId)?.costPerUnit ?? l.unitCost),
      expires: '',
      batch: '',
    })),
  );
  const [error, setError] = useState<string | null>(null);
  const update = (index: number, patch: Partial<(typeof lines)[number]>) =>
    setLines((ls) => ls.map((l, i) => (i === index ? { ...l, ...patch } : l)));

  const total = lines.reduce((sum, l) => sum + (parseQty(l.quantity) > 0 ? Math.round(parseQty(l.quantity) * (Number(l.cost.replace(/\D/g, '')) || 0)) : 0), 0);

  const save = useMutation({
    mutationFn: () =>
      api.inventory.receiveOrder(
        order.id,
        lines
          .filter((l) => parseQty(l.quantity) > 0)
          .map((l) => ({
            stockItemId: l.stockItemId,
            quantity: parseQty(l.quantity),
            costPerUnit: Number(l.cost.replace(/\D/g, '')) || undefined,
            expiresAt: endOfDayIso(l.expires),
            batchCode: l.batch.trim() || null,
          })),
      ),
    onSuccess: (o) => {
      void queryClient.invalidateQueries({ queryKey: ['stock'] });
      onSaved(`№${o.number} omborga qabul qilindi`);
    },
    onError: (e) => setError(failText(e, 'Qabul qilinmadi')),
  });

  return (
    <Drawer
      title={`№${order.number} — ${order.supplierName}dan qabul qilish`}
      width="wide"
      onClose={onClose}
      footer={
        <>
          {error && <span className="field__error" style={{ flex: 1, alignSelf: 'center' }}>{error}</span>}
          <span className="muted" style={{ alignSelf: 'center', marginRight: 'auto' }}>Faktura boʻyicha: <b>{som(total)}</b></span>
          <button type="button" className="btn btn--ghost" onClick={onClose}>Bekor</button>
          <button
            type="button"
            className="btn"
            disabled={save.isPending}
            onClick={() => {
              if (!lines.some((l) => parseQty(l.quantity) > 0)) return setError('Kamida bitta mahsulot miqdorini kiriting');
              setError(null);
              save.mutate();
            }}
          >
            <IconSave size={16} /> {save.isPending ? 'Saqlanmoqda…' : 'Omborga kirim qilish'}
          </button>
        </>
      }
    >
      <p className="field__hint" style={{ marginTop: 0 }}>Kelmagan mahsulot miqdorini 0 qiling. Narx — fakturadagi 1 birlik narxi; u ombor qiymati va tannarx uchun yangilanadi.</p>
      <div className="table-wrap">
        <table style={{ minWidth: 640 }}>
          <thead>
            <tr><th>Mahsulot</th><th>Keldi</th><th>Narx (soʻm)</th><th>Yaroqlilik</th><th>Partiya</th></tr>
          </thead>
          <tbody>
            {lines.map((l, index) => (
              <tr key={l.stockItemId}>
                <td className="cell-main">{l.name}<div className="cell-sub">buyurtma: {amountOf(order.lines[index]!.quantity, l.unit)}</div></td>
                <td><input aria-label="Keldi" inputMode="decimal" value={l.quantity} onChange={(e) => update(index, { quantity: e.target.value })} style={{ width: 90 }} /> {unitOf(l.unit)}</td>
                <td><input aria-label="Narx" inputMode="numeric" value={l.cost} onChange={(e) => update(index, { cost: e.target.value })} style={{ width: 110 }} /></td>
                <td><input aria-label="Yaroqlilik muddati" type="date" value={l.expires} onChange={(e) => update(index, { expires: e.target.value })} /></td>
                <td><input aria-label="Partiya" value={l.batch} onChange={(e) => update(index, { batch: e.target.value })} style={{ width: 100 }} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Drawer>
  );
}
