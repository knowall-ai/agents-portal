'use client';

import { Suspense, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Bot, RefreshCw } from 'lucide-react';
import { MainLayout } from '@/components/layout';
import { EmptyState, LoadingSpinner, kindLabels } from '@/components/common';
import { AgentCard } from '@/components/agents';
import { useApi } from '@/hooks';
import type { AgentKind, AgentStatus, AgentSummary } from '@/types';

function AgentsView() {
  const { status } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const { data, error, isLoading, refetch, lastUpdated } = useApi<{ agents: AgentSummary[] }>(
    status === 'authenticated' ? '/api/agents' : null,
    60_000
  );

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
    router.replace(`/agents${next.toString() ? `?${next}` : ''}`);
  };

  const byCustomer = filtered.reduce<Record<string, AgentSummary[]>>((acc, agent) => {
    (acc[agent.customer] ??= []).push(agent);
    return acc;
  }, {});

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Agents
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {filtered.length} of {agents.length} agents
            {lastUpdated && ` · updated ${lastUpdated.toLocaleTimeString()}`}
          </p>
        </div>
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
          <button onClick={refetch} className="btn-secondary flex items-center gap-2 text-sm">
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {isLoading && !data ? (
        <LoadingSpinner className="py-12" message="Discovering agents in Azure..." />
      ) : error && !data ? (
        <div className="card">
          <EmptyState title="Could not load agents" description={error} />
        </div>
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

export default function AgentsPage() {
  return (
    <MainLayout>
      <Suspense fallback={<LoadingSpinner className="py-12" />}>
        <AgentsView />
      </Suspense>
    </MainLayout>
  );
}
