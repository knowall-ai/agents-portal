'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation } from 'd3-force-3d';
import type { Simulation, SimulationLinkDatum, SimulationNodeDatum } from 'd3-force-3d';
import {
  Maximize2,
  Minimize2,
  Moon,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Sun,
  Zap,
} from 'lucide-react';
import { EmptyState, LoadingSpinner } from '@/components/common';
import {
  HUD,
  HudBoostChip,
  HudDeep,
  HudGauge,
  HudPanel,
  HudRow,
  HudSparkline,
} from '@/components/common/hud/Hud';
import { formatTotals } from '@/lib/format';
import type {
  AgentBoost,
  AgentBrain,
  AgentCosts,
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
  // One green/teal family (the portal's --primary and the HUD lime) so the
  // graph reads as one hologram; type is told by brightness and temperature
  Person: '#4ade80',
  Organization: '#2dd4bf',
  Project: '#22c55e',
  Product: '#5eead4',
  Concept: '#a3e635',
  Meeting: '#34d399',
  Decision: '#bef264',
  Risk: '#ffb000',
};
const OTHER_COLOUR = '#94a3b8';

/** d3 swaps link endpoints from ids to node objects once the simulation has run. */
function endpointId(end: SimNode | string | number): string {
  return typeof end === 'object' ? end.id : String(end);
}

/** The rotation and vertical pan that put `node` front and centre, from its live position. */
function focusTarget(node: SimNode, zoom: number, tilt: number): { angle: number; panY: number } {
  const x = node.x ?? 0;
  const y = node.y ?? 0;
  const z = node.z ?? 0;
  // rx = x cosθ + z sinθ = 0 at θ = atan2(-x, z); +π puts the node on the camera side
  const angle = Math.atan2(-x, z) + Math.PI;
  const rho = Math.hypot(x, z);
  const ry = y * Math.cos(tilt) + rho * Math.sin(tilt);
  const rz2 = y * Math.sin(tilt) - rho * Math.cos(tilt);
  const scale = (FOCAL / Math.max(FOCAL * 0.2, FOCAL + rz2)) * zoom;
  // cy sits 80px above the middle of the canvas; land the node just above centre
  return { angle, panY: -ry * scale + 64 };
}
const READ_COLOUR = '#9dff0a'; // recall — the HUD lime
const WRITE_COLOUR = '#f0ffcd'; // remember / connect — the HUD core white
const NEW_COLOUR = '#ffffff';
const FORGET_COLOUR = '#ffb000'; // the HUD amber
const HIGHLIGHT_MS: Record<string, number> = {
  recall: 9000,
  remember: 11000,
  connect: 11000,
  forget: 8000,
  added: 8000,
};
const FEED_MAX = 60;
const CANVAS_HEIGHT = 720;
// Avatar-renderer palette (robot_avatar.py): lime glow, pale core, amber warnings
const HOLO = '#9dff0a';
const HOLO_CORE = '#f0ffcd';
const HOLO_DIM = '#7c8f7c';
const HOLO_AMBER = '#ffb000';
const FOCAL = 1100;
const DEFAULT_ZOOM = 1;
const TILT = 0.32;
/** radians per second — one full turn every ~2.5 minutes */
const AUTO_ROTATE = 0.042;
/** Backdrop plates (public/brain), in the style of the avatar renderer's scenes */
export const BACKDROPS = ['none', 'bridge', 'rain-city', 'cyber-sky'] as const;
export type Backdrop = (typeof BACKDROPS)[number];
/** Where each plate's emitter sits, as fractions of the image; the graph floats over it */
const PLATE_ANCHOR: Record<Exclude<Backdrop, 'none'>, { x: number; y: number }> = {
  bridge: { x: 0.46, y: 0.84 },
  'rain-city': { x: 0.42, y: 0.64 },
  'cyber-sky': { x: 0.47, y: 0.845 },
};
interface Plate {
  img: CanvasImageSource;
  w: number;
  h: number;
  ax: number;
  ay: number;
}
/** How fast recency fades: live activity over ~20 min, graph timestamps over ~12 h */
const RECENCY_LIVE_TAU = 20 * 60;
const RECENCY_GRAPH_TAU = 12 * 3600;

function colourFor(label: string): string {
  return LABEL_COLOURS[label] ?? OTHER_COLOUR;
}

/** Blend two hex colours; t=0 gives a, t=1 gives b. */
function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift: number) =>
    Math.round(((pa >> shift) & 255) * (1 - t) + ((pb >> shift) & 255) * t);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
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
  costs?: AgentCosts | null;
  boost?: AgentBoost | null;
  /** Scene behind the graph; 'none' keeps the plain gradient */
  backdrop?: Backdrop;
  isLoading: boolean;
  error?: string | null;
  /** Tile mode for the Brains grid: no HUD, no controls, just the living graph */
  compact?: boolean;
  /** Canvas height in px (ignored in full page) */
  height?: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function BrainView({
  agentId,
  agentName,
  agentStatus,
  brain,
  costs,
  boost,
  backdrop = 'bridge',
  isLoading,
  error,
  compact = false,
  height = CANVAS_HEIGHT,
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
  const tiltRef = useRef(TILT);
  /** true once the user has wheel-zoomed; auto-fit stays off until reset */
  const userZoomRef = useRef(false);
  const dragRef = useRef<{ x: number; y: number; angle: number; tilt: number } | null>(null);
  const [isFull, setIsFull] = useState(false);
  const hoverRef = useRef<SimNode | null>(null);
  const rotateRef = useRef(true);
  const dreamingRef = useRef(false);
  const firesRef = useRef<Map<string, number>>(new Map());
  /** When each node was last touched and with what colour, for the recency gradient */
  const recencyRef = useRef<Map<string, { at: number; colour: string; live: boolean }>>(new Map());
  const panRef = useRef({ y: 0 });
  const backdropRef = useRef<Plate | null>(null);
  const focusRef = useRef<SimNode | null>(null);

  // Mirrored into refs so the render loop reads them without restarting
  const statusRef = useRef(agentStatus);
  const selectedRef = useRef<SimNode | null>(null);

  const [feed, setFeed] = useState<BrainActivation[]>([]);
  const [stats, setStats] = useState<BrainStats | null>(null);
  const [state, setState] = useState<BrainState | null>(null);
  const [selected, setSelected] = useState<SimNode | null>(null);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);
  const [rotating, setRotating] = useState(true);
  const [streamStatus, setStreamStatus] = useState<'connecting' | 'live' | 'offline'>('connecting');
  const [tick, setTick] = useState(0);
  useEffect(() => {
    statusRef.current = agentStatus;
  }, [agentStatus]);
  const [clock, setClock] = useState(() => Date.now());
  const [cpuHistory, setCpuHistory] = useState<number[]>([]);
  const [names, setNames] = useState<{ id: string; name: string; label: string }[]>([]);
  const [query, setQuery] = useState('');
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
    recencyRef.current = new Map(
      nodes
        .filter((n) => n.updatedAt > 0)
        .map((n) => [n.id, { at: n.updatedAt * 1000, colour: WRITE_COLOUR, live: false }])
    );
    setNames(nodes.map((n) => ({ id: n.id, name: n.name, label: n.label })));
    setStats(snapshot.stats);
    setState(snapshot.state);
    dreamingRef.current = snapshot.state.dreaming;

    // Bigger graphs start further out so the whole picture fits
    zoomRef.current = Math.max(
      0.7,
      Math.min(DEFAULT_ZOOM, DEFAULT_ZOOM * Math.sqrt(60 / Math.max(60, nodes.length)))
    );

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
    if (backdrop === 'none') {
      backdropRef.current = null;
      return;
    }
    const img = new Image();
    img.src = `/brain/bg-${backdrop}.jpg`;
    img.onload = () => {
      // Brighten once at load so the plate reads without a per-frame filter
      const lit = document.createElement('canvas');
      lit.width = img.width;
      lit.height = img.height;
      const lctx = lit.getContext('2d');
      if (lctx) {
        lctx.filter = 'brightness(1.5) saturate(1.1)';
        lctx.drawImage(img, 0, 0);
      }
      const anchor = PLATE_ANCHOR[backdrop];
      backdropRef.current = {
        img: lctx ? lit : img,
        w: img.width,
        h: img.height,
        ax: anchor.x,
        ay: anchor.y,
      };
    };
    return () => {
      backdropRef.current = null;
    };
  }, [backdrop]);

  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const onChange = () => setIsFull(document.fullscreenElement === wrapRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const toggleFull = () => {
    // The browser may refuse (no user gesture, embedded frame); nothing to do then
    const request = document.fullscreenElement
      ? document.exitFullscreen()
      : wrapRef.current?.requestFullscreen();
    request?.catch(() => undefined);
  };

  // ---- highlights -----------------------------------------------------------
  const highlight = useCallback((ids: string[], kind: string, colour: string) => {
    const until = Date.now() + (HIGHLIGHT_MS[kind] ?? 8000);
    for (const id of ids) {
      if (byIdRef.current.has(id)) {
        highlightsRef.current.set(id, { colour, until, kind });
        recencyRef.current.set(id, { at: Date.now(), colour, live: true });
      }
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
      // drop every edge that touched it, whether or not the diff listed them
      for (let i = links.length - 1; i >= 0; i--) {
        const l = links[i];
        if (endpointId(l.source) === id || endpointId(l.target) === id) links.splice(i, 1);
      }
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
      recencyRef.current.set(sn.id, { at: Date.now(), colour: WRITE_COLOUR, live: true });
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
    setNames(nodes.map((n) => ({ id: n.id, name: n.name, label: n.label })));
    (sim.force('link') as ReturnType<typeof forceLink<SimNode, SimLink>>).links(links);
    sim.alpha(0.4).restart();
    if (diff.stats) setStats(diff.stats);
    // Keep the FOCUS panel honest: drop it if its node went, else refresh its links
    const sel = selectedRef.current;
    if (sel) {
      if (!byId.has(sel.id)) {
        setSelected(null);
        setSelectedLinks([]);
        focusRef.current = null;
      } else {
        setSelectedLinks(
          links
            .filter((l) => endpointId(l.source) === sel.id || endpointId(l.target) === sel.id)
            .slice(0, 12)
        );
      }
    }
  }, []);

  // ---- live stream ------------------------------------------------------------
  useEffect(() => {
    if (!brain?.available || !snapshot) return;
    // EventSource gives up for good on a non-200 response (e.g. the proxy hit an
    // upstream throttle), so reconnect ourselves with a gentle backoff
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let delay = 5_000;
    let stopped = false;
    const connect = () => {
      if (stopped) return;
      source = new EventSource(`/api/agents/${agentId}/brain/events`);
      wire(source);
    };
    const wire = (source: EventSource) => {
      source.onopen = () => {
        delay = 5_000;
        setStreamStatus('live');
      };
      source.onerror = () => {
        setStreamStatus('offline');
        if (source.readyState === EventSource.CLOSED && !stopped) {
          clearTimeout(retry);
          retry = setTimeout(connect, delay);
          delay = Math.min(60_000, delay * 2);
        }
      };
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
          // a partial arriving before the snapshot has nothing to merge into
          setState((s) => (s ? { ...s, ...next } : s));
          if (typeof next.dreaming === 'boolean') dreamingRef.current = next.dreaming;
          if (typeof next.cpuPercent === 'number') {
            const cpu = next.cpuPercent;
            setCpuHistory((h) => [...h, cpu].slice(-40));
          }
        } catch {
          // ignore malformed
        }
      });
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      source?.close();
    };
  }, [agentId, brain?.available, snapshot, applyActivation, applyDiff]);

  // ---- render loop -------------------------------------------------------------
  // The canvas only mounts once a snapshot has arrived, so start the loop then
  const ready = !!snapshot;
  useEffect(() => {
    if (!ready) return;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Graph and its reflection are composed on offscreen layers each frame
    const layer = document.createElement('canvas');
    const mirror = document.createElement('canvas');
    const lctx = layer.getContext('2d');
    const mctx = mirror.getContext('2d');
    if (!lctx || !mctx) return;
    let raf = 0;
    let last = performance.now();
    let floorY = CANVAS_HEIGHT * 0.8;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (const [c, cctx] of [
        [layer, lctx],
        [mirror, mctx],
      ] as const) {
        c.width = canvas.width;
        c.height = canvas.height;
        cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);

    const draw = () => {
      const t = performance.now();
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      const frame = t * 0.06; // ≈ frames at 60 fps, continuous across restarts
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      const cx = compact ? w / 2 : w / 2 + 40;
      const cy = h / 2 - 80 + panRef.current.y;
      const now = Date.now();
      const focus = focusRef.current
        ? focusTarget(focusRef.current, zoomRef.current, tiltRef.current)
        : null;
      if (focus && !dragRef.current) {
        // ease the graph round so the focused node sits front and centre
        let delta = focus.angle - angleRef.current;
        delta = Math.atan2(Math.sin(delta), Math.cos(delta));
        angleRef.current += delta * Math.min(1, dt * 2);
        panRef.current.y += (focus.panY - panRef.current.y) * Math.min(1, dt * 2);
      } else {
        if (rotateRef.current && !dragRef.current) angleRef.current += AUTO_ROTATE * dt;
        panRef.current.y += (0 - panRef.current.y) * Math.min(1, dt * 3);
      }
      const a = angleRef.current;
      const cosA = Math.cos(a);
      const sinA = Math.sin(a);
      const cosT = Math.cos(tiltRef.current);
      const sinT = Math.sin(tiltRef.current);
      // Auto-fit: keep the whole graph inside the view however the layout breathes
      if (!userZoomRef.current) {
        let sum = 0;
        for (const n of nodesRef.current) {
          const x = n.x ?? 0;
          const y = n.y ?? 0;
          const z = n.z ?? 0;
          sum += x * x + y * y + z * z;
        }
        const rms = Math.sqrt(sum / Math.max(1, nodesRef.current.length));
        const fit = (Math.min(compact ? w : w - 400, h) * 0.5) / Math.max(80, rms * 1.9);
        zoomRef.current +=
          (Math.min(2.5, Math.max(0.3, fit)) - zoomRef.current) * Math.min(1, dt * 1.5);
      }
      const zoom = zoomRef.current;
      const asleep = statusRef.current === 'offline';
      const dreaming = dreamingRef.current;
      const tint = dreaming ? [139, 92, 246] : [34, 197, 94];

      // ---- backdrop: deep field, perspective floor grid, holo rings ----
      const bg = ctx.createRadialGradient(cx, cy, 20, cx, cy, Math.max(w, h) * 0.75);
      bg.addColorStop(0, dreaming ? '#161029' : '#0c1a22');
      bg.addColorStop(0.55, '#090d14');
      bg.addColorStop(1, '#05070b');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      const plate = backdropRef.current;
      if (plate) {
        // Scale and place the plate so its emitter sits right under the graph
        // while the image still covers the canvas; the floor is the emitter
        const need = Math.max(cx / plate.ax, (w - cx) / (1 - plate.ax), w);
        const s = Math.max(need / plate.w, h / plate.h);
        const pw = plate.w * s;
        const ph = plate.h * s;
        const ox = cx - plate.ax * pw;
        const oy = Math.min(0, Math.max(h - ph, h - 68 - plate.ay * ph));
        ctx.drawImage(plate.img, ox, oy, pw, ph);
        floorY = oy + plate.ay * ph;

        // The emitter lights the plate and throws a cone up to the hologram
        const flicker = 0.03 * Math.sin(frame / 6) + 0.02 * Math.sin(frame / 17);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.translate(cx, floorY);
        ctx.scale(1, 0.22);
        const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 160);
        glow.addColorStop(0, `rgba(${tint[0]}, ${tint[1]}, ${tint[2]}, ${0.4 + flicker})`);
        glow.addColorStop(1, `rgba(${tint[0]}, ${tint[1]}, ${tint[2]}, 0)`);
        ctx.fillStyle = glow;
        ctx.fillRect(-170, -170, 340, 340);
        ctx.restore();
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const cone = ctx.createLinearGradient(0, floorY, 0, cy - 60);
        cone.addColorStop(0, `rgba(${tint[0]}, ${tint[1]}, ${tint[2]}, ${0.16 + flicker})`);
        cone.addColorStop(1, `rgba(${tint[0]}, ${tint[1]}, ${tint[2]}, 0)`);
        ctx.fillStyle = cone;
        ctx.beginPath();
        ctx.moveTo(cx - 110, floorY);
        ctx.lineTo(cx + 110, floorY);
        ctx.lineTo(cx + 320, cy - 60);
        ctx.lineTo(cx - 320, cy - 60);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else {
        const horizon = h * 0.6;
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, horizon, w, h - horizon);
        ctx.clip();
        ctx.strokeStyle = `rgba(${tint[0]}, ${tint[1]}, ${tint[2]}, 0.09)`;
        ctx.lineWidth = 1;
        for (let i = -14; i <= 14; i++) {
          ctx.beginPath();
          ctx.moveTo(cx + i * 22, horizon);
          ctx.lineTo(cx + i * 260, h + 40);
          ctx.stroke();
        }
        const scrollT = (frame * 0.004) % 1;
        for (let k = 0; k < 14; k++) {
          const t = (k + scrollT) / 14;
          const y = horizon + (h - horizon) * t * t;
          ctx.strokeStyle = `rgba(${tint[0]}, ${tint[1]}, ${tint[2]}, ${0.03 + t * 0.12})`;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
          ctx.stroke();
        }
        ctx.restore();

        // holographic base rings under the graph
        ctx.save();
        ctx.translate(cx, cy + 210);
        ctx.scale(1, 0.28);
        for (let ring = 0; ring < 3; ring++) {
          const rr = 150 + ring * 70 + Math.sin(frame / 30 + ring) * 4;
          ctx.strokeStyle = `rgba(${tint[0]}, ${tint[1]}, ${tint[2]}, ${0.18 - ring * 0.05})`;
          ctx.lineWidth = ring === 0 ? 1.5 : 1;
          ctx.setLineDash(ring === 1 ? [6, 10] : []);
          ctx.beginPath();
          ctx.arc(0, 0, rr, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        // rotating sweep
        const sweep = (frame / 90) % (Math.PI * 2);
        ctx.strokeStyle = `rgba(${tint[0]}, ${tint[1]}, ${tint[2]}, 0.35)`;
        ctx.beginPath();
        ctx.arc(0, 0, 290, sweep, sweep + 0.6);
        ctx.stroke();
        ctx.restore();
      }

      if (dreaming) {
        const pulse = 0.5 + 0.5 * Math.sin(frame / 40);
        const aura = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(w, h) * 0.55);
        aura.addColorStop(0, `rgba(139, 92, 246, ${0.16 + pulse * 0.1})`);
        aura.addColorStop(1, 'rgba(139, 92, 246, 0)');
        ctx.fillStyle = aura;
        ctx.fillRect(0, 0, w, h);
      }

      // ---- project ----
      const nodes = nodesRef.current;
      for (const n of nodes) {
        const x = n.x ?? 0;
        const y = n.y ?? 0;
        const z = n.z ?? 0;
        const rx = x * cosA + z * sinA;
        const rz = -x * sinA + z * cosA;
        const ry = y * cosT - rz * sinT;
        const rz2 = y * sinT + rz * cosT;
        // Never let a node pass behind the camera: keep the projection scale positive
        const scale = (FOCAL / Math.max(FOCAL * 0.2, FOCAL + rz2)) * zoom;
        n.sx = cx + rx * scale;
        n.sy = cy + ry * scale;
        n.depth = scale;
        n.sr = Math.max(0.5, (3.2 + Math.sqrt(Math.max(0, n.degree)) * 1.8) * scale);
      }

      // ---- background firing: the graph is never completely still ----
      const fires = firesRef.current;
      const linkCount = linksRef.current.length;
      if (!asleep && linkCount > 0 && Math.random() < (dreaming ? 0.16 : 0.07)) {
        const l = linksRef.current[Math.floor(Math.random() * linkCount)];
        fires.set(l.id, now + 900 + Math.random() * 600);
      }
      for (const [id, until] of fires) if (until < now) fires.delete(id);
      const focusId = selectedRef.current?.id;
      const neighbours = new Set<string>();

      // The graph is drawn on its own layer so it can be mirrored onto the floor
      let bottom = 0;
      for (const n of nodes) bottom = Math.max(bottom, (n.sy as number) + (n.sr as number));
      if (!plate) floorY += (Math.min(h - 84, bottom + 16) - floorY) * Math.min(1, dt * 2);
      const main = ctx;
      lctx.clearRect(0, 0, w, h);
      {
        const ctx = lctx;
        // ---- edges (additive); active ones glow ----
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (const l of linksRef.current) {
          const s = l.source as SimNode;
          const t = l.target as SimNode;
          if (s.sx === undefined || t.sx === undefined) continue;
          const depth = ((s.depth ?? 1) + (t.depth ?? 1)) / 2;
          const flash = linkFlashRef.current.get(l.id);
          const hs = highlightsRef.current.get(s.id);
          const ht = highlightsRef.current.get(t.id);
          const lit = (flash && flash > now) || (hs && ht);
          const firing = fires.has(l.id);
          const focused = focusId !== undefined && (s.id === focusId || t.id === focusId);
          if (focused) neighbours.add(s.id === focusId ? t.id : s.id);
          const hovered =
            focused || (hoverRef.current && (hoverRef.current === s || hoverRef.current === t));
          const grad = ctx.createLinearGradient(s.sx, s.sy as number, t.sx, t.sy as number);
          const base =
            (lit ? 0.45 : hovered ? 0.55 : firing ? 0.35 : 0.05 + depth * 0.1) *
            (focusId !== undefined && !focused ? 0.5 : 1);
          grad.addColorStop(0, hexToRgba(colourFor(s.label), base));
          grad.addColorStop(1, hexToRgba(colourFor(t.label), base));
          ctx.strokeStyle = lit ? hexToRgba(WRITE_COLOUR, 0.55) : grad;
          ctx.lineWidth = lit || hovered ? 1.6 : 0.8;
          ctx.beginPath();
          ctx.moveTo(s.sx, s.sy as number);
          ctx.lineTo(t.sx, t.sy as number);
          ctx.stroke();
          if (lit || hovered) {
            ctx.fillStyle = 'rgba(203, 213, 225, 0.8)';
            ctx.font = `${Math.max(9, 10 * depth)}px ui-monospace, monospace`;
            ctx.fillText(
              l.type,
              (s.sx + t.sx) / 2 + 4,
              ((s.sy as number) + (t.sy as number)) / 2 - 3
            );
          }
        }
        ctx.restore();

        // ---- nodes, far to near, as lit spheres ----
        const ordered = [...nodes].sort((p, q) => (p.depth ?? 0) - (q.depth ?? 0));
        // Label sparingly: the best-connected nodes only, and none of the unrelated ones
        // while something is focused, so the picture reads around what you're inspecting
        const labelThreshold =
          nodes.length > 200 ? 9 : nodes.length > 120 ? 7 : nodes.length > 30 ? 5 : 2;
        for (const n of ordered) {
          const x = n.sx as number;
          const y = n.sy as number;
          const r = n.sr as number;
          const depth = n.depth ?? 1;
          const baseColour = colourFor(n.label);
          const rec = recencyRef.current.get(n.id);
          const recency = rec
            ? Math.exp(-((now - rec.at) / 1000) / (rec.live ? RECENCY_LIVE_TAU : RECENCY_GRAPH_TAU))
            : 0;
          const colour = rec ? mixHex(baseColour, rec.colour, Math.min(0.9, recency)) : baseColour;
          const hl = highlightsRef.current.get(n.id);
          if (hl && hl.until < now) highlightsRef.current.delete(n.id);
          const active = hl && hl.until > now ? hl : undefined;
          const hovered = hoverRef.current === n || focusId === n.id;
          const related = focusId !== undefined && (n.id === focusId || neighbours.has(n.id));
          const dimmed = focusId !== undefined && !related;
          const fog = (asleep ? 0.35 : Math.min(1, 0.35 + depth * 0.55)) * (dimmed ? 0.55 : 1);

          // halo (additive)
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          const haloR = r * (active ? 3.2 : 2.1 + recency * 1.6);
          const halo = ctx.createRadialGradient(x, y, r * 0.6, x, y, haloR);
          halo.addColorStop(
            0,
            hexToRgba(active ? active.colour : colour, (active ? 0.5 : 0.22 + recency * 0.3) * fog)
          );
          halo.addColorStop(1, hexToRgba(active ? active.colour : colour, 0));
          ctx.fillStyle = halo;
          ctx.beginPath();
          ctx.arc(x, y, haloR, 0, Math.PI * 2);
          ctx.fill();
          if (active) {
            const life = (active.until - now) / (HIGHLIGHT_MS[active.kind] ?? 8000);
            const ring = r + 6 + (1 - life) * 26;
            ctx.strokeStyle = hexToRgba(active.colour, 0.6 * life);
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(x, y, ring, 0, Math.PI * 2);
            ctx.stroke();
            const ring2 = r + 6 + (((1 - life) * 26 + 13) % 26);
            ctx.strokeStyle = hexToRgba(active.colour, 0.3 * life);
            ctx.beginPath();
            ctx.arc(x, y, ring2, 0, Math.PI * 2);
            ctx.stroke();
          }
          ctx.restore();

          // sphere shading
          const sphere = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
          sphere.addColorStop(0, hexToRgba('#ffffff', 0.9 * fog));
          sphere.addColorStop(0.35, hexToRgba(colour, fog));
          sphere.addColorStop(1, hexToRgba(colour, 0.35 * fog));
          ctx.fillStyle = sphere;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
          if (hovered) {
            ctx.strokeStyle = '#f3f4f6';
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }
          if (related) {
            const isFocus = n.id === focusId;
            ctx.strokeStyle = hexToRgba(isFocus ? HOLO_CORE : HOLO, isFocus ? 0.95 : 0.7);
            ctx.lineWidth = isFocus ? 2 : 1;
            ctx.beginPath();
            ctx.arc(x, y, r + (isFocus ? 8 + Math.sin(frame / 8) * 2 : 4), 0, Math.PI * 2);
            ctx.stroke();
          }
          const wellConnected = n.degree >= labelThreshold && (focusId === undefined || related);
          if (hovered || active || related || wellConnected) {
            const size = Math.max(9, 11 * depth);
            ctx.font = `${hovered || active || related ? 600 : 400} ${size}px ui-sans-serif, system-ui, sans-serif`;
            const tw = ctx.measureText(n.name).width;
            // holographic caption: hairline + text
            ctx.strokeStyle = hexToRgba(colour, 0.35 * fog);
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x + r + 2, y);
            ctx.lineTo(x + r + 8, y);
            ctx.stroke();
            ctx.fillStyle = 'rgba(5, 7, 11, 0.45)';
            ctx.fillRect(x + r + 8, y - size * 0.8, tw + 6, size + 4);
            ctx.fillStyle =
              hovered || active || related ? '#f3f4f6' : `rgba(226, 232, 240, ${0.4 + fog * 0.5})`;
            ctx.fillText(n.name, x + r + 11, y + size * 0.35);
          }
        }
      }

      // ---- floor: soft shadow under the graph, then a squashed, fading reflection ----
      ctx.save();
      ctx.translate(cx, floorY);
      ctx.scale(1, 0.16);
      const shadow = ctx.createRadialGradient(0, 0, 0, 0, 0, 280);
      shadow.addColorStop(0, 'rgba(0, 0, 0, 0.6)');
      shadow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = shadow;
      ctx.fillRect(-320, -320, 640, 640);
      ctx.restore();
      main.drawImage(layer, 0, 0, w, h);
      mctx.clearRect(0, 0, w, h);
      mctx.save();
      mctx.translate(0, floorY);
      mctx.scale(1, -0.55);
      mctx.translate(0, -floorY);
      mctx.drawImage(layer, 0, 0, w, h);
      mctx.restore();
      mctx.globalCompositeOperation = 'destination-in';
      const fade = mctx.createLinearGradient(0, floorY, 0, floorY + 150);
      fade.addColorStop(0, 'rgba(0, 0, 0, 0.4)');
      fade.addColorStop(1, 'rgba(0, 0, 0, 0)');
      mctx.fillStyle = fade;
      mctx.fillRect(0, floorY, w, h - floorY);
      mctx.globalCompositeOperation = 'source-over';
      main.drawImage(mirror, 0, 0, w, h);

      // ---- vignette + scanlines + HUD brackets ----
      const vig = ctx.createRadialGradient(
        cx,
        cy,
        Math.min(w, h) * 0.35,
        cx,
        cy,
        Math.max(w, h) * 0.75
      );
      vig.addColorStop(0, 'rgba(0,0,0,0)');
      vig.addColorStop(1, `rgba(0,0,0,${plate ? 0.2 : 0.55})`);
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(255,255,255,0.025)';
      for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
      ctx.strokeStyle = `rgba(${tint[0]}, ${tint[1]}, ${tint[2]}, 0.5)`;
      ctx.lineWidth = 1.5;
      const b = 18;
      for (const [bx, by, dx, dy] of [
        [10, 10, 1, 1],
        [w - 10, 10, -1, 1],
        [10, h - 10, 1, -1],
        [w - 10, h - 10, -1, -1],
      ]) {
        ctx.beginPath();
        ctx.moveTo(bx + dx * b, by);
        ctx.lineTo(bx, by);
        ctx.lineTo(bx, by + dy * b);
        ctx.stroke();
      }
      if (asleep) {
        ctx.fillStyle = 'rgba(5, 7, 11, 0.5)';
        ctx.fillRect(0, 0, w, h);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [ready]);

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
    dragRef.current = {
      x: e.clientX,
      y: e.clientY,
      angle: angleRef.current,
      tilt: tiltRef.current,
    };
  };
  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (dragRef.current) {
      // A real drag hands the camera back to the user: the focus panel stays,
      // but the view no longer glides back to the focused node
      if (
        focusRef.current &&
        (Math.abs(e.clientX - dragRef.current.x) > 4 || Math.abs(e.clientY - dragRef.current.y) > 4)
      )
        focusRef.current = null;
      angleRef.current = dragRef.current.angle - (e.clientX - dragRef.current.x) * 0.006;
      tiltRef.current = Math.min(
        1.3,
        Math.max(-0.4, dragRef.current.tilt + (e.clientY - dragRef.current.y) * 0.004)
      );
      return;
    }
    hoverRef.current = pick(e);
    e.currentTarget.style.cursor = hoverRef.current ? 'pointer' : 'grab';
  };
  const onMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const moved =
      dragRef.current &&
      (Math.abs(e.clientX - dragRef.current.x) > 4 || Math.abs(e.clientY - dragRef.current.y) > 4);
    dragRef.current = null;
    if (!moved) focusNode(pick(e));
  };
  /** Rotate and pan so `node` sits front and centre; rotation stays parked until reset. */
  const focusNode = (node: SimNode | null) => {
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
    if (!node) {
      focusRef.current = null;
      return;
    }
    focusRef.current = node;
  };

  // Wheel zoom must be a non-passive native listener so it can stop the page scrolling
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      userZoomRef.current = true;
      zoomRef.current = Math.min(3, Math.max(0.4, zoomRef.current * (e.deltaY > 0 ? 0.92 : 1.08)));
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [ready]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [] as typeof names;
    return names.filter((n) => n.name.toLowerCase().includes(q)).slice(0, 6);
  }, [names, query]);
  const usage = state?.usage ?? null;
  const usageMode = usage?.mode ?? (boost?.active ? 'api' : 'sub');
  // BOOST chip: the portal's own boost state (Azure run-command) or the Presence file, whichever says active
  const boostChip = (() => {
    const presence = state?.boost;
    if (presence?.active) {
      const untilMs =
        presence.until ?? (presence.minutes != null ? clock + presence.minutes * 60000 : clock);
      return { minutes: Math.max(0, Math.round((untilMs - clock) / 60000)) };
    }
    if (boost?.active) {
      const untilMs = boost.until ? new Date(boost.until).getTime() : clock;
      return { minutes: Math.max(0, Math.round((untilMs - clock) / 60000)) };
    }
    return null;
  })();
  const activityPerMin = useMemo(
    () => feed.filter((ev) => clock / 1000 - ev.ts < 60).length,
    [feed, clock]
  );
  const deepNow = feed[0] && clock / 1000 - feed[0].ts < 6 ? feed[0] : null;
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
    <div
      ref={wrapRef}
      className="relative overflow-hidden"
      style={{ height: isFull ? '100vh' : height, backgroundColor: '#05070b' }}
    >
      <canvas
        ref={canvasRef}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={() => {
          dragRef.current = null;
          hoverRef.current = null;
        }}
        style={{ display: 'block', cursor: 'grab' }}
      />

      {compact ? (
        <div
          className="pointer-events-none absolute top-2 left-3 text-xs font-semibold tracking-widest uppercase"
          style={{ color: HUD.dim, fontFamily: HUD.font }}
        >
          {agentName}
          {brain?.fixture && <span style={{ color: HUD.amber }}> · demo</span>}
        </div>
      ) : (
        <>
          {/* Left: state, search, focus, deep-brain feed, usage, telemetry — one column */}
          <div
            className="pointer-events-none absolute top-3 bottom-3 left-3 flex flex-col gap-2"
            style={{ width: HUD.colWidth, fontFamily: HUD.font, fontSize: 12, color: HUD.text }}
          >
            <div className="flex items-center gap-2">
              <span
                className="inline-flex items-center gap-1 border px-2 py-0.5 text-[11px] font-semibold tracking-widest uppercase"
                style={{
                  borderColor: hexToRgba(moodColour, 0.6),
                  backgroundColor: HUD.panel,
                  color: moodColour,
                }}
              >
                {asleep ? (
                  <Moon size={11} />
                ) : dreaming ? (
                  <Sparkles size={11} />
                ) : (
                  <Sun size={11} />
                )}
                {mood}
              </span>
              <span style={{ color: streamStatus === 'live' ? HUD.g : HUD.dim }}>
                {streamStatus === 'live'
                  ? '● STREAM LIVE'
                  : streamStatus === 'connecting'
                    ? '○ STREAM CONNECTING'
                    : '○ STREAM OFFLINE'}
              </span>
              {brain.fixture && (
                <span
                  style={{ color: HUD.amber }}
                  title="Built-in sample graph, not an agent's memory"
                >
                  DEMO DATA
                </span>
              )}
            </div>
            <div className="pointer-events-auto relative">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && results[0]) {
                    const node = byIdRef.current.get(results[0].id);
                    if (node) focusNode(node);
                    setQuery('');
                  }
                  if (e.key === 'Escape') setQuery('');
                }}
                placeholder={`search ${agentName}'s memory…`}
                className="w-full px-2 py-1 outline-none"
                style={{
                  border: `1px solid ${HUD.dim}`,
                  backgroundColor: HUD.panel,
                  color: HUD.text,
                  fontFamily: HUD.font,
                  fontSize: 12,
                }}
              />
              {query && results.length > 0 && (
                <ul
                  className="absolute right-0 left-0 z-10 mt-1"
                  style={{
                    border: `1px solid ${HUD.dim}`,
                    backgroundColor: 'rgba(6, 12, 9, 0.92)',
                  }}
                >
                  {results.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-white/5"
                        onClick={() => {
                          const node = byIdRef.current.get(r.id);
                          if (node) focusNode(node);
                          setQuery('');
                        }}
                      >
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ backgroundColor: colourFor(r.label) }}
                        />
                        <span className="flex-1 truncate">{r.name}</span>
                        <span style={{ color: HUD.dim }}>{r.label}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {selected && (
              <HudPanel title="FOCUS">
                <HudRow colour={colourFor(selected.label)}>{selected.name}</HudRow>
                <HudRow colour={HUD.dim}>
                  {selected.label} {selected.degree} CONNECTIONS
                </HudRow>
                {Object.entries(selected.props)
                  .filter(([k]) => k !== 'name')
                  .slice(0, 4)
                  .map(([k, v]) => (
                    <HudRow key={k}>
                      <span style={{ color: HUD.dim }}>{k.toUpperCase()} </span>
                      {String(v).slice(0, 34)}
                    </HudRow>
                  ))}
                {selectedLinks.map((l) => {
                  const src = l.source as SimNode;
                  const tgt = l.target as SimNode;
                  const other = src.id === selected.id ? tgt : src;
                  return (
                    <HudRow key={l.id}>
                      <span style={{ color: HUD.dim }}>
                        {src.id === selected.id ? '→' : '←'} {l.type}{' '}
                      </span>
                      {other.name.slice(0, 26)}
                    </HudRow>
                  );
                })}
              </HudPanel>
            )}
            <HudPanel
              title={`${agentName.toUpperCase()} // DEEP BRAIN`}
              className="min-h-0 flex-1 overflow-hidden"
            >
              {feed.length === 0 ? (
                <HudRow colour={HUD.dim}>waiting for the first thought…</HudRow>
              ) : (
                feed.slice(0, 40).map((ev, i) => (
                  <HudRow key={`${ev.ts}-${i}`} colour={activationColour(ev.kind)}>
                    {activationGlyph(ev.kind)} {ev.kind.toUpperCase().padEnd(9)}
                    <span style={{ color: HUD.text }}>{activationText(ev).slice(0, 30)}</span>
                    <span style={{ color: HUD.dim }}> {shortAgo(ev.ts)}</span>
                  </HudRow>
                ))
              )}
            </HudPanel>
            <div className="mt-auto">
              {boostChip && <HudBoostChip minutesLeft={boostChip.minutes} />}
              <HudPanel
                title={`OPENAI // USAGE — ${usageMode === 'api' ? 'API' : 'SUB'} MODE${boostChip ? ' · BOOST' : ''}`}
                boost={!!boostChip}
              >
                {usage?.sub?.pct_left != null ? (
                  <HudGauge
                    label="SUB"
                    frac={usage.sub.pct_left / 100}
                    value={`${usage.sub.pct_left}%${
                      usage.sub.reset_at
                        ? ` → ${new Date(usage.sub.reset_at * 1000).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`
                        : usage.sub.reset
                          ? ` → in ${usage.sub.reset}`
                          : ''
                    }`}
                    colour={
                      usage.sub.pct_left < HUD.subRedBelow
                        ? HUD.red
                        : usage.sub.pct_left < HUD.subAmberBelow
                          ? HUD.amber
                          : HUD.g
                    }
                    dim={usageMode === 'api' ? HUD.dim : HUD.dimStrong}
                  />
                ) : (
                  <HudRow colour={HUD.dim}>SUB --</HudRow>
                )}
                {usage?.api?.usd_mtd != null && usage.budget ? (
                  <HudGauge
                    label="API"
                    frac={usage.api.usd_mtd / usage.budget}
                    value={`$${usage.api.usd_mtd.toFixed(0)}/$${usage.budget.toFixed(0)} → ${nextMonthLabel(clock)}`}
                    colour={
                      usage.api.usd_mtd / usage.budget > HUD.apiRedOver
                        ? HUD.red
                        : usage.api.usd_mtd / usage.budget > HUD.apiAmberOver
                          ? HUD.amber
                          : HUD.g
                    }
                    dim={usageMode === 'api' ? HUD.dimStrong : HUD.dim}
                  />
                ) : usage?.api?.usd_mtd != null ? (
                  <HudRow colour={HUD.dim}>API ${usage.api.usd_mtd.toFixed(2)} this month</HudRow>
                ) : (
                  <HudRow colour={HUD.dim}>API -- needs OPENAI_ADMIN_KEY</HudRow>
                )}
                {costs && (
                  <HudRow colour={HUD.dim}>
                    AZURE {formatTotals(costs.monthToDate.totals)} MTD ·{' '}
                    {formatTotals(costs.lastMonth.totals)} LAST
                  </HudRow>
                )}
              </HudPanel>
            </div>
            <HudPanel title={`${agentName.toUpperCase()} // TELEMETRY`}>
              <HudGauge
                label="CPU"
                frac={(state?.cpuPercent ?? 0) / 100}
                value={state?.cpuPercent != null ? `${state.cpuPercent.toFixed(0)}%` : '--'}
                colour={(state?.cpuPercent ?? 0) > 85 ? HUD.amber : HUD.g}
              />
              <HudGauge
                label="RAM"
                frac={
                  state?.memTotalGb && state.memUsedGb != null
                    ? state.memUsedGb / state.memTotalGb
                    : (state?.memPercent ?? 0) / 100
                }
                value={
                  state?.memTotalGb && state.memUsedGb != null
                    ? `${state.memUsedGb.toFixed(1)}/${state.memTotalGb.toFixed(0)}G`
                    : state?.memPercent != null
                      ? `${state.memPercent.toFixed(0)}%`
                      : '--'
                }
              />
              <HudGauge
                label="LOAD"
                frac={(state?.load1 ?? 0) / 4}
                value={state?.load1 != null ? state.load1.toFixed(2) : '--'}
                colour={(state?.load1 ?? 0) > 3 ? HUD.amber : HUD.g}
              />
              <HudGauge label="ACT" frac={activityPerMin / 20} value={`${activityPerMin}/min`} />
              <div className="mt-[2px]">
                <HudSparkline values={cpuHistory} />
              </div>
              <div className="mt-[6px]">
                <HudRow>
                  NODES {stats?.nodeCount ?? 0} EDGES {stats?.relCount ?? 0} SHOWN{' '}
                  {stats?.shown ?? 0}
                </HudRow>
                <HudRow>
                  READS {state?.recentReads ?? 0} WRITES {state?.recentWrites ?? 0} DREAM{' '}
                  {state?.lastDreamAt ? shortAgo(state.lastDreamAt) : '--'}
                </HudRow>
              </div>
              {deepNow && (
                <HudDeep label={`${deepNow.kind} ${activationText(deepNow)}`} since={deepNow.ts} />
              )}
            </HudPanel>
          </div>

          {/* Top-right: controls */}
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
                userZoomRef.current = false;
                angleRef.current = 0.6;
                tiltRef.current = TILT;
                focusNode(null);
              }}
              title="Reset view"
            >
              <RotateCcw size={12} />
            </button>
            <button
              type="button"
              className="btn-secondary flex items-center gap-1 px-2 py-1 text-xs"
              onClick={toggleFull}
              title={isFull ? 'Exit full page' : 'Full page'}
            >
              {isFull ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
            </button>
          </div>

          {/* Bottom-right: legend */}
          <div
            className="pointer-events-none absolute right-3 bottom-3 flex items-center gap-3 font-mono text-[10px]"
            style={{ color: HOLO_DIM }}
          >
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: READ_COLOUR }} />{' '}
              READING
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: WRITE_COLOUR }} />{' '}
              WRITING
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: NEW_COLOUR }} /> NEW
            </span>
            <span className="flex items-center gap-1">
              <span
                className="h-2 w-5 rounded-full"
                style={{ background: `linear-gradient(90deg, ${OTHER_COLOUR}, ${WRITE_COLOUR})` }}
              />{' '}
              OLDER → RECENT
            </span>
            <span className="flex items-center gap-1">
              <Zap size={10} /> DRAG TO TURN · WHEEL TO ZOOM · CLICK A NODE
            </span>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

/** "01 Oct" for the first of next month, when the API budget resets. */
function nextMonthLabel(nowMs: number): string {
  const d = new Date(nowMs);
  const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return next.toLocaleDateString([], { day: '2-digit', month: 'short' });
}

function shortAgo(ts: number): string {
  const s = Math.max(0, Math.round(Date.now() / 1000 - ts));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
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
