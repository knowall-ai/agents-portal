'use client';

import { useSession } from 'next-auth/react';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  Building2,
  CheckCircle,
  Clock,
  RefreshCw,
} from 'lucide-react';
import { MainLayout } from '@/components/layout';
import { EmptyState, LoadingSpinner } from '@/components/common';
import { ActivityFeed, AgentCard } from '@/components/agents';
import LandingPage from '@/components/LandingPage';
import { useApi } from '@/hooks';
import type { ActivityEvent, AgentSummary } from '@/types';

export default function HomePage() {
  const { data: session, status } = useSession();
  const agentsApi = useApi<{ agents: AgentSummary[]; tenantId: string }>(
    status === 'authenticated' ? '/api/agents' : null,
    60_000
  );
  const activityApi = useApi<{ events: ActivityEvent[] }>(
    status === 'authenticated' ? '/api/activity?limit=15' : null,
    120_000
  );

  if (status === 'loading') {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        style={{ backgroundColor: 'var(--background)' }}
      >
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!session) {
    return <LandingPage />;
  }

  const agents = agentsApi.data?.agents ?? [];
  const count = (s: AgentSummary['status']) => agents.filter((a) => a.status === s).length;
  const customers = new Set(agents.map((a) => a.customer)).size;
  const attention = agents.filter((a) => a.status === 'degraded' || a.status === 'offline');

  const statCards = [
    {
      title: 'Online',
      value: count('online'),
      icon: <CheckCircle size={24} />,
      color: 'var(--status-online)',
      href: '/agents?status=online',
    },
    {
      title: 'Needs attention',
      value: count('degraded') + count('offline'),
      icon: <AlertTriangle size={24} />,
      color: attention.length ? 'var(--status-offline)' : 'var(--text-muted)',
      href: '/agents?status=degraded',
    },
    {
      title: 'Planned',
      value: count('planned'),
      icon: <Clock size={24} />,
      color: 'var(--status-planned)',
      href: '/agents?status=planned',
    },
    {
      title: 'Customers',
      value: customers,
      icon: <Building2 size={24} />,
      color: 'var(--primary)',
      href: '/agents',
    },
    {
      title: 'Total agents',
      value: agents.length,
      icon: <Bot size={24} />,
      color: 'var(--primary)',
      href: '/agents',
    },
  ];

  return (
    <MainLayout>
      <div className="p-6">
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="mb-2 text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
              Welcome back, {session.user?.name?.split(' ')[0] || 'User'}
            </h1>
            <p style={{ color: 'var(--text-secondary)' }}>
              Here&apos;s how your agents are doing right now.
            </p>
          </div>
          <button
            onClick={() => {
              agentsApi.refetch();
              activityApi.refetch();
            }}
            className="btn-secondary flex items-center gap-2 text-sm"
            aria-label="Refresh"
          >
            <RefreshCw size={14} className={agentsApi.isLoading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>

        {agentsApi.error && !agentsApi.data && (
          <div
            className="card mb-8 flex items-center gap-4 p-4"
            style={{ borderColor: 'var(--status-offline)' }}
          >
            <AlertTriangle size={24} style={{ color: 'var(--status-offline)' }} />
            <div>
              <p className="font-medium" style={{ color: 'var(--text-primary)' }}>
                Could not load agents from Azure
              </p>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                {agentsApi.error}
              </p>
            </div>
          </div>
        )}

        <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5">
          {statCards.map((stat) => (
            <Link
              key={stat.title}
              href={stat.href}
              className="card p-6 transition-colors hover:bg-[var(--surface-hover)]"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="mb-1 text-sm" style={{ color: 'var(--text-muted)' }}>
                    {stat.title}
                  </p>
                  {agentsApi.isLoading && !agentsApi.data ? (
                    <div className="flex h-9 items-center">
                      <LoadingSpinner size="sm" />
                    </div>
                  ) : (
                    <p className="text-3xl font-bold" style={{ color: stat.color }}>
                      {stat.value}
                    </p>
                  )}
                </div>
                <div
                  className="rounded-lg p-3"
                  style={{
                    backgroundColor: `color-mix(in srgb, ${stat.color} 15%, transparent)`,
                    color: stat.color,
                  }}
                >
                  {stat.icon}
                </div>
              </div>
            </Link>
          ))}
        </div>

        <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                {attention.length > 0 ? 'Needs attention' : 'Agents'}
              </h2>
              <Link
                href="/agents"
                className="flex items-center gap-1 text-sm hover:underline"
                style={{ color: 'var(--primary)' }}
              >
                View all <ArrowRight size={14} />
              </Link>
            </div>
            {agentsApi.isLoading && !agentsApi.data ? (
              <LoadingSpinner className="py-12" message="Discovering agents in Azure..." />
            ) : agents.length === 0 ? (
              <div className="card">
                <EmptyState
                  icon={<Bot size={28} />}
                  title="No agents found in this tenant"
                  description="Tag an agent's resources with agent=<name> or add it to config/agents.json. See the onboarding guide."
                />
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {(attention.length > 0 ? attention : agents).slice(0, 6).map((agent) => (
                  <AgentCard key={agent.id} agent={agent} />
                ))}
              </div>
            )}
          </div>

          <div className="card self-start">
            <div
              className="flex items-center justify-between border-b p-4"
              style={{ borderColor: 'var(--border)' }}
            >
              <h2
                className="flex items-center gap-2 text-lg font-semibold"
                style={{ color: 'var(--text-primary)' }}
              >
                <Activity size={18} style={{ color: 'var(--primary)' }} />
                Recent activity
              </h2>
              <Link
                href="/activity"
                className="text-sm hover:underline"
                style={{ color: 'var(--primary)' }}
              >
                All
              </Link>
            </div>
            <ActivityFeed
              events={activityApi.data?.events ?? null}
              isLoading={activityApi.isLoading}
              error={activityApi.error}
              showAgent
              limit={10}
            />
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
