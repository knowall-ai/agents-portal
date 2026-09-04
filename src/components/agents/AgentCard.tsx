'use client';

import Link from 'next/link';
import {
  ArrowRight,
  Boxes,
  Building2,
  ExternalLink,
  Github,
  MessageSquare,
  Share2,
} from 'lucide-react';
import { AgentAvatar, EnvironmentBadge, KindBadge, StatusBadge } from '@/components/common';
import type { AgentSummary } from '@/types';

export default function AgentCard({ agent }: { agent: AgentSummary }) {
  return (
    <Link
      href={`/agents/${agent.id}`}
      className="card flex flex-col p-5 transition-colors hover:bg-[var(--surface-hover)]"
      style={{ borderLeft: `3px solid var(--status-${agent.status})` }}
      data-testid="agent-card"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <AgentAvatar name={agent.name} image={agent.avatarUrl} status={agent.status} size="md" />
          <div className="min-w-0">
            <h3 className="truncate text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              {agent.name}
            </h3>
            <p className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
              <Building2 size={12} />
              {agent.customer}
            </p>
          </div>
        </div>
        <StatusBadge status={agent.status} title={agent.statusReason} />
      </div>

      {agent.description && (
        <p className="mb-4 line-clamp-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
          {agent.description}
        </p>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-2">
        <KindBadge kind={agent.kind} />
        <EnvironmentBadge environment={agent.environment} />
        {agent.delegated && (
          <span
            className="kind-badge"
            style={{ color: 'var(--status-planned)' }}
            title="Resources live in another tenant, delegated via Azure Lighthouse"
          >
            <Share2 size={12} />
            Lighthouse
          </span>
        )}
        <span
          className="ml-auto flex items-center gap-3 text-xs"
          style={{ color: 'var(--text-muted)' }}
        >
          <span className="flex items-center gap-1" title="Azure resources">
            <Boxes size={12} />
            {agent.resourceCount}
          </span>
          {agent.teamsChatUrl && <MessageSquare size={12} aria-label="Reachable in Teams" />}
          {agent.repo && <Github size={12} aria-label="Has GitHub repo" />}
          {agent.portalUrl && <ExternalLink size={12} aria-label="Has portal" />}
          <ArrowRight size={14} />
        </span>
      </div>
    </Link>
  );
}
