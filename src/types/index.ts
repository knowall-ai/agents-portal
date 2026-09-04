// Shared types for Agent Dashboard

/** How the agent is built / hosted. */
export type AgentKind = 'openclaw' | 'foundry' | 'botframework' | 'unknown';

/** Derived health of an agent. */
export type AgentStatus = 'online' | 'degraded' | 'offline' | 'planned' | 'unknown';

export type Environment = 'prod' | 'test' | 'dev' | 'unknown';

/** Normalised runtime state of a single Azure resource. */
export type ResourceState = 'running' | 'stopped' | 'deallocated' | 'provisioned' | 'unknown';

export interface AzureResource {
  id: string;
  name: string;
  type: string;
  kind?: string;
  location: string;
  resourceGroup: string;
  subscriptionId: string;
  tenantId: string;
  tags: Record<string, string>;
  state: ResourceState;
  /** Raw state string from Azure (e.g. "PowerState/running", "Running") */
  rawState?: string;
  hostName?: string;
  /** Bot Service only: the Microsoft App ID used to address the bot in Teams (28:<id>) */
  botAppId?: string;
}

export interface AzureSubscription {
  subscriptionId: string;
  name: string;
  tenantId: string;
  /** Tenant IDs that manage this subscription via Azure Lighthouse */
  managedByTenants: string[];
}

/** Static registry entry from config/agents.json. */
export interface AgentRegistryEntry {
  id: string;
  name: string;
  kind?: AgentKind;
  customer?: string;
  description?: string;
  environment?: Environment;
  /** Public portal / landing URL for the agent */
  portalUrl?: string;
  /** URL probed server-side to decide whether the agent is reachable. Defaults to portalUrl. */
  healthUrl?: string;
  /** GitHub repo in owner/name form */
  repo?: string;
  /** Path inside the repo holding <skill>/SKILL.md folders */
  skillsPath?: string;
  /** Resource groups whose resources belong to this agent (case-insensitive) */
  resourceGroups?: string[];
  /** Agent not yet built or deployed — shown as "planned" */
  planned?: boolean;
  /** Profile image (absolute URL or path under /public) */
  avatarUrl?: string;
  /** Entra user principal name of the agent's own account, for a Teams chat deep link */
  teamsUpn?: string;
}

export interface AgentSummary {
  id: string;
  name: string;
  kind: AgentKind;
  customer: string;
  description?: string;
  environment: Environment;
  status: AgentStatus;
  statusReason: string;
  tenantId?: string;
  subscriptionId?: string;
  subscriptionName?: string;
  resourceGroups: string[];
  /** True when the resources live in a different tenant than the signed-in user (Azure Lighthouse) */
  delegated: boolean;
  portalUrl?: string;
  repo?: string;
  resourceCount: number;
  source: 'registry' | 'tags' | 'both';
  avatarUrl?: string;
  /** Deep link that opens a Teams chat with the agent (user account or bot) */
  teamsChatUrl?: string;
}

export interface FoundryProject {
  accountId: string;
  accountName: string;
  projectName: string;
  endpoint: string;
}

export interface AgentDetail extends AgentSummary {
  resources: AzureResource[];
  foundryProjects: FoundryProject[];
  /** Result of probing healthUrl / portalUrl */
  reachability?: {
    url: string;
    reachable: boolean;
    httpStatus?: number;
    checkedAt: string;
  };
}

export interface Skill {
  id: string;
  name: string;
  description?: string;
  source: 'github' | 'foundry';
  sourceLabel: string;
  url?: string;
}

export interface FoundryAssistant {
  id: string;
  name: string;
  model: string;
  description?: string;
  createdAt: string;
  tools: string[];
  metadata: Record<string, string>;
  projectName: string;
}

export type ActivityLevel = 'info' | 'success' | 'warning' | 'error';

export interface ActivityEvent {
  id: string;
  agentId: string;
  agentName: string;
  timestamp: string;
  source: 'azure' | 'github' | 'foundry';
  title: string;
  detail?: string;
  actor?: string;
  level: ActivityLevel;
  url?: string;
}

export interface Tenant {
  tenantId: string;
  displayName?: string;
  defaultDomain?: string;
  current: boolean;
}
