/**
 * Date/time helpers, in particular branch working hours.
 *
 * Every branch has its own IANA timezone, so "is the branch open?" can never be
 * answered with the server's local clock. These helpers do the conversion via
 * `Intl`, which needs no extra dependency and is correct across DST.
 */

import type { Weekday } from '@restor/shared-types';

export interface TimeWindow {
  dayOfWeek: Weekday;
  /** `HH:mm`, local to the branch. */
  opensAt: string;
  closesAt: string;
  isClosed: boolean;
}

/** Parses `HH:mm` into minutes past midnight; `null` when malformed. */
export function parseTimeToMinutes(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function formatMinutesAsTime(minutes: number): string {
  const normalised = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(normalised / 60);
  const m = normalised % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Wall-clock fields of `date` as seen in `timeZone`. */
export function getZonedParts(
  date: Date,
  timeZone: string,
): { weekday: Weekday; hour: number; minute: number; minutesOfDay: number } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const lookup = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';

  const weekdayMap: Record<string, Weekday> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };

  // `hour12: false` renders midnight as "24" in some ICU versions.
  const hour = Number(lookup('hour')) % 24;
  const minute = Number(lookup('minute'));

  return {
    weekday: weekdayMap[lookup('weekday')] ?? 1,
    hour,
    minute,
    minutesOfDay: hour * 60 + minute,
  };
}

/**
 * Whether a branch is trading at `now`.
 *
 * Handles windows that cross midnight (e.g. 10:00-02:00): such a window stays
 * open into the following calendar day, which is the normal case for a fast
 * food branch.
 */
export function isOpenAt(
  windows: readonly TimeWindow[],
  timeZone: string,
  now: Date = new Date(),
): boolean {
  const { weekday, minutesOfDay } = getZonedParts(now, timeZone);

  for (const window of windows) {
    if (window.isClosed) continue;

    const opens = parseTimeToMinutes(window.opensAt);
    const closes = parseTimeToMinutes(window.closesAt);
    if (opens === null || closes === null) continue;

    const crossesMidnight = closes <= opens;

    if (window.dayOfWeek === weekday) {
      if (crossesMidnight ? minutesOfDay >= opens : minutesOfDay >= opens && minutesOfDay < closes) {
        return true;
      }
    }

    // A window opened yesterday may still be running past midnight today.
    if (crossesMidnight && window.dayOfWeek === previousWeekday(weekday)) {
      if (minutesOfDay < closes) return true;
    }
  }

  return false;
}

function previousWeekday(day: Weekday): Weekday {
  return (day === 1 ? 7 : day - 1) as Weekday;
}

/** Start of the day containing `date`, in `timeZone`, as a UTC `Date`. */
export function startOfDayInZone(date: Date, timeZone: string): Date {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const [isoDate] = formatter.format(date).split(',');
  // `en-CA` yields YYYY-MM-DD, which parses unambiguously.
  const offsetMs = getZoneOffsetMs(date, timeZone);
  return new Date(Date.parse(`${isoDate}T00:00:00.000Z`) - offsetMs);
}

/** Offset of `timeZone` from UTC at `date`, in milliseconds. */
export function getZoneOffsetMs(date: Date, timeZone: string): number {
  const utc = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
  const zoned = new Date(date.toLocaleString('en-US', { timeZone }));
  return zoned.getTime() - utc.getTime();
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

export function minutesBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 60_000);
}

/** Seconds elapsed since `from` — drives the KDS card timer. */
export function secondsSince(from: Date | string, now: Date = new Date()): number {
  const start = typeof from === 'string' ? new Date(from) : from;
  return Math.max(0, Math.floor((now.getTime() - start.getTime()) / 1000));
}

/** `272` → `04:32`, the elapsed-time format the KDS shows (TZ §21). */
export function formatElapsed(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
