import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Permission } from '@restor/shared-types';
import { IconArrowRight, IconMenu, IconOrders, IconSearch, IconUser } from '@restor/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useBranch } from '../lib/branch';
import { som } from '../lib/format';
import { NAV_ITEMS } from './nav';

interface Result {
  key: string;
  group: string;
  icon: ReactNode;
  title: string;
  sub?: string;
  to: string;
}

/**
 * Ctrl+K: jump to a page, or find an order, customer or dish by name, number
 * or phone.
 *
 * Searches through the same list endpoints the pages use, so it can never
 * find something the user is not allowed to open — and each source is only
 * queried when the user holds the permission for it.
 */
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { can } = useAuth();
  const { branchId } = useBranch();
  const [text, setText] = useState('');
  const [term, setTerm] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounced: a query per keystroke would race and flicker.
  useEffect(() => {
    const t = setTimeout(() => setTerm(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);

  const searching = term.length >= 2;

  const orders = useQuery({
    queryKey: ['palette', 'orders', term, branchId],
    queryFn: () => api.orders.list({ search: term, branchId: branchId || undefined, limit: 5 }),
    enabled: searching && can(Permission.ORDERS_VIEW),
  });
  const customers = useQuery({
    queryKey: ['palette', 'customers', term],
    queryFn: () => api.customers.list({ search: term, limit: 5 }),
    enabled: searching && can(Permission.CUSTOMERS_VIEW),
  });
  const products = useQuery({
    queryKey: ['palette', 'products', term],
    queryFn: () => api.catalog.listProducts({ search: term, limit: 5 }),
    enabled: searching && can(Permission.PRODUCTS_VIEW),
  });

  const results = useMemo<Result[]>(() => {
    const needle = text.trim().toLowerCase();
    const pages: Result[] = NAV_ITEMS.filter((item) => !item.permission || can(item.permission))
      .filter(
        (item) =>
          !needle ||
          `${item.label} ${item.title} ${item.keywords ?? ''}`.toLowerCase().includes(needle),
      )
      .map((item) => ({
        key: `page:${item.to}`,
        group: 'Sahifalar',
        icon: <item.Icon size={16} />,
        title: item.label,
        sub: item.title !== item.label ? item.title : undefined,
        to: item.to,
      }));

    if (!searching) return pages;

    return [
      ...(orders.data?.items ?? []).map<Result>((order) => ({
        key: `order:${order.id}`,
        group: 'Buyurtmalar',
        icon: <IconOrders size={16} />,
        title: `#${order.displayNumber} · ${som(order.total)}`,
        sub: [order.customerName, order.customerPhone, order.branch?.name]
          .filter(Boolean)
          .join(' · '),
        to: `/orders?id=${order.id}`,
      })),
      ...(customers.data?.items ?? []).map<Result>((customer) => ({
        key: `customer:${customer.id}`,
        group: 'Mijozlar',
        icon: <IconUser size={16} />,
        title: customer.fullName ?? customer.phone,
        sub: `${customer.phone} · ${customer.ordersCount} ta buyurtma`,
        to: `/customers?id=${customer.id}`,
      })),
      ...(products.data?.items ?? []).map<Result>((product) => ({
        key: `product:${product.id}`,
        group: 'Taomlar',
        icon: <IconMenu size={16} />,
        title: product.name,
        sub: som(product.price),
        to: `/menu?id=${product.id}`,
      })),
      ...pages,
    ];
  }, [text, searching, can, orders.data, customers.data, products.data]);

  useEffect(() => setActive(0), [results.length, term]);

  useEffect(() => {
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = (result: Result | undefined) => {
    if (!result) return;
    onClose();
    navigate(result.to);
  };

  const loading = searching && (orders.isFetching || customers.isFetching || products.isFetching);

  let lastGroup = '';

  return createPortal(
    <div
      className="palette-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label="Qidiruv">
        <div className="palette__input-row">
          <IconSearch size={18} />
          <input
            ref={inputRef}
            className="palette__input"
            placeholder="Buyurtma raqami, mijoz, telefon yoki taom…"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActive((i) => Math.min(i + 1, results.length - 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                choose(results[active]);
              } else if (event.key === 'Escape') {
                onClose();
              }
            }}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-results"
          />
          {loading ? <div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> : <span className="kbd">Esc</span>}
        </div>

        <div className="palette__results" id="palette-results" role="listbox" ref={listRef}>
          {results.length === 0 && (
            <div className="palette__empty">
              {loading ? 'Qidirilmoqda…' : `“${text}” boʻyicha hech narsa topilmadi`}
            </div>
          )}
          {results.map((result, index) => {
            const header = result.group !== lastGroup ? result.group : null;
            lastGroup = result.group;
            return (
              <div key={result.key}>
                {header && <div className="popover__title">{header}</div>}
                <button
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  data-active={index === active}
                  className={`menu-item${index === active ? ' menu-item--active' : ''}`}
                  onMouseMove={() => setActive(index)}
                  onClick={() => choose(result)}
                >
                  <span className="menu-item__icon">{result.icon}</span>
                  <span className="menu-item__body">
                    <span className="menu-item__title">{result.title}</span>
                    {result.sub && <span className="menu-item__sub">{result.sub}</span>}
                  </span>
                  {index === active && <IconArrowRight size={14} style={{ color: 'var(--text-subtle)' }} />}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
