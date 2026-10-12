import type { RevenuePoint } from '@restor/shared-types';
import type { Period } from '../components/ui';

export type ChartGranularity = 'hour' | 'day' | 'week';

const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Lines the two periods up bucket by bucket.
 *
 * Hours (from 06:00, earlier only if there was trade) for a single day, days
 * or weeks otherwise — the previous period is aligned by position, so "day 3"
 * of this week sits over "day 3" of last week.
 */
export function buildChart(
  current: RevenuePoint[],
  previous: RevenuePoint[],
  metric: 'revenue' | 'orders',
  granularity: ChartGranularity,
  period: Period,
) {
  const value = (p: RevenuePoint | undefined) => (p ? (metric === 'revenue' ? p.revenue : p.orders) : 0);

  if (granularity === 'hour') {
    const hourOf = (p: RevenuePoint) => Number(p.at.slice(11, 13));
    const all = [...current, ...previous];
    const first = Math.min(6, ...all.map(hourOf));
    const isToday = period.key === 'today';
    const nowHour = new Date().getHours();
    const labels: string[] = [];
    const cur: Array<number | null> = [];
    const prev: Array<number | null> = [];
    for (let h = first; h <= 23; h++) {
      labels.push(`${String(h).padStart(2, '0')}:00`);
      // Hours still to come today are a gap, not a zero.
      cur.push(isToday && h > nowHour ? null : value(current.find((p) => hourOf(p) === h)));
      prev.push(value(previous.find((p) => hourOf(p) === h)));
    }
    return { labels, current: cur, previous: prev };
  }

  if (granularity === 'week') {
    const cur = [...current].sort((a, b) => a.at.localeCompare(b.at));
    const prev = [...previous].sort((a, b) => a.at.localeCompare(b.at));
    return {
      labels: cur.map((p) => chartLabel(p.at, 'week')),
      current: cur.map(value),
      previous: cur.map((_, i) => value(prev[i])),
    };
  }

  const days: string[] = [];
  const start = new Date(`${period.dateFrom}T00:00:00`);
  const end = new Date(`${period.dateTo}T00:00:00`);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) days.push(dayKey(d));
  const prevStart = new Date(start);
  prevStart.setDate(prevStart.getDate() - days.length);

  return {
    labels: days.map((d) => chartLabel(d, 'day')),
    current: days.map((d) => value(current.find((p) => p.at.slice(0, 10) === d))),
    previous: days.map((_, i) => {
      const day = new Date(prevStart);
      day.setDate(day.getDate() + i);
      const key = dayKey(day);
      return value(previous.find((p) => p.at.slice(0, 10) === key));
    }),
  };
}

/** `14:00`, `14:00 – 15:00`, `12.10`, `12.10 dan hafta`. */
export function chartLabel(at: string, granularity: ChartGranularity, range = false): string {
  if (granularity === 'hour') {
    const h = Number(at.slice(11, 13));
    const hh = String(h).padStart(2, '0');
    return range ? `${hh}:00 – ${String((h + 1) % 24).padStart(2, '0')}:00` : `${hh}:00`;
  }
  const label = `${at.slice(8, 10)}.${at.slice(5, 7)}`;
  return granularity === 'week' && range ? `${label} dan boshlangan hafta` : label;
}
