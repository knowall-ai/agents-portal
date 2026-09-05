'use client';

import { Suspense, use } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { formatDistanceToNow } from 'date-fns';
import {
  ArrowLeft,
  BadgeCheck,
  Boxes,
  Building2,
  ExternalLink,
  Github,
  Globe,
  Heart,
  LayoutGrid,
  MessageSquare,
  Phone,
  Receipt,
  RefreshCw,
  Share2,
  ShieldCheck,
  Sparkles,
  Activity,
  Brain,
  Zap,
} from 'lucide-react';
import { MainLayout } from '@/components/layout';
import {
  AgentAvatar,
  EmptyState,
  EnvironmentBadge,
  KindBadge,
  LoadingSpinner,
  StatusBadge,
  Tabs,
  type TabDef,
} from '@/components/common';
import {
  ActivityFeed,
  BoostControl,
  BrainView,
  CostBreakdown,
  FoundryAssistants,
  LicenseList,
  PermissionsPanel,
  ResourceTable,
  SkillList,
  SoulPanel,
} from '@/components/agents';
import { useApi } from '@/hooks';
import { BACKDROPS, type Backdrop } from '@/components/agents/BrainView';
import type {
  ActivityEvent,
  AgentBoost,
  AgentBrain,
  AgentCosts,
  AgentDetail,
  AgentLicensing,
  AgentPermissions,
  AgentSoul,
  FoundryAssistant,
  Skill,
} from '@/types';

const TAB_IDS = [
  'overview',
  'brain',
  'costs',
  'licences',
  'permissions',
  'skills',
  'activity',
] as const;
type TabId = (typeof TAB_IDS)[number];
const RECENT_ACTIVITY = 8;

export default function AgentPage(props: { params: Promise<{ id: string }> }) {
  // useSearchParams needs a Suspense boundary in the App Router
  return (
    <Suspense
      fallback={
        <MainLayout>
          <LoadingSpinner className="py-12" message="Loading agent..." />
        </MainLayout>
      }
    >
      <AgentPageInner {...props} />
    </Suspense>
  );
}

function AgentPageInner({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { status } = useSession();
  const ready = status === 'authenticated';
  const router = useRouter();
  const searchParams = useSearchParams();
  const requested = searchParams.get('tab');
  const requestedTab: TabId | null = (TAB_IDS as readonly string[]).includes(requested ?? '')
    ? (requested as TabId)
    : null;
  const demo = searchParams.get('demo') === '1';
  const requestedBg = searchParams.get('bg');
  const backdrop: Backdrop = (BACKDROPS as readonly string[]).includes(requestedBg ?? '')
    ? (requestedBg as Backdrop)
    : 'bridge';
  const setTab = (next: string) => {
    const query = new URLSearchParams(searchParams.toString());
    if (next === 'overview') query.delete('tab');
    else query.set('tab', next);
    const qs = query.toString();
    router.replace(qs ? `?${qs}` : `/agents/${id}`, { scroll: false });
  };

  const detail = useApi<{ agent: AgentDetail; assistants: FoundryAssistant[] }>(
    ready ? `/api/agents/${id}` : null,
    60_000
  );
  const skills = useApi<{ skills: Skill[] }>(ready ? `/api/agents/${id}/skills` : null);
  const soul = useApi<{ soul: AgentSoul | null; configured: boolean }>(
    ready ? `/api/agents/${id}/soul` : null
  );
  const activity = useApi<{ events: ActivityEvent[] }>(
    ready ? `/api/agents/${id}/activity` : null,
    120_000
  );
  const costs = useApi<AgentCosts>(ready ? `/api/agents/${id}/costs` : null, 15 * 60_000);
  const licensing = useApi<{ licensing: AgentLicensing }>(
    ready ? `/api/agents/${id}/licenses` : null
  );
  const permissions = useApi<{ permissions: AgentPermissions }>(
    ready ? `/api/agents/${id}/permissions` : null
  );
  const boost = useApi<{ boost: AgentBoost }>(ready ? `/api/agents/${id}/boost` : null, 60_000);
  const brain = useApi<{ brain: AgentBrain }>(
    ready ? `/api/agents/${id}/brain${demo ? '?demo=1' : ''}` : null
  );
  const setDemo = (on: boolean) => {
    const next = new URLSearchParams(searchParams.toString());
    if (on) next.set('demo', '1');
    else next.delete('demo');
    next.set('tab', 'brain');
    router.replace(`/agents/${id}?${next.toString()}`);
  };

  const agent = detail.data?.agent;
  const permissionCount = permissions.data
    ? (permissions.data.permissions.account
        ? permissions.data.permissions.account.directoryRoles.length +
          permissions.data.permissions.account.groups.length +
          permissions.data.permissions.account.azureRoles.length
        : 0) +
      permissions.data.permissions.apps.reduce(
        (n, app) => n + app.permissions.length + app.azureRoles.length,
        0
      )
    : undefined;
  const tabs: TabDef[] = [
    { id: 'overview', label: 'Overview', icon: <LayoutGrid size={14} /> },
    {
      id: 'brain',
      label: 'Brain',
      icon: <Brain size={14} />,
      count: brain.data?.brain.snapshot?.stats.nodeCount,
    },
    { id: 'costs', label: 'Costs', icon: <Receipt size={14} /> },
    {
      id: 'licences',
      label: 'Licences',
      icon: <BadgeCheck size={14} />,
      count: licensing.data?.licensing.licenses.length,
    },
    {
      id: 'permissions',
      label: 'Permissions',
      icon: <ShieldCheck size={14} />,
      count: permissionCount,
    },
    {
      id: 'skills',
      label: 'Skills',
      icon: <Sparkles size={14} />,
      count: skills.data?.skills.length,
    },
    {
      id: 'activity',
      label: 'Activity',
      icon: <Activity size={14} />,
      count: activity.data?.events.length,
    },
  ];
  // only a tab that is actually rendered can be selected, so a shared ?tab=brain link
  // on an agent without a brain falls back to Overview instead of a blank panel
  const tab: TabId =
    requestedTab && tabs.some((t) => t.id === requestedTab) ? requestedTab : 'overview';

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
                {agent.teamsCallUrl && (
                  <a
                    href={agent.teamsCallUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-primary flex items-center gap-2 text-sm"
                    title="Start a Teams call with this agent"
                  >
                    <Phone size={14} /> Call in Teams
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
                    licensing.refetch();
                    permissions.refetch();
                    boost.refetch();
                    brain.refetch();
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

            <Tabs tabs={tabs} active={tab} onChange={setTab} idPrefix="agent" />

            <div role="tabpanel" id={`agent-panel-${tab}`} aria-labelledby={`agent-${tab}`}>
              {tab === 'overview' && (
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                  <div className="space-y-6 lg:col-span-2">
                    {boost.data?.boost.supported && (
                      <section className="card">
                        <h2
                          className="flex items-center gap-2 border-b p-4 text-lg font-semibold"
                          style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                        >
                          <Zap size={18} style={{ color: 'var(--primary)' }} /> Boost
                        </h2>
                        <BoostControl
                          agentId={agent.id}
                          boost={boost.data?.boost ?? null}
                          isLoading={boost.isLoading}
                          error={boost.error}
                          onChanged={() => boost.refetch()}
                        />
                      </section>
                    )}

                    {agent.repo && (soul.isLoading || soul.error || soul.data) && (
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
                          configured={soul.data?.configured}
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
                          <Brain size={18} style={{ color: 'var(--primary)' }} /> AI Foundry
                          assistants
                        </h2>
                        <FoundryAssistants assistants={detail.data.assistants} />
                      </section>
                    )}
                  </div>

                  <section className="card self-start">
                    <h2
                      className="flex items-center gap-2 border-b p-4 text-lg font-semibold"
                      style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                    >
                      <Activity size={18} style={{ color: 'var(--primary)' }} /> Recent activity
                      <button
                        type="button"
                        onClick={() => setTab('activity')}
                        className="ml-auto text-xs font-normal hover:underline"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        View all
                      </button>
                    </h2>
                    <ActivityFeed
                      events={activity.data?.events.slice(0, RECENT_ACTIVITY) ?? null}
                      isLoading={activity.isLoading}
                      error={activity.error}
                    />
                  </section>
                </div>
              )}

              {tab === 'brain' && (
                <section className="card overflow-hidden">
                  <h2
                    className="flex items-center gap-2 border-b p-4 text-lg font-semibold"
                    style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                  >
                    <Brain size={18} style={{ color: 'var(--primary)' }} /> Brain
                    <span className="text-sm font-normal" style={{ color: 'var(--text-muted)' }}>
                      Reverie graph memory, live
                    </span>
                  </h2>
                  <BrainView
                    agentId={agent.id}
                    agentName={agent.name}
                    agentStatus={agent.status}
                    brain={brain.data?.brain ?? null}
                    costs={costs.data}
                    boost={boost.data?.boost ?? null}
                    backdrop={backdrop}
                    isLoading={brain.isLoading}
                    error={brain.error}
                    demo={demo}
                    onDemoChange={setDemo}
                  />
                </section>
              )}

              {tab === 'costs' && (
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
              )}

              {tab === 'licences' && (
                <section className="card">
                  <h2
                    className="flex items-center gap-2 border-b p-4 text-lg font-semibold"
                    style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                  >
                    <BadgeCheck size={18} style={{ color: 'var(--primary)' }} /> Licences
                  </h2>
                  <LicenseList
                    licensing={licensing.data?.licensing ?? null}
                    isLoading={licensing.isLoading}
                    error={licensing.error}
                  />
                </section>
              )}

              {tab === 'permissions' && (
                <section className="card">
                  <h2
                    className="flex items-center gap-2 border-b p-4 text-lg font-semibold"
                    style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                  >
                    <ShieldCheck size={18} style={{ color: 'var(--primary)' }} /> Permissions
                  </h2>
                  <PermissionsPanel
                    permissions={permissions.data?.permissions ?? null}
                    isLoading={permissions.isLoading}
                    error={permissions.error}
                  />
                </section>
              )}

              {tab === 'skills' && (
                <section className="card">
                  <h2
                    className="flex items-center gap-2 border-b p-4 text-lg font-semibold"
                    style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                  >
                    <Sparkles size={18} style={{ color: 'var(--primary)' }} /> Skills
                  </h2>
                  <SkillList
                    skills={skills.data?.skills ?? null}
                    isLoading={skills.isLoading}
                    error={skills.error}
                  />
                </section>
              )}

              {tab === 'activity' && (
                <section className="card">
                  <h2
                    className="flex items-center gap-2 border-b p-4 text-lg font-semibold"
                    style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                  >
                    <Activity size={18} style={{ color: 'var(--primary)' }} /> Activity
                  </h2>
                  <ActivityFeed
                    events={activity.data?.events ?? null}
                    isLoading={activity.isLoading}
                    error={activity.error}
                  />
                </section>
              )}
            </div>
          </>
        ) : null}
      </div>
    </MainLayout>
  );
}
