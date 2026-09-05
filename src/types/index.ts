// Shared types for Agents Portal

/** How the agent is built / hosted. */
export type AgentKind = 'openclaw' | 'hermes' | 'foundry' | 'botframework' | 'unknown';

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

/** A repo folder holding <skill>/SKILL.md folders. */
export interface SkillSource {
  /** GitHub repo in owner/name form */
  repo: string;
  /** Path inside the repo, e.g. "skills" */
  path: string;
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
  /**
   * Shared skill packs the agent also loads at runtime (e.g. the T-Minus-15 and
   * KnowAll plugin repos). A same-named skill in the agent's own repo shadows these.
   */
  skillSources?: SkillSource[];
  /** Path to the agent's SOUL.md. Defaults to workspace/SOUL.md, then SOUL.md. */
  soulPath?: string;
  /** Entra app registrations the agent runs as (Graph/API access). Bot app IDs are added automatically. */
  appRegistrations?: AppRegistrationRef[];
  /** BOOST mode: run a script on the agent's VM to switch OpenAI Fast mode on/off */
  boost?: BoostConfig;
  /** Reverie brain API base URL (https://<agent-domain>/reverie); the portal's REVERIE_TOKEN is sent to it */
  brainUrl?: string;
  /** Resource groups whose resources belong to this agent (case-insensitive) */
  resourceGroups?: string[];
  /**
   * Subscriptions the entry's resource groups live in. Required when the portal
   * trusts more than one tenant, because a resource-group name is only unique
   * inside a subscription; otherwise the registry's own tenant is the scope.
   */
  subscriptionIds?: string[];
  /** Agent not yet built or deployed — shown as "planned" */
  planned?: boolean;
  /** Profile image (absolute URL or path under /public) */
  avatarUrl?: string;
  /** Entra user principal name of the agent's own account, for a Teams chat deep link */
  teamsUpn?: string;
  /** OpenAI project id (proj_…) whose API spend belongs to this agent */
  openaiProjectId?: string;
  /** Anthropic workspace id (wrkspc_…) whose API spend belongs to this agent */
  anthropicWorkspaceId?: string;
  /** Flat monthly fees not visible in any API (e.g. ChatGPT subscription, ElevenLabs plan) */
  fixedCosts?: FixedCost[];
}

/** A node of the agent's graph memory (Reverie). */
export interface BrainNode {
  id: string;
  label: string;
  labels: string[];
  name: string;
  degree: number;
  /** epoch seconds */
  updatedAt: number;
  /** epoch seconds */
  createdAt: number;
  props: Record<string, string | number | boolean | null | (string | number)[]>;
}

export interface BrainRel {
  id: string;
  type: string;
  source: string;
  target: string;
  /** epoch seconds */
  updatedAt: number;
}

export interface BrainStats {
  nodeCount: number;
  relCount: number;
  labels: Record<string, number>;
  relTypes: Record<string, number>;
  shown: number;
}

/** Awake / dreaming signals from the agent's activation log and dream diary. */
export interface BrainState {
  dreaming: boolean;
  /** epoch seconds, as are lastDreamAt and generatedAt */
  lastActivityAt: number | null;
  lastDreamAt: number | null;
  lastDreamName: string | null;
  recentReads: number;
  recentWrites: number;
  eventsAvailable: boolean;
  /** Agent VM host stats, when the server can read them */
  cpuPercent?: number | null;
  load1?: number | null;
  memPercent?: number | null;
  memUsedGb?: number | null;
  memTotalGb?: number | null;
  /** usage-stats.json as defined by knowall-ai/agent-presence docs/HUD-CONTRACT.md */
  usage?: PresenceUsage | null;
  /** boost-state.json as defined by the same contract */
  boost?: PresenceBoost | null;
}

/** OPENAI // USAGE figures the video feed shows (agent-presence HUD contract). */
export interface PresenceUsage {
  mode?: 'sub' | 'api';
  sub?: { pct_left?: number | null; reset_at?: number | null; reset?: string | null };
  api?: { usd_mtd?: number | null };
  budget?: number | null;
}

/** BOOST chip state (agent-presence HUD contract); `until` is epoch milliseconds. */
export interface PresenceBoost {
  active?: boolean;
  tier?: string;
  until?: number | null;
  since?: number | null;
  minutes?: number | null;
}

export interface BrainSnapshot {
  nodes: BrainNode[];
  rels: BrainRel[];
  stats: BrainStats;
  state: BrainState;
  generatedAt: number;
}

/** One line of the activation log: what the agent just read or wrote. */
export interface BrainActivation {
  /** epoch seconds */
  ts: number;
  kind: 'recall' | 'remember' | 'connect' | 'forget' | 'dream.start' | 'dream.end' | string;
  ids?: string[];
  names?: (string | null)[];
  id?: string;
  name?: string;
  label?: string;
  type?: string;
  terms?: string[];
}

export interface BrainDiff {
  nodesAdded: BrainNode[];
  nodesUpdated: BrainNode[];
  nodesRemoved: string[];
  relsAdded: BrainRel[];
  relsRemoved: string[];
  stats?: BrainStats;
}

/** What the brain route returns: the snapshot when available, else why not. */
export interface AgentBrain {
  available: boolean;
  /** true when served from the built-in demo graph (BRAIN_FIXTURE=1 or ?demo=1) */
  fixture?: boolean;
  /** true when a live Reverie source is configured for this agent (so demo can be switched off) */
  liveAvailable?: boolean;
  snapshot?: BrainSnapshot;
  error?: string;
}

/** Registry config for BOOST mode (OpenAI Fast mode with auto-revert), run on the agent's VM. */
export interface BoostConfig {
  /** Absolute path of the boost script on the VM (on|off|status) */
  script: string;
  /** Hours Boost stays on before the VM switches the agent back (default 2) */
  defaultHours?: number;
  /** Upper bound the UI and API accept (default 8) */
  maxHours?: number;
}

/** BOOST state as reported by the VM (or last known). */
/** Teams presence of the agent's own account (Microsoft Graph). */
export interface AgentPresence {
  /** Available, Busy, Away, DoNotDisturb, Offline, PresenceUnknown… */
  availability: string;
  /** Available, InACall, InAConferenceCall, Presenting, Away… */
  activity: string;
  /** The activity says the account is on a Teams call */
  onCall: boolean;
  checkedAt: string;
  /** Why presence could not be read (no account, missing consent, Graph error) */
  error?: string;
}

export interface AgentBoost {
  supported: boolean;
  active: boolean;
  /** Model that Fast mode applies to */
  model?: string;
  since?: string;
  until?: string;
  hours?: number;
  /** Where this state came from */
  source: 'vm' | 'cache' | 'none';
  checkedAt?: string;
  defaultHours: number;
  maxHours: number;
  warning: string;
  error?: string;
}

export interface AppRegistrationRef {
  appId: string;
  label?: string;
}

export type PermissionKind =
  | 'delegated'
  | 'application'
  | 'directory-role'
  | 'group'
  | 'azure-role';

/** One permission, role or membership, with an explanation for the expandable row. */
export interface PermissionItem {
  id: string;
  name: string;
  kind: PermissionKind;
  /** Microsoft's own description where it publishes one */
  description?: string;
  /** API the permission is on (Microsoft Graph, …) or "Azure" for RBAC */
  resource?: string;
  /** App permissions: whether the tenant has consented / assigned it */
  granted?: boolean;
  /** Azure RBAC: the scope the role is assigned at */
  scope?: string;
}

/** What the agent's own Entra account can do. */
export interface AgentAccountAccess {
  upn: string;
  objectId?: string;
  directoryRoles: PermissionItem[];
  groups: PermissionItem[];
  azureRoles: PermissionItem[];
}

/** What one of the agent's app registrations can do. */
export interface AgentAppAccess {
  appId: string;
  displayName: string;
  label?: string;
  servicePrincipalId?: string;
  permissions: PermissionItem[];
  azureRoles: PermissionItem[];
  error?: string;
}

export interface AgentPermissions {
  account?: AgentAccountAccess;
  apps: AgentAppAccess[];
  /** Why directory data could not be read, when it could not */
  error?: string;
}

/** A Microsoft licence (SKU) assigned to the agent's Entra account. */
export interface AgentLicense {
  skuId: string;
  skuPartNumber: string;
  name: string;
  /** Capabilities from the provisioned service plans (Teams, Exchange mailbox, …) */
  capabilities: string[];
  /** Provisioned service plans not listed as a capability */
  otherPlans: number;
}

/** Licences and subscriptions behind an agent. */
export interface AgentLicensing {
  /** The agent's own Entra account, when it has one */
  upn?: string;
  displayName?: string;
  accountEnabled?: boolean;
  usageLocation?: string;
  licenses: AgentLicense[];
  /** Flat-fee subscriptions from the registry (ChatGPT, ElevenLabs, …) */
  subscriptions: FixedCost[];
  /** Why Microsoft licences could not be read, when they could not */
  licenseError?: string;
}

export interface FixedCost {
  label: string;
  amount: number;
  currency: string;
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
  /** Teams deep link that calls the agent's account; only when it has a teamsUpn */
  teamsCallUrl?: string;
  /** The agent's own Entra account, from the agent-teams-upn tag or the registry */
  teamsUpn?: string;
  /** OpenAI project (proj_…) whose API spend belongs to this agent: registry or the agent-openai-project tag */
  openaiProjectId?: string;
  /** Anthropic workspace (wrkspc_…) whose API spend belongs to this agent: registry or the agent-anthropic-workspace tag */
  anthropicWorkspaceId?: string;
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

/** The agent's SOUL.md (identity / values) as committed to its repo. */
export interface AgentSoul {
  path: string;
  markdown: string;
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

/** One metric sample from Azure Monitor */
export interface MetricPoint {
  /** epoch ms */
  ts: number;
  /** average over the interval; null when Azure has no sample */
  value: number | null;
}

export interface VmCpuSeries {
  resourceId: string;
  name: string;
  points: MetricPoint[];
}

export interface AgentMetrics {
  /** Window the series cover, in hours */
  hours: number;
  /** Sample interval, in minutes */
  intervalMinutes: number;
  cpu: VmCpuSeries[];
}

/** Events on one calendar day, for the year-long activity calendar */
export interface ActivityDay {
  /** yyyy-MM-dd */
  date: string;
  total: number;
  github: number;
  azure: number;
  foundry: number;
}

export interface Tenant {
  tenantId: string;
  displayName?: string;
  defaultDomain?: string;
  current: boolean;
}

// ---------------------------------------------------------------------------
// Avatar
// ---------------------------------------------------------------------------

/** An Entra account's profile photo, as Microsoft Graph serves it. */
export interface UserPhoto {
  contentType: string;
  base64: string;
}

/** The agent's picture: a URL to redirect to, or the bytes to serve. */
export type AgentAvatar = { redirect: string } | UserPhoto;

/**
 * Why a lookup ended: `found` and `none` are settled answers worth caching,
 * `failed` is an upstream error the route turns into 502 and never caches.
 */
export type AvatarResult =
  | { status: 'found'; avatar: AgentAvatar }
  | { status: 'none' }
  | { status: 'failed'; message: string };

// ---------------------------------------------------------------------------
// Costs
// ---------------------------------------------------------------------------

export type CostSource = 'azure' | 'openai' | 'anthropic' | 'fixed';

export interface CostLine {
  source: CostSource;
  label: string;
  amount: number;
  currency: string;
}

/** Totals keyed by ISO currency code — costs are never converted between currencies. */
export type CurrencyTotals = Record<string, number>;

export interface CostPeriod {
  lines: CostLine[];
  totals: CurrencyTotals;
}

export interface CostSourceStatus {
  source: CostSource;
  status: 'ok' | 'not-configured' | 'no-mapping' | 'error';
  detail?: string;
}

export interface AgentCosts {
  agentId: string;
  monthToDate: CostPeriod;
  lastMonth: CostPeriod;
  sources: CostSourceStatus[];
  generatedAt: string;
}

export interface CostsSummary {
  agents: { agentId: string; monthToDate: CurrencyTotals; lastMonth: CurrencyTotals }[];
  totals: { monthToDate: CurrencyTotals; lastMonth: CurrencyTotals };
  sources: CostSourceStatus[];
  generatedAt: string;
}
