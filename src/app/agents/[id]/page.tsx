'use client';

import { use } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { formatDistanceToNow } from 'date-fns';
import {
  ArrowLeft,
  Boxes,
  Building2,
  ExternalLink,
  Github,
  Globe,
  Heart,
  MessageSquare,
  Receipt,
  RefreshCw,
  Share2,
  Sparkles,
  Activity,
  Brain,
} from 'lucide-react';
import { MainLayout } from '@/components/layout';
import {
  AgentAvatar,
  EmptyState,
  EnvironmentBadge,
  KindBadge,
  LoadingSpinner,
  StatusBadge,
} from '@/components/common';
import {
  ActivityFeed,
  CostBreakdown,
  FoundryAssistants,
  ResourceTable,
  SkillList,
  SoulPanel,
} from '@/components/agents';
import { useApi } from '@/hooks';
import type {
  ActivityEvent,
  AgentCosts,
  AgentDetail,
  AgentSoul,
  FoundryAssistant,
  Skill,
} from '@/types';

export default function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { status } = useSession();
  const ready = status === 'authenticated';

  const detail = useApi<{ agent: AgentDetail; assistants: FoundryAssistant[] }>(
    ready ? `/api/agents/${id}` : null,
    60_000
  );
  const skills = useApi<{ skills: Skill[] }>(ready ? `/api/agents/${id}/skills` : null);
  const soul = useApi<{ soul: AgentSoul | null }>(ready ? `/api/agents/${id}/soul` : null);
  const activity = useApi<{ events: ActivityEvent[] }>(
    ready ? `/api/agents/${id}/activity` : null,
    120_000
  );
  const costs = useApi<AgentCosts>(ready ? `/api/agents/${id}/costs` : null, 15 * 60_000);

  const agent = detail.data?.agent;

  return (
    <MainLayout>
      <div className="p-6">
        <Link
          href="/"
          className="mb-4 inline-flex items-center gap-1 text-sm hover:underline"
          style={{ color: 'var(--text-secondary)' }}
        >
          <ArrowLeft size={14} /> All agents
        </Link>

        {detail.isLoading && !agent ? (
          <LoadingSpinner className="py-12" message="Loading agent..." />
        ) : detail.error && !agent ? (
          <div className="card">
            <EmptyState title="Could not load agent" description={detail.error} />
          </div>
        ) : agent ? (
          <>
            <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-4">
                <AgentAvatar
                  name={agent.name}
                  image={agent.avatarUrl}
                  status={agent.status}
                  size="xl"
                />
                <div className="min-w-0">
                  <div className="mb-1 flex flex-wrap items-center gap-3">
                    <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                      {agent.name}
                    </h1>
                    <StatusBadge status={agent.status} title={agent.statusReason} />
                    <KindBadge kind={agent.kind} />
                    <EnvironmentBadge environment={agent.environment} />
                    {agent.delegated && (
                      <span className="kind-badge" style={{ color: 'var(--status-planned)' }}>
                        <Share2 size={12} /> Lighthouse
                      </span>
                    )}
                  </div>
                  <p
                    className="flex items-center gap-1 text-sm"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    <Building2 size={14} /> {agent.customer}
                  </p>
                  {agent.description && (
                    <p
                      className="mt-2 max-w-2xl text-sm"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      {agent.description}
                    </p>
                  )}
                  <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                    {agent.statusReason}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {agent.teamsChatUrl && (
                  <a
                    href={agent.teamsChatUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-primary flex items-center gap-2 text-sm"
                  >
                    <MessageSquare size={14} /> Chat in Teams
                  </a>
                )}
                {agent.portalUrl && (
                  <a
                    href={agent.portalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-secondary flex items-center gap-2 text-sm"
                  >
                    <Globe size={14} /> Portal <ExternalLink size={12} />
                  </a>
                )}
                {agent.repo && (
                  <a
                    href={`https://github.com/${agent.repo}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-secondary flex items-center gap-2 text-sm"
                  >
                    <Github size={14} /> Repo
                  </a>
                )}
                <button
                  onClick={() => {
                    detail.refetch();
                    skills.refetch();
                    soul.refetch();
                    activity.refetch();
                    costs.refetch();
                  }}
                  className="btn-secondary flex items-center gap-2 text-sm"
                >
                  <RefreshCw size={14} className={detail.isLoading ? 'animate-spin' : ''} />
                  Refresh
                </button>
              </div>
            </div>

            <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
              <div className="card p-4">
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Subscription
                </p>
                <p
                  className="truncate text-sm font-medium"
                  style={{ color: 'var(--text-primary)' }}
                  title={agent.subscriptionId}
                >
                  {agent.subscriptionName ?? agent.subscriptionId ?? '—'}
                </p>
              </div>
              <div className="card p-4">
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Resource groups
                </p>
                <p
                  className="truncate text-sm font-medium"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {agent.resourceGroups.join(', ') || '—'}
                </p>
              </div>
              <div className="card p-4">
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Tenant
                </p>
                <p className="truncate font-mono text-xs" style={{ color: 'var(--text-primary)' }}>
                  {agent.tenantId ?? '—'}
                </p>
              </div>
              <div className="card p-4">
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Reachability
                </p>
                {agent.reachability ? (
                  <p
                    className="text-sm font-medium"
                    style={{
                      color: agent.reachability.reachable
                        ? 'var(--status-online)'
                        : 'var(--status-offline)',
                    }}
                    title={agent.reachability.url}
                  >
                    {agent.reachability.reachable ? 'Responding' : 'Not responding'}
                    {agent.reachability.httpStatus
                      ? ` (HTTP ${agent.reachability.httpStatus})`
                      : ''}
                    <span
                      className="block text-xs font-normal"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      checked{' '}
                      {formatDistanceToNow(new Date(agent.reachability.checkedAt), {
                        addSuffix: true,
                      })}
                    </span>
                  </p>
                ) : (
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    No portal URL configured
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <div className="space-y-6 lg:col-span-2">
                {agent.repo && (soul.isLoading || soul.error || soul.data?.soul) && (
                  <section className="card">
                    <h2
                      className="flex items-center gap-2 border-b p-4 text-lg font-semibold"
                      style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                    >
                      <Heart size={18} style={{ color: 'var(--primary)' }} /> Soul
                      {soul.data?.soul?.url && (
                        <a
                          href={soul.data.soul.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-auto flex items-center gap-1 font-mono text-xs font-normal hover:underline"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          {soul.data.soul.path} <ExternalLink size={11} />
                        </a>
                      )}
                    </h2>
                    <SoulPanel
                      soul={soul.data?.soul ?? null}
                      isLoading={soul.isLoading}
                      error={soul.error}
                    />
                  </section>
                )}

                <section className="card">
                  <h2
                    className="flex items-center gap-2 border-b p-4 text-lg font-semibold"
                    style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                  >
                    <Boxes size={18} style={{ color: 'var(--primary)' }} /> Azure resources
                  </h2>
                  <ResourceTable resources={agent.resources} />
                </section>

                {detail.data && detail.data.assistants.length > 0 && (
                  <section className="card">
                    <h2
                      className="flex items-center gap-2 border-b p-4 text-lg font-semibold"
                      style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                    >
                      <Brain size={18} style={{ color: 'var(--primary)' }} /> AI Foundry assistants
                    </h2>
                    <FoundryAssistants assistants={detail.data.assistants} />
                  </section>
                )}

                <section className="card">
                  <h2
                    className="flex items-center gap-2 border-b p-4 text-lg font-semibold"
                    style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                  >
                    <Receipt size={18} style={{ color: 'var(--primary)' }} /> Costs
                  </h2>
                  <CostBreakdown
                    costs={costs.data}
                    isLoading={costs.isLoading}
                    error={costs.error}
                  />
                </section>

                <section className="card">
                  <h2
                    className="flex items-center gap-2 border-b p-4 text-lg font-semibold"
                    style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                  >
                    <Sparkles size={18} style={{ color: 'var(--primary)' }} /> Skills
                    {skills.data && (
                      <span className="text-sm font-normal" style={{ color: 'var(--text-muted)' }}>
                        ({skills.data.skills.length})
                      </span>
                    )}
                  </h2>
                  <SkillList
                    skills={skills.data?.skills ?? null}
                    isLoading={skills.isLoading}
                    error={skills.error}
                  />
                </section>
              </div>

              <section className="card self-start">
                <h2
                  className="flex items-center gap-2 border-b p-4 text-lg font-semibold"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                >
                  <Activity size={18} style={{ color: 'var(--primary)' }} /> Recent activity
                </h2>
                <ActivityFeed
                  events={activity.data?.events ?? null}
                  isLoading={activity.isLoading}
                  error={activity.error}
                />
              </section>
            </div>
          </>
        ) : null}
      </div>
    </MainLayout>
  );
}
