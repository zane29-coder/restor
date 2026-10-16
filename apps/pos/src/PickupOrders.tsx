import { useCallback, useEffect, useState } from 'react';
import { OrderSource, OrderStatus, OrderType, type Order } from '@restor/shared-types';
import { formatMoney } from '@restor/shared-utils';
import { RestorApiError } from '@restor/api-client';
import { api } from './api';
import { PaymentDialog, type TenderPart } from './PaymentDialog';
import { Receipt } from './Receipt';
import { settle } from './offline-queue';

const ACTIVE = [OrderStatus.NEW, OrderStatus.ACCEPTED, OrderStatus.PREPARING, OrderStatus.READY];
const LABELS: Record<string, string> = {
  NEW: 'Yangi', ACCEPTED: 'Qabul qilingan', PREPARING: 'Tayyorlanmoqda', READY: 'Tayyor',
};

/** Every pickup source shares the same branch queue, including Telegram. */
export function PickupOrders({ branchId, branchName }: { branchId: string; branchName: string }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [paying, setPaying] = useState<Order | null>(null);
  const [receipt, setReceipt] = useState<{ order: Order; parts: TenderPart[]; change: number } | null>(null);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);

  const load = useCallback(async () => {
    const result = await api.orders.list({ branchId, type: OrderType.PICKUP, status: ACTIVE, page, limit: 30 });
    setOrders(result.items);
    setPages(result.pagination.totalPages);
  }, [branchId, page]);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try { await load(); if (active) setError(null); }
      catch (caught) { if (active) setError(caught instanceof RestorApiError ? caught.message : 'Buyurtmalar yuklanmadi'); }
      finally { if (active) setLoading(false); }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [load]);

  async function advance(order: Order, status: OrderStatus) {
    setBusy(true);
    try { await api.orders.updateStatus(order.id, { status }); await load(); setError(null); }
    catch (caught) { setError(caught instanceof RestorApiError ? caught.message : 'Holat yangilanmadi'); }
    finally { setBusy(false); }
  }

  async function pay(parts: TenderPart[], tendered: number) {
    if (!paying) return;
    setBusy(true);
    try {
      // Never create another order for a customer who ordered in Telegram.
      const fresh = await api.orders.get(paying.id);
      if (fresh.total - fresh.paidTotal !== paying.total - paying.paidTotal) {
        setPaying(fresh.total > fresh.paidTotal ? fresh : null);
        throw new Error('To‘lov summasi o‘zgardi. Qolgan summani tekshiring.');
      }
      await settle(fresh.id, { parts });
      const paid = await api.orders.get(fresh.id);
      setReceipt({ order: paid, parts, change: Math.max(0, tendered - (fresh.total - fresh.paidTotal)) });
      setPaying(null);
      await load();
      setError(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'To‘lov saqlanmadi'); }
    finally { setBusy(false); }
  }

  return <section className="pickup">
    <div className="pickup__heading"><div><h1>Olib ketish</h1><p>Telegram va kassadan kelgan faol buyurtmalar · {branchName}</p></div>
      <button className="menu__tab" disabled={busy} onClick={() => void load().catch(() => setError('Buyurtmalar yuklanmadi'))}>Yangilash</button></div>
    {error && <div className="pos__error" role="alert">{error}</div>}
    {loading ? <p className="empty">Yuklanmoqda…</p> : orders.length === 0 ? <p className="empty">Olib ketish buyurtmalari yo‘q</p> :
      <div className="pickup__grid">{orders.map(order => <article className="pickup__card" key={order.id}>
        <div className="pickup__title"><strong>{order.displayNumber}</strong><span className={`order-status order-status--${order.status.toLowerCase()}`}>{LABELS[order.status]}</span></div>
        <p className="cart__meta">{order.source === OrderSource.TELEGRAM_MINI_APP || order.source === OrderSource.TELEGRAM_BOT ? 'Telegram' : order.source === OrderSource.POS ? 'Kassa' : 'Sayt'} · {new Date(order.createdAt).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })}</p>
        <strong>{order.customerName || 'Mijoz'}</strong>
        {order.customerPhone && <a href={`tel:${order.customerPhone}`}>{order.customerPhone}</a>}
        <ul>{order.items.map(item => <li key={item.id}>{item.quantity} × {item.name}{item.variantName ? ` (${item.variantName})` : ''}
          {item.modifiers.map(modifier => <small key={modifier.id}>{modifier.name}</small>)}{item.comment && <small>{item.comment}</small>}</li>)}</ul>
        {order.comment && <p>{order.comment}</p>}
        <div className="cart__total-line"><strong>{formatMoney(order.total)}</strong><span className="cart__meta">{order.paidTotal >= order.total ? 'To‘langan' : `Qoldiq: ${formatMoney(order.total - order.paidTotal)}`}</span></div>
        <div className="pickup__actions">
          {order.paidTotal < order.total && <button className="pay-btn pay-btn--primary" disabled={busy} onClick={() => setPaying(order)}>To‘lov olish</button>}
          {order.status === OrderStatus.NEW && <button className="pay-btn" disabled={busy} onClick={() => void advance(order, OrderStatus.ACCEPTED)}>Qabul qilish</button>}
          {order.status === OrderStatus.READY && <button className="pay-btn" disabled={busy || order.paidTotal < order.total} onClick={() => void advance(order, OrderStatus.DELIVERED)}>Mijozga berildi</button>}
        </div>
      </article>)}</div>}
    <div className="pickup__pages"><button className="menu__tab" disabled={page <= 1} onClick={() => setPage(page - 1)}>Oldingi</button><span>{page} / {Math.max(1, pages)}</span><button className="menu__tab" disabled={page >= pages} onClick={() => setPage(page + 1)}>Keyingi</button></div>
    {paying && <PaymentDialog total={paying.total - paying.paidTotal} isSubmitting={busy} onCancel={() => setPaying(null)} onConfirm={(parts, tendered) => void pay(parts, tendered)} />}
    {receipt && <Receipt {...receipt} branchName={branchName} onDismiss={() => setReceipt(null)} />}
  </section>;
}
