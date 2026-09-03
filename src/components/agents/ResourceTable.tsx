'use client';

import { ExternalLink } from 'lucide-react';
import type { AzureResource, ResourceState } from '@/types';

const typeLabels: Record<string, string> = {
  'microsoft.compute/virtualmachines': 'Virtual machine',
  'microsoft.web/sites': 'App Service',
  'microsoft.botservice/botservices': 'Bot Service',
  'microsoft.cognitiveservices/accounts': 'AI Services',
  'microsoft.machinelearningservices/workspaces': 'AI Foundry hub / project',
  'microsoft.app/containerapps': 'Container App',
  'microsoft.containerinstance/containergroups': 'Container Instance',
};

const stateColor: Record<ResourceState, string> = {
  running: 'var(--status-online)',
  provisioned: 'var(--status-online)',
  stopped: 'var(--status-offline)',
  deallocated: 'var(--status-offline)',
  unknown: 'var(--status-unknown)',
};

export default function ResourceTable({ resources }: { resources: AzureResource[] }) {
  if (resources.length === 0) {
    return (
      <p className="p-4 text-sm" style={{ color: 'var(--text-muted)' }}>
        No Azure resources are linked to this agent yet.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="table-header">
          <tr className="text-left text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
            <th className="px-4 py-2 font-medium">Name</th>
            <th className="px-4 py-2 font-medium">Type</th>
            <th className="px-4 py-2 font-medium">State</th>
            <th className="px-4 py-2 font-medium">Resource group</th>
            <th className="px-4 py-2 font-medium">Region</th>
            <th className="px-4 py-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {resources.map((r) => (
            <tr key={r.id} className="table-row">
              <td className="px-4 py-2 font-medium" style={{ color: 'var(--text-primary)' }}>
                {r.name}
                {r.hostName && (
                  <a
                    href={`https://${r.hostName}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-2 text-xs hover:underline"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {r.hostName}
                  </a>
                )}
              </td>
              <td className="px-4 py-2" style={{ color: 'var(--text-secondary)' }}>
                {typeLabels[r.type] ?? r.type}
                {r.kind && (
                  <span className="ml-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                    ({r.kind})
                  </span>
                )}
              </td>
              <td className="px-4 py-2">
                <span className="flex items-center gap-2" style={{ color: stateColor[r.state] }}>
                  <span className="status-dot" style={{ backgroundColor: stateColor[r.state] }} />
                  {r.rawState ?? r.state}
                </span>
              </td>
              <td className="px-4 py-2" style={{ color: 'var(--text-secondary)' }}>
                {r.resourceGroup}
              </td>
              <td className="px-4 py-2" style={{ color: 'var(--text-secondary)' }}>
                {r.location}
              </td>
              <td className="px-4 py-2 text-right">
                <a
                  href={`https://portal.azure.com/#@/resource${r.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex hover:text-[var(--primary)]"
                  style={{ color: 'var(--text-muted)' }}
                  aria-label="Open in Azure portal"
                >
                  <ExternalLink size={14} />
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
