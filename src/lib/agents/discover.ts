// Turn Azure resources + the static registry into a list of agents.
//
// Discovery rules (first match wins):
//   1. Resource tag `agent` (or any key in AGENT_TAG_KEYS) names the agent slug.
//   2. Otherwise a registry entry whose `resourceGroups` contains the resource's
//      group claims it, but only inside the entry's `subscriptionIds` or the
//      registry's own tenant; a shared resource group (e.g. ka-agents) can host
//      several agents as long as the newer ones are tagged.
//   3. Anything else is ignored.
//
// Registry metadata (name, customer, kind, URLs) overrides tag-derived values.
import { registryTenant } from '@/lib/tenants';
import type {
  AgentDetail,
  AgentKind,
  AgentRegistryEntry,
  AgentStatus,
  AgentSummary,
  AzureResource,
  AzureSubscription,
  Environment,
} from '@/types';

const DEFAULT_TAG_KEYS = ['agent', 'project'];

export function getTagKeys(): string[] {
  const raw = process.env.AGENT_TAG_KEYS;
  const keys = raw
    ? raw
        .split(',')
        .map((k) => k.trim().toLowerCase())
        .filter(Boolean)
    : DEFAULT_TAG_KEYS;
  return keys.length ? keys : DEFAULT_TAG_KEYS;
}

/** Case-insensitive tag lookup. */
export function tag(tags: Record<string, string>, key: string): string | undefined {
  const wanted = key.toLowerCase();
  for (const [k, v] of Object.entries(tags)) {
    if (k.toLowerCase() === wanted) return v;
  }
  return undefined;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function normaliseEnvironment(value?: string): Environment {
  if (!value) return 'unknown';
  const v = value.toLowerCase();
  if (/^(prod|production|live)$/.test(v)) return 'prod';
  if (/^(test|uat|staging|stage|qa)$/.test(v)) return 'test';
  if (/^(dev|development|sandbox)$/.test(v)) return 'dev';
  return 'unknown';
}

export function normaliseKind(value?: string): AgentKind | undefined {
  if (!value) return undefined;
  const v = value.toLowerCase();
  if (v === 'openclaw') return 'openclaw';
  if (v === 'hermes') return 'hermes';
  if (/foundry|assistant/.test(v)) return 'foundry';
  if (/bot/.test(v)) return 'botframework';
  return 'unknown';
}

/** Guess the kind from the shape of the deployment when nothing says otherwise. */
export function inferKind(resources: AzureResource[]): AgentKind {
  const types = new Set(resources.map((r) => r.type));
  if (types.has('microsoft.botservice/botservices')) return 'botframework';
  if (
    types.has('microsoft.cognitiveservices/accounts') ||
    types.has('microsoft.machinelearningservices/workspaces')
  ) {
    return 'foundry';
  }
  return 'unknown';
}

/** Derive an agent's status from the runtime state of its compute resources. */
export function deriveStatus(resources: AzureResource[]): {
  status: AgentStatus;
  reason: string;
} {
  if (resources.length === 0) return { status: 'unknown', reason: 'No Azure resources found' };

  const compute = resources.filter((r) =>
    [
      'microsoft.compute/virtualmachines',
      'microsoft.web/sites',
      'microsoft.app/containerapps',
      'microsoft.containerinstance/containergroups',
    ].includes(r.type)
  );

  if (compute.length === 0) {
    return { status: 'online', reason: 'Managed services provisioned (no compute to monitor)' };
  }

  const up = compute.filter((r) => r.state === 'running');
  const down = compute.filter((r) => r.state === 'stopped' || r.state === 'deallocated');
  const describe = (list: AzureResource[]) => list.map((r) => r.name).join(', ');

  if (up.length === compute.length) {
    return { status: 'online', reason: `All ${compute.length} compute resources running` };
  }
  if (down.length === compute.length) {
    return { status: 'offline', reason: `Stopped: ${describe(down)}` };
  }
  if (down.length > 0) {
    return { status: 'degraded', reason: `Stopped: ${describe(down)}` };
  }
  return {
    status: up.length > 0 ? 'online' : 'unknown',
    reason: up.length > 0 ? `${up.length}/${compute.length} running` : 'Compute state unknown',
  };
}

interface Bucket {
  id: string;
  registry?: AgentRegistryEntry;
  resources: AzureResource[];
  fromTags: boolean;
}

/**
 * Is this resource inside the scope a registry entry claims? Resource-group
 * names are only unique within a subscription, so an entry claims its groups in
 * the subscriptions it names, or — when it names none — in the registry's own
 * tenant (`registryTenant`). Without that anchor anyone who can create a
 * same-named resource group in their own subscription would inherit the entry's
 * brain URL, repo and boost script, which are read with server-held tokens.
 */
/** Whether an entry carries anything that spends a server-held token or runs code. */
export function entryIsPrivileged(entry: AgentRegistryEntry): boolean {
  return Boolean(
    entry.brainUrl ||
    entry.repo ||
    entry.boost ||
    entry.soulPath ||
    (entry.skillSources && entry.skillSources.length > 0)
  );
}

export function claimsResource(
  entry: AgentRegistryEntry,
  resource: Pick<AzureResource, 'resourceGroup' | 'subscriptionId' | 'tenantId'>,
  env: Record<string, string | undefined> = process.env
): boolean {
  const subscriptions = (entry.subscriptionIds ?? []).map((s) => s.toLowerCase());
  // An entry that spends server-held tokens or runs a script must say which
  // subscriptions it lives in: a resource-group name alone can be recreated by
  // anyone with a subscription in the same tenant
  if (subscriptions.length === 0 && entryIsPrivileged(entry)) return false;
  const inScope =
    subscriptions.length > 0
      ? subscriptions.includes(resource.subscriptionId.toLowerCase())
      : resource.tenantId.toLowerCase() === registryTenant(env);
  if (!inScope) return false;
  const groups = (entry.resourceGroups ?? []).map((g) => g.toLowerCase());
  return groups.length === 0 || groups.includes(resource.resourceGroup.toLowerCase());
}

/** Group resources into agents. Exported for unit tests. */
export function groupResources(
  resources: AzureResource[],
  registry: AgentRegistryEntry[],
  tagKeys: string[] = getTagKeys()
): Bucket[] {
  const buckets = new Map<string, Bucket>();
  const claiming = registry.filter((entry) => (entry.resourceGroups ?? []).length > 0);

  const bucketFor = (id: string): Bucket => {
    let bucket = buckets.get(id);
    if (!bucket) {
      bucket = {
        id,
        registry: registry.find((e) => e.id === id),
        resources: [],
        fromTags: false,
      };
      buckets.set(id, bucket);
    }
    return bucket;
  };

  for (const resource of resources) {
    let slug: string | undefined;
    let tagged = false;
    for (const key of tagKeys) {
      const value = tag(resource.tags, key);
      if (value) {
        tagged = true;
        slug = slugify(value);
        if (slug) break;
      }
    }
    if (slug) {
      const bucket = bucketFor(slug);
      bucket.resources.push(resource);
      bucket.fromTags = true;
      continue;
    }
    // A tag that names nothing usable still marks the resource as somebody
    // else's: it must not fall through to the resource-group claim
    if (tagged) continue;
    const claimed = claiming.find((entry) => claimsResource(entry, resource));
    if (claimed) bucketFor(claimed.id).resources.push(resource);
  }

  // Registry-only agents (planned, or nothing deployed yet)
  for (const entry of registry) {
    if (!buckets.has(entry.id))
      buckets.set(entry.id, { id: entry.id, registry: entry, resources: [], fromTags: false });
  }

  return [...buckets.values()];
}

/** Accept only https URLs (tags are writable by anyone with Contributor on a resource). */
export function safeHttpsUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** Bot Framework's placeholder icon says nothing about the agent, so it counts as no icon. */
export function isDefaultBotIcon(url?: string): boolean {
  if (!url) return true;
  try {
    const { hostname, pathname } = new URL(url);
    return hostname === 'docs.botframework.com' && pathname.endsWith('/bot-framework-default.png');
  } catch {
    return true;
  }
}

/**
 * Where the portal can fetch the agent's picture from Azure or Entra: the Bot
 * Service icon or the account photo behind `agent-teams-upn`. Undefined when
 * the agent has neither, so the Avatar falls back to initials.
 */
export function azureAvatarPath(
  id: string,
  resources: AzureResource[],
  upn?: string
): string | undefined {
  const hasBot = resources.some((r) => r.type === 'microsoft.botservice/botservices');
  return hasBot || upn ? `/api/agents/${encodeURIComponent(id)}/avatar` : undefined;
}

/**
 * A provider account id for the agent: the registry value when it has the
 * provider's shape, else the one well-formed tag value shared by the agent's
 * resources. Malformed values are skipped, and two resources disagreeing
 * yields nothing rather than whichever Azure listed first.
 */
export function providerId(
  registryValue: string | undefined,
  resources: AzureResource[],
  key: string,
  shape: RegExp
): string | undefined {
  if (registryValue && shape.test(registryValue)) return registryValue;
  const valid = new Set<string>();
  for (const r of resources) {
    const value = tag(r.tags, key);
    if (value && shape.test(value)) valid.add(value);
  }
  return valid.size === 1 ? [...valid][0] : undefined;
}

export const OPENAI_PROJECT_ID = /^proj_[A-Za-z0-9_-]+$/;
export const ANTHROPIC_WORKSPACE_ID = /^wrkspc_[A-Za-z0-9_-]+$/;

/** Avatar may be a same-origin path (the avatar route) or an https URL. */
export function safeAvatarUrl(value?: string): string | undefined {
  if (!value) return undefined;
  if (/^\/[A-Za-z0-9_\-./]+$/.test(value) && !value.includes('..')) return value;
  return safeHttpsUrl(value);
}

function titleCase(slug: string): string {
  return slug
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/**
 * Teams deep link for the agent. Agents with their own Entra account (OpenClaw)
 * are addressed by UPN; bots by their Microsoft App ID with the 28: prefix.
 */
export function teamsChatUrl(
  entry: AgentRegistryEntry | undefined,
  resources: AzureResource[]
): string | undefined {
  const upn = agentUpn(entry, resources);
  if (upn) return `https://teams.microsoft.com/l/chat/0/0?users=${encodeURIComponent(upn)}`;
  const bot = resources.find((r) => r.type === 'microsoft.botservice/botservices' && r.botAppId);
  if (bot?.botAppId) return `https://teams.microsoft.com/l/chat/0/0?users=28:${bot.botAppId}`;
  return undefined;
}

/** Teams deep link that starts a video call with the agent's own account (bots cannot be called this way). */
export function teamsCallUrl(
  entry: AgentRegistryEntry | undefined,
  resources: AzureResource[]
): string | undefined {
  // A Bot Service agent is reachable in chat but has no callable account, even
  // when a UPN is tagged or set in the registry.
  if (resources.some((r) => r.type === 'microsoft.botservice/botservices')) return undefined;
  const upn = agentUpn(entry, resources);
  return upn
    ? `https://teams.microsoft.com/l/call/0/0?users=${encodeURIComponent(upn)}&withVideo=true`
    : undefined;
}

/**
 * The agent's own Entra account: the `agent-teams-upn` tag on any of its
 * resources, or the registry's `teamsUpn` as an override. Keeping it in Azure
 * means no address has to live in this public repo.
 */
export function agentUpn(
  entry: AgentRegistryEntry | undefined,
  resources: AzureResource[]
): string | undefined {
  return entry?.teamsUpn ?? firstTag(resources, 'agent-teams-upn');
}

function firstTag(resources: AzureResource[], key: string): string | undefined {
  for (const r of resources) {
    const v = tag(r.tags, key);
    if (v) return v;
  }
  return undefined;
}

export function buildAgent(
  bucket: Bucket,
  subscriptions: AzureSubscription[],
  sessionTenantId: string
): AgentDetail {
  const { registry: entry, resources } = bucket;
  // Registry values that steer spend attribution apply only when the caller can
  // see a resource the entry claims, the same rule the service applies to
  // server-token features
  const trusted = entry && resources.some((r) => claimsResource(entry, r)) ? entry : undefined;
  const subscriptionId = resources[0]?.subscriptionId;
  const subscription = subscriptions.find((s) => s.subscriptionId === subscriptionId);
  const tenantId = resources[0]?.tenantId ?? subscription?.tenantId;

  const kind: AgentKind =
    entry?.kind ?? normaliseKind(firstTag(resources, 'agent-kind')) ?? inferKind(resources);
  const environment =
    entry?.environment ??
    normaliseEnvironment(firstTag(resources, 'environment') ?? firstTag(resources, 'env'));

  let status: AgentStatus;
  let statusReason: string;
  if (entry?.planned && resources.length === 0) {
    status = 'planned';
    statusReason = 'Not yet built or deployed';
  } else {
    ({ status, reason: statusReason } = deriveStatus(resources));
  }

  const resourceGroups = [...new Set(resources.map((r) => r.resourceGroup))].sort();

  return {
    id: bucket.id,
    name: entry?.name ?? titleCase(bucket.id),
    kind,
    customer: entry?.customer ?? firstTag(resources, 'agent-customer') ?? 'Unassigned',
    description: entry?.description ?? firstTag(resources, 'agent-description'),
    environment,
    status,
    statusReason,
    tenantId,
    subscriptionId,
    subscriptionName: subscription?.name,
    resourceGroups,
    delegated: Boolean(tenantId && sessionTenantId && tenantId !== sessionTenantId),
    // The portal URL is probed and the repo is read with the server's GitHub
    // token, so both take the registry value only from a trusted entry; a tag
    // can only be read off a resource the caller already sees
    portalUrl: safeHttpsUrl(trusted?.portalUrl ?? firstTag(resources, 'agent-url')),
    repo: [trusted?.repo ?? firstTag(resources, 'agent-repo')].find((r): r is string =>
      Boolean(r && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(r))
    ),
    resourceCount: resources.length,
    source: entry && bucket.fromTags ? 'both' : entry ? 'registry' : 'tags',
    avatarUrl:
      safeAvatarUrl(entry?.avatarUrl ?? firstTag(resources, 'agent-avatar')) ??
      azureAvatarPath(bucket.id, resources, agentUpn(entry, resources)),
    teamsChatUrl: teamsChatUrl(entry, resources),
    teamsCallUrl: teamsCallUrl(entry, resources),
    teamsUpn: agentUpn(entry, resources),
    openaiProjectId: providerId(
      trusted?.openaiProjectId,
      resources,
      'agent-openai-project',
      OPENAI_PROJECT_ID
    ),
    anthropicWorkspaceId: providerId(
      trusted?.anthropicWorkspaceId,
      resources,
      'agent-anthropic-workspace',
      ANTHROPIC_WORKSPACE_ID
    ),
    resources: [...resources].sort(
      (a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name)
    ),
    foundryProjects: [],
  };
}

export function toSummary(agent: AgentDetail): AgentSummary {
  return {
    id: agent.id,
    name: agent.name,
    kind: agent.kind,
    customer: agent.customer,
    description: agent.description,
    environment: agent.environment,
    status: agent.status,
    statusReason: agent.statusReason,
    tenantId: agent.tenantId,
    subscriptionId: agent.subscriptionId,
    subscriptionName: agent.subscriptionName,
    resourceGroups: agent.resourceGroups,
    delegated: agent.delegated,
    portalUrl: agent.portalUrl,
    repo: agent.repo,
    resourceCount: agent.resourceCount,
    source: agent.source,
    avatarUrl: agent.avatarUrl,
    teamsChatUrl: agent.teamsChatUrl,
    teamsCallUrl: agent.teamsCallUrl,
    teamsUpn: agent.teamsUpn,
  };
}

const STATUS_ORDER: Record<AgentStatus, number> = {
  offline: 0,
  degraded: 1,
  online: 2,
  unknown: 3,
  planned: 4,
};

export function sortAgents<T extends AgentSummary>(agents: T[]): T[] {
  return [...agents].sort(
    (a, b) =>
      a.customer.localeCompare(b.customer) ||
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      a.name.localeCompare(b.name)
  );
}
