'use client';

import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { Cloud, Github, Brain, ExternalLink } from 'lucide-react';
import { EmptyState, LoadingSpinner } from '@/components/common';
import type { ActivityEvent } from '@/types';

const sourceIcon: Record<ActivityEvent['source'], React.ReactNode> = {
  azure: <Cloud size={14} />,
  github: <Github size={14} />,
  foundry: <Brain size={14} />,
};

const levelColor: Record<ActivityEvent['level'], string> = {
  info: 'var(--text-muted)',
  success: 'var(--status-online)',
  warning: 'var(--status-degraded)',
  error: 'var(--status-offline)',
};

interface ActivityFeedProps {
  events: ActivityEvent[] | null;
  isLoading: boolean;
  error?: string | null;
  showAgent?: boolean;
  limit?: number;
}

export default function ActivityFeed({
  events,
  isLoading,
  error,
  showAgent = false,
  limit,
}: ActivityFeedProps) {
  if (isLoading && !events) {
    return <LoadingSpinner className="py-8" message="Loading activity..." />;
  }
  if (error && !events) {
    return <EmptyState title="Could not load activity" description={error} />;
  }
  const list = (events ?? []).slice(0, limit ?? events?.length ?? 0);
  if (list.length === 0) {
    return (
      <EmptyState
        title="No recent activity"
        description="Nothing in the Azure Activity Log, GitHub or AI Foundry for the last few days."
      />
    );
  }

  return (
    <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
      {list.map((event) => (
        <li key={event.id} className="flex gap-3 px-4 py-3">
          <span
            className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
            style={{ backgroundColor: 'var(--surface-hover)', color: levelColor[event.level] }}
            title={event.source}
          >
            {sourceIcon[event.source]}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
              {showAgent && (
                <Link
                  href={`/agents/${event.agentId}`}
                  className="mr-1 font-medium hover:underline"
                  style={{ color: 'var(--primary)' }}
                >
                  {event.agentName}
                </Link>
              )}
              {event.title}
              {event.url && (
                <a
                  href={event.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-1 inline-flex align-middle hover:text-[var(--primary)]"
                  style={{ color: 'var(--text-muted)' }}
                  aria-label="Open"
                >
                  <ExternalLink size={12} />
                </a>
              )}
            </p>
            {event.detail && (
              <p className="truncate text-xs" style={{ color: 'var(--text-secondary)' }}>
                {event.detail}
              </p>
            )}
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {formatDistanceToNow(new Date(event.timestamp), { addSuffix: true })}
              {event.actor && ` · ${event.actor}`}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
