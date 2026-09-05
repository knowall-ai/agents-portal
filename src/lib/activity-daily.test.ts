import { describe, expect, it } from 'vitest';
import { dailyActivity } from './activity-buckets';
import type { ActivityEvent } from '@/types';

function event(iso: string, source: ActivityEvent['source']): ActivityEvent {
  return {
    id: `${source}:${iso}`,
    agentId: 'a',
    agentName: 'A',
    timestamp: iso,
    source,
    title: 't',
    level: 'info',
  };
}

describe('dailyActivity', () => {
  const now = new Date(2026, 8, 4, 21, 30); // local time, 4 Sep 2026

  it('returns one entry per day, today last, with per-source counts', () => {
    const days = dailyActivity(
      [
        event(new Date(2026, 8, 4, 9).toISOString(), 'github'),
        event(new Date(2026, 8, 4, 10).toISOString(), 'azure'),
        event(new Date(2026, 8, 1, 10).toISOString(), 'foundry'),
      ],
      7,
      now
    );
    expect(days).toHaveLength(7);
    expect(days[6]).toEqual({ date: '2026-09-04', total: 2, github: 1, azure: 1, foundry: 0 });
    expect(days[3]).toEqual({ date: '2026-09-01', total: 1, github: 0, azure: 0, foundry: 1 });
    expect(days[0].date).toBe('2026-08-29');
  });

  it('keeps every calendar day across a DST change', () => {
    // 25 Oct 2026 is the UK clock change; 30 days around it must still be 30 entries
    const days = dailyActivity([], 30, new Date(2026, 10, 5));
    expect(days).toHaveLength(30);
    expect(new Set(days.map((d) => d.date)).size).toBe(30);
  });

  it('ignores events outside the window and with bad timestamps', () => {
    const days = dailyActivity(
      [event(new Date(2025, 0, 1).toISOString(), 'github'), event('nope', 'github')],
      7,
      now
    );
    expect(days.reduce((n, d) => n + d.total, 0)).toBe(0);
  });
});
