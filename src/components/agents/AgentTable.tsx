'use client';

import Link from 'next/link';
import { ExternalLink, Github, MessageSquare, Share2 } from 'lucide-react';
import { AgentAvatar, EnvironmentBadge, KindBadge, StatusBadge } from '@/components/common';
import { formatTotals } from '@/lib/format';
import type { AgentSummary, CurrencyTotals } from '@/types';

interface AgentTableProps {
  agents: AgentSummary[];
  /** Month-to-date cost per agent id, when loaded */
  costs?: Map<string, CurrencyTotals>;
}

export default function AgentTable({ agents, costs }: AgentTableProps) {
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm" data-testid="agent-table">
        <thead className="table-header">
          <tr className="text-left text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Agent</th>
            <th className="px-4 py-3 font-medium">Customer</th>
            <th className="px-4 py-3 font-medium">Kind</th>
            <th className="px-4 py-3 font-medium">Env</th>
            <th className="px-4 py-3 font-medium">Resource groups</th>
            <th className="px-4 py-3 text-right font-medium">Resources</th>
            {costs && <th className="px-4 py-3 text-right font-medium">Cost (MTD)</th>}
            <th className="px-4 py-3 font-medium">Links</th>
          </tr>
        </thead>
        <tbody>
          {agents.map((agent) => (
            <tr key={agent.id} className="table-row">
              <td className="px-4 py-3 whitespace-nowrap">
                <StatusBadge status={agent.status} size="sm" title={agent.statusReason} />
              </td>
              <td className="px-4 py-3">
                <Link href={`/agents/${agent.id}`} className="group flex items-center gap-3">
                  <AgentAvatar name={agent.name} image={agent.avatarUrl} size="sm" />
                  <span className="min-w-0">
                    <span
                      className="block font-medium group-hover:underline"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {agent.name}
                    </span>
                    {agent.description && (
                      <span
                        className="block max-w-md truncate text-xs"
                        style={{ color: 'var(--text-muted)' }}
                        title={agent.description}
                      >
                        {agent.description}
                      </span>
                    )}
                  </span>
                </Link>
              </td>
              <td
                className="px-4 py-3 whitespace-nowrap"
                style={{ color: 'var(--text-secondary)' }}
              >
                <span className="flex items-center gap-2">
                  {agent.customer}
                  {agent.delegated && (
                    <span
                      className="kind-badge"
                      style={{ color: 'var(--status-planned)' }}
                      title="Delegated via Azure Lighthouse"
                    >
                      <Share2 size={12} /> Lighthouse
                    </span>
                  )}
                </span>
              </td>
              <td className="px-4 py-3 whitespace-nowrap">
                <KindBadge kind={agent.kind} />
              </td>
              <td className="px-4 py-3 whitespace-nowrap">
                <EnvironmentBadge environment={agent.environment} />
              </td>
              <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>
                {agent.resourceGroups.join(', ') || '—'}
              </td>
              <td className="px-4 py-3 text-right" style={{ color: 'var(--text-secondary)' }}>
                {agent.resourceCount}
              </td>
              {costs && (
                <td
                  className="px-4 py-3 text-right font-mono whitespace-nowrap"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {formatTotals(costs.get(agent.id) ?? {}, '—')}
                </td>
              )}
              <td className="px-4 py-3 whitespace-nowrap">
                <span className="flex items-center gap-2" style={{ color: 'var(--text-muted)' }}>
                  {agent.teamsChatUrl && (
                    <a
                      href={agent.teamsChatUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-[var(--primary)]"
                      aria-label={`Chat with ${agent.name} in Teams`}
                      title="Chat in Teams"
                    >
                      <MessageSquare size={14} />
                    </a>
                  )}
                  {agent.portalUrl && (
                    <a
                      href={agent.portalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-[var(--primary)]"
                      aria-label={`${agent.name} portal`}
                      title={agent.portalUrl}
                    >
                      <ExternalLink size={14} />
                    </a>
                  )}
                  {agent.repo && (
                    <a
                      href={`https://github.com/${agent.repo}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-[var(--primary)]"
                      aria-label={`${agent.name} repository`}
                      title={agent.repo}
                    >
                      <Github size={14} />
                    </a>
                  )}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
