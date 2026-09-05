import { eachDayOfInterval, format, startOfDay, subDays } from 'date-fns';
import type { ActivityDay, ActivityEvent } from '@/types';

export type ActivitySource = ActivityEvent['source'];
export const ACTIVITY_SOURCES: ActivitySource[] = ['azure', 'github', 'foundry'];

export interface ActivityBucket {
  /** Start of the bucket, epoch ms */
  start: number;
  /** End of the bucket (exclusive), epoch ms */
  end: number;
  counts: Record<ActivitySource, number>;
  total: number;
  /** Events with level error or warning, so the chart can flag them */
  problems: number;
}

/**
 * Group events into `slots` equal buckets covering the last `hours`, the last
 * bucket ending at the next bucket boundary after `now`. Bucket width is
 * therefore `hours / slots`; callers choose the resolution (the chart uses
 * half-hour buckets for a day and hourly buckets for longer windows).
 */
export function bucketActivity(
  events: ActivityEvent[],
  hours: number,
  slots = 24,
  now = Date.now()
): ActivityBucket[] {
  const windowMs = hours * 60 * 60 * 1000;
  const width = windowMs / slots;
  // Align the window end to the next bucket boundary so the last bar is "now"
  const end = Math.ceil(now / width) * width;
  const start = end - windowMs;
  const buckets: ActivityBucket[] = Array.from({ length: slots }, (_, i) => ({
    start: start + i * width,
    end: start + (i + 1) * width,
    counts: { azure: 0, github: 0, foundry: 0 },
    total: 0,
    problems: 0,
  }));
  for (const event of events) {
    const t = Date.parse(event.timestamp);
    if (!Number.isFinite(t) || t < start || t >= end) continue;
    const bucket = buckets[Math.min(slots - 1, Math.floor((t - start) / width))];
    bucket.counts[event.source] += 1;
    bucket.total += 1;
    if (event.level === 'error' || event.level === 'warning') bucket.problems += 1;
  }
  return buckets;
}

/**
 * Events per calendar day for the last `days` days (today included), one entry
 * per day whether or not anything happened, oldest first. Calendar-day
 * arithmetic, so DST changes neither skip nor duplicate a day.
 */
export function dailyActivity(
  events: ActivityEvent[],
  days = 365,
  now = new Date()
): ActivityDay[] {
  const end = startOfDay(now);
  const byDate = new Map<string, ActivityDay>();
  for (const day of eachDayOfInterval({ start: subDays(end, days - 1), end })) {
    const date = format(day, 'yyyy-MM-dd');
    byDate.set(date, { date, total: 0, github: 0, azure: 0, foundry: 0 });
  }
  for (const event of events) {
    const t = Date.parse(event.timestamp);
    if (!Number.isFinite(t)) continue;
    const day = byDate.get(format(t, 'yyyy-MM-dd'));
    if (!day) continue;
    day.total += 1;
    day[event.source] += 1;
  }
  return [...byDate.values()];
}
