import { describe, expect, it } from 'vitest';
import { bucketActivity } from './activity-buckets';
import type { ActivityEvent } from '@/types';

const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 4, 21, 30); // 21:30 UTC, so buckets end at 22:00

function event(
  offsetHours: number,
  source: ActivityEvent['source'],
  level = 'info'
): ActivityEvent {
  return {
    id: `${source}:${offsetHours}`,
    agentId: 'sallie',
    agentName: 'Sallie',
    timestamp: new Date(NOW - offsetHours * HOUR).toISOString(),
    source,
    title: 't',
    level: level as ActivityEvent['level'],
  };
}

describe('bucketActivity', () => {
  it('splits the window into equal buckets ending at the next boundary', () => {
    const buckets = bucketActivity([], 24, 24, NOW);
    expect(buckets).toHaveLength(24);
    expect(buckets[23].end).toBe(Date.UTC(2026, 8, 4, 22, 0));
    expect(buckets[0].start).toBe(Date.UTC(2026, 8, 3, 22, 0));
    expect(buckets[1].start - buckets[0].start).toBe(HOUR);
  });

  it('counts events per source in the right bucket and flags problems', () => {
    const buckets = bucketActivity(
      [event(0.25, 'github'), event(0.4, 'azure', 'error'), event(5, 'foundry')],
      24,
      24,
      NOW
    );
    const last = buckets[23];
    expect(last.counts).toEqual({ azure: 1, github: 1, foundry: 0 });
    expect(last.total).toBe(2);
    expect(last.problems).toBe(1);
    // 5 h before 21:30 is 16:30, the bucket 16:00-17:00
    const five = buckets.find((b) => b.start === Date.UTC(2026, 8, 4, 16, 0));
    expect(five?.counts.foundry).toBe(1);
  });

  it('ignores events outside the window and with bad timestamps', () => {
    const stale = event(30, 'github');
    const bad = { ...event(1, 'github'), timestamp: 'not a date' };
    const buckets = bucketActivity([stale, bad], 24, 24, NOW);
    expect(buckets.reduce((n, b) => n + b.total, 0)).toBe(0);
  });

  it('uses three-hour buckets for a three-day window with 24 slots', () => {
    // Buckets end at the next 3 h boundary (00:00), so the window opens at 00:00
    // three days earlier; 69 h before 21:30 is 00:30 on that day, the first bucket
    const buckets = bucketActivity([event(69, 'azure')], 72, 24, NOW);
    expect(buckets[1].start - buckets[0].start).toBe(3 * HOUR);
    expect(buckets[0].start).toBe(Date.UTC(2026, 8, 2, 0, 0));
    expect(buckets[0].total).toBe(1);
  });
});
