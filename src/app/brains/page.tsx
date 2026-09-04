'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { Brain, ExternalLink, Maximize2, Minimize2, RefreshCw } from 'lucide-react';
import { MainLayout } from '@/components/layout';
import { BrainView } from '@/components/agents';
import { HUD } from '@/components/common/hud/Hud';
import { useApi } from '@/hooks';
import type { AgentBrain, AgentSummary } from '@/types';

/** Never fewer tiles than this, so the wall reads as a bank of monitors */
const MIN_TILES = 4;
const TILE_HEIGHT = 340;

/** Agents that run on their own VM and can therefore carry a Reverie brain */
function hasOwnVm(agent: AgentSummary): boolean {
  return agent.kind === 'openclaw' || (agent.kind as string) === 'hermes';
}

function BrainTile({ agent, height }: { agent: AgentSummary; height: number }) {
  const brain = useApi<{ brain: AgentBrain }>(`/api/agents/${agent.id}/brain`);
  return (
    <div
      className="group relative overflow-hidden rounded-md"
      style={{ backgroundColor: '#05070b' }}
    >
      <BrainView
        agentId={agent.id}
        agentName={agent.name}
        agentStatus={agent.status}
        brain={brain.data?.brain ?? null}
        isLoading={brain.isLoading}
        error={brain.error}
        compact
        height={height}
      />
      <Link
        href={`/agents/${agent.id}?tab=brain`}
        className="absolute top-2 right-3 flex items-center gap-1 text-xs opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
        style={{ color: HUD.g, fontFamily: HUD.font }}
        title={`Open ${agent.name}'s brain`}
      >
        OPEN <ExternalLink size={11} />
      </Link>
    </div>
  );
}

function EmptyTile({ height }: { height: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-md border"
      style={{
        height,
        backgroundColor: '#05070b',
        borderColor: 'rgba(157, 255, 10, 0.12)',
        fontFamily: HUD.font,
      }}
    >
      <span className="text-xs tracking-[0.3em] uppercase" style={{ color: HUD.dim }}>
        No signal
      </span>
    </div>
  );
}

/** A CCTV wall of every VM-hosted agent's brain, at least four monitors, full page on demand. */
export default function BrainsPage() {
  const { status } = useSession();
  const agents = useApi<{ agents: AgentSummary[] }>(
    status === 'authenticated' ? '/api/agents' : null,
    60_000
  );
  const wallRef = useRef<HTMLDivElement>(null);
  const [isFull, setIsFull] = useState(false);
  const [viewportHeight, setViewportHeight] = useState(0);
  useEffect(() => {
    const onChange = () => setIsFull(document.fullscreenElement === wallRef.current);
    const onResize = () => setViewportHeight(window.innerHeight);
    onResize();
    document.addEventListener('fullscreenchange', onChange);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      window.removeEventListener('resize', onResize);
    };
  }, []);
  const toggleFull = () => {
    const request = document.fullscreenElement
      ? document.exitFullscreen()
      : wallRef.current?.requestFullscreen();
    request?.catch(() => undefined);
  };

  const withBrains = (agents.data?.agents ?? []).filter(hasOwnVm);
  const tileCount = Math.max(MIN_TILES, Math.ceil(withBrains.length / 2) * 2);
  const rows = tileCount / 2;
  // In full page the wall fills the screen; otherwise fixed monitors
  const tileHeight =
    isFull && viewportHeight ? Math.floor((viewportHeight - 16 * (rows + 1)) / rows) : TILE_HEIGHT;

  return (
    <MainLayout>
      <div className="p-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1
              className="flex items-center gap-2 text-2xl font-bold"
              style={{ color: 'var(--text-primary)' }}
            >
              <Brain size={22} style={{ color: 'var(--primary)' }} /> Brains
            </h1>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Every agent with its own VM, live. Hover a monitor to open that brain.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={agents.refetch}
              className="btn-secondary flex items-center gap-2 text-sm"
            >
              <RefreshCw size={14} className={agents.isLoading ? 'animate-spin' : ''} />
              Refresh
            </button>
            <button
              onClick={toggleFull}
              className="btn-secondary flex items-center gap-2 text-sm"
              title={isFull ? 'Exit full page' : 'Full page'}
            >
              {isFull ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              {isFull ? 'Exit' : 'Full page'}
            </button>
          </div>
        </div>
        <div
          ref={wallRef}
          className="grid grid-cols-1 gap-4 md:grid-cols-2"
          style={{ backgroundColor: '#05070b', padding: isFull ? 16 : 0 }}
        >
          {withBrains.map((agent) => (
            <BrainTile key={agent.id} agent={agent} height={tileHeight} />
          ))}
          {Array.from({ length: tileCount - withBrains.length }, (_, i) => (
            <EmptyTile key={`empty-${i}`} height={tileHeight} />
          ))}
        </div>
      </div>
    </MainLayout>
  );
}
