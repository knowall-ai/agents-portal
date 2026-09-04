'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  Bot,
  Building2,
  CheckCircle,
  Clock,
  LayoutGrid,
  List,
  Receipt,
  RefreshCw,
} from 'lucide-react';
import { EmptyState, LoadingSpinner, kindLabels } from '@/components/common';
import { AgentCard, AgentTable } from '@/components/agents';
import { useApi } from '@/hooks';
import { formatTotals } from '@/lib/format';
import type { AgentKind, AgentStatus, AgentSummary, CostsSummary, CurrencyTotals } from '@/types';

type ViewMode = 'list' | 'grid';
const VIEW_KEY = 'agents-portal-agents-view';

/** KPIs + filterable agent list. Used as the home page. */
export default function AgentsView() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const [view, setView] = useState<ViewMode>('list');
  const { data, error, isLoading, refetch, lastUpdated } = useApi<{ agents: AgentSummary[] }>(
    status === 'authenticated' ? '/api/agents' : null,
    60_000
  );
  const costsApi = useApi<CostsSummary>(
    status === 'authenticated' ? '/api/costs' : null,
    15 * 60_000
  );
  const costByAgent = useMemo(() => {
    const map = new Map<string, CurrencyTotals>();
    for (const a of costsApi.data?.agents ?? []) map.set(a.agentId, a.monthToDate);
    return map;
  }, [costsApi.data]);

  // Remember the chosen view per browser
  useEffect(() => {
    try {
      const stored = localStorage.getItem(VIEW_KEY);
      if (stored === 'grid' || stored === 'list') setView(stored);
    } catch {
      // localStorage unavailable — keep default
    }
  }, []);

  const changeView = (next: ViewMode) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // ignore
    }
  };

  const q = (params.get('q') ?? '').toLowerCase();
  const statusFilter = params.get('status') ?? '';
  const kindFilter = params.get('kind') ?? '';
  const customerFilter = params.get('customer') ?? '';

  const agents = useMemo(() => data?.agents ?? [], [data]);
  const customers = useMemo(() => [...new Set(agents.map((a) => a.customer))].sort(), [agents]);

  const filtered = agents.filter((a) => {
    if (statusFilter && a.status !== statusFilter) return false;
    if (kindFilter && a.kind !== kindFilter) return false;
    if (customerFilter && a.customer !== customerFilter) return false;
    if (q) {
      const haystack = [a.name, a.customer, a.description, ...a.resourceGroups, a.subscriptionName]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`/${next.toString() ? `?${next}` : ''}`);
  };

  const byCustomer = filtered.reduce<Record<string, AgentSummary[]>>((acc, agent) => {
    (acc[agent.customer] ??= []).push(agent);
    return acc;
  }, {});

  const count = (s: AgentStatus) => agents.filter((a) => a.status === s).length;
  const attention = count('degraded') + count('offline');
  const kpis: {
    title: string;
    value: number | string;
    icon: React.ReactNode;
    color: string;
    status: string;
    loading?: boolean;
    hint?: string;
  }[] = [
    {
      title: 'Online',
      value: count('online'),
      icon: <CheckCircle size={22} />,
      color: 'var(--status-online)',
      status: 'online',
    },
    {
      title: 'Needs attention',
      value: attention,
      icon: <AlertTriangle size={22} />,
      color: attention ? 'var(--status-offline)' : 'var(--text-muted)',
      status: 'degraded',
    },
    {
      title: 'Planned',
      value: count('planned'),
      icon: <Clock size={22} />,
      color: 'var(--status-planned)',
      status: 'planned',
    },
    {
      title: 'Customers',
      value: customers.length,
      icon: <Building2 size={22} />,
      color: 'var(--primary)',
      status: '',
    },
    {
      title: 'Total agents',
      value: agents.length,
      icon: <Bot size={22} />,
      color: 'var(--primary)',
      status: '',
    },
    (() => {
      const summary = costsApi.data;
      const azure = summary?.sources.find((s) => s.source === 'azure');
      const failed = !summary ? Boolean(costsApi.error) : azure?.status === 'error';
      return {
        title: 'Cost this month',
        value: failed ? 'n/a' : summary ? formatTotals(summary.totals.monthToDate, '—') : '',
        icon: <Receipt size={22} />,
        color: failed ? 'var(--text-muted)' : 'var(--status-degraded)',
        status: '',
        loading: costsApi.isLoading && !summary,
        hint: failed
          ? (azure?.detail ?? costsApi.error ?? 'Cost lookup failed').replace(/\{.*$/, '').trim()
          : summary
            ? `Last month ${formatTotals(summary.totals.lastMonth, '—')}`
            : undefined,
      };
    })(),
  ];

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Welcome back, {session?.user?.name?.split(' ')[0] || 'User'}
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {filtered.length} of {agents.length} agents
            {lastUpdated && ` · updated ${lastUpdated.toLocaleTimeString()}`}
          </p>
        </div>
        <button onClick={refetch} className="btn-secondary flex items-center gap-2 text-sm">
          <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* KPIs */}
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        {kpis.map((kpi) => {
          const active = kpi.status !== '' && statusFilter === kpi.status;
          return (
            <Link
              key={kpi.title}
              href={kpi.status ? `/?status=${kpi.status}` : '/'}
              className="card p-4 transition-colors hover:bg-[var(--surface-hover)]"
              style={active ? { borderColor: kpi.color } : undefined}
              aria-pressed={active}
              title={kpi.hint}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="mb-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                    {kpi.title}
                  </p>
                  {(isLoading && !data) || kpi.loading ? (
                    <div className="flex h-8 items-center">
                      <LoadingSpinner size="sm" />
                    </div>
                  ) : (
                    <p
                      className={`font-bold ${typeof kpi.value === 'string' && kpi.value.length > 8 ? 'text-base' : 'text-2xl'}`}
                      style={{ color: kpi.color }}
                    >
                      {kpi.value}
                    </p>
                  )}
                  {kpi.hint && (
                    <p className="truncate text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      {kpi.hint}
                    </p>
                  )}
                </div>
                <div
                  className="rounded-lg p-2"
                  style={{
                    backgroundColor: `color-mix(in srgb, ${kpi.color} 15%, transparent)`,
                    color: kpi.color,
                  }}
                >
                  {kpi.icon}
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      {error && !data && (
        <div
          className="card mb-6 flex items-center gap-4 p-4"
          style={{ borderColor: 'var(--status-offline)' }}
        >
          <AlertTriangle size={24} style={{ color: 'var(--status-offline)' }} />
          <div>
            <p className="font-medium" style={{ color: 'var(--text-primary)' }}>
              Could not load agents from Azure
            </p>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              {error}
            </p>
          </div>
        </div>
      )}

      {/* Filters + view toggle */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="input text-sm"
            value={customerFilter}
            onChange={(e) => setParam('customer', e.target.value)}
            aria-label="Filter by customer"
          >
            <option value="">All customers</option>
            {customers.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            className="input text-sm"
            value={statusFilter}
            onChange={(e) => setParam('status', e.target.value)}
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            {(['online', 'degraded', 'offline', 'planned', 'unknown'] as AgentStatus[]).map((s) => (
              <option key={s} value={s}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
          <select
            className="input text-sm"
            value={kindFilter}
            onChange={(e) => setParam('kind', e.target.value)}
            aria-label="Filter by kind"
          >
            <option value="">All kinds</option>
            {(Object.keys(kindLabels) as AgentKind[]).map((k) => (
              <option key={k} value={k}>
                {kindLabels[k]}
              </option>
            ))}
          </select>
          {(statusFilter || kindFilter || customerFilter || q) && (
            <Link href="/" className="text-sm hover:underline" style={{ color: 'var(--primary)' }}>
              Clear filters
            </Link>
          )}
        </div>
        <div
          className="flex overflow-hidden rounded-md border"
          style={{ borderColor: 'var(--border)' }}
          role="group"
          aria-label="View mode"
        >
          <button
            onClick={() => changeView('list')}
            className="p-2 transition-colors"
            style={{
              backgroundColor: view === 'list' ? 'rgba(34,197,94,0.15)' : 'var(--surface)',
              color: view === 'list' ? 'var(--primary)' : 'var(--text-secondary)',
            }}
            aria-pressed={view === 'list'}
            aria-label="List view"
            title="List view"
          >
            <List size={16} />
          </button>
          <button
            onClick={() => changeView('grid')}
            className="p-2 transition-colors"
            style={{
              backgroundColor: view === 'grid' ? 'rgba(34,197,94,0.15)' : 'var(--surface)',
              color: view === 'grid' ? 'var(--primary)' : 'var(--text-secondary)',
            }}
            aria-pressed={view === 'grid'}
            aria-label="Card view"
            title="Card view"
          >
            <LayoutGrid size={16} />
          </button>
        </div>
      </div>

      {isLoading && !data ? (
        <LoadingSpinner className="py-12" message="Discovering agents in Azure..." />
      ) : filtered.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Bot size={28} />}
            title="No agents match"
            description={
              agents.length === 0
                ? 'Tag an agent’s Azure resources with agent=<name> or add it to config/agents.json.'
                : 'Try clearing the filters or searching for something else.'
            }
          />
        </div>
      ) : view === 'list' ? (
        <AgentTable agents={filtered} costs={costByAgent} />
      ) : (
        Object.entries(byCustomer).map(([customer, list]) => (
          <section key={customer} className="mb-8">
            <h2
              className="mb-3 text-sm font-semibold uppercase"
              style={{ color: 'var(--text-muted)' }}
            >
              {customer}
            </h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {list.map((agent) => (
                <AgentCard key={agent.id} agent={agent} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
