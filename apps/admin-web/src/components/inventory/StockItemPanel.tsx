import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { StockItem, Supplier, SupplierOrder } from '@restor/shared-types';
import { IconEdit, IconHourglass, IconMinus, IconPlus, IconTelegram } from '@restor/ui';
import { api, RestorApiError } from '../../lib/api';
import { dateOf, phone, qty, som } from '../../lib/format';
import { amountOf, LEVEL_LABELS, LEVEL_TONES, levelOf, parseQty, unitOf } from '../../lib/inventory';
import { Loading } from '../States';
import { SidePanel } from '../ui';

const WEEKDAYS = ['Yak', 'Dush', 'Sesh', 'Chor', 'Pay', 'Juma', 'Shan'];

/**
 * One item's card: how much is left against its threshold, how fast it goes,
 * what it goes into, and a one-step reorder to the supplier it last came
 * from.
 */
export function StockItemPanel({
  item,
  suppliers,
  canManage,
  onClose,
  onEdit,
  onMove,
  onOrdered,
  onNotice,
}: {
  item: StockItem;
  suppliers: Supplier[];
  canManage: boolean;
  onClose: () => void;
  onEdit: () => void;
  onMove: (kind: 'RECEIPT' | 'WASTE') => void;
  onOrdered: (order: SupplierOrder) => void;
  onNotice: (n: { ok: boolean; text: string }) => void;
}) {
  const queryClient = useQueryClient();
  const insight = useQuery({ queryKey: ['stock', 'insight', item.id], queryFn: () => api.inventory.insight(item.id) });
  const active = suppliers.filter((s) => s.isActive);
  const [supplierId, setSupplierId] = useState('');
  const [amount, setAmount] = useState('');

  const level = levelOf(item);
  const q = Number(item.quantity);
  const min = item.minQuantity ? Number(item.minQuantity) : null;
  // The bar is scaled to twice the threshold, so "comfortably stocked" fills it.
  const scale = Math.max(q, (min ?? q) * 2, 1);
  const data = insight.data;

  // Default the reorder to the last supplier and to two weeks of usage, or
  // back up to twice the threshold when there is no usage to go by.
  useEffect(() => {
    if (!data) return;
    setSupplierId((current) => current || data.lastReceipt?.supplierId || active[0]?.id || '');
    setAmount((current) => {
      if (current) return current;
      const avg = Number(data.avgDaily);
      const target = avg > 0 ? avg * 14 : min ? min * 2 : 0;
      const need = Math.max(0, Math.ceil(target - q));
      return need > 0 ? String(need) : '';
    });
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const order = useMutation({
    mutationFn: () =>
      api.inventory.createOrder({ branchId: item.branchId, supplierId, lines: [{ stockItemId: item.id, quantity: parseQty(amount) }] }),
    onSuccess: (o) => {
      void queryClient.invalidateQueries({ queryKey: ['stock', 'orders'] });
      onOrdered(o);
    },
    onError: (e) => onNotice({ ok: false, text: e instanceof RestorApiError ? e.message : 'Yuborilmadi' }),
  });

  const supplier = active.find((s) => s.id === supplierId);
  const maxDay = data ? Math.max(...data.days.map((d) => Number(d.consumed) + Number(d.wasted)), 0.001) : 1;

  return (
    <SidePanel
      title={item.name}
      sub={[item.category, item.sku, item.branchName].filter(Boolean).join(' · ') || unitOf(item.unit)}
      headerExtra={<span className={`pill ${LEVEL_TONES[level]}`}>{LEVEL_LABELS[level]}</span>}
      onClose={onClose}
      footer={
        canManage ? (
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn--sm" onClick={() => onMove('RECEIPT')}><IconPlus size={14} /> Kirim</button>
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => onMove('WASTE')}><IconMinus size={14} /> Hisobdan chiqarish</button>
            <button type="button" className="btn btn--sm btn--ghost" onClick={onEdit}><IconEdit size={14} /> Tahrirlash</button>
          </div>
        ) : undefined
      }
    >
      <section>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span className="muted" style={{ fontSize: 12.5 }}>Zaxira qoldigʻi</span>
          <b style={{ fontSize: 22 }}>{amountOf(item.quantity, item.unit)}</b>
        </div>
        <div className="stock-gauge" aria-hidden>
          <div className={`stock-gauge__bar ${LEVEL_TONES[level]}`} style={{ width: `${Math.min(100, Math.max(0, (q / scale) * 100))}%` }} />
          {min !== null && <span className="stock-gauge__min" style={{ left: `${(min / scale) * 100}%` }} />}
        </div>
        <div className="row" style={{ justifyContent: 'space-between', fontSize: 12, marginTop: 6 }}>
          <span className="row" style={{ gap: 4 }}>
            <IconHourglass size={13} />
            {data?.daysLeft !== null && data?.daysLeft !== undefined ? `Taxminan ${data.daysLeft} kunga yetadi` : 'Sarf maʼlumoti yoʻq'}
          </span>
          {min !== null && <span className="muted">Chegara: {amountOf(item.minQuantity, item.unit)}</span>}
        </div>
        <dl className="kv" style={{ marginTop: 12 }}>
          <dt>1 {unitOf(item.unit)} narxi</dt><dd>{som(item.costPerUnit)}</dd>
          <dt>Umumiy qiymat</dt><dd>{som(item.stockValue)}</dd>
        </dl>
      </section>

      {insight.isLoading ? (
        <Loading />
      ) : data ? (
        <>
          <section style={{ marginTop: 16 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h3 className="card__title" style={{ fontSize: 13.5 }}>7 kunlik sarf</h3>
              <span className="muted" style={{ fontSize: 12 }}>Oʻrtacha: {qty(data.avgDaily)} {unitOf(item.unit)}/kun</span>
            </div>
            <div className="usage-bars" role="img" aria-label="Soʻnggi 7 kunlik sarf">
              {data.days.map((d) => {
                const used = Number(d.consumed);
                const wasted = Number(d.wasted);
                return (
                  <div key={d.date} className="usage-bars__col" title={`${dateOf(d.date)}: sarf ${qty(d.consumed)}, chiqim ${qty(d.wasted)} ${unitOf(item.unit)}`}>
                    <div className="usage-bars__stack">
                      {wasted > 0 && <span className="usage-bars__waste" style={{ height: `${(wasted / maxDay) * 100}%` }} />}
                      <span className="usage-bars__used" style={{ height: `${(used / maxDay) * 100}%` }} />
                    </div>
                    <span className="usage-bars__day">{WEEKDAYS[new Date(`${d.date}T12:00:00`).getDay()]}</span>
                  </div>
                );
              })}
            </div>
          </section>

          {data.products.length > 0 && (
            <section className="soft-box" style={{ marginTop: 14 }}>
              <b style={{ fontSize: 13 }}>Retseptlarda qoʻllanadi</b>
              <p className="cell-sub" style={{ margin: '4px 0 8px' }}>Zaxira tugasa, bu taomlarni tayyorlab boʻlmaydi:</p>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {data.products.map((p) => (
                  <span key={p.id} className="pill tone-neutral">{p.name} · {qty(p.quantity)} {unitOf(item.unit)}</span>
                ))}
              </div>
            </section>
          )}

          {canManage && active.length > 0 && (
            <section className="reorder-box" style={{ marginTop: 14 }}>
              <b>Tezkor taʼminot buyurtmasi</b>
              <div className="field">
                <label htmlFor="ro-sup">Taʼminotchi</label>
                <select id="ro-sup" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                  {active.map((s) => <option key={s.id} value={s.id}>{s.name}{s.phone ? ` · ${phone(s.phone)}` : ''}</option>)}
                </select>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <div className="field" style={{ flex: 1 }}>
                  <label htmlFor="ro-qty">Miqdor ({unitOf(item.unit)})</label>
                  <input id="ro-qty" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </div>
                <div className="field" style={{ flex: 1 }}>
                  <span className="field__label">Taxminiy summa</span>
                  <b style={{ lineHeight: '38px' }}>{parseQty(amount) > 0 ? som(Math.round(parseQty(amount) * item.costPerUnit)) : '—'}</b>
                </div>
              </div>
              {data.lastReceipt && (
                <span className="cell-sub">Oxirgi kirim: {dateOf(data.lastReceipt.createdAt)}{data.lastReceipt.supplierName ? `, ${data.lastReceipt.supplierName}` : ''}{data.lastReceipt.costPerUnit ? `, ${som(data.lastReceipt.costPerUnit)}/${unitOf(item.unit)}` : ''}</span>
              )}
              <button
                type="button"
                className="btn"
                style={{ width: '100%', justifyContent: 'center' }}
                disabled={order.isPending || !supplierId || !(parseQty(amount) > 0)}
                onClick={() => order.mutate()}
              >
                <IconTelegram size={16} /> {supplier?.telegramChatId ? 'Taʼminotchiga Telegram orqali yuborish' : 'Buyurtma tuzish'}
              </button>
            </section>
          )}
        </>
      ) : null}
    </SidePanel>
  );
}
