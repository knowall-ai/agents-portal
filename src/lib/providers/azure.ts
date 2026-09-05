// Azure Resource Manager helpers: Resource Graph, subscriptions, tenants and the Activity Log.
import type {
  PermissionItem,
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
  botAppId: string;
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
    hostName = tostring(properties.defaultHostName),
    botAppId = tostring(properties.msaAppId)
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
      botAppId: row.botAppId || undefined,
    };
  });
}

/** Subscriptions visible to the user, with Lighthouse delegation info. */
/** The icon set on a Bot Service resource (Bot profile in the Azure portal), if any. */
export async function getBotIconUrl(
  token: string,
  botResourceId: string
): Promise<string | undefined> {
  const bot = await armFetch<{ properties?: { iconUrl?: string } }>(
    token,
    `${botResourceId}?api-version=2022-09-15`
  );
  return bot.properties?.iconUrl || undefined;
}

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
  // Resource group names come from Resource Graph, but escape quotes anyway so the
  // OData filter cannot be broken out of.
  const safeGroup = resourceGroup.replace(/'/g, "''");
  const filter = `eventTimestamp ge '${since}' and resourceGroupName eq '${safeGroup}'`;
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
      id: `azure:${agent.id}:${entry.id}`,
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

// ---------------------------------------------------------------------------
// Azure RBAC role assignments for a principal (user or service principal)
// ---------------------------------------------------------------------------

interface RoleAssignmentRow {
  properties: { roleDefinitionId: string; scope: string; principalId: string };
}

const roleDefinitionCache = new Map<string, Promise<{ roleName: string; description?: string }>>();

function roleDefinition(token: string, id: string) {
  let pending = roleDefinitionCache.get(id);
  if (!pending) {
    pending = armFetch<{ properties: { roleName: string; description?: string } }>(
      token,
      `${id}?api-version=2022-04-01`
    ).then((r) => r.properties);
    roleDefinitionCache.set(id, pending);
  }
  return pending;
}

/** "/subscriptions/…/resourceGroups/rg/providers/…/vaults/kv" → "kv (Key Vault)" style short scope. */
export function shortenScope(scope: string): string {
  const parts = scope.split('/').filter(Boolean);
  if (parts.length <= 2)
    return parts.length === 2 ? `Subscription ${parts[1].slice(0, 8)}…` : scope;
  const rg = parts.indexOf('resourceGroups');
  if (rg !== -1 && parts.length === rg + 2) return `Resource group ${parts[rg + 1]}`;
  const providers = parts.indexOf('providers');
  if (providers !== -1 && parts.length > providers + 2) {
    const namespace = parts[providers + 1];
    const names = parts.slice(providers + 3).filter((_, i) => i % 2 === 0);
    return `${names.join('/')} (${namespace})`;
  }
  return scope;
}

/** Role assignments for a principal across the given subscriptions, with role descriptions. */
export async function listRoleAssignments(
  token: string,
  subscriptionIds: string[],
  principalId: string
): Promise<PermissionItem[]> {
  if (!/^[0-9a-f-]{36}$/i.test(principalId))
    throw new Error(`Invalid principal id: ${principalId}`);
  const rows = (
    await Promise.all(
      subscriptionIds.map((sub) =>
        armFetch<{ value: RoleAssignmentRow[] }>(
          token,
          `/subscriptions/${sub}/providers/Microsoft.Authorization/roleAssignments?api-version=2022-04-01&$filter=${encodeURIComponent(`principalId eq '${principalId}'`)}`
        )
          .then((r) => r.value)
          .catch((error) => {
            console.warn(`Role assignments failed for ${sub}:`, error);
            return [] as RoleAssignmentRow[];
          })
      )
    )
  ).flat();
  const seen = new Set<string>();
  const items = await Promise.all(
    rows
      .filter((row) => {
        const key = `${row.properties.roleDefinitionId}@${row.properties.scope}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map(async (row): Promise<PermissionItem> => {
        const def = await roleDefinition(token, row.properties.roleDefinitionId).catch(() => ({
          roleName: row.properties.roleDefinitionId.split('/').pop() ?? 'Unknown role',
          description: undefined,
        }));
        return {
          id: `${row.properties.roleDefinitionId}@${row.properties.scope}`,
          name: def.roleName,
          kind: 'azure-role',
          description: def.description,
          resource: 'Azure',
          scope: shortenScope(row.properties.scope),
        };
      })
  );
  return items.sort(
    (a, b) => a.name.localeCompare(b.name) || (a.scope ?? '').localeCompare(b.scope ?? '')
  );
}

// ---------------------------------------------------------------------------
// VM run-command: the portal's only write path. Gated by the user's own RBAC
// on the VM and recorded in the Azure Activity Log under their identity.
// ---------------------------------------------------------------------------

export interface VmRef {
  subscriptionId: string;
  resourceGroup: string;
  name: string;
}

/** The agent's VM, when it has one. */
export function findVm(resources: AzureResource[]): VmRef | undefined {
  const vm = resources.find((r) => r.type === 'microsoft.compute/virtualmachines');
  return vm
    ? { subscriptionId: vm.subscriptionId, resourceGroup: vm.resourceGroup, name: vm.name }
    : undefined;
}

export interface RunCommandResult {
  stdout: string;
  stderr: string;
}

/** Split a run-command message into its [stdout] and [stderr] sections. Exported for tests. */
export function parseRunCommandMessage(message: string): RunCommandResult {
  const out = message.indexOf('[stdout]');
  const err = message.indexOf('[stderr]');
  if (out === -1) return { stdout: message.trim(), stderr: '' };
  const stdout = message.slice(out + '[stdout]'.length, err === -1 ? undefined : err).trim();
  const stderr = err === -1 ? '' : message.slice(err + '[stderr]'.length).trim();
  return { stdout, stderr };
}

const VM_NAME = /^[A-Za-z0-9._-]{1,64}$/;

interface RunCommandOperation {
  status?: string;
  properties?: { output?: { value?: { message?: string }[] } };
}

/**
 * Run a shell script on a VM with the user's ARM token (RunShellScript).
 * Waits for the async operation to finish; rejects with the ARM error (403 etc.).
 */
export async function runVmScript(
  token: string,
  vm: VmRef,
  script: string[],
  timeoutMs = 180_000
): Promise<RunCommandResult> {
  if (!VM_NAME.test(vm.name) || !VM_NAME.test(vm.resourceGroup)) {
    throw new Error(`Invalid VM reference: ${vm.resourceGroup}/${vm.name}`);
  }
  const path = `/subscriptions/${vm.subscriptionId}/resourceGroups/${vm.resourceGroup}/providers/Microsoft.Compute/virtualMachines/${vm.name}/runCommand?api-version=2024-07-01`;
  const start = await fetch(`${ARM}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ commandId: 'RunShellScript', script }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!start.ok) {
    const body = await start.text();
    throw new Error(`ARM ${start.status} runCommand: ${body.slice(0, 300)}`);
  }
  const poll = start.headers.get('azure-asyncoperation') ?? start.headers.get('location');
  if (start.status === 202 && !poll) {
    // Accepted but nowhere to poll: treating that as success would report an empty result
    throw new Error('ARM 202 runCommand without an Azure-AsyncOperation or Location header');
  }
  const deadline = Date.now() + timeoutMs;
  let result: RunCommandOperation = start.status === 200 ? await start.json() : {};
  while (poll && (!result.status || result.status === 'InProgress')) {
    if (Date.now() > deadline) throw new Error('Run command timed out');
    await new Promise((resolve) => setTimeout(resolve, 4_000));
    const response = await fetch(poll, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 202) continue; // Location-style polling: not finished yet
    if (!response.ok) throw new Error(`ARM ${response.status} polling run command`);
    result = await response.json();
    result.status ??= 'Succeeded';
  }
  if (result.status && result.status !== 'Succeeded') {
    throw new Error(`Run command ${result.status}`);
  }
  const message = result.properties?.output?.value?.map((v) => v.message ?? '').join('\n') ?? '';
  return parseRunCommandMessage(message);
}
