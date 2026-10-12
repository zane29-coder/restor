import { useMemo, useRef, useState, type ReactNode } from 'react';

/**
 * Small, dependency-free charts for the admin screens.
 *
 * Plain SVG and CSS rather than a charting library: the panel needs four
 * shapes, and a library would add more weight than the screens it draws.
 * Colours come from the `--series-*` tokens (validated for colour-vision
 * deficiency in both themes), always in slot order, and every chart carries
 * a legend or direct labels so identity never rests on colour alone.
 */

/* ------------------------------------------------------------------ */
/* Line chart                                                         */
/* ------------------------------------------------------------------ */

export interface LineSeries {
  key: string;
  label: string;
  color: string;
  /** One value per x label; `null` leaves a gap (e.g. hours still to come). */
  values: Array<number | null>;
  dashed?: boolean;
  /** Soft fill under the line — only ever for the primary series. */
  area?: boolean;
}

export function LineChart({
  labels,
  series,
  height = 220,
  format,
  xTickEvery = 1,
}: {
  labels: string[];
  series: LineSeries[];
  height?: number;
  format: (value: number) => string;
  /** Show every n-th x label, so 24 hours do not collide. */
  xTickEvery?: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const n = labels.length;
  const max = useMemo(() => {
    const peak = Math.max(0, ...series.flatMap((s) => s.values.filter((v): v is number => v !== null)));
    return niceCeil(peak);
  }, [series]);

  const W = 1000;
  const H = height;
  const x = (i: number) => (n <= 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (v: number) => H - (max > 0 ? (v / max) * H : 0);

  const pathFor = (values: Array<number | null>) => {
    let d = '';
    let pen = false;
    values.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };

  const areaFor = (values: Array<number | null>) => {
    const pts = values
      .map((v, i) => (v === null ? null : ([x(i), y(v)] as const)))
      .filter((p): p is readonly [number, number] => p !== null);
    if (pts.length < 2) return '';
    return `M${pts[0]![0]},${H} ${pts.map(([px, py]) => `L${px},${py}`).join(' ')} L${pts[pts.length - 1]![0]},${H} Z`;
  };

  const ticks = [0, 0.25, 0.5, 0.75, 1];

  function onMove(event: React.MouseEvent) {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect || n === 0) return;
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    setHover(Math.round(ratio * (n - 1)));
  }

  const hoverLeft = hover !== null ? `${(x(hover) / W) * 100}%` : '0';

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '56px minmax(0, 1fr)' }}>
      <div style={{ position: 'relative', height: H }}>
        {ticks.map((t) => (
          <span key={t} className="chart__axis-y" style={{ top: H - t * H }}>
            {shortNumber(max * t)}
          </span>
        ))}
      </div>

      <div>
        <div
          ref={wrapRef}
          className="chart"
          style={{ height: H }}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
          role="img"
          aria-label={`Grafik: ${series.map((s) => s.label).join(', ')}`}
        >
          <svg className="chart__svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" height={H}>
            {ticks.map((t) => (
              <line
                key={t}
                x1={0}
                x2={W}
                y1={H - t * H}
                y2={H - t * H}
                stroke={t === 0 ? 'var(--chart-axis)' : 'var(--chart-grid)'}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {series.map((s) =>
              s.area ? (
                <path key={`${s.key}-area`} d={areaFor(s.values)} fill={s.color} opacity={0.1} />
              ) : null,
            )}
            {series.map((s) => (
              <path
                key={s.key}
                d={pathFor(s.values)}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeDasharray={s.dashed ? '5 5' : undefined}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>

          {hover !== null && (
            <>
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: hoverLeft,
                  width: 1,
                  background: 'var(--border-strong)',
                  pointerEvents: 'none',
                }}
              />
              {series.map((s) => {
                const v = s.values[hover];
                if (v === null || v === undefined) return null;
                return (
                  <span
                    key={s.key}
                    style={{
                      position: 'absolute',
                      left: hoverLeft,
                      top: y(v),
                      width: 10,
                      height: 10,
                      marginLeft: -5,
                      marginTop: -5,
                      borderRadius: '50%',
                      background: s.color,
                      boxShadow: '0 0 0 2px var(--surface)',
                      pointerEvents: 'none',
                    }}
                  />
                );
              })}
              <div
                className="chart__tip"
                style={
                  hover > n / 2
                    ? { right: `calc(${100 - (x(hover) / W) * 100}% + 12px)` }
                    : { left: `calc(${hoverLeft} + 12px)` }
                }
              >
                <div className="chart__tip-title">{labels[hover]}</div>
                {series.map((s) => (
                  <div key={s.key} className="chart__tip-row">
                    <span className="legend__item">
                      <span className="swatch swatch--line" style={{ background: s.color }} />
                      {s.label}
                    </span>
                    <strong className="num">
                      {s.values[hover] === null || s.values[hover] === undefined
                        ? '—'
                        : format(s.values[hover]!)}
                    </strong>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="chart__axis-x">
          {labels.map((label, i) =>
            i % xTickEvery === 0 || i === n - 1 ? (
              <span key={i} style={{ flex: 1, textAlign: i === 0 ? 'left' : i === n - 1 ? 'right' : 'center' }}>
                {label}
              </span>
            ) : null,
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Donut                                                              */
/* ------------------------------------------------------------------ */

export interface DonutSlice {
  key: string;
  label: string;
  value: number;
  color: string;
}

export function Donut({
  slices,
  size = 168,
  centerLabel,
  centerValue,
}: {
  slices: DonutSlice[];
  size?: number;
  centerLabel: string;
  centerValue: ReactNode;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  const stroke = 18;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  // A 2px gap between segments so adjacent colours never touch.
  const gap = slices.filter((s) => s.value > 0).length > 1 ? 2 : 0;

  let offset = 0;
  const active = slices.find((s) => s.key === hover);

  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={centerLabel}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-mid)" strokeWidth={stroke} />
        {total > 0 &&
          slices.map((slice) => {
            if (slice.value <= 0) return null;
            const length = (slice.value / total) * c;
            const dash = Math.max(0, length - gap);
            const el = (
              <circle
                key={slice.key}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={slice.color}
                strokeWidth={hover === slice.key ? stroke + 4 : stroke}
                strokeDasharray={`${dash} ${c - dash}`}
                strokeDashoffset={-offset}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
                onMouseEnter={() => setHover(slice.key)}
                onMouseLeave={() => setHover(null)}
                style={{ cursor: 'default', transition: 'stroke-width 120ms ease' }}
              >
                <title>{`${slice.label}: ${slice.value}`}</title>
              </circle>
            );
            offset += length;
            return el;
          })}
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'grid',
          placeItems: 'center',
          textAlign: 'center',
          pointerEvents: 'none',
        }}
      >
        <div>
          <div style={{ fontSize: 22, fontWeight: 800 }} className="num">
            {active ? active.value : centerValue}
          </div>
          <div className="muted" style={{ fontSize: 11 }}>
            {active ? active.label : centerLabel}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sparkline                                                          */
/* ------------------------------------------------------------------ */

/** A trend hint for a KPI tile; decorative, so hidden from assistive tech. */
export function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null;
  const W = 80;
  const H = 24;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const d = values
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${((i / (values.length - 1)) * W).toFixed(1)},${(H - 2 - ((v - min) / span) * (H - 4)).toFixed(1)}`)
    .join(' ');
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Labelled bars                                                      */
/* ------------------------------------------------------------------ */

/** A ranked list of shares, each a labelled bar — for tenders, sources, branches. */
export function BarList({
  rows,
  color = 'var(--series-1)',
}: {
  rows: Array<{ key: string; label: ReactNode; value: string; share: number }>;
  color?: string;
}) {
  return (
    <div className="stack" style={{ gap: 12 }}>
      {rows.map((row) => (
        <div key={row.key} className="bar-row">
          <div className="bar-row__head">
            <span>{row.label}</span>
            <span className="bar-row__value">{row.value}</span>
          </div>
          <div className="progress">
            <div className="progress__bar" style={{ width: `${Math.max(0, Math.min(100, row.share))}%`, background: color }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Rounds up to a readable top for the y-axis whose quarters are also round
 * (4 → 1, 2, 3, 4), without leaving half the plot empty above the peak.
 */
function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(value)));
  const f = value / exp;
  const steps = [1, 1.2, 1.6, 2, 2.4, 3, 4, 5, 6, 8, 10];
  return (steps.find((s) => f <= s) ?? 10) * exp;
}

function shortNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(Math.round(value));
}
