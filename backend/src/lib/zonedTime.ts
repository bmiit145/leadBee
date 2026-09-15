/**
 * Calendar arithmetic in a named time zone.
 *
 * "Today", "tomorrow", a date filter and the 08:30–20:00 booking window are
 * wall-clock ideas: they mean the day *where the user is*. Computing them with
 * the server's own clock is right only while the server happens to run in the
 * same zone as its users — a server in UTC made "today" start at 05:30 in India.
 *
 * Pure, and built on `Intl` only, so it needs no dependency and is tested
 * without a database.
 */

export interface CalendarDay {
  year: number;
  month: number;
  day: number;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

function wallClock(instant: Date, timeZone: string) {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    // Some runtimes render midnight as 24 even with h23.
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second'),
  };
}

/** How far `timeZone` is ahead of UTC at `instant`, in milliseconds. */
function offsetMs(instant: Date, timeZone: string): number {
  const wall = wallClock(instant, timeZone);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return asUtc - (instant.getTime() - instant.getUTCMilliseconds());
}

/** The calendar day an instant falls on, in `timeZone`. */
export function calendarDayOf(instant: Date, timeZone: string): CalendarDay {
  const wall = wallClock(instant, timeZone);
  return { year: wall.year, month: wall.month, day: wall.day };
}

export function addDays(day: CalendarDay, days: number): CalendarDay {
  const shifted = new Date(Date.UTC(day.year, day.month - 1, day.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** The instant a wall-clock time (minutes after midnight) occurs on `day` in `timeZone`. */
export function zonedInstant(day: CalendarDay, minuteOfDay: number, timeZone: string): Date {
  const naive = Date.UTC(day.year, day.month - 1, day.day, 0, minuteOfDay);
  const firstGuess = naive - offsetMs(new Date(naive), timeZone);
  // The offset is re-read at the candidate, which corrects a day with a DST change.
  return new Date(naive - offsetMs(new Date(firstGuess), timeZone));
}

/** First and last millisecond of `day` in `timeZone`. */
export function dayBounds(day: CalendarDay, timeZone: string): { start: Date; end: Date } {
  const start = zonedInstant(day, 0, timeZone);
  const next = zonedInstant(addDays(day, 1), 0, timeZone);
  return { start, end: new Date(next.getTime() - 1) };
}

/**
 * `YYYY-MM-DD` is that calendar day as written. Anything else is read as an
 * instant and converted to the day it falls on in `timeZone`. Null when neither.
 */
export function parseCalendarDay(input: string, timeZone: string): CalendarDay | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.trim());
  if (match) return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  const instant = new Date(input);
  return Number.isNaN(instant.getTime()) ? null : calendarDayOf(instant, timeZone);
}

/**
 * An inclusive date filter: from the start of `from` to the end of `to`, both
 * in `timeZone`. Null when neither is given; throws on an unreadable value.
 */
export function dayRange(
  from: string | undefined,
  to: string | undefined,
  timeZone: string
): { $gte?: Date; $lte?: Date } | null {
  if (!from && !to) return null;
  const range: { $gte?: Date; $lte?: Date } = {};
  if (from) {
    const day = parseCalendarDay(from, timeZone);
    if (!day) throw new RangeError('Invalid dateFrom');
    range.$gte = dayBounds(day, timeZone).start;
  }
  if (to) {
    const day = parseCalendarDay(to, timeZone);
    if (!day) throw new RangeError('Invalid dateTo');
    range.$lte = dayBounds(day, timeZone).end;
  }
  return range;
}

/** "12 Sept, 3:00 pm" in `timeZone` — for activity text a person reads. */
export function formatWhen(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone,
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(instant);
}
