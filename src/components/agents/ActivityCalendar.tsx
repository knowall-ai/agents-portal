'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityCalendar as Calendar, type Activity } from 'react-activity-calendar';
import { format, subDays } from 'date-fns';
import { LoadingSpinner } from '@/components/common';
import type { ActivityEvent } from '@/types';

const WEEKS = 52;

/** Portal greens, darkest to brightest, like a GitHub contributions graph. */
const THEME = {
  dark: ['#1a1d26', '#14532d', '#15803d', '#22c55e', '#4ade80'],
  light: ['#1a1d26', '#14532d', '#15803d', '#22c55e', '#4ade80'],
};

interface ActivityCalendarProps {
  events: ActivityEvent[] | null;
  isLoading: boolean;
}

interface DayTotals {
  total: number;
  github: number;
  azure: number;
  foundry: number;
}

/** One cell per day for the last 16 weeks; colour by how many events landed that day. */
export default function ActivityCalendar({ events, isLoading }: ActivityCalendarProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1200);
  const showChart = !(isLoading && !events);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const w = Math.floor(entry.contentRect.width);
      if (w > 0) setWidth(w);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [showChart]);
  // Size the squares so a year fills the card, like the contributions graph on GitHub
  const blockMargin = 3;
  const blockSize = Math.max(9, Math.min(22, Math.floor((width - 44) / (WEEKS + 1)) - blockMargin));
  const { data, byDay, totals } = useMemo(() => {
    const byDay = new Map<string, DayTotals>();
    const today = new Date();
    const first = subDays(today, WEEKS * 7 - 1);
    for (let d = new Date(first); d <= today; d = new Date(d.getTime() + 86_400_000)) {
      byDay.set(format(d, 'yyyy-MM-dd'), { total: 0, github: 0, azure: 0, foundry: 0 });
    }
    const totals: DayTotals = { total: 0, github: 0, azure: 0, foundry: 0 };
    for (const e of events ?? []) {
      const day = byDay.get(format(new Date(e.timestamp), 'yyyy-MM-dd'));
      if (!day) continue;
      day.total += 1;
      day[e.source] += 1;
      totals.total += 1;
      totals[e.source] += 1;
    }
    const peak = Math.max(1, ...[...byDay.values()].map((d) => d.total));
    const data: Activity[] = [...byDay.entries()].map(([date, day]) => ({
      date,
      count: day.total,
      // four shades above empty, scaled to the busiest day in the window
      level: day.total === 0 ? 0 : Math.max(1, Math.ceil((day.total / peak) * 4)),
    }));
    return { data, byDay, totals };
  }, [events]);

  if (!showChart) {
    return <LoadingSpinner className="py-6" message="Loading activity..." />;
  }

  return (
    <div ref={wrapRef} className="px-4 pt-3 pb-3" style={{ color: 'var(--text-secondary)' }}>
      <div className="mb-2 text-xs" style={{ color: 'var(--text-muted)' }}>
        {totals.total} event{totals.total === 1 ? '' : 's'} in the last {WEEKS} weeks
        {totals.total > 0 && (
          <>
            {' '}
            · {totals.github} commit{totals.github === 1 ? '' : 's'} · {totals.azure} Azure ·{' '}
            {totals.foundry} Foundry
          </>
        )}
      </div>
      <div className="overflow-x-auto">
        <Calendar
          data={data}
          colorScheme="dark"
          theme={THEME}
          maxLevel={4}
          blockSize={blockSize}
          blockMargin={blockMargin}
          blockRadius={2}
          fontSize={11}
          showWeekdayLabels
          labels={{ legend: { less: 'Quiet', more: 'Busy' }, totalCount: ' ' }}
          renderBlock={(block, activity) => {
            const day = byDay.get(activity.date);
            const parts = day
              ? [
                  day.github ? `${day.github} commit${day.github === 1 ? '' : 's'}` : null,
                  day.azure ? `${day.azure} Azure` : null,
                  day.foundry ? `${day.foundry} Foundry` : null,
                ].filter(Boolean)
              : [];
            const label = `${format(new Date(activity.date), 'EEE d MMM')}: ${
              activity.count === 0 ? 'no activity' : parts.join(', ')
            }`;
            return (
              <g>
                <title>{label}</title>
                {block}
              </g>
            );
          }}
        />
      </div>
    </div>
  );
}
