'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation } from 'd3-force-3d';
import type { Simulation, SimulationLinkDatum, SimulationNodeDatum } from 'd3-force-3d';
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
const CANVAS_HEIGHT = 720;
const OVERLAY_WIDTH = 320;
// Avatar-renderer palette (robot_avatar.py): lime glow, pale core, amber warnings
const HOLO = '#9dff0a';
const HOLO_CORE = '#f0ffcd';
const HOLO_DIM = '#7c8f7c';
const HOLO_AMBER = '#ffb000';
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
  const firesRef = useRef<Map<string, number>>(new Map());
  const panRef = useRef({ y: 0 });
  const focusRef = useRef<{ angle: number; panY: number } | null>(null);
  const packetsRef = useRef<Map<string, number>>(new Map());
  const dustRef = useRef<{ x: number; y: number; vx: number; vy: number; s: number; p: number }[]>(
    []
  );

  const [feed, setFeed] = useState<BrainActivation[]>([]);
  const [stats, setStats] = useState<BrainStats | null>(null);
  const [state, setState] = useState<BrainState | null>(null);
  const [selected, setSelected] = useState<SimNode | null>(null);
  const [rotating, setRotating] = useState(true);
  const [streamStatus, setStreamStatus] = useState<'connecting' | 'live' | 'offline'>('connecting');
  const [tick, setTick] = useState(0);
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
    setNames(nodes.map((n) => ({ id: n.id, name: n.name, label: n.label })));
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
        if (typeof next.cpuPercent === 'number') {
          const cpu = next.cpuPercent;
          setCpuHistory((h) => [...h, cpu].slice(-40));
        }
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

    if (dustRef.current.length === 0) {
      dustRef.current = Array.from({ length: 90 }, () => ({
        x: Math.random() * 1600,
        y: Math.random() * CANVAS_HEIGHT,
        vx: (Math.random() - 0.5) * 0.25,
        vy: -0.05 - Math.random() * 0.2,
        s: Math.random() < 0.15 ? 2 : 1,
        p: Math.random() * 6.28,
      }));
    }
    const dust = dustRef.current;
    const draw = () => {
      frame += 1;
      const w = wrap.clientWidth;
      const h = CANVAS_HEIGHT;
      const cx = w / 2 + OVERLAY_WIDTH / 2 - 40;
      const cy = h / 2 - 10 + panRef.current.y;
      const now = Date.now();
      const focus = focusRef.current;
      if (focus && !dragRef.current) {
        // ease the graph round so the focused node sits front and centre
        let delta = focus.angle - angleRef.current;
        delta = Math.atan2(Math.sin(delta), Math.cos(delta));
        angleRef.current += delta * 0.07;
        panRef.current.y += (focus.panY - panRef.current.y) * 0.08;
      } else {
        if (rotateRef.current && !dragRef.current) angleRef.current += AUTO_ROTATE;
        panRef.current.y += (0 - panRef.current.y) * 0.05;
      }
      const a = angleRef.current;
      const cosA = Math.cos(a);
      const sinA = Math.sin(a);
      const cosT = Math.cos(TILT);
      const sinT = Math.sin(TILT);
      const zoom = zoomRef.current;
      const asleep = agentStatus === 'offline';
      const dreaming = dreamingRef.current;
      const tint = dreaming ? [139, 92, 246] : [34, 211, 238];

      // ---- backdrop: deep field, perspective floor grid, holo rings, dust ----
      const bg = ctx.createRadialGradient(cx, cy, 20, cx, cy, Math.max(w, h) * 0.75);
      bg.addColorStop(0, dreaming ? '#161029' : '#0c1a22');
      bg.addColorStop(0.55, '#090d14');
      bg.addColorStop(1, '#05070b');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

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

      if (dreaming) {
        const pulse = 0.5 + 0.5 * Math.sin(frame / 40);
        const aura = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(w, h) * 0.55);
        aura.addColorStop(0, `rgba(139, 92, 246, ${0.16 + pulse * 0.1})`);
        aura.addColorStop(1, 'rgba(139, 92, 246, 0)');
        ctx.fillStyle = aura;
        ctx.fillRect(0, 0, w, h);
      }

      // dust motes
      ctx.fillStyle = `rgba(${tint[0]}, ${tint[1]}, ${tint[2]}, 0.35)`;
      for (const m of dust) {
        m.x += m.vx;
        m.y += m.vy;
        if (m.x < 0) m.x = w;
        if (m.x > w) m.x = 0;
        if (m.y < 0) m.y = h;
        if (m.y > h) m.y = 0;
        ctx.globalAlpha = 0.15 + 0.35 * Math.abs(Math.sin(frame / 60 + m.p));
        ctx.fillRect(m.x, m.y, m.s, m.s);
      }
      ctx.globalAlpha = 1;

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
        const scale = (FOCAL / (FOCAL + rz2)) * zoom;
        n.sx = cx + rx * scale;
        n.sy = cy + ry * scale;
        n.depth = scale;
        n.sr = (3.2 + Math.sqrt(n.degree) * 1.8) * scale;
      }

      // ---- background firing: the graph is never completely still ----
      const fires = firesRef.current;
      const linkCount = linksRef.current.length;
      if (!asleep && linkCount > 0 && Math.random() < (dreaming ? 0.16 : 0.07)) {
        const l = linksRef.current[Math.floor(Math.random() * linkCount)];
        fires.set(l.id, now + 900 + Math.random() * 600);
      }
      for (const [id, until] of fires) if (until < now) fires.delete(id);
      const focusId = selected?.id;
      const neighbours = new Set<string>();

      // ---- edges (additive) with light packets on active ones ----
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const packets = packetsRef.current;
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
        const base = lit ? 0.45 : hovered ? 0.55 : firing ? 0.35 : 0.05 + depth * 0.1;
        grad.addColorStop(0, hexToRgba(colourFor(s.label), base));
        grad.addColorStop(1, hexToRgba(colourFor(t.label), base));
        ctx.strokeStyle = lit ? hexToRgba(WRITE_COLOUR, 0.55) : grad;
        ctx.lineWidth = lit || hovered ? 1.6 : 0.8;
        ctx.beginPath();
        ctx.moveTo(s.sx, s.sy as number);
        ctx.lineTo(t.sx, t.sy as number);
        ctx.stroke();
        if (lit || hs || ht || firing) {
          // light packet travelling source -> target
          const prog = ((packets.get(l.id) ?? Math.random()) + (firing ? 0.03 : 0.012)) % 1;
          packets.set(l.id, prog);
          const px = s.sx + (t.sx - s.sx) * prog;
          const py = (s.sy as number) + ((t.sy as number) - (s.sy as number)) * prog;
          const pc = lit ? WRITE_COLOUR : firing && !hs && !ht ? HOLO_CORE : READ_COLOUR;
          const pg = ctx.createRadialGradient(px, py, 0, px, py, 7);
          pg.addColorStop(0, hexToRgba(pc, 0.9));
          pg.addColorStop(1, hexToRgba(pc, 0));
          ctx.fillStyle = pg;
          ctx.beginPath();
          ctx.arc(px, py, 7, 0, Math.PI * 2);
          ctx.fill();
        } else {
          packets.delete(l.id);
        }
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
        const fog = asleep ? 0.35 : Math.min(1, 0.35 + depth * 0.55);

        // halo (additive)
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const haloR = r * (active ? 3.2 : 2.1);
        const halo = ctx.createRadialGradient(x, y, r * 0.6, x, y, haloR);
        halo.addColorStop(
          0,
          hexToRgba(active ? active.colour : colour, (active ? 0.5 : 0.22) * fog)
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
        const related = focusId !== undefined && (n.id === focusId || neighbours.has(n.id));
        if (hovered || active || related || n.degree >= labelThreshold) {
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
      vig.addColorStop(1, 'rgba(0,0,0,0.55)');
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
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const z = node.z ?? 0;
    // rx = x cosθ + z sinθ = 0 at θ = atan2(-x, z); +π puts the node on the camera side
    const theta = Math.atan2(-x, z) + Math.PI;
    const rho = Math.hypot(x, z);
    const ry = y * Math.cos(TILT) + rho * Math.sin(TILT);
    const rz2 = y * Math.sin(TILT) - rho * Math.cos(TILT);
    const scale = (FOCAL / (FOCAL + rz2)) * zoomRef.current;
    focusRef.current = { angle: theta, panY: -ry * scale + 10 };
  };

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    zoomRef.current = Math.min(3, Math.max(0.4, zoomRef.current * (e.deltaY > 0 ? 0.92 : 1.08)));
  };

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [] as typeof names;
    return names.filter((n) => n.name.toLowerCase().includes(q)).slice(0, 6);
  }, [names, query]);
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
    <div ref={wrapRef} className="relative overflow-hidden" style={{ height: CANVAS_HEIGHT }}>
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

      {/* Top-left: state + focus */}
      <div
        className="pointer-events-none absolute top-3 left-3 flex flex-col gap-2 font-mono text-[11px]"
        style={{ width: OVERLAY_WIDTH, color: HOLO_CORE }}
      >
        <div className="flex items-center gap-2">
          <span
            className="inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[10px] font-semibold tracking-widest uppercase"
            style={{
              borderColor: hexToRgba(moodColour, 0.6),
              backgroundColor: 'rgba(5, 10, 8, 0.55)',
              color: moodColour,
            }}
          >
            {asleep ? <Moon size={11} /> : dreaming ? <Sparkles size={11} /> : <Sun size={11} />}
            {mood}
          </span>
          <span style={{ color: streamStatus === 'live' ? HOLO : HOLO_DIM }}>
            {streamStatus === 'live'
              ? '● LIVE'
              : streamStatus === 'connecting'
                ? '○ CONNECTING'
                : '○ STREAM OFFLINE'}
          </span>
          {brain.fixture && <span style={{ color: HOLO_AMBER }}>FIXTURE</span>}
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
            placeholder="search her memory…"
            className="w-full px-2 py-1 font-mono text-[11px] outline-none"
            style={{
              border: `1px solid ${hexToRgba(HOLO, 0.35)}`,
              backgroundColor: 'rgba(5, 10, 8, 0.6)',
              color: HOLO_CORE,
            }}
          />
          {query && results.length > 0 && (
            <ul
              className="absolute right-0 left-0 z-10 mt-1"
              style={{
                border: `1px solid ${hexToRgba(HOLO, 0.35)}`,
                backgroundColor: 'rgba(5, 10, 8, 0.92)',
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
                    <span style={{ color: HOLO_DIM }}>{r.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {selected && (
          <Panel title="FOCUS">
            <p className="font-semibold" style={{ color: colourFor(selected.label) }}>
              {selected.name}
            </p>
            <p style={{ color: HOLO_DIM }}>
              {selected.label} · {selected.degree} connections
            </p>
            <ul className="mt-1 space-y-0.5">
              {Object.entries(selected.props)
                .filter(([k]) => k !== 'name')
                .slice(0, 6)
                .map(([k, v]) => (
                  <li key={k} className="truncate">
                    <span style={{ color: HOLO_DIM }}>{k}:</span> {String(v)}
                  </li>
                ))}
            </ul>
            {selectedLinks.length > 0 && (
              <ul className="mt-1 space-y-0.5">
                {selectedLinks.map((l) => {
                  const src = l.source as SimNode;
                  const tgt = l.target as SimNode;
                  const other = src.id === selected.id ? tgt : src;
                  return (
                    <li key={l.id} className="truncate">
                      <span style={{ color: HOLO_DIM }}>
                        {src.id === selected.id ? '→' : '←'} {l.type}
                      </span>{' '}
                      {other.name}
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        )}
      </div>

      {/* Bottom-left: deep-brain feed above telemetry, one aligned column like the video feed */}
      <div
        className="pointer-events-none absolute bottom-3 left-3 flex flex-col gap-2 font-mono text-[11px]"
        style={{ width: OVERLAY_WIDTH, color: HOLO_CORE }}
      >
        <Panel title={`${agentName.toUpperCase()} // DEEP BRAIN`}>
          {feed.length === 0 ? (
            <p style={{ color: HOLO_DIM }}>waiting for the first thought…</p>
          ) : (
            <ul className="space-y-1">
              {feed.slice(0, 7).map((ev, i) => (
                <li key={`${ev.ts}-${i}`} className="flex gap-2 leading-snug">
                  <span style={{ color: activationColour(ev.kind) }}>
                    {activationGlyph(ev.kind)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    <span style={{ color: activationColour(ev.kind) }}>{ev.kind}</span>{' '}
                    {activationText(ev)}
                  </span>
                  <span className="shrink-0" style={{ color: HOLO_DIM }}>
                    {shortAgo(ev.ts)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title={`${agentName.toUpperCase()} // TELEMETRY`}>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
            <Stat label="NODES" value={stats?.nodeCount ?? 0} />
            <Stat label="EDGES" value={stats?.relCount ?? 0} />
            <Stat label="READS 15M" value={state?.recentReads ?? 0} />
            <Stat label="WRITES 15M" value={state?.recentWrites ?? 0} />
            <Stat
              label="LAST DREAM"
              value={state?.lastDreamAt ? shortAgo(state.lastDreamAt) : '—'}
            />
            <Stat
              label="LAST THOUGHT"
              value={state?.lastActivityAt ? shortAgo(state.lastActivityAt) : '—'}
            />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span style={{ color: HOLO_DIM }}>CPU</span>
            <span style={{ color: (state?.cpuPercent ?? 0) > 80 ? HOLO_AMBER : HOLO }}>
              {state?.cpuPercent != null ? `${state.cpuPercent.toFixed(0)}%` : '—'}
              {state?.load1 != null && (
                <span className="ml-2" style={{ color: HOLO_DIM }}>
                  load {state.load1}
                </span>
              )}
              {state?.memPercent != null && (
                <span className="ml-2" style={{ color: HOLO_DIM }}>
                  mem {state.memPercent.toFixed(0)}%
                </span>
              )}
            </span>
          </div>
          <svg className="mt-1 h-7 w-full" viewBox="0 0 100 28" preserveAspectRatio="none">
            <polyline
              fill="none"
              stroke={HOLO}
              strokeWidth="1.2"
              vectorEffect="non-scaling-stroke"
              points={(cpuHistory.length ? cpuHistory : [0])
                .map(
                  (v, i, arr) => `${(i / Math.max(1, arr.length - 1)) * 100},${27 - (v / 100) * 26}`
                )
                .join(' ')}
            />
            <line
              x1="0"
              y1="27.5"
              x2="100"
              y2="27.5"
              stroke={hexToRgba(HOLO, 0.3)}
              strokeWidth="0.5"
            />
          </svg>
          <div
            className="mt-1 flex h-4 items-end gap-[2px]"
            title="activations per minute, last 30 min"
          >
            {sparkline.map((v, i) => (
              <span
                key={i}
                className="flex-1"
                style={{
                  height: `${Math.max(8, Math.min(100, v * 25))}%`,
                  backgroundColor: v ? hexToRgba(READ_COLOUR, 0.8) : hexToRgba(HOLO, 0.12),
                }}
              />
            ))}
          </div>
          <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5">
            {legend.map(([label, count]) => (
              <li key={label} className="flex items-center gap-1.5">
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: colourFor(label) }}
                />
                <span className="flex-1 truncate" style={{ color: HOLO_DIM }}>
                  {label.toUpperCase()}
                </span>
                <span>{count}</span>
              </li>
            ))}
          </ul>
        </Panel>
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
            zoomRef.current = DEFAULT_ZOOM;
            angleRef.current = 0.6;
            focusNode(null);
          }}
          title="Reset view"
        >
          <RotateCcw size={12} />
        </button>
      </div>

      {/* Bottom-right: legend */}
      <div
        className="pointer-events-none absolute right-3 bottom-3 flex items-center gap-3 font-mono text-[10px]"
        style={{ color: HOLO_DIM }}
      >
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: READ_COLOUR }} /> READING
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: WRITE_COLOUR }} />{' '}
          WRITING
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: NEW_COLOUR }} /> NEW
        </span>
        <span className="flex items-center gap-1">
          <Zap size={10} /> DRAG TO TURN · WHEEL TO ZOOM · CLICK A NODE
        </span>
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
      className="relative px-3 py-2"
      style={{
        border: `1px solid ${hexToRgba(HOLO, 0.35)}`,
        backgroundColor: 'rgba(5, 10, 8, 0.6)',
        boxShadow: `0 0 12px ${hexToRgba(HOLO, 0.08)} inset`,
      }}
    >
      {[
        ['top', 'left'],
        ['top', 'right'],
        ['bottom', 'left'],
        ['bottom', 'right'],
      ].map(([v, h]) => (
        <span
          key={`${v}${h}`}
          className="absolute h-2.5 w-2.5"
          style={{
            [v]: -1,
            [h]: -1,
            borderTop: v === 'top' ? `2px solid ${HOLO}` : undefined,
            borderBottom: v === 'bottom' ? `2px solid ${HOLO}` : undefined,
            borderLeft: h === 'left' ? `2px solid ${HOLO}` : undefined,
            borderRight: h === 'right' ? `2px solid ${HOLO}` : undefined,
          }}
        />
      ))}
      <p className="mb-1 text-[10px] tracking-[0.2em]" style={{ color: HOLO_DIM }}>
        {title}
      </p>
      {children}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span style={{ color: HOLO_DIM }}>{label}</span>
      <span style={{ color: HOLO }}>{value}</span>
    </div>
  );
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
