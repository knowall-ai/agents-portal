'use client';

import { useSession } from 'next-auth/react';
import { Activity, RefreshCw } from 'lucide-react';
import { MainLayout } from '@/components/layout';
import { ActivityFeed } from '@/components/agents';
import { useApi } from '@/hooks';
import type { ActivityEvent } from '@/types';

export default function ActivityPage() {
  const { status } = useSession();
  const { data, error, isLoading, refetch, lastUpdated } = useApi<{ events: ActivityEvent[] }>(
    status === 'authenticated' ? '/api/activity?limit=100' : null,
    120_000
  );

  return (
    <MainLayout>
      <div className="p-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1
              className="flex items-center gap-2 text-2xl font-bold"
              style={{ color: 'var(--text-primary)' }}
            >
              <Activity size={22} style={{ color: 'var(--primary)' }} /> Activity
            </h1>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Azure Activity Log, GitHub commits and AI Foundry runs across all agents
              {lastUpdated && ` · updated ${lastUpdated.toLocaleTimeString()}`}
            </p>
          </div>
          <button onClick={refetch} className="btn-secondary flex items-center gap-2 text-sm">
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
        <div className="card">
          <ActivityFeed
            events={data?.events ?? null}
            isLoading={isLoading}
            error={error}
            showAgent
          />
        </div>
      </div>
    </MainLayout>
  );
}
