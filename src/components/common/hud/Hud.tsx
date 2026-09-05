'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The cockpit HUD from the agents' video feed, rebuilt for the browser so every
 * portal view can reuse the same panels: bracketed translucent panel,
 * `LABEL ▮▮▮▮ value` gauges with a VU-style peak hold, a boxed sparkline, plain
 * text rows, amber DEEP lines and the amber BOOST chip.
 *
 * CANONICAL SOURCE: knowall-ai/agent-presence — the Python renderer
 * (presence/.../robot_avatar.py) draws the same HUD onto the v4l2 video feed.
 * The two renderers cannot share code (PIL vs DOM), so what must not drift is
 * kept there and mirrored here verbatim:
 *   - design tokens:  presence/hud/tokens.json  (palette, type, column, gauge)
 *   - data contract:  docs/HUD-CONTRACT.md      (usage-stats, boost-state, hud-stats)
 * If a value below disagrees with tokens.json, tokens.json wins — update here.
 */

export const HUD = {
  /** tokens.json G: (157, 255, 10) */
  g: '#9dff0a',
  /** DIM: G at 115/255 alpha */
  dim: 'rgba(157, 255, 10, 0.45)',
  dimStrong: 'rgba(157, 255, 10, 0.78)',
  amber: '#facc15',
  red: '#f85149',
  /** peak-hold tick (235, 255, 245) */
  peak: '#ebfff5',
  /** panel fill (6, 12, 9, 110) */
  panel: 'rgba(6, 12, 9, 0.43)',
  text: '#f0ffcd',
  font: "'DejaVu Sans Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  colWidth: 350,
  gaugeWidth: 140,
  /** SUB gauge goes amber under 20 % left and red under 10 % */
  subAmberBelow: 20,
  subRedBelow: 10,
  /** API gauge goes amber over 80 % of budget and red over 90 % */
  apiAmberOver: 0.8,
  apiRedOver: 0.9,
} as const;

const BRACKET = 16;

interface HudPanelProps {
  title: string;
  children: React.ReactNode;
  /** Draw the top corners doubled in amber, as the renderer does while boosting */
  boost?: boolean;
  className?: string;
}

/** Translucent panel with the four lime bracket corners and a DIM header. */
export function HudPanel({ title, children, boost, className = '' }: HudPanelProps) {
  const corner = (v: 'top' | 'bottom', h: 'left' | 'right') => {
    const amberTop = boost && v === 'top';
    const colour = amberTop ? HUD.amber : HUD.g;
    const len = amberTop ? BRACKET * 2 : BRACKET;
    return (
      <span
        key={`${v}-${h}`}
        aria-hidden
        className="pointer-events-none absolute"
        style={{
          [v]: 0,
          [h]: 0,
          width: len,
          height: BRACKET,
          borderTop: v === 'top' ? `3px solid ${colour}` : undefined,
          borderBottom: v === 'bottom' ? `3px solid ${colour}` : undefined,
          borderLeft: h === 'left' ? `3px solid ${colour}` : undefined,
          borderRight: h === 'right' ? `3px solid ${colour}` : undefined,
        }}
      />
    );
  };
  return (
    <section
      className={`relative px-[14px] pt-2 pb-[10px] ${className}`}
      style={{ backgroundColor: HUD.panel, fontFamily: HUD.font, color: HUD.text, fontSize: 12 }}
    >
      {corner('top', 'left')}
      {corner('top', 'right')}
      {corner('bottom', 'left')}
      {corner('bottom', 'right')}
      <p className="mb-[6px] text-[12px] tracking-wide" style={{ color: HUD.dim }}>
        {title}
      </p>
      {children}
    </section>
  );
}

interface HudGaugeProps {
  label: string;
  /** 0..1 */
  frac: number;
  value: string;
  /** Colour of the fill and the value text; defaults to G */
  colour?: string;
  /** Colour of the label and the bar outline; defaults to DIM */
  dim?: string;
}

/** `LABEL [▮▮▮▮▯▯▯] value` with the brightest value of the last 10 s held as a white tick. */
export function HudGauge({ label, frac, value, colour = HUD.g, dim = HUD.dim }: HudGaugeProps) {
  const peaks = useRef<{ t: number; f: number }[]>([]);
  const [peak, setPeak] = useState(0);
  const clamped = Math.max(0, Math.min(1, Number.isFinite(frac) ? frac : 0));
  useEffect(() => {
    const refresh = () => {
      const now = Date.now();
      peaks.current = peaks.current.filter((p) => p.t > now - 10_000);
      setPeak(Math.max(...peaks.current.map((p) => p.f), 0));
    };
    peaks.current.push({ t: Date.now(), f: clamped });
    refresh();
    // the hold also has to expire while the value sits still
    const timer = setInterval(refresh, 1000);
    return () => clearInterval(timer);
  }, [clamped]);
  return (
    <div className="flex h-[20px] items-center" style={{ fontFamily: HUD.font, fontSize: 12 }}>
      <span className="w-[44px]" style={{ color: dim }}>
        {label}
      </span>
      <span
        className="relative h-[10px] shrink-0"
        style={{ width: HUD.gaugeWidth, border: `1px solid ${dim}` }}
      >
        <span
          className="absolute top-[1px] bottom-[1px] left-[1px]"
          style={{ width: `calc(${clamped * 100}% - 2px)`, backgroundColor: colour }}
        />
        {peak > 0.02 && (
          <span
            className="absolute top-0 bottom-0 w-[2px]"
            style={{ left: `calc(${peak * 100}% - 1px)`, backgroundColor: HUD.peak }}
          />
        )}
      </span>
      <span className="ml-[7px] truncate" style={{ color: colour }}>
        {value.trim()}
      </span>
    </div>
  );
}

/** Boxed sparkline of the last 60 samples (0..100), like the CPU history on the video. */
export function HudSparkline({ values, height = 20 }: { values: number[]; height?: number }) {
  const pts = values.slice(-60);
  return (
    <svg
      className="mt-[2px] block w-full"
      style={{ height, border: `1px solid ${HUD.dim}` }}
      viewBox={`0 0 100 ${height}`}
      preserveAspectRatio="none"
    >
      {pts.length > 1 && (
        <polyline
          fill="none"
          stroke={HUD.g}
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
          points={pts
            .map(
              (v, i) =>
                `${(i / (pts.length - 1)) * 100},${height - (Math.min(v, 100) / 100) * height}`
            )
            .join(' ')}
        />
      )}
    </svg>
  );
}

/** A plain stats row in G, e.g. `TURNS 12  TTFT 0.8s  CALL 03:12`. */
export function HudRow({
  children,
  colour = HUD.g,
}: {
  children: React.ReactNode;
  colour?: string;
}) {
  return (
    <p
      className="h-[16px] leading-[16px] whitespace-pre"
      style={{ color: colour, fontFamily: HUD.font, fontSize: 12 }}
    >
      {children}
    </p>
  );
}

/** Amber `DEEP <label> <elapsed>s` line for work in progress. */
export function HudDeep({ label, since }: { label: string; since: number }) {
  const [el, setEl] = useState(0);
  useEffect(() => {
    const tick = () => setEl(Math.max(0, Math.round(Date.now() / 1000 - since)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [since]);
  return (
    <HudRow colour={HUD.amber}>
      DEEP {label.slice(0, 30)} {el}s
    </HudRow>
  );
}

/** The pulsing amber BOOST chip that sits on top of the usage panel while boosting. */
export function HudBoostChip({ minutesLeft }: { minutesLeft: number }) {
  return (
    <div
      className="flex h-[22px] items-center gap-2 px-3"
      style={{ backgroundColor: 'rgba(28, 20, 4, 0.67)', fontFamily: HUD.font, fontSize: 12 }}
    >
      <svg width="9" height="15" viewBox="0 0 9 15" aria-hidden className="hud-boost-pulse">
        <polygon points="6,0 1,9 4,9 0,15 8,6.75 4.5,6.75 8,0" fill={HUD.amber} />
      </svg>
      <span className="hud-boost-pulse" style={{ color: HUD.amber }}>
        BOOST — FAST TIER · {minutesLeft}m left
      </span>
    </div>
  );
}
