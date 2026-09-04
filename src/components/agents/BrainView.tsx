'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation } from 'd3-force-3d';
import type { Simulation, SimulationLinkDatum, SimulationNodeDatum } from 'd3-force-3d';
import { formatDistanceToNow } from 'date-fns';
import { Moon, Pause, Play, RotateCcw, Sparkles, Sun, Zap } from 'lucide-react';
import { EmptyState, LoadingSpinner } from '@/components/common';
import type {
  AgentBrain,
  AgentStatus,
  BrainActivation,
  BrainDiff,
  BrainNode,
  BrainRel,
  BrainState,
  BrainStats,
} from '@/types';

// ---------------------------------------------------------------------------
// Look
// ---------------------------------------------------------------------------

const LABEL_COLOURS: Record<string, string> = {
  Person: '#22c55e',
  Organization: '#3b82f6',
  Project: '#f97316',
  Product: '#a855f7',
  Concept: '#eab308',
  Meeting: '#06b6d4',
  Decision: '#ec4899',
  Risk: '#ef4444',
};
const OTHER_COLOUR = '#9ca3af';
const READ_COLOUR = '#67e8f9'; // recall
const WRITE_COLOUR = '#86efac'; // remember / connect
const NEW_COLOUR = '#ffffff';
const FORGET_COLOUR = '#f87171';
const HIGHLIGHT_MS: Record<string, number> = {
  recall: 9000,
  remember: 11000,
  connect: 11000,
  forget: 8000,
  added: 8000,
};
const FEED_MAX = 60;
const CANVAS_HEIGHT = 640;
const FOCAL = 1100;
const DEFAULT_ZOOM = 1.3;
const TILT = 0.32;
const AUTO_ROTATE = 0.0022; // radians per frame ≈ one turn every 48 s

function colourFor(label: string): string {
  return LABEL_COLOURS[label] ?? OTHER_COLOUR;
}

function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// ---------------------------------------------------------------------------
// Simulation types
// ---------------------------------------------------------------------------

interface SimNode extends SimulationNodeDatum, BrainNode {
  /** screen-space cache for hit testing */
  sx?: number;
  sy?: number;
  sr?: number;
  depth?: number;
}
interface SimLink extends SimulationLinkDatum<SimNode> {
  id: string;
  type: string;
  updatedAt: number;
}
interface Highlight {
  colour: string;
  until: number;
  kind: string;
}

interface BrainViewProps {
  agentId: string;
  agentName: string;
  agentStatus: AgentStatus;
  brain: AgentBrain | null;
  isLoading: boolean;
  error?: string | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function BrainView({
  agentId,
  agentName,
  agentStatus,
  brain,
  isLoading,
  error,
}: BrainViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<SimLink[]>([]);
  const byIdRef = useRef<Map<string, SimNode>>(new Map());
  const byNameRef = useRef<Map<string, SimNode>>(new Map());
  const highlightsRef = useRef<Map<string, Highlight>>(new Map());
  const linkFlashRef = useRef<Map<string, number>>(new Map());
  const angleRef = useRef(0.6);
  const zoomRef = useRef(DEFAULT_ZOOM);
  const dragRef = useRef<{ x: number; y: number; angle: number } | null>(null);
  const hoverRef = useRef<SimNode | null>(null);
  const rotateRef = useRef(true);
  const dreamingRef = useRef(false);

  const [feed, setFeed] = useState<BrainActivation[]>([]);
  const [stats, setStats] = useState<BrainStats | null>(null);
  const [state, setState] = useState<BrainState | null>(null);
  const [selected, setSelected] = useState<SimNode | null>(null);
  const [rotating, setRotating] = useState(true);
  const [streamStatus, setStreamStatus] = useState<'connecting' | 'live' | 'offline'>('connecting');
  const [tick, setTick] = useState(0);
  const [clock, setClock] = useState(() => Date.now());
  const [selectedLinks, setSelectedLinks] = useState<SimLink[]>([]);

  const snapshot = brain?.snapshot;

  // ---- build simulation from snapshot -------------------------------------
  useEffect(() => {
    if (!snapshot) return;
    const nodes: SimNode[] = snapshot.nodes.map((n, i) => {
      const golden = i * 2.399963;
      const r = 60 + Math.sqrt(i) * 30;
      return {
        ...n,
        x: Math.cos(golden) * r,
        y: (Math.random() - 0.5) * 220,
        z: Math.sin(golden) * r,
      };
    });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const links: SimLink[] = snapshot.rels
      .filter((r) => byId.has(r.source) && byId.has(r.target))
      .map((r) => ({
        id: r.id,
        type: r.type,
        updatedAt: r.updatedAt,
        source: r.source,
        target: r.target,
      }));
    nodesRef.current = nodes;
    linksRef.current = links;
    byIdRef.current = byId;
    byNameRef.current = new Map(nodes.map((n) => [n.name.toLowerCase(), n]));
    setStats(snapshot.stats);
    setState(snapshot.state);
    dreamingRef.current = snapshot.state.dreaming;

    simRef.current?.stop();
    const sim = forceSimulation<SimNode, SimLink>(nodes, 3)
      .force(
        'link',
        forceLink<SimNode, SimLink>(links)
          .id((d) => d.id)
          .distance(120)
          .strength(0.5)
      )
      .force('charge', forceManyBody<SimNode>().strength(-320).distanceMax(1200))
      .force('center', forceCenter<SimNode>(0, 0, 0).strength(0.05))
      .force(
        'collide',
        forceCollide<SimNode>((d) => 16 + Math.sqrt(d.degree) * 3)
      )
      .alphaDecay(0.015)
      .velocityDecay(0.35);
    simRef.current = sim;
    setTick((t) => t + 1);
    return () => {
      sim.stop();
    };
  }, [snapshot]);

  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  // ---- highlights -----------------------------------------------------------
  const highlight = useCallback((ids: string[], kind: string, colour: string) => {
    const until = Date.now() + (HIGHLIGHT_MS[kind] ?? 8000);
    for (const id of ids) {
      if (byIdRef.current.has(id)) highlightsRef.current.set(id, { colour, until, kind });
    }
  }, []);

  const idsFor = useCallback((activation: BrainActivation): string[] => {
    const ids = new Set<string>();
    for (const id of activation.ids ?? []) ids.add(id);
    if (activation.id) ids.add(activation.id);
    for (const name of [...(activation.names ?? []), activation.name].filter(
      (n): n is string => !!n
    )) {
      const hit = byNameRef.current.get(name.toLowerCase());
      if (hit) ids.add(hit.id);
    }
    return [...ids];
  }, []);

  const applyActivation = useCallback(
    (activation: BrainActivation) => {
      setFeed((f) => [activation, ...f].slice(0, FEED_MAX));
      if (activation.kind === 'dream.start') dreamingRef.current = true;
      if (activation.kind === 'dream.end') dreamingRef.current = false;
      const ids = idsFor(activation);
      if (activation.kind === 'recall') highlight(ids, 'recall', READ_COLOUR);
      else if (activation.kind === 'remember') highlight(ids, 'remember', WRITE_COLOUR);
      else if (activation.kind === 'connect') {
        highlight(ids, 'connect', WRITE_COLOUR);
        if (ids.length === 2) {
          for (const l of linksRef.current) {
            const s = (l.source as SimNode).id ?? l.source;
            const t = (l.target as SimNode).id ?? l.target;
            if (ids.includes(String(s)) && ids.includes(String(t))) {
              linkFlashRef.current.set(l.id, Date.now() + 10000);
            }
          }
        }
      } else if (activation.kind === 'forget') highlight(ids, 'forget', FORGET_COLOUR);
    },
    [highlight, idsFor]
  );

  const applyDiff = useCallback((diff: BrainDiff) => {
    const sim = simRef.current;
    if (!sim) return;
    const nodes = nodesRef.current;
    const links = linksRef.current;
    const byId = byIdRef.current;
    for (const id of diff.nodesRemoved ?? []) {
      const n = byId.get(id);
      if (!n) continue;
      byId.delete(id);
      byNameRef.current.delete(n.name.toLowerCase());
      nodes.splice(nodes.indexOf(n), 1);
    }
    for (const rid of diff.relsRemoved ?? []) {
      const i = links.findIndex((l) => l.id === rid);
      if (i !== -1) links.splice(i, 1);
    }
    for (const n of diff.nodesUpdated ?? []) {
      const existing = byId.get(n.id);
      if (existing)
        Object.assign(existing, { degree: n.degree, updatedAt: n.updatedAt, props: n.props });
    }
    for (const n of diff.nodesAdded ?? []) {
      if (byId.has(n.id)) continue;
      const anchorRel = (diff.relsAdded ?? []).find((r) => r.source === n.id || r.target === n.id);
      const anchor = anchorRel
        ? byId.get(anchorRel.source === n.id ? anchorRel.target : anchorRel.source)
        : undefined;
      const sn: SimNode = {
        ...n,
        x: (anchor?.x ?? 0) + (Math.random() - 0.5) * 40,
        y: (anchor?.y ?? 0) + (Math.random() - 0.5) * 40,
        z: (anchor?.z ?? 0) + (Math.random() - 0.5) * 40,
      };
      nodes.push(sn);
      byId.set(sn.id, sn);
      byNameRef.current.set(sn.name.toLowerCase(), sn);
      highlightsRef.current.set(sn.id, {
        colour: NEW_COLOUR,
        until: Date.now() + HIGHLIGHT_MS.added,
        kind: 'added',
      });
    }
    for (const r of diff.relsAdded ?? []) {
      if (!byId.has(r.source) || !byId.has(r.target) || links.some((l) => l.id === r.id)) continue;
      links.push({
        id: r.id,
        type: r.type,
        updatedAt: r.updatedAt,
        source: r.source,
        target: r.target,
      });
      linkFlashRef.current.set(r.id, Date.now() + 10000);
    }
    sim.nodes(nodes);
    (sim.force('link') as ReturnType<typeof forceLink<SimNode, SimLink>>).links(links);
    sim.alpha(0.4).restart();
    if (diff.stats) setStats(diff.stats);
  }, []);

  // ---- live stream ------------------------------------------------------------
  useEffect(() => {
    if (!brain?.available || !snapshot) return;
    const source = new EventSource(`/api/agents/${agentId}/brain/events`);
    source.onopen = () => setStreamStatus('live');
    source.onerror = () => setStreamStatus('offline');
    source.addEventListener('activation', (e) => {
      try {
        applyActivation(JSON.parse((e as MessageEvent).data) as BrainActivation);
      } catch {
        // ignore malformed
      }
    });
    source.addEventListener('graph', (e) => {
      try {
        applyDiff(JSON.parse((e as MessageEvent).data) as BrainDiff);
      } catch {
        // ignore malformed
      }
    });
    source.addEventListener('state', (e) => {
      try {
        const next = JSON.parse((e as MessageEvent).data) as Partial<BrainState>;
        setState((s) => ({ ...(s as BrainState), ...next }));
        if (typeof next.dreaming === 'boolean') dreamingRef.current = next.dreaming;
      } catch {
        // ignore malformed
      }
    });
    return () => source.close();
  }, [agentId, brain?.available, snapshot, applyActivation, applyDiff]);

  // ---- render loop -------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    let frame = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = wrap.clientWidth;
      const h = CANVAS_HEIGHT;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);

    const draw = () => {
      frame += 1;
      const w = wrap.clientWidth;
      const h = CANVAS_HEIGHT;
      const cx = w / 2;
      const cy = h / 2;
      const now = Date.now();
      if (rotateRef.current && !dragRef.current) angleRef.current += AUTO_ROTATE;
      const a = angleRef.current;
      const cosA = Math.cos(a);
      const sinA = Math.sin(a);
      const cosT = Math.cos(TILT);
      const sinT = Math.sin(TILT);
      const zoom = zoomRef.current;
      const asleep = agentStatus === 'offline';
      const dreaming = dreamingRef.current;

      // background
      const bg = ctx.createRadialGradient(cx, cy * 0.9, 40, cx, cy, Math.max(w, h) * 0.8);
      bg.addColorStop(0, dreaming ? '#191233' : '#12161f');
      bg.addColorStop(1, '#0a0c11');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(255,255,255,0.035)';
      for (let gx = 20; gx < w; gx += 40) {
        for (let gy = 20; gy < h; gy += 40) ctx.fillRect(gx, gy, 1, 1);
      }
      if (dreaming) {
        const pulse = 0.5 + 0.5 * Math.sin(frame / 40);
        const aura = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(w, h) * 0.55);
        aura.addColorStop(0, `rgba(139, 92, 246, ${0.16 + pulse * 0.1})`);
        aura.addColorStop(1, 'rgba(139, 92, 246, 0)');
        ctx.fillStyle = aura;
        ctx.fillRect(0, 0, w, h);
      }

      // project
      const nodes = nodesRef.current;
      for (const n of nodes) {
        const x = n.x ?? 0;
        const y = n.y ?? 0;
        const z = n.z ?? 0;
        const rx = x * cosA + z * sinA;
        const rz = -x * sinA + z * cosA;
        const ry = y * cosT - rz * sinT;
        const rz2 = y * sinT + rz * cosT;
        const scale = (FOCAL / (FOCAL + rz2)) * zoom;
        n.sx = cx + rx * scale;
        n.sy = cy + ry * scale;
        n.depth = scale;
        n.sr = (3 + Math.sqrt(n.degree) * 1.7) * scale;
      }

      // edges
      ctx.lineWidth = 1;
      for (const l of linksRef.current) {
        const s = l.source as SimNode;
        const t = l.target as SimNode;
        if (s.sx === undefined || t.sx === undefined) continue;
        const depth = ((s.depth ?? 1) + (t.depth ?? 1)) / 2;
        const flash = linkFlashRef.current.get(l.id);
        const hs = highlightsRef.current.get(s.id);
        const ht = highlightsRef.current.get(t.id);
        const lit = (flash && flash > now) || (hs && ht);
        ctx.strokeStyle = lit
          ? hexToRgba(WRITE_COLOUR, 0.55)
          : `rgba(148, 163, 184, ${0.06 + depth * 0.1})`;
        ctx.lineWidth = lit ? 1.6 : 0.8;
        ctx.beginPath();
        ctx.moveTo(s.sx, s.sy as number);
        ctx.lineTo(t.sx, t.sy as number);
        ctx.stroke();
        if (lit || (hoverRef.current && (hoverRef.current === s || hoverRef.current === t))) {
          ctx.fillStyle = 'rgba(203, 213, 225, 0.75)';
          ctx.font = `${Math.max(9, 10 * depth)}px ui-monospace, monospace`;
          ctx.fillText(
            l.type,
            (s.sx + t.sx) / 2 + 4,
            ((s.sy as number) + (t.sy as number)) / 2 - 3
          );
        }
      }

      // nodes, far to near
      const ordered = [...nodes].sort((p, q) => (p.depth ?? 0) - (q.depth ?? 0));
      const labelThreshold = nodes.length > 120 ? 5 : nodes.length > 30 ? 3 : 1;
      for (const n of ordered) {
        const x = n.sx as number;
        const y = n.sy as number;
        const r = n.sr as number;
        const depth = n.depth ?? 1;
        const colour = colourFor(n.label);
        const hl = highlightsRef.current.get(n.id);
        if (hl && hl.until < now) highlightsRef.current.delete(n.id);
        const active = hl && hl.until > now ? hl : undefined;
        const hovered = hoverRef.current === n || selected?.id === n.id;

        if (active) {
          const life = (active.until - now) / (HIGHLIGHT_MS[active.kind] ?? 8000);
          const ring = r + 6 + (1 - life) * 22 + 3 * Math.sin(frame / 6);
          const glow = ctx.createRadialGradient(x, y, r, x, y, ring);
          glow.addColorStop(0, hexToRgba(active.colour, 0.55 * life + 0.1));
          glow.addColorStop(1, hexToRgba(active.colour, 0));
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(x, y, ring, 0, Math.PI * 2);
          ctx.fill();
        }
        const alpha = asleep ? 0.35 : 0.55 + depth * 0.45;
        ctx.fillStyle = hexToRgba(colour, Math.min(1, alpha));
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        if (hovered || active) {
          ctx.strokeStyle = active ? active.colour : '#f3f4f6';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
        if (hovered || active || n.degree >= labelThreshold) {
          ctx.fillStyle =
            hovered || active ? '#f3f4f6' : `rgba(226, 232, 240, ${0.35 + depth * 0.5})`;
          ctx.font = `${hovered || active ? 600 : 400} ${Math.max(9, 11 * depth)}px ui-sans-serif, system-ui, sans-serif`;
          ctx.fillText(n.name, x + r + 4, y + 4);
        }
      }

      if (asleep) {
        ctx.fillStyle = 'rgba(10, 12, 17, 0.45)';
        ctx.fillRect(0, 0, w, h);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [agentStatus, selected, tick]);

  // ---- interaction --------------------------------------------------------------
  const pick = (e: React.MouseEvent<HTMLCanvasElement>): SimNode | null => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    let best: SimNode | null = null;
    let bestD = 12;
    for (const n of nodesRef.current) {
      if (n.sx === undefined || n.sy === undefined) continue;
      const d = Math.hypot(n.sx - px, n.sy - py) - (n.sr ?? 3);
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best;
  };

  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    dragRef.current = { x: e.clientX, y: e.clientY, angle: angleRef.current };
  };
  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (dragRef.current) {
      angleRef.current = dragRef.current.angle + (e.clientX - dragRef.current.x) * 0.006;
      return;
    }
    hoverRef.current = pick(e);
    e.currentTarget.style.cursor = hoverRef.current ? 'pointer' : 'grab';
  };
  const onMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const moved = dragRef.current && Math.abs(e.clientX - dragRef.current.x) > 4;
    dragRef.current = null;
    if (!moved) {
      const node = pick(e);
      setSelected(node);
      setSelectedLinks(
        node
          ? linksRef.current
              .filter(
                (l) => (l.source as SimNode).id === node.id || (l.target as SimNode).id === node.id
              )
              .slice(0, 12)
          : []
      );
    }
  };
  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    zoomRef.current = Math.min(3, Math.max(0.4, zoomRef.current * (e.deltaY > 0 ? 0.92 : 1.08)));
  };

  const legend = useMemo(
    () => Object.entries(stats?.labels ?? {}).sort((a, b) => b[1] - a[1]),
    [stats]
  );
  const sparkline = useMemo(() => {
    const now = clock / 1000;
    const buckets = new Array(30).fill(0);
    for (const ev of feed) {
      const m = Math.floor((now - ev.ts) / 60);
      if (m >= 0 && m < 30) buckets[29 - m] += 1;
    }
    return buckets;
  }, [feed, clock]);

  // ---- states -----------------------------------------------------------------------
  if (isLoading && !brain)
    return <LoadingSpinner className="py-12" message="Waking the brain..." />;
  if (error && !brain) return <EmptyState title="Could not load brain" description={error} />;
  if (!brain?.available) {
    return (
      <EmptyState
        icon={<Sparkles size={28} />}
        title="No brain connected"
        description={
          brain?.error ?? 'Set brainUrl in the registry and REVERIE_TOKEN on the server.'
        }
      />
    );
  }
  if (!snapshot) return <EmptyState title="Brain unavailable" description={brain.error} />;

  const asleep = agentStatus === 'offline';
  const dreaming = state?.dreaming ?? false;
  const mood = asleep ? 'Asleep' : dreaming ? 'Dreaming' : 'Awake';
  const moodColour = asleep ? 'var(--text-muted)' : dreaming ? '#a78bfa' : 'var(--status-online)';

  return (
    <div className="grid grid-cols-1 gap-0 lg:grid-cols-[300px_1fr]">
      {/* Left column: status, deep-brain feed, telemetry */}
      <div
        className="flex flex-col gap-4 border-b p-4 font-mono text-xs lg:border-r lg:border-b-0"
        style={{ borderColor: 'var(--border)', maxHeight: CANVAS_HEIGHT, overflowY: 'auto' }}
      >
        <div className="flex items-center gap-2">
          <span
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-semibold tracking-wide uppercase"
            style={{ backgroundColor: 'var(--surface-hover)', color: moodColour }}
          >
            {asleep ? <Moon size={12} /> : dreaming ? <Sparkles size={12} /> : <Sun size={12} />}
            {mood}
          </span>
          <span style={{ color: 'var(--text-muted)' }}>
            {streamStatus === 'live'
              ? '● live'
              : streamStatus === 'connecting'
                ? '○ connecting'
                : '○ stream offline'}
          </span>
          {brain.fixture && <span style={{ color: 'var(--warning)' }}>fixture</span>}
        </div>

        {selected && (
          <Panel title="FOCUS">
            <p className="font-semibold" style={{ color: colourFor(selected.label) }}>
              {selected.name}
            </p>
            <p style={{ color: 'var(--text-muted)' }}>
              {selected.label} · {selected.degree} connections
            </p>
            <ul className="mt-2 space-y-0.5">
              {Object.entries(selected.props)
                .filter(([k]) => k !== 'name')
                .slice(0, 8)
                .map(([k, v]) => (
                  <li key={k} className="truncate" style={{ color: 'var(--text-secondary)' }}>
                    <span style={{ color: 'var(--text-muted)' }}>{k}:</span> {String(v)}
                  </li>
                ))}
            </ul>
            {selectedLinks.length > 0 && (
              <ul className="mt-2 space-y-0.5">
                {selectedLinks.map((l) => {
                  const s = l.source as SimNode;
                  const t = l.target as SimNode;
                  const other = s.id === selected.id ? t : s;
                  return (
                    <li key={l.id} className="truncate" style={{ color: 'var(--text-secondary)' }}>
                      <span style={{ color: 'var(--text-muted)' }}>
                        {s.id === selected.id ? '→' : '←'} {l.type}
                      </span>{' '}
                      {other.name}
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        )}

        <Panel title={`${agentName.toUpperCase()} // DEEP BRAIN`}>
          {feed.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>Waiting for the first thought…</p>
          ) : (
            <ul className="space-y-1.5">
              {feed.slice(0, 10).map((ev, i) => (
                <li key={`${ev.ts}-${i}`} className="flex gap-2 leading-snug">
                  <span style={{ color: activationColour(ev.kind) }}>
                    {activationGlyph(ev.kind)}
                  </span>
                  <span className="min-w-0 flex-1" style={{ color: 'var(--text-secondary)' }}>
                    <span style={{ color: activationColour(ev.kind) }}>{ev.kind}</span>{' '}
                    {activationText(ev)}
                    <span className="ml-1" style={{ color: 'var(--text-muted)' }}>
                      {formatDistanceToNow(new Date(ev.ts * 1000), { addSuffix: true })}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={`${agentName.toUpperCase()} // TELEMETRY`}>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            <Stat label="nodes" value={stats?.nodeCount ?? 0} />
            <Stat label="edges" value={stats?.relCount ?? 0} />
            <Stat label="reads 15m" value={state?.recentReads ?? 0} />
            <Stat label="writes 15m" value={state?.recentWrites ?? 0} />
          </div>
          <div className="mt-1 space-y-1">
            <Stat
              label="last dream"
              value={
                state?.lastDreamAt
                  ? formatDistanceToNow(new Date(state.lastDreamAt * 1000), { addSuffix: true })
                  : '—'
              }
            />
            <Stat
              label="last thought"
              value={
                state?.lastActivityAt
                  ? formatDistanceToNow(new Date(state.lastActivityAt * 1000), { addSuffix: true })
                  : '—'
              }
            />
          </div>
          <div
            className="mt-3 flex h-8 items-end gap-[2px]"
            title="activations per minute, last 30 min"
          >
            {sparkline.map((v, i) => (
              <span
                key={i}
                className="flex-1 rounded-sm"
                style={{
                  height: `${Math.max(6, Math.min(100, v * 25))}%`,
                  backgroundColor: v ? 'var(--primary)' : 'var(--surface-hover)',
                  opacity: v ? 0.9 : 0.6,
                }}
              />
            ))}
          </div>
          <ul className="mt-3 space-y-1">
            {legend.map(([label, count]) => (
              <li key={label} className="flex items-center gap-2">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: colourFor(label) }}
                />
                <span className="flex-1" style={{ color: 'var(--text-secondary)' }}>
                  {label}
                </span>
                <span style={{ color: 'var(--text-muted)' }}>{count}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      {/* Main: the graph */}
      <div ref={wrapRef} className="relative" style={{ height: CANVAS_HEIGHT }}>
        <canvas
          ref={canvasRef}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={() => {
            dragRef.current = null;
            hoverRef.current = null;
          }}
          onWheel={onWheel}
          style={{ display: 'block', cursor: 'grab' }}
        />
        <div className="absolute top-3 right-3 flex items-center gap-1">
          <button
            type="button"
            className="btn-secondary flex items-center gap-1 px-2 py-1 text-xs"
            onClick={() => {
              rotateRef.current = !rotateRef.current;
              setRotating(rotateRef.current);
            }}
            title={rotating ? 'Pause rotation' : 'Resume rotation'}
          >
            {rotating ? <Pause size={12} /> : <Play size={12} />}
          </button>
          <button
            type="button"
            className="btn-secondary flex items-center gap-1 px-2 py-1 text-xs"
            onClick={() => {
              zoomRef.current = DEFAULT_ZOOM;
              angleRef.current = 0.6;
              setSelected(null);
              setSelectedLinks([]);
            }}
            title="Reset view"
          >
            <RotateCcw size={12} />
          </button>
        </div>
        <div
          className="absolute bottom-3 left-3 flex items-center gap-3 rounded px-2 py-1 font-mono text-[10px]"
          style={{ backgroundColor: 'rgba(15, 17, 23, 0.6)', color: 'var(--text-muted)' }}
        >
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: READ_COLOUR }} />{' '}
            reading
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: WRITE_COLOUR }} />{' '}
            writing
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: NEW_COLOUR }} /> new
          </span>
          <span className="flex items-center gap-1">
            <Zap size={10} /> drag to turn · wheel to zoom · click a node
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      className="relative rounded border p-3"
      style={{ borderColor: 'var(--border)', backgroundColor: 'rgba(15, 17, 23, 0.5)' }}
    >
      <span
        className="absolute top-0 left-0 h-2 w-2 border-t border-l"
        style={{ borderColor: 'var(--primary)' }}
      />
      <span
        className="absolute right-0 bottom-0 h-2 w-2 border-r border-b"
        style={{ borderColor: 'var(--primary)' }}
      />
      <p className="mb-2 text-[10px] tracking-widest" style={{ color: 'var(--text-muted)' }}>
        {title}
      </p>
      {children}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ color: 'var(--text-primary)' }}>{value}</span>
    </div>
  );
}

function activationColour(kind: string): string {
  if (kind === 'recall') return READ_COLOUR;
  if (kind === 'remember' || kind === 'connect') return WRITE_COLOUR;
  if (kind === 'forget') return FORGET_COLOUR;
  if (kind.startsWith('dream')) return '#a78bfa';
  return OTHER_COLOUR;
}

function activationGlyph(kind: string): string {
  if (kind === 'recall') return '◐';
  if (kind === 'remember') return '●';
  if (kind === 'connect') return '⟷';
  if (kind === 'forget') return '○';
  if (kind.startsWith('dream')) return '☾';
  return '·';
}

function activationText(ev: BrainActivation): string {
  const names = [...(ev.names ?? []), ev.name].filter((n): n is string => !!n);
  if (ev.kind === 'connect' && names.length === 2)
    return `${names[0]} ${ev.type ?? '→'} ${names[1]}`;
  if (names.length)
    return names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3}` : '');
  if (ev.terms?.length) return `"${ev.terms.slice(0, 3).join('", "')}"`;
  if (ev.kind === 'dream.start') return 'consolidating the day';
  if (ev.kind === 'dream.end') return 'woke up';
  return '';
}
