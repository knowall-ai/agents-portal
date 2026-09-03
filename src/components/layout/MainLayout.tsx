'use client';

import { useState } from 'react';
import Sidebar from './Sidebar';
import Header from './Header';
import { useApi } from '@/hooks';
import type { AgentSummary } from '@/types';

interface MainLayoutProps {
  children: React.ReactNode;
}

export default function MainLayout({ children }: MainLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { data } = useApi<{ agents: AgentSummary[] }>('/api/agents', 60_000);

  const counts = data
    ? data.agents.reduce(
        (acc, agent) => {
          if (agent.status in acc) acc[agent.status as keyof typeof acc] += 1;
          return acc;
        },
        { online: 0, degraded: 0, offline: 0, planned: 0 }
      )
    : undefined;

  return (
    <div className="flex h-screen overflow-hidden">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} counts={counts} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header onMenuClick={() => setSidebarOpen(!sidebarOpen)} />
        <main className="flex-1 overflow-auto" style={{ backgroundColor: 'var(--background)' }}>
          {children}
        </main>
      </div>
    </div>
  );
}
