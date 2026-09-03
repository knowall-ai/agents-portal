'use client';

import type { Environment } from '@/types';

const labels: Record<Environment, string> = {
  prod: 'Prod',
  test: 'Test',
  dev: 'Dev',
  unknown: '—',
};

export default function EnvironmentBadge({ environment }: { environment: Environment }) {
  if (environment === 'unknown') return null;
  return (
    <span
      className="rounded px-1.5 py-0.5 text-[11px] font-medium"
      style={{
        backgroundColor: environment === 'prod' ? 'rgba(34,197,94,0.15)' : 'var(--surface-hover)',
        color: environment === 'prod' ? 'var(--primary)' : 'var(--text-secondary)',
      }}
    >
      {labels[environment]}
    </span>
  );
}
