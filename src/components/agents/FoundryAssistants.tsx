'use client';

import { format } from 'date-fns';
import type { FoundryAssistant } from '@/types';

export default function FoundryAssistants({ assistants }: { assistants: FoundryAssistant[] }) {
  if (assistants.length === 0) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="table-header">
          <tr className="text-left text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
            <th className="px-4 py-2 font-medium">Assistant</th>
            <th className="px-4 py-2 font-medium">Model</th>
            <th className="px-4 py-2 font-medium">Tools</th>
            <th className="px-4 py-2 font-medium">Project</th>
            <th className="px-4 py-2 font-medium">Created</th>
          </tr>
        </thead>
        <tbody>
          {assistants.map((a) => (
            <tr key={a.id} className="table-row">
              <td className="px-4 py-2" style={{ color: 'var(--text-primary)' }}>
                <span className="font-medium">{a.name}</span>
                {a.description && (
                  <span
                    className="block max-w-md truncate text-xs"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {a.description}
                  </span>
                )}
              </td>
              <td
                className="px-4 py-2 font-mono text-xs"
                style={{ color: 'var(--text-secondary)' }}
              >
                {a.model}
              </td>
              <td className="px-4 py-2" style={{ color: 'var(--text-secondary)' }}>
                {a.tools.length === 0
                  ? '—'
                  : a.tools.map((t) => (
                      <span
                        key={t}
                        className="mr-1 mb-1 inline-block rounded px-1.5 py-0.5 text-[11px]"
                        style={{ backgroundColor: 'var(--surface-hover)' }}
                      >
                        {t.replace(/^function:/, '')}
                      </span>
                    ))}
              </td>
              <td className="px-4 py-2" style={{ color: 'var(--text-secondary)' }}>
                {a.projectName}
              </td>
              <td className="px-4 py-2" style={{ color: 'var(--text-muted)' }}>
                {format(new Date(a.createdAt), 'd MMM yyyy')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
