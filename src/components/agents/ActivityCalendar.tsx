'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityCalendar as Calendar, type Activity } from 'react-activity-calendar';
import { format } from 'date-fns';
import { LoadingSpinner } from '@/components/common';
import type { ActivityDay } from '@/types';

const WEEKS = 52;

/** Portal greens, darkest to brightest, like a GitHub contributions graph. */
const THEME = {
  dark: ['#1a1d26', '#14532d', '#15803d', '#22c55e', '#4ade80'],
  light: ['#1a1d26', '#14532d', '#15803d', '#22c55e', '#4ade80'],
};

interface ActivityCalendarProps {
  /** One entry per day, oldest first, as the activity API returns */
  days: ActivityDay[] | null;
  isLoading: boolean;
}

/** One cell per day for the last year; colour by how many events landed that day. */
export default function ActivityCalendar({ days, isLoading }: ActivityCalendarProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1200);
  const showChart = !(isLoading && !days);
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
  // Size the squares so a year fills the card, like the contributions graph on GitHub;
  // weekday labels take ~34px, the rest is 53 columns of square + gap
  const blockMargin = 3;
  const blockSize = Math.max(9, Math.floor((width - 34) / (WEEKS + 1)) - blockMargin);

  const { data, byDate, totals } = useMemo(() => {
    const window = (days ?? []).slice(-WEEKS * 7);
    const byDate = new Map(window.map((d) => [d.date, d]));
    const totals = window.reduce(
      (acc, d) => ({
        total: acc.total + d.total,
        github: acc.github + d.github,
        azure: acc.azure + d.azure,
        foundry: acc.foundry + d.foundry,
      }),
      { total: 0, github: 0, azure: 0, foundry: 0 }
    );
    const peak = Math.max(1, ...window.map((d) => d.total));
    const data: Activity[] = window.map((d) => ({
      date: d.date,
      count: d.total,
      // four shades above empty, scaled to the busiest day in the window
      level: d.total === 0 ? 0 : Math.max(1, Math.ceil((d.total / peak) * 4)),
    }));
    return { data, byDate, totals };
  }, [days]);

  if (!showChart) {
    return <LoadingSpinner className="py-6" message="Loading activity..." />;
  }
  if (data.length === 0) {
    return (
      <p className="px-4 py-6 text-sm" style={{ color: 'var(--text-muted)' }}>
        No activity recorded yet
      </p>
    );
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
            const day = byDate.get(activity.date);
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
