import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { IconAlert, IconBell, IconOrders, IconTable } from '@restor/ui';
import { ago, qty as trimQty, som } from '../lib/format';
import { useNewOrders, usePendingWaiterCalls, useStockSummary } from '../lib/live';
import { useDismiss } from '../lib/useDismiss';

/**
 * Things waiting on a person, gathered from the live queries the shell
 * already polls: orders nobody has accepted, guests who called a waiter, and
 * stock below its reorder line. Nothing here is stored — it is a view of
 * current state, so it empties itself as the work gets done.
 */
export function NotificationsBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);

  const newOrders = useNewOrders();
  const calls = usePendingWaiterCalls();
  const stock = useStockSummary();

  const orderItems = newOrders.data?.items ?? [];
  const orderTotal = newOrders.data?.pagination.total ?? 0;
  const callItems = calls.data ?? [];
  const lowItems = stock.data?.lowItems ?? [];
  const lowCount = stock.data?.lowCount ?? 0;
  const total = orderTotal + callItems.length + lowCount;

  const go = (to: string) => {
    close();
    navigate(to);
  };

  return (
    <div className="popover-anchor" ref={ref}>
      <button
        type="button"
        className="icon-btn"
        aria-label={`Bildirishnomalar${total ? `: ${total} ta` : ''}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <IconBell size={20} />
        {total > 0 && <span className="dot-count">{total > 99 ? '99+' : total}</span>}
      </button>

      {open && (
        <div className="popover popover--right" style={{ width: 360 }}>
          {total === 0 && (
            <div className="palette__empty">
              <IconBell size={28} style={{ margin: '0 auto 8px', color: 'var(--text-subtle)' }} />
              Hozircha eʼtibor talab qiladigan narsa yoʻq
            </div>
          )}

          {callItems.length > 0 && (
            <>
              <div className="popover__title">Stollardan chaqiruv ({callItems.length})</div>
              {callItems.slice(0, 5).map((call) => (
                <Item
                  key={call.id}
                  icon={<IconTable size={16} />}
                  tone="tone-warning"
                  title={`Stol ${call.tableNumber}: ${
                    call.type === 'REQUEST_BILL' ? 'hisob soʻraldi' : 'ofitsiant chaqirildi'
                  }`}
                  sub={ago(call.createdAt)}
                  onClick={() => go('/tables')}
                />
              ))}
            </>
          )}

          {orderTotal > 0 && (
            <>
              <div className="popover__title">Qabul qilinmagan buyurtmalar ({orderTotal})</div>
              {orderItems.map((order) => (
                <Item
                  key={order.id}
                  icon={<IconOrders size={16} />}
                  tone="tone-primary"
                  title={`#${order.displayNumber} · ${som(order.total)}`}
                  sub={`${order.customerName ?? order.customerPhone ?? 'Mijoz'} · ${ago(order.createdAt)}`}
                  onClick={() => go(`/orders?id=${order.id}`)}
                />
              ))}
            </>
          )}

          {lowCount > 0 && (
            <>
              <div className="popover__title">Kam qolgan xomashyo ({lowCount})</div>
              {lowItems.slice(0, 5).map((item) => (
                <Item
                  key={item.id}
                  icon={<IconAlert size={16} />}
                  tone="tone-danger"
                  title={item.name}
                  sub={`Qoldiq: ${trimQty(item.quantity)} · min ${trimQty(item.minQuantity ?? '0')}${
                    item.branchName ? ` · ${item.branchName}` : ''
                  }`}
                  onClick={() => go('/inventory')}
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Item({
  icon,
  tone,
  title,
  sub,
  onClick,
}: {
  icon: ReactNode;
  tone: string;
  title: string;
  sub: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="menu-item" onClick={onClick}>
      <span className={`menu-item__icon ${tone}`}>{icon}</span>
      <span className="menu-item__body">
        <span className="menu-item__title">{title}</span>
        <span className="menu-item__sub">{sub}</span>
      </span>
    </button>
  );
}
