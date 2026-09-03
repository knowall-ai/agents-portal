'use client';

import type { AgentStatus } from '@/types';

const labels: Record<AgentStatus, string> = {
  online: 'Online',
  degraded: 'Degraded',
  offline: 'Offline',
  planned: 'Planned',
  unknown: 'Unknown',
};

interface StatusBadgeProps {
  status: AgentStatus;
  size?: 'sm' | 'md';
  title?: string;
}

export default function StatusBadge({ status, size = 'md', title }: StatusBadgeProps) {
  return (
    <span
      className={`status-badge status-${status} ${size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : ''}`}
      title={title}
    >
      <span className={`status-dot status-dot-${status}`} />
      {labels[status]}
    </span>
  );
}
