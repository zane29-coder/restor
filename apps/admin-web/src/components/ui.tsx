import { useEffect, useId, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  IconChevronRight,
  IconClose,
  IconTrendDown,
  IconTrendUp,
  type IconProps,
} from '@restor/ui';
import type { ComponentType } from 'react';
import { daysAgo, isoDay, percent } from '../lib/format';

/* ------------------------------------------------------------------ */
/* Page header                                                        */
/* ------------------------------------------------------------------ */

export function PageHeader({
  crumb,
  title,
  badge,
  subtitle,
  actions,
}: {
  /** Last breadcrumb segment; the trail always starts at "Asosiy". */
  crumb?: ReactNode;
  title: ReactNode;
  badge?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div className="page-head__text">
        {crumb && (
          <nav className="crumbs" aria-label="Joylashuv">
            <Link to="/">Asosiy</Link>
            <IconChevronRight size={12} />
            <span className="crumbs__current">{crumb}</span>
          </nav>
        )}
        <h1 className="page-title">
          {title}
          {badge}
        </h1>
        {subtitle && <p className="page-sub">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

/** The pulsing "live" pill next to a page title. */
export function LivePill({ label = 'Jonli' }: { label?: string }) {
  return (
    <span className="pill tone-success" style={{ fontSize: 11 }}>
      <span className="status-dot status-dot--live" style={{ width: 7, height: 7 }} />
      {label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* KPI tile                                                           */
/* ------------------------------------------------------------------ */

export function Kpi({
  label,
  value,
  unit,
  Icon,
  tone = 'tone-primary',
  foot,
  alert,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  Icon?: ComponentType<IconProps>;
  tone?: string;
  foot?: ReactNode;
  alert?: boolean;
}) {
  return (
    <div className={`kpi${alert ? ' kpi--alert' : ''}`}>
      <div className="kpi__top">
        <div style={{ minWidth: 0 }}>
          <div className="kpi__label">{label}</div>
          <div className="kpi__value">
            {value}
            {unit && <span className="kpi__unit">{unit}</span>}
          </div>
        </div>
        {Icon && (
          <span className={`kpi__icon ${tone}`}>
            <Icon size={20} />
          </span>
        )}
      </div>
      {foot && <div className="kpi__foot">{foot}</div>}
    </div>
  );
}

/**
 * A change against the previous period.
 *
 * `null` renders nothing rather than "0%": no baseline is not the same as no
 * change. `goodWhenDown` flips the colours for figures like cancellations.
 */
export function Delta({ value, goodWhenDown }: { value: number | null; goodWhenDown?: boolean }) {
  if (value === null || !Number.isFinite(value)) return null;
  const up = value > 0;
  const good = value === 0 ? null : goodWhenDown ? !up : up;
  const tone = good === null ? 'tone-neutral' : good ? 'tone-success' : 'tone-danger';
  return (
    <span className={`delta ${tone}`}>
      {up ? <IconTrendUp size={12} /> : value < 0 ? <IconTrendDown size={12} /> : null}
      {up ? '+' : ''}
      {percent(value)}
    </span>
  );
}

/** Percentage change between two plain numbers, `null` without a baseline. */
export function changeOf(current: number, previous: number | undefined | null): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/* ------------------------------------------------------------------ */
/* Card                                                               */
/* ------------------------------------------------------------------ */

export function Card({
  title,
  sub,
  actions,
  flush,
  children,
  footer,
  style,
}: {
  title?: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  flush?: boolean;
  children: ReactNode;
  footer?: ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <section className={`card${flush ? ' card--flush' : ''}`} style={style}>
      {(title || actions) && (
        <div className="card__head">
          <div style={{ minWidth: 0 }}>
            {title && <h2 className="card__title">{title}</h2>}
            {sub && <p className="card__sub">{sub}</p>}
          </div>
          {actions && <div className="row" style={{ flexWrap: 'nowrap' }}>{actions}</div>}
        </div>
      )}
      {children}
      {footer && <div className="card__foot">{footer}</div>}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Segmented control and tabs                                         */
/* ------------------------------------------------------------------ */

export interface Option<T extends string> {
  value: T;
  label: ReactNode;
  count?: number;
}

export function Seg<T extends string>({
  options,
  value,
  onChange,
  quiet,
  label,
}: {
  options: Array<Option<T>>;
  value: T;
  onChange: (value: T) => void;
  quiet?: boolean;
  label?: string;
}) {
  return (
    <div className={`seg${quiet ? ' seg--quiet' : ''}`} role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          className={`seg__btn${option.value === value ? ' seg__btn--active' : ''}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
          {option.count !== undefined && <span style={{ opacity: 0.75 }}>({option.count})</span>}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<Option<T> & { Icon?: ComponentType<IconProps> }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {options.map(({ value: v, label, count, Icon }) => (
        <button
          key={v}
          type="button"
          role="tab"
          aria-selected={v === value}
          className={`tabs__btn${v === value ? ' tabs__btn--active' : ''}`}
          onClick={() => onChange(v)}
        >
          {Icon && <Icon size={16} />}
          {label}
          {count !== undefined && <span className="tabs__count">{count}</span>}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Switch                                                             */
/* ------------------------------------------------------------------ */

export function Switch({
  checked,
  onChange,
  label,
  disabled,
  title,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <label className="switch" title={title}>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        aria-label={typeof label === 'string' ? label : title}
      />
      <span className="switch__track" />
      {label && <span>{label}</span>}
    </label>
  );
}

/* ------------------------------------------------------------------ */
/* Pagination                                                         */
/* ------------------------------------------------------------------ */

export function Pager({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  // First, last, and a window around the current page.
  const pages = new Set<number>([1, totalPages, page - 1, page, page + 1]);
  const list = [...pages].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);

  return (
    <nav className="pager" aria-label="Sahifalar">
      <button type="button" className="pager__btn" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="Oldingi">
        ‹
      </button>
      {list.map((p, i) => (
        <span key={p} style={{ display: 'contents' }}>
          {i > 0 && p - list[i - 1]! > 1 && <span className="subtle">…</span>}
          <button
            type="button"
            className={`pager__btn${p === page ? ' pager__btn--active' : ''}`}
            aria-current={p === page ? 'page' : undefined}
            onClick={() => onChange(p)}
          >
            {p}
          </button>
        </span>
      ))}
      <button type="button" className="pager__btn" disabled={page >= totalPages} onClick={() => onChange(page + 1)} aria-label="Keyingi">
        ›
      </button>
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/* Side panel                                                         */
/* ------------------------------------------------------------------ */

/**
 * The detail panel beside a list (orders, menu, staff, customers, stock).
 *
 * Inline and sticky on a wide screen, so the list stays usable while a record
 * is open; on a narrow one the grid collapses and it simply follows the list.
 * Escape closes it, like the drawers.
 */
export function SidePanel({
  title,
  sub,
  onClose,
  headerExtra,
  children,
  footer,
}: {
  title: ReactNode;
  sub?: ReactNode;
  onClose: () => void;
  headerExtra?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const titleId = useId();

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape' && !document.querySelector('.drawer, .palette')) onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <aside className="side-panel" aria-labelledby={titleId}>
      <header className="side-panel__head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 id={titleId} className="side-panel__title">
            {title}
          </h2>
          {sub && <div className="card__sub">{sub}</div>}
        </div>
        {headerExtra}
        <button type="button" className="icon-btn icon-btn--sm" aria-label="Yopish" onClick={onClose}>
          <IconClose size={18} />
        </button>
      </header>
      <div className="side-panel__body">{children}</div>
      {footer && <footer className="side-panel__foot">{footer}</footer>}
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* Period picker                                                      */
/* ------------------------------------------------------------------ */

export type PeriodKey = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'custom';

export interface Period {
  key: PeriodKey;
  /** `YYYY-MM-DD`, inclusive — the shape the reports API takes. */
  dateFrom: string;
  dateTo: string;
}

export function periodFor(key: Exclude<PeriodKey, 'custom'>): Period {
  const today = daysAgo(0);
  switch (key) {
    case 'today':
      return { key, dateFrom: isoDay(today), dateTo: isoDay(today) };
    case 'yesterday':
      return { key, dateFrom: isoDay(daysAgo(1)), dateTo: isoDay(daysAgo(1)) };
    case '7d':
      return { key, dateFrom: isoDay(daysAgo(6)), dateTo: isoDay(today) };
    case '30d':
      return { key, dateFrom: isoDay(daysAgo(29)), dateTo: isoDay(today) };
    case 'month': {
      const first = new Date(today.getFullYear(), today.getMonth(), 1);
      return { key, dateFrom: isoDay(first), dateTo: isoDay(today) };
    }
  }
}

/** The window of equal length immediately before `period`. */
export function previousPeriod(period: Period): Period {
  const from = new Date(`${period.dateFrom}T00:00:00`);
  const to = new Date(`${period.dateTo}T00:00:00`);
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
  const prevTo = new Date(from);
  prevTo.setDate(prevTo.getDate() - 1);
  const prevFrom = new Date(prevTo);
  prevFrom.setDate(prevFrom.getDate() - (days - 1));
  return { key: 'custom', dateFrom: isoDay(prevFrom), dateTo: isoDay(prevTo) };
}

/** Days covered by a period, inclusive. */
export function periodDays(period: Period): number {
  const from = new Date(`${period.dateFrom}T00:00:00`);
  const to = new Date(`${period.dateTo}T00:00:00`);
  return Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
}

const PERIOD_OPTIONS: Array<{ value: Exclude<PeriodKey, 'custom'>; label: string }> = [
  { value: 'today', label: 'Bugun' },
  { value: 'yesterday', label: 'Kecha' },
  { value: '7d', label: 'Soʻnggi 7 kun' },
  { value: '30d', label: 'Soʻnggi 30 kun' },
  { value: 'month', label: 'Shu oy' },
];

export function PeriodPicker({ value, onChange }: { value: Period; onChange: (period: Period) => void }) {
  return (
    <div className="row" style={{ gap: 8 }}>
      <Seg
        label="Davr"
        quiet
        options={[...PERIOD_OPTIONS, { value: 'custom' as PeriodKey, label: 'Moslashtirilgan' }]}
        value={value.key}
        onChange={(key) =>
          key === 'custom' ? onChange({ ...value, key: 'custom' }) : onChange(periodFor(key))
        }
      />
      {value.key === 'custom' && (
        <div className="row" style={{ gap: 6 }}>
          <input
            type="date"
            aria-label="Boshlanish sanasi"
            value={value.dateFrom}
            max={value.dateTo}
            onChange={(event) => event.target.value && onChange({ ...value, dateFrom: event.target.value })}
          />
          <span className="muted">—</span>
          <input
            type="date"
            aria-label="Tugash sanasi"
            value={value.dateTo}
            min={value.dateFrom}
            max={isoDay(new Date())}
            onChange={(event) => event.target.value && onChange({ ...value, dateTo: event.target.value })}
          />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Export                                                             */
/* ------------------------------------------------------------------ */

/**
 * Downloads rows as a CSV that Excel opens correctly.
 *
 * Semicolon-separated with a UTF-8 BOM: Excel in Uzbek and Russian locales
 * expects `;` as the list separator, and without the BOM it reads UTF-8 as
 * the ANSI code page and mangles every ʻ and ʼ.
 */
export function downloadCsv(fileName: string, rows: Array<Array<string | number | null | undefined>>) {
  const escape = (cell: string | number | null | undefined) => {
    const text = cell === null || cell === undefined ? '' : String(cell);
    return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const csv = '﻿' + rows.map((row) => row.map(escape).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName.endsWith('.csv') ? fileName : `${fileName}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
