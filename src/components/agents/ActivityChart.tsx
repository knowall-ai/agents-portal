'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import { LoadingSpinner } from '@/components/common';
import { ACTIVITY_SOURCES, bucketActivity, type ActivitySource } from '@/lib/activity-buckets';
import type { ActivityEvent, MetricPoint } from '@/types';

const SOURCE_COLOUR: Record<ActivitySource, string> = {
  azure: '#3b82f6',
  github: '#9ca3af',
  foundry: '#8b5cf6',
};
const SOURCE_LABEL: Record<ActivitySource, string> = {
  azure: 'Azure',
  github: 'GitHub',
  foundry: 'Foundry',
};

interface ActivityChartProps {
  events: ActivityEvent[] | null;
  /** Window length; 24 gives hourly bars, 72 three-hourly */
  hours: number;
  isLoading: boolean;
  /** VM CPU samples (average %, epoch ms) drawn as a line on a 0-100 axis */
  cpu?: MetricPoint[] | null;
  height?: number;
}

/** Half-hour bars on the day view, hourly bars on longer views */
function slotsFor(hours: number): number {
  return hours > 24 ? hours : hours * 2;
}
const PAD = { top: 10, right: 34, bottom: 22, left: 28 };
const CPU_COLOUR = 'var(--primary)';

/**
 * Stacked bars of activity per time bucket, one colour per source, with the
 * newest bucket on the right. Pure SVG so it scales with the card.
 */
export default function ActivityChart({
  events,
  hours,
  isLoading,
  cpu,
  height = 180,
}: ActivityChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  // Draw in real pixels so text and bars stay crisp at any card width
  const [width, setWidth] = useState(900);
  // The wrapper only exists once there is something to draw, so re-run then
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
  const slots = slotsFor(hours);
  const buckets = useMemo(() => bucketActivity(events ?? [], hours, slots), [events, hours, slots]);
  const max = Math.max(1, ...buckets.map((b) => b.total));
  const total = buckets.reduce((n, b) => n + b.total, 0);
  // Average CPU per bucket, so the line shares the bars' time axis
  const cpuByBucket = useMemo(() => {
    if (!cpu || cpu.length === 0) return null;
    return buckets.map((b) => {
      const inBucket = cpu.filter((p) => p.value !== null && p.ts >= b.start && p.ts < b.end) as {
        value: number;
      }[];
      if (inBucket.length === 0) return null;
      return inBucket.reduce((n, p) => n + p.value, 0) / inBucket.length;
    });
  }, [cpu, buckets]);

  if (!showChart) {
    return <LoadingSpinner className="py-6" message="Loading activity..." />;
  }

  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const slot = plotW / slots;
  const barW = Math.max(2, slot * 0.7);
  const ySteps = max <= 4 ? max : 4;
  // A label every 3 h on the day view and every 12 h on the 3-day view
  const tickEvery = hours > 24 ? 12 : 6;
  const labelFor = (ms: number) => (hours > 24 ? format(ms, 'EEE HH:mm') : format(ms, 'HH:mm'));
  const hovered = hover !== null ? buckets[hover] : null;
  const hoveredCpu = hover !== null ? (cpuByBucket?.[hover] ?? null) : null;
  const cpuPath = cpuByBucket
    ? cpuByBucket
        .map((v, i) =>
          v === null
            ? null
            : `${PAD.left + i * slot + slot / 2},${PAD.top + plotH - (plotH * v) / 100}`
        )
        .reduce<string>((d, pt, i, arr) => {
          if (!pt) return d;
          const prev = i > 0 ? arr[i - 1] : null;
          return `${d}${d && prev ? ' L' : ' M'}${pt}`;
        }, '')
    : '';

  return (
    <div ref={wrapRef} className="px-4 pt-3 pb-2">
      <div className="mb-1 flex items-center gap-4 text-xs" style={{ color: 'var(--text-muted)' }}>
        <span>
          {total} event{total === 1 ? '' : 's'} in the last{' '}
          {hours > 24 ? `${hours / 24} days` : `${hours} hours`}
        </span>
        <span className="ml-auto flex items-center gap-3">
          {ACTIVITY_SOURCES.map((s) => (
            <span key={s} className="flex items-center gap-1">
              <span
                className="inline-block h-2 w-2 rounded-sm"
                style={{ backgroundColor: SOURCE_COLOUR[s] }}
              />
              {SOURCE_LABEL[s]}
            </span>
          ))}
          {cpuByBucket && (
            <span className="flex items-center gap-1">
              <span className="inline-block h-0.5 w-3" style={{ backgroundColor: CPU_COLOUR }} />
              VM CPU %
            </span>
          )}
        </span>
      </div>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="block"
        style={{ height, maxWidth: '100%' }}
        role="img"
        aria-label={`Activity over the last ${hours} hours`}
        onMouseLeave={() => setHover(null)}
      >
        {/* gridlines and y labels */}
        {Array.from({ length: ySteps + 1 }, (_, i) => {
          const value = Math.round((max * i) / ySteps);
          const y = PAD.top + plotH - (plotH * i) / ySteps;
          return (
            <g key={i}>
              <line
                x1={PAD.left}
                x2={width - PAD.right}
                y1={y}
                y2={y}
                stroke="var(--border)"
                strokeDasharray={i === 0 ? undefined : '3 4'}
              />
              <text
                x={PAD.left - 6}
                y={y + 3}
                textAnchor="end"
                fontSize="10"
                fill="var(--text-muted)"
              >
                {value}
              </text>
            </g>
          );
        })}
        {/* bars */}
        {buckets.map((b, i) => {
          const x = PAD.left + i * slot + (slot - barW) / 2;
          let yTop = PAD.top + plotH;
          const isHover = hover === i;
          return (
            <g key={b.start} onMouseEnter={() => setHover(i)}>
              <rect
                x={PAD.left + i * slot}
                y={PAD.top}
                width={slot}
                height={plotH}
                fill={isHover ? 'rgba(255,255,255,0.04)' : 'transparent'}
              />
              {ACTIVITY_SOURCES.map((s) => {
                const h = (plotH * b.counts[s]) / max;
                if (h === 0) return null;
                yTop -= h;
                return (
                  <rect
                    key={s}
                    x={x}
                    y={yTop}
                    width={barW}
                    height={h}
                    fill={SOURCE_COLOUR[s]}
                    opacity={hover === null || isHover ? 1 : 0.55}
                    rx={1}
                  />
                );
              })}
              {b.problems > 0 && (
                <circle cx={x + barW / 2} cy={yTop - 5} r={2.5} fill="var(--status-offline)" />
              )}
              {i % tickEvery === 0 && (
                <text
                  x={PAD.left + i * slot + slot / 2}
                  y={height - 6}
                  textAnchor="middle"
                  fontSize="10"
                  fill="var(--text-muted)"
                >
                  {labelFor(b.start)}
                </text>
              )}
            </g>
          );
        })}
        {cpuByBucket && (
          <g>
            {[0, 50, 100].map((v) => (
              <text
                key={v}
                x={width - PAD.right + 6}
                y={PAD.top + plotH - (plotH * v) / 100 + 3}
                fontSize="10"
                fill={CPU_COLOUR}
                opacity={0.8}
              >
                {v}%
              </text>
            ))}
            <path
              d={cpuPath}
              fill="none"
              stroke={CPU_COLOUR}
              strokeWidth={1.5}
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={0.9}
            />
          </g>
        )}
        <text
          x={width - PAD.right}
          y={height - 6}
          textAnchor="end"
          fontSize="10"
          fill="var(--text-secondary)"
        >
          now
        </text>
      </svg>
      <p className="h-4 text-xs" style={{ color: 'var(--text-secondary)' }}>
        {hovered
          ? `${labelFor(hovered.start)} – ${labelFor(hovered.end)}: ${hovered.total} event${
              hovered.total === 1 ? '' : 's'
            }` +
            ACTIVITY_SOURCES.filter((s) => hovered.counts[s] > 0)
              .map((s) => ` · ${SOURCE_LABEL[s]} ${hovered.counts[s]}`)
              .join('') +
            (hovered.problems > 0 ? ` · ${hovered.problems} with warnings or errors` : '') +
            (hoveredCpu !== null ? ` · CPU ${Math.round(hoveredCpu)}%` : '')
          : total === 0
            ? 'No activity in this window'
            : 'Hover a bar for detail'}
      </p>
    </div>
  );
}
