// Azure Resource Manager helpers: Resource Graph, subscriptions, tenants and the Activity Log.
import type {
  ActivityEvent,
  AzureResource,
  AzureSubscription,
  ResourceState,
  Tenant,
} from '@/types';

const ARM = 'https://management.azure.com';

/** Resource types that make up an agent deployment. */
export const AGENT_RESOURCE_TYPES = [
  'microsoft.compute/virtualmachines',
  'microsoft.web/sites',
  'microsoft.botservice/botservices',
  'microsoft.cognitiveservices/accounts',
  'microsoft.machinelearningservices/workspaces',
  'microsoft.app/containerapps',
  'microsoft.containerinstance/containergroups',
];

async function armFetch<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const url = path.startsWith('http') ? path : `${ARM}${path}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`ARM ${response.status} ${path}: ${body.slice(0, 300)}`);
  }
  return response.json() as Promise<T>;
}

interface GraphRow {
  id: string;
  name: string;
  type: string;
  kind: string;
  location: string;
  resourceGroup: string;
  subscriptionId: string;
  tenantId: string;
  tags: Record<string, string> | null;
  powerState: string;
  siteState: string;
  provisioningState: string;
  hostName: string;
}

function normaliseState(row: GraphRow): { state: ResourceState; rawState?: string } {
  const type = row.type.toLowerCase();
  if (type === 'microsoft.compute/virtualmachines') {
    const code = row.powerState || '';
    if (code.endsWith('running')) return { state: 'running', rawState: code };
    if (code.endsWith('deallocated')) return { state: 'deallocated', rawState: code };
    if (code.endsWith('stopped')) return { state: 'stopped', rawState: code };
    return { state: 'unknown', rawState: code || undefined };
  }
  if (type === 'microsoft.web/sites' || type === 'microsoft.app/containerapps') {
    const s = row.siteState || row.provisioningState || '';
    if (/running|succeeded/i.test(s)) return { state: 'running', rawState: s };
    if (/stopped/i.test(s)) return { state: 'stopped', rawState: s };
    return { state: 'unknown', rawState: s || undefined };
  }
  if (type === 'microsoft.containerinstance/containergroups') {
    const s = row.provisioningState || '';
    return { state: /succeeded/i.test(s) ? 'running' : 'unknown', rawState: s || undefined };
  }
  // Bot Service, AI Services, ML workspaces: managed, no runtime state
  const s = row.provisioningState || '';
  if (!s || /succeeded/i.test(s)) return { state: 'provisioned', rawState: s || undefined };
  return { state: 'unknown', rawState: s };
}

/**
 * Query Azure Resource Graph for all agent-shaped resources visible to the user.
 * Resource Graph spans every subscription the token can read, including ones
 * delegated from other tenants through Azure Lighthouse.
 */
export async function listAgentResources(token: string): Promise<AzureResource[]> {
  const typeList = AGENT_RESOURCE_TYPES.map((t) => `'${t}'`).join(',');
  const query = `Resources
| where type in~ (${typeList})
| project id, name, type, kind, location, resourceGroup, subscriptionId, tenantId, tags,
    powerState = tostring(properties.extended.instanceView.powerState.code),
    siteState = tostring(properties.state),
    provisioningState = tostring(properties.provisioningState),
    hostName = tostring(properties.defaultHostName)
| order by name asc`;

  const rows: GraphRow[] = [];
  let skipToken: string | undefined;
  do {
    const body: Record<string, unknown> = {
      query,
      options: {
        resultFormat: 'objectArray',
        $top: 500,
        ...(skipToken ? { $skipToken: skipToken } : {}),
      },
    };
    const result = await armFetch<{ data: GraphRow[]; $skipToken?: string }>(
      token,
      '/providers/Microsoft.ResourceGraph/resources?api-version=2022-10-01',
      { method: 'POST', body: JSON.stringify(body) }
    );
    rows.push(...(result.data ?? []));
    skipToken = result.$skipToken;
  } while (skipToken);

  return rows.map((row) => {
    const { state, rawState } = normaliseState(row);
    return {
      id: row.id,
      name: row.name,
      type: row.type.toLowerCase(),
      kind: row.kind || undefined,
      location: row.location,
      resourceGroup: row.resourceGroup.toLowerCase(),
      subscriptionId: row.subscriptionId,
      tenantId: row.tenantId,
      tags: row.tags ?? {},
      state,
      rawState,
      hostName: row.hostName || undefined,
    };
  });
}

/** Subscriptions visible to the user, with Lighthouse delegation info. */
export async function listSubscriptions(token: string): Promise<AzureSubscription[]> {
  const result = await armFetch<{
    data: {
      subscriptionId: string;
      name: string;
      tenantId: string;
      managedBy: { tenantId: string }[] | null;
    }[];
  }>(token, '/providers/Microsoft.ResourceGraph/resources?api-version=2022-10-01', {
    method: 'POST',
    body: JSON.stringify({
      query:
        "ResourceContainers | where type == 'microsoft.resources/subscriptions' | project subscriptionId, name, tenantId, managedBy = properties.managedByTenants",
      options: { resultFormat: 'objectArray' },
    }),
  });
  return (result.data ?? []).map((s) => ({
    subscriptionId: s.subscriptionId,
    name: s.name,
    tenantId: s.tenantId,
    managedByTenants: (s.managedBy ?? []).map((m) => m.tenantId),
  }));
}

/** Entra tenants the signed-in user belongs to (home tenant plus any guest tenants). */
export async function listTenants(token: string, currentTenantId: string): Promise<Tenant[]> {
  const result = await armFetch<{
    value: { tenantId: string; displayName?: string; defaultDomain?: string }[];
  }>(token, '/tenants?api-version=2022-12-01');
  return (result.value ?? []).map((t) => ({
    tenantId: t.tenantId,
    displayName: t.displayName,
    defaultDomain: t.defaultDomain,
    current: t.tenantId === currentTenantId,
  }));
}

interface ActivityLogEntry {
  id: string;
  eventTimestamp: string;
  operationName?: { value: string; localizedValue: string };
  status?: { value: string; localizedValue: string };
  subStatus?: { value: string; localizedValue: string };
  category?: { value: string; localizedValue: string };
  level?: string;
  caller?: string;
  resourceId?: string;
  correlationId?: string;
  description?: string;
}

function levelFor(entry: ActivityLogEntry): ActivityEvent['level'] {
  const status = entry.status?.value ?? '';
  if (/failed/i.test(status) || entry.level === 'Error' || entry.level === 'Critical')
    return 'error';
  if (entry.level === 'Warning') return 'warning';
  if (/succeeded/i.test(status)) return 'success';
  return 'info';
}

/**
 * Azure Activity Log entries for one resource group over the last `days`.
 * Only terminal events (Succeeded / Failed) are returned to avoid noise.
 */
export async function listActivityLog(
  token: string,
  subscriptionId: string,
  resourceGroup: string,
  agent: { id: string; name: string },
  days = 7
): Promise<ActivityEvent[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const filter = `eventTimestamp ge '${since}' and resourceGroupName eq '${resourceGroup}'`;
  const select =
    'eventTimestamp,operationName,status,subStatus,category,level,caller,resourceId,correlationId,description';
  const path = `/subscriptions/${subscriptionId}/providers/Microsoft.Insights/eventtypes/management/values?api-version=2015-04-01&$filter=${encodeURIComponent(filter)}&$select=${select}`;

  const result = await armFetch<{ value: ActivityLogEntry[] }>(token, path);
  const seen = new Set<string>();
  const events: ActivityEvent[] = [];

  for (const entry of result.value ?? []) {
    const status = entry.status?.value ?? '';
    if (!/succeeded|failed/i.test(status)) continue;
    const key = `${entry.correlationId ?? entry.id}:${entry.operationName?.value}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const resourceName = entry.resourceId?.split('/').pop();
    events.push({
      id: `azure:${entry.id}`,
      agentId: agent.id,
      agentName: agent.name,
      timestamp: entry.eventTimestamp,
      source: 'azure',
      title: entry.operationName?.localizedValue || entry.operationName?.value || 'Azure operation',
      detail: [resourceName, entry.status?.localizedValue, entry.subStatus?.localizedValue]
        .filter(Boolean)
        .join(' · '),
      actor: entry.caller,
      level: levelFor(entry),
      url: entry.resourceId
        ? `https://portal.azure.com/#@/resource${entry.resourceId}/eventlogs`
        : undefined,
    });
  }
  return events;
}
