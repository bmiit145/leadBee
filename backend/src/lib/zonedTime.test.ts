import { describe, expect, it } from 'vitest';
import {
  addDays,
  calendarDayOf,
  dayBounds,
  dayRange,
  isValidTimeZone,
  parseCalendarDay,
  zonedInstant,
} from './zonedTime.js';

const IST = 'Asia/Kolkata';

describe('zonedTime', () => {
  it('recognises real IANA zones only', () => {
    expect(isValidTimeZone(IST)).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });

  it('starts an Indian day at 18:30 UTC the evening before', () => {
    const { start, end } = dayBounds({ year: 2026, month: 9, day: 15 }, IST);
    expect(start.toISOString()).toBe('2026-09-14T18:30:00.000Z');
    expect(end.toISOString()).toBe('2026-09-15T18:29:59.999Z');
  });

  it('places 08:30 on a day at the right instant', () => {
    expect(zonedInstant({ year: 2026, month: 9, day: 15 }, 8 * 60 + 30, IST).toISOString()).toBe(
      '2026-09-15T03:00:00.000Z'
    );
  });

  it('reads the calendar day where the user is, not in UTC', () => {
    // 20:00 UTC on the 14th is already 01:30 on the 15th in India.
    expect(calendarDayOf(new Date('2026-09-14T20:00:00Z'), IST)).toEqual({
      year: 2026,
      month: 9,
      day: 15,
    });
  });

  it('rolls days across month ends', () => {
    expect(addDays({ year: 2026, month: 9, day: 30 }, 1)).toEqual({ year: 2026, month: 10, day: 1 });
  });

  it('takes YYYY-MM-DD as written and converts instants', () => {
    expect(parseCalendarDay('2026-09-15', IST)).toEqual({ year: 2026, month: 9, day: 15 });
    expect(parseCalendarDay('2026-09-14T20:00:00Z', IST)).toEqual({ year: 2026, month: 9, day: 15 });
    expect(parseCalendarDay('not a date', IST)).toBeNull();
  });

  it('keeps a whole day across DST changes', () => {
    const { start, end } = dayBounds({ year: 2026, month: 3, day: 8 }, 'America/New_York');
    // The spring-forward day is 23 hours long.
    expect((end.getTime() + 1 - start.getTime()) / 3_600_000).toBe(23);
  });

  it('builds an inclusive date filter', () => {
    const range = dayRange('2026-09-01', '2026-09-30', IST);
    expect(range?.$gte?.toISOString()).toBe('2026-08-31T18:30:00.000Z');
    expect(range?.$lte?.toISOString()).toBe('2026-09-30T18:29:59.999Z');
    expect(dayRange(undefined, undefined, IST)).toBeNull();
    expect(() => dayRange('garbage', undefined, IST)).toThrow();
  });
});
