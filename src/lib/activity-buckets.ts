import type { ActivityEvent } from '@/types';

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
 * Group events into equal time buckets ending now. The window is `hours` long
 * and always splits into `slots` buckets, so a 24 h chart has hourly bars and a
 * 72 h chart three-hourly bars with the same number of columns.
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
