// Agent service: composes Azure discovery, the registry, Foundry, GitHub and
// health probes into the shapes the API routes return.
import { cached, invalidate } from '@/lib/cache';
import { getRegistry, getRegistryEntry as lookupRegistryEntry } from '@/lib/registry';
import type { AgentRegistryEntry } from '@/types';
import {
  findVm,
  getBotIconUrl,
  listActivityLog,
  listVmCpu,
  listAgentResources,
  listRoleAssignments,
  listSubscriptions,
  runVmScript,
} from '@/lib/providers/azure';
import {
  assistantsToSkills,
  listAssistants,
  listFoundryProjects,
  listRecentRuns,
} from '@/lib/providers/foundry';
import {
  DEFAULT_TRAINING_REPO,
  getCurriculum,
  getRepoMarkdown,
  listRepoCommits,
  listRepoSkills,
  listTrainingRuns,
} from '@/lib/providers/github';
import { probeUrl } from '@/lib/providers/health';
import {
  getAppAccess,
  getUserAccess,
  getUserLicensing,
  getUserPhoto,
  getUserPresence,
} from '@/lib/providers/graph';
import { fetchBrainSnapshot, isValidBrainUrl } from '@/lib/providers/reverie';
import { fixtureSnapshot } from '@/lib/brain-fixture';
import { reverieTokenFor } from '@/lib/reverie-token';
import { isOnCall } from '@/lib/presence';
import { outstandingFor, scenarioAppliesTo, sortRuns } from '@/lib/training';
import {
  FOUNDRY_SCOPE,
  GRAPH_DIRECTORY_READ_ALL_SCOPE,
  GRAPH_DIRECTORY_SCOPE,
  GRAPH_PRESENCE_SCOPE,
  getResourceToken,
  type UserContext,
} from '@/lib/tokens';
import type {
  ActivityEvent,
  AgentBoost,
  AgentBrain,
  AgentCosts,
  AgentDetail,
  AgentMetrics,
  AgentLicensing,
  AgentPermissions,
  AgentPresence,
  AgentSoul,
  AgentTraining,
  AvatarResult,
  CostSourceStatus,
  CostsSummary,
  FoundryAssistant,
  Skill,
} from '@/types';
import {
  buildAgent,
  claimsResource,
  groupResources,
  isDefaultBotIcon,
  safeHttpsUrl,
  sortAgents,
} from './discover';
import { addTotals, buildAgentCosts, type CostInputs } from './costs';
import { mergeSkillSources, skillSourcesFor } from './skills';
import {
  fetchAnthropicCosts,
  fetchOpenAICosts,
  monthWindows,
  queryAzureCosts,
  type AzureCostRow,
  type LlmCostRow,
  type Timeframe,
} from '@/lib/providers/costs';

function scope(ctx: UserContext): string {
  return `${ctx.tenantId}:${ctx.userId}`;
}

/**
 * The registry entry behind an agent, but only when the caller can see at least
 * one Azure resource inside the scope the entry claims (`claimsResource`:
 * the entry's subscriptions, or the registry's own tenant, and its resource
 * groups when it names any). Registry-only agents (nothing visible, or a
 * tag-derived slug that merely matches an entry id) get nothing, because
 * server-held tokens (REVERIE_TOKEN, GITHUB_TOKEN) are spent on the entry's URLs.
 */
function getRegistryEntry(agent: AgentDetail): AgentRegistryEntry | undefined {
  const entry = lookupRegistryEntry(agent.id);
  if (!entry) return undefined;
  return agent.resources.some((r) => claimsResource(entry, r)) ? entry : undefined;
}

/** All agents visible to the user (cached per user for CACHE_TTL_SECONDS). */
export async function listAgents(ctx: UserContext): Promise<AgentDetail[]> {
  return cached(`agents:${scope(ctx)}`, async () => {
    const [resources, subscriptions] = await Promise.all([
      listAgentResources(ctx.armToken),
      listSubscriptions(ctx.armToken),
    ]);
    const buckets = groupResources(resources, getRegistry());
    return sortAgents(buckets.map((b) => buildAgent(b, subscriptions, ctx.tenantId)));
  });
}

/**
 * Whether the caller can see an agent with this id, from the cached agents list
 * alone. Cheap enough to run before an authorisation check: it reads nothing the
 * caller is not already entitled to and does not compose the agent's detail.
 */
export async function agentExists(ctx: UserContext, id: string): Promise<boolean> {
  const agents = await listAgents(ctx);
  return agents.some((a) => a.id === id.toLowerCase());
}

export async function getAgent(ctx: UserContext, id: string): Promise<AgentDetail | null> {
  const agents = await listAgents(ctx);
  const agent = agents.find((a) => a.id === id.toLowerCase());
  if (!agent) return null;

  return cached(`agent:${scope(ctx)}:${agent.id}`, async () => {
    const entry = getRegistryEntry(agent);
    const [foundryProjects, reachability] = await Promise.all([
      listFoundryProjects(ctx.armToken, agent.resources),
      entry?.healthUrl || agent.portalUrl
        ? probeUrl(entry?.healthUrl ?? (agent.portalUrl as string))
        : Promise.resolve(undefined),
    ]);

    let status = agent.status;
    let statusReason = agent.statusReason;
    if (reachability && status === 'online' && !reachability.reachable) {
      status = 'degraded';
      statusReason = `Compute running but ${reachability.url} is not responding`;
    }

    return { ...agent, status, statusReason, foundryProjects, reachability };
  });
}

export async function getAssistants(
  ctx: UserContext,
  agent: AgentDetail
): Promise<FoundryAssistant[]> {
  if (agent.foundryProjects.length === 0) return [];
  return cached(`assistants:${scope(ctx)}:${agent.id}`, async () => {
    const token = await getResourceToken(ctx, FOUNDRY_SCOPE);
    if (!token) return [];
    return listAssistants(token, agent.foundryProjects);
  });
}

export async function getSkills(ctx: UserContext, agent: AgentDetail): Promise<Skill[]> {
  return cached(
    `skills:${scope(ctx)}:${agent.id}`,
    async () => {
      const sources = skillSourcesFor(getRegistryEntry(agent));
      const [repoLists, assistants] = await Promise.all([
        Promise.all(
          sources.map((source) =>
            // Repo skills come from the server-side GitHub token and are the same for
            // every viewer, so cache them per repo rather than per user
            cached(
              `skills:repo:${source.repo}:${source.path}`,
              () => listRepoSkills(source.repo, source.path),
              10 * 60 * 1000
            ).catch((error) => {
              console.warn(`GitHub skills lookup failed for ${agent.id} (${source.repo}):`, error);
              return [] as Skill[];
            })
          )
        ),
        getAssistants(ctx, agent),
      ]);
      return [...mergeSkillSources(repoLists), ...assistantsToSkills(assistants)];
    },
    10 * 60 * 1000
  );
}

const AVATAR_TTL = 60 * 60 * 1000;

/**
 * The agent's picture from where it lives: the Bot Service icon (set under Bot
 * profile in the Azure portal), else the profile photo of the Entra account
 * behind `agent-teams-upn`. Read with the signed-in user's tokens, so a viewer
 * who cannot read the bot or the directory gets initials instead.
 *
 * Each source still falls back to the next one, but a source that errored is
 * remembered: if nothing was found the result is `failed` rather than `none`,
 * so the route answers 502 instead of claiming there is no picture. Only
 * settled answers are cached — a failure is retried on the next request.
 */
export async function getAvatar(ctx: UserContext, agent: AgentDetail): Promise<AvatarResult> {
  return cached<AvatarResult>(
    `avatar:${scope(ctx)}:${agent.id}`,
    async (): Promise<AvatarResult> => {
      let failure: string | undefined;
      const note = (what: string, error: unknown): void => {
        failure = error instanceof Error ? error.message : String(error);
        console.warn(`${what} lookup failed for ${agent.id}:`, failure);
      };

      const bot = agent.resources.find((r) => r.type === 'microsoft.botservice/botservices');
      if (bot) {
        try {
          const icon = await getBotIconUrl(ctx.armToken, bot.id);
          const url = isDefaultBotIcon(icon) ? undefined : safeHttpsUrl(icon);
          if (url) return { status: 'found', avatar: { redirect: url } };
        } catch (error) {
          note('Bot icon', error);
        }
      }
      if (agent.teamsUpn) {
        try {
          // No token means the Graph permission is not consented: a settled
          // "no picture available", not an upstream failure
          const token = await getResourceToken(ctx, GRAPH_DIRECTORY_SCOPE);
          if (token) {
            const photo = await getUserPhoto(token, agent.teamsUpn);
            if (photo) return { status: 'found', avatar: photo };
          }
        } catch (error) {
          note('Account photo', error);
        }
      }
      return failure ? { status: 'failed', message: failure } : { status: 'none' };
    },
    (value) => (value.status === 'failed' ? 0 : AVATAR_TTL)
  );
}

const SOUL_CANDIDATES = ['workspace/SOUL.md', 'SOUL.md'];

/**
 * The agent's SOUL.md (registry `soulPath`, else the OpenClaw defaults).
 * Only registry-configured repos are read: `agent.repo` can come from an Azure
 * tag, and tags must not be able to point the server-side GitHub token at
 * arbitrary repositories.
 */
export async function getSoul(ctx: UserContext, agent: AgentDetail): Promise<AgentSoul | null> {
  const entry = getRegistryEntry(agent);
  const repo = entry?.repo;
  if (!repo) return null;
  return cached(
    `soul:${scope(ctx)}:${agent.id}`,
    async () => {
      const candidates = [...(entry?.soulPath ? [entry.soulPath] : []), ...SOUL_CANDIDATES];
      for (const path of candidates) {
        const soul = await getRepoMarkdown(repo, path);
        if (soul) return soul;
      }
      return null;
    },
    10 * 60 * 1000
  );
}

/** The repo the training harness publishes runs and the curriculum to. */
function trainingRepo(): string {
  return process.env.TRAINING_REPO?.trim() || DEFAULT_TRAINING_REPO;
}

const TRAINING_TTL = 10 * 60 * 1000;
const TRAINING_ERROR_TTL = 60 * 1000;

/**
 * Training runs and curriculum for the agent, from the training repo
 * (knowall-ai/agent-training#14). Read with the server's GitHub token, so —
 * like skills and the soul — only for an agent whose registry entry the caller
 * can actually see: without one the answer is `configured: false` and no token
 * is spent. A repo that cannot be read leaves `error` set and is retried a
 * minute later rather than being cached for the full ten.
 */
export async function getTraining(ctx: UserContext, agent: AgentDetail): Promise<AgentTraining> {
  const empty: AgentTraining = { runs: [], curriculum: [], outstanding: [], configured: false };
  if (!getRegistryEntry(agent)) return empty;
  const repo = trainingRepo();

  return cached<AgentTraining>(
    `training:${scope(ctx)}:${agent.id}`,
    async () => {
      try {
        // The repo is the same for every viewer, so the reads themselves are
        // cached per repo rather than per user. The curriculum comes first so
        // the run listing keeps each of its scenarios' latest result even when
        // the newest-50 cap would drop it, and outstanding training is judged
        // on what actually happened rather than on what was truncated.
        const curriculum = await cached(
          `training:curriculum:${repo}`,
          () => getCurriculum(repo),
          TRAINING_TTL
        );
        const keep = curriculum.filter((s) => scenarioAppliesTo(s, agent.id)).map((s) => s.id);
        const runs = await cached(
          `training:runs:${repo}:${agent.id}`,
          () => listTrainingRuns(repo, agent.id, keep),
          TRAINING_TTL
        );
        const sorted = sortRuns(runs);
        return {
          runs: sorted,
          curriculum,
          outstanding: outstandingFor(agent.id, sorted, curriculum),
          configured: true,
          repo,
        };
      } catch (error) {
        console.warn(`Training lookup failed for ${agent.id} (${repo}):`, error);
        return {
          ...empty,
          configured: true,
          repo,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
    (value) => (value.error ? TRAINING_ERROR_TTL : TRAINING_TTL)
  );
}

/**
 * Microsoft licences on the agent's own Entra account (`agent-teams-upn` tag or registry `teamsUpn`)
 * plus flat-fee subscriptions from the registry. Reading another user's
 * licences needs the User.Read.All delegated permission with admin consent;
 * without it the subscriptions still render and `licenseError` says why.
 */
const DIRECTORY_TTL = 30 * 60 * 1000;
const DIRECTORY_ERROR_TTL = 60 * 1000;

export async function getLicensing(ctx: UserContext, agent: AgentDetail): Promise<AgentLicensing> {
  const entry = getRegistryEntry(agent);
  const base: AgentLicensing = {
    upn: agent.teamsUpn,
    licenses: [],
    subscriptions: entry?.fixedCosts ?? [],
  };
  if (!agent.teamsUpn) return base;
  const upn = agent.teamsUpn;
  return cached(
    `licensing:${scope(ctx)}:${agent.id}`,
    async () => {
      try {
        const token = await getResourceToken(ctx, GRAPH_DIRECTORY_SCOPE);
        if (!token) {
          return {
            ...base,
            licenseError:
              'Microsoft Graph User.Read.All is not consented for this app — see docs/DEPLOYMENT.adoc',
          };
        }
        return { ...base, ...(await getUserLicensing(token, upn)) };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`Licence lookup failed for ${agent.id}:`, message);
        return { ...base, licenseError: message };
      }
    },
    // Keep successes for a while; retry failures (missing consent, Graph errors) quickly
    (value) => (value.licenseError ? DIRECTORY_ERROR_TTL : DIRECTORY_TTL)
  );
}

const PRESENCE_TTL = 20 * 1000;

/**
 * Teams presence of the agent's own account, so the portal can show when the
 * agent is on a call. Short-lived cache. A missing account or missing consent
 * comes back as an unknown presence with an `error`, because neither is going
 * to fix itself on a retry. A Graph failure throws instead, so `cached()` can
 * serve the last good reading and the route can answer 502 rather than
 * publishing a confident "not on a call".
 */
export async function getPresence(ctx: UserContext, agent: AgentDetail): Promise<AgentPresence> {
  const unknown = (error?: string): AgentPresence => ({
    availability: 'PresenceUnknown',
    activity: 'PresenceUnknown',
    onCall: false,
    checkedAt: new Date().toISOString(),
    error,
  });
  if (!agent.teamsUpn) return unknown('No agent-teams-upn tag on this agent');
  const upn = agent.teamsUpn;
  return cached(
    `presence:${scope(ctx)}:${agent.id}`,
    async () => {
      const token = await getResourceToken(ctx, GRAPH_PRESENCE_SCOPE);
      if (!token) {
        return unknown(
          'Microsoft Graph Presence.Read.All is not consented for this app — see docs/DEPLOYMENT.adoc'
        );
      }
      const presence = await getUserPresence(token, upn);
      return {
        ...presence,
        onCall: isOnCall(presence.activity),
        checkedAt: new Date().toISOString(),
      };
    },
    PRESENCE_TTL
  );
}

const NO_DIRECTORY_CONSENT =
  'Microsoft Graph Directory.Read.All is not consented for this app — see docs/DEPLOYMENT.adoc';

/**
 * What the agent can do: directory roles, groups and Azure RBAC roles of its
 * own account, and the API permissions of its app registrations (registry
 * `appRegistrations` plus any Bot Service app IDs) with consent state.
 * Read-only; needs Directory.Read.All (delegated, admin consent). Never
 * throws: failures come back as `error` and are cached only briefly.
 */
export async function getPermissions(
  ctx: UserContext,
  agent: AgentDetail
): Promise<AgentPermissions> {
  const entry = getRegistryEntry(agent);
  const apps = new Map<string, { appId: string; label?: string }>();
  for (const app of entry?.appRegistrations ?? []) apps.set(app.appId.toLowerCase(), app);
  for (const r of agent.resources) {
    if (
      r.type === 'microsoft.botservice/botservices' &&
      r.botAppId &&
      !apps.has(r.botAppId.toLowerCase())
    ) {
      apps.set(r.botAppId.toLowerCase(), { appId: r.botAppId, label: `Bot Service ${r.name}` });
    }
  }
  if (!agent.teamsUpn && apps.size === 0) return { apps: [] };

  const upn = agent.teamsUpn;
  const skeleton = (error: string): AgentPermissions => ({
    account: upn ? { upn, directoryRoles: [], groups: [], azureRoles: [] } : undefined,
    apps: [...apps.values()].map((a) => ({
      appId: a.appId,
      displayName: a.label ?? a.appId,
      label: a.label,
      permissions: [],
      azureRoles: [],
      // Without this the panel would read the empty lists as "No API
      // permissions requested" instead of "could not be read".
      error,
    })),
    error,
  });

  return cached(
    `permissions:${scope(ctx)}:${agent.id}`,
    async (): Promise<AgentPermissions> => {
      let token: string | null;
      try {
        token = await getResourceToken(ctx, GRAPH_DIRECTORY_READ_ALL_SCOPE);
      } catch (error) {
        return skeleton(error instanceof Error ? error.message : String(error));
      }
      if (!token) return skeleton(NO_DIRECTORY_CONSENT);
      const graph = token;

      const subscriptionIds = await listSubscriptions(ctx.armToken)
        .then((subs) => subs.map((s) => s.subscriptionId))
        .catch((error) => {
          console.warn('Subscription list failed for role assignments:', error);
          return [] as string[];
        });
      const roles = (principalId?: string) =>
        principalId
          ? listRoleAssignments(ctx.armToken, subscriptionIds, principalId).catch((error) => {
              console.warn(`Role assignments failed for ${principalId}:`, error);
              return [];
            })
          : Promise.resolve([]);

      // A failed lookup must not be cached for the full TTL as "no roles": an
      // empty account is indistinguishable from an unprivileged one, so the
      // failure is recorded and the TTL selector below picks the short TTL.
      let accountError: string | undefined;
      const account = upn
        ? await getUserAccess(graph, upn)
            .then(async (access) => ({ upn, ...access, azureRoles: await roles(access.objectId) }))
            .catch((error) => {
              console.warn(`User access lookup failed for ${agent.id}:`, error);
              accountError = error instanceof Error ? error.message : String(error);
              return { upn, directoryRoles: [], groups: [], azureRoles: [] };
            })
        : undefined;

      const appAccess = await Promise.all(
        [...apps.values()].map((a) =>
          getAppAccess(graph, a.appId, a.label)
            .then(async (access) => ({
              ...access,
              azureRoles: await roles(access.servicePrincipalId),
            }))
            .catch((error) => ({
              appId: a.appId,
              displayName: a.label ?? a.appId,
              label: a.label,
              permissions: [],
              azureRoles: [],
              error: error instanceof Error ? error.message : String(error),
            }))
        )
      );
      return { account, apps: appAccess, error: accountError };
    },
    (value) => (value.error ? DIRECTORY_ERROR_TTL : DIRECTORY_TTL)
  );
}

// ---------------------------------------------------------------------------
// BOOST mode
// ---------------------------------------------------------------------------

const BOOST_WARNING =
  'Boost switches the agent to OpenAI Fast mode (service_tier fast): about 2.5× faster ' +
  'generation at twice the standard token price ($8 / $40 per million). It bills the ' +
  'metered API and never uses the ChatGPT subscription: the agent is moved to API-first ' +
  'while Boost is on, then switched back automatically by the VM.';

const BOOST_CACHE_TTL = 12 * 60 * 60 * 1000;

export interface BoostRequest {
  action: 'on' | 'off' | 'refresh';
  hours?: number;
}

/**
 * The request body `POST /api/agents/:id/boost` accepts: `{ action: "refresh" }`
 * or `{ action: "on" | "off", hours?: number }`. Anything else — null, an array,
 * a primitive, an unknown key or a non-numeric `hours` — is rejected here so a
 * malformed payload is a 400 rather than a 500.
 */
export function parseBoostRequest(body: unknown): BoostRequest | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const { action, hours, ...rest } = body as Record<string, unknown>;
  if (Object.keys(rest).length > 0) return null;
  if (action !== 'on' && action !== 'off' && action !== 'refresh') return null;
  if (hours === undefined) return { action };
  // Only `on` takes a duration, in quarter hours; the bounds are checked in setBoost
  if (action !== 'on' || typeof hours !== 'number' || !Number.isFinite(hours)) return null;
  if (hours <= 0 || !Number.isInteger(hours * 4)) return null;
  return { action, hours };
}

interface BoostScriptState {
  active?: boolean;
  model?: string;
  since?: string;
  until?: string;
  hours?: number;
  error?: string;
}

/** Parse the JSON line the boost script prints last. Exported for tests. */
export function parseBoostOutput(stdout: string): BoostScriptState {
  const line = stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('{'))
    .pop();
  if (!line) throw new Error(`Boost script returned no JSON: ${stdout.slice(0, 200)}`);
  return JSON.parse(line) as BoostScriptState;
}

function boostShape(agent: AgentDetail): {
  base: AgentBoost;
  script?: string;
  vm?: ReturnType<typeof findVm>;
} {
  const entry = getRegistryEntry(agent);
  const vm = findVm(agent.resources);
  return {
    base: {
      supported: Boolean(entry?.boost?.script && vm),
      active: false,
      source: 'none',
      defaultHours: entry?.boost?.defaultHours ?? 2,
      maxHours: entry?.boost?.maxHours ?? 8,
      warning: BOOST_WARNING,
    },
    script: entry?.boost?.script,
    vm,
  };
}

/** VM state is global, not per viewer, so the cache key is the agent alone. */
function boostKey(agent: AgentDetail): string {
  return `boost:${agent.id}:state`;
}

async function runBoost(ctx: UserContext, agent: AgentDetail, args: string): Promise<AgentBoost> {
  const { base, script, vm } = boostShape(agent);
  if (!script || !vm) return base;
  const { stdout, stderr } = await runVmScript(ctx.armToken, vm, [`${script} ${args}`]);
  let state: BoostScriptState;
  try {
    state = parseBoostOutput(stdout);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(stderr ? `${reason} (${stderr.slice(0, 200)})` : reason);
  }
  if (state.error) throw new Error(state.error);
  const result: AgentBoost = {
    ...base,
    active: Boolean(state.active),
    model: state.model,
    since: state.since,
    until: state.until,
    hours: state.hours,
    source: 'vm',
    checkedAt: new Date().toISOString(),
  };
  invalidate(boostKey(agent));
  await cached(boostKey(agent), async () => result, BOOST_CACHE_TTL);
  return result;
}

/** Last known Boost state; `refresh` asks the VM (a run-command round trip, ~30 s). */
export async function getBoost(
  ctx: UserContext,
  agent: AgentDetail,
  refresh = false
): Promise<AgentBoost> {
  const { base, script, vm } = boostShape(agent);
  if (!script || !vm) return base;
  if (refresh) return runBoost(ctx, agent, 'status');
  const known = await cached<AgentBoost | null>(boostKey(agent), async () => null, 0);
  if (!known) return base;
  // Past `until`, the VM's own timer has already switched the agent back
  if (known.active && known.until && new Date(known.until).getTime() < Date.now()) {
    return { ...known, active: false, source: 'cache' };
  }
  return { ...known, source: 'cache' };
}

/** Turn Boost on for `hours` (bounded by the registry) or off, as the signed-in user. */
export async function setBoost(
  ctx: UserContext,
  agent: AgentDetail,
  on: boolean,
  hours?: number
): Promise<AgentBoost> {
  const { base } = boostShape(agent);
  if (!base.supported) throw new Error('Boost is not configured for this agent');
  if (!on) return runBoost(ctx, agent, 'off');
  const requested = hours ?? base.defaultHours;
  // `boost.sh on N` accepts quarter hours (the UI offers 30 min); anything
  // finer would reach the VM verbatim, so pin the granularity here.
  if (
    !Number.isFinite(requested) ||
    !Number.isInteger(requested * 4) ||
    requested < 0.25 ||
    requested > base.maxHours
  ) {
    throw new Error(
      `Hours must be a multiple of 0.25 between 0.25 and ${base.maxHours}, got ${requested}`
    );
  }
  return runBoost(ctx, agent, `on ${requested}`);
}

// ---------------------------------------------------------------------------
// Brain (Reverie graph memory)
// ---------------------------------------------------------------------------

export type BrainSource = { kind: 'fixture' } | { kind: 'reverie'; url: string; token: string };

/**
 * Where an agent's brain view reads from. Only the registry's `brainUrl` is
 * honoured (never a tag) because a server-side token (REVERIE_TOKEN_<AGENT>, else
 * REVERIE_TOKEN) is sent to it.
 */
export function brainSource(agent: AgentDetail, demo = false): BrainSource | null {
  if (demo || process.env.BRAIN_FIXTURE === '1') return { kind: 'fixture' };
  const url = getRegistryEntry(agent)?.brainUrl;
  const token = reverieTokenFor(agent.id);
  if (!url || !token || !isValidBrainUrl(url)) return null;
  return { kind: 'reverie', url, token };
}

/**
 * Snapshot of the agent's graph memory. Cached briefly; a failed refresh serves
 * the last good snapshot for a short while (see cache.ts) before erroring.
 */
export async function getBrain(agent: AgentDetail, demo = false): Promise<AgentBrain> {
  const source = brainSource(agent, demo);
  const liveAvailable = brainSource(agent)?.kind === 'reverie';
  if (!source) {
    const entry = getRegistryEntry(agent);
    return {
      available: false,
      error: !entry?.brainUrl
        ? 'No brainUrl in the registry for this agent'
        : !isValidBrainUrl(entry.brainUrl)
          ? 'brainUrl in the registry is not a valid https URL'
          : `REVERIE_TOKEN_${agent.id.toUpperCase().replace(/[^A-Z0-9]/g, '_')} (or REVERIE_TOKEN) is not set on the server`,
    };
  }
  if (source.kind === 'fixture')
    return { available: true, fixture: true, liveAvailable, snapshot: fixtureSnapshot() };
  try {
    const snapshot = await cached(
      `brain:${agent.id}`,
      () => fetchBrainSnapshot(source.url, source.token),
      15 * 1000
    );
    return { available: true, liveAvailable, snapshot };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Brain snapshot failed for ${agent.id}:`, message);
    return { available: true, error: message };
  }
}

export async function getActivity(ctx: UserContext, agent: AgentDetail): Promise<ActivityEvent[]> {
  return cached(`activity:${scope(ctx)}:${agent.id}`, async () => {
    const who = { id: agent.id, name: agent.name };
    const groups = [
      ...new Set(agent.resources.map((r) => `${r.subscriptionId}|${r.resourceGroup}`)),
    ];

    const azure = groups.map((key) => {
      const [subscriptionId, resourceGroup] = key.split('|');
      return listActivityLog(ctx.armToken, subscriptionId, resourceGroup, who).catch((error) => {
        console.warn(`Activity log failed for ${resourceGroup}:`, error);
        return [] as ActivityEvent[];
      });
    });

    // The server's GitHub token is spent only on a repo the trusted registry
    // entry names; a repo taken from a tag is read anonymously (public repos)
    const trustedRepo = getRegistryEntry(agent)?.repo;
    const repo = trustedRepo ?? agent.repo;
    const github = repo
      ? listRepoCommits(repo, who, 1000, 365, { anonymous: !trustedRepo }).catch((error) => {
          console.warn(`GitHub commits failed for ${repo}:`, error);
          return [] as ActivityEvent[];
        })
      : Promise.resolve([] as ActivityEvent[]);

    // The whole Foundry sequence is isolated, not just the runs call: the token
    // exchange and the assistants lookup can fail too, and neither should blank
    // the Azure and GitHub events.
    const foundry = (async () => {
      if (agent.foundryProjects.length === 0) return [] as ActivityEvent[];
      try {
        const token = await getResourceToken(ctx, FOUNDRY_SCOPE);
        if (!token) return [] as ActivityEvent[];
        const assistants = await getAssistants(ctx, agent);
        return await listRecentRuns(token, agent.foundryProjects, assistants, who);
      } catch (error) {
        console.warn(`Foundry runs failed for ${agent.id}:`, error);
        return [] as ActivityEvent[];
      }
    })();

    const results = await Promise.all([...azure, github, foundry]);
    // Untruncated: the calendar aggregates a whole year; the route trims the feed
    return results.flat().sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  });
}

/** VM CPU series for the agent's virtual machines over the last `hours`. */
export async function getMetrics(
  ctx: UserContext,
  agent: AgentDetail,
  hours: number
): Promise<AgentMetrics> {
  const intervalMinutes = hours > 24 ? 60 : 30;
  return cached(`metrics:${scope(ctx)}:${agent.id}:${hours}`, async () => {
    const vms = agent.resources.filter(
      (r) => r.type.toLowerCase() === 'microsoft.compute/virtualmachines'
    );
    const cpu = await Promise.all(
      vms.map(async (vm) => ({
        resourceId: vm.id,
        name: vm.name,
        points: await listVmCpu(ctx.armToken, vm.id, hours, intervalMinutes).catch((error) => {
          console.warn(`CPU metrics failed for ${vm.name}:`, error);
          return [];
        }),
      }))
    );
    return { hours, intervalMinutes, cpu };
  });
}

/** Merged activity feed across every agent the user can see. */
export async function getAllActivity(ctx: UserContext, limit = 60): Promise<ActivityEvent[]> {
  const agents = await listAgents(ctx);
  const details = await Promise.all(agents.map((a) => getAgent(ctx, a.id)));
  const feeds = await Promise.all(
    details.filter((a): a is AgentDetail => Boolean(a)).map((a) => getActivity(ctx, a))
  );
  // Agents that share a repo (e.g. prod and test) report the same commits;
  // keep the first occurrence so the merged feed lists each event once.
  const seen = new Set<string>();
  return feeds
    .flat()
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .filter((event) => {
      const [source, , ...rest] = event.id.split(':');
      const key = `${source}:${rest.join(':')}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Costs
// ---------------------------------------------------------------------------

const COST_TTL = 30 * 60 * 1000; // billing APIs are rate limited and change slowly
const COST_ERROR_TTL = 2 * 60 * 1000; // back off after a failure instead of hammering a 429
const TIMEFRAMES: Timeframe[] = ['MonthToDate', 'TheLastMonth'];

type Loaded<T> = { rows: T[]; error?: string };

/** Cache successes for COST_TTL and failures for COST_ERROR_TTL. */
async function loadCached<T>(key: string, loader: () => Promise<T[]>): Promise<Loaded<T>> {
  return cached<Loaded<T>>(
    key,
    async () => {
      try {
        return { rows: await loader() };
      } catch (error) {
        return { rows: [], error: error instanceof Error ? error.message : String(error) };
      }
    },
    (value) => (value.error ? COST_ERROR_TTL : COST_TTL)
  );
}

async function loadCostInputs(ctx: UserContext, agents: AgentDetail[]): Promise<CostInputs> {
  const subscriptionIds = [
    ...new Set(agents.flatMap((a) => a.resources.map((r) => r.subscriptionId))),
  ];
  const windows = monthWindows();
  const sources: CostSourceStatus[] = [];

  const empty = (): Record<Timeframe, AzureCostRow[]> => ({ MonthToDate: [], TheLastMonth: [] });
  const azure = empty();
  let azureError: string | undefined;
  await Promise.all(
    subscriptionIds.flatMap((sub) =>
      TIMEFRAMES.map(async (tf) => {
        const result = await loadCached(`costs:azure:${scope(ctx)}:${sub}:${tf}`, () =>
          queryAzureCosts(ctx.armToken, sub, tf)
        );
        azure[tf].push(...result.rows);
        if (result.error) {
          azureError = result.error;
          console.warn(`Azure cost query failed for ${sub}/${tf}:`, azureError);
        }
      })
    )
  );
  sources.push(
    azureError
      ? { source: 'azure', status: 'error', detail: azureError }
      : { source: 'azure', status: 'ok' }
  );

  const llm = async (
    source: 'openai' | 'anthropic',
    key: string | undefined,
    fetcher: (window: { start: Date; end: Date }, key: string) => Promise<LlmCostRow[]>
  ): Promise<Record<Timeframe, LlmCostRow[]>> => {
    const result: Record<Timeframe, LlmCostRow[]> = { MonthToDate: [], TheLastMonth: [] };
    if (!key) {
      sources.push({
        source,
        status: 'not-configured',
        detail: `Set ${source === 'openai' ? 'OPENAI_ADMIN_KEY' : 'ANTHROPIC_ADMIN_KEY'} on the server`,
      });
      return result;
    }
    try {
      for (const tf of TIMEFRAMES) {
        // Org-wide figures: cache once for everyone, attribution happens per agent
        result[tf] = await cached(
          `costs:${source}:${tf}`,
          () => fetcher(windows[tf], key),
          COST_TTL
        );
      }
      sources.push({ source, status: 'ok' });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.warn(`${source} cost lookup failed:`, detail);
      sources.push({ source, status: 'error', detail });
    }
    return result;
  };

  const [openai, anthropic] = await Promise.all([
    llm('openai', process.env.OPENAI_ADMIN_KEY, fetchOpenAICosts),
    llm('anthropic', process.env.ANTHROPIC_ADMIN_KEY, fetchAnthropicCosts),
  ]);

  return { azure, openai, anthropic, sources };
}

export async function getAgentCosts(ctx: UserContext, agent: AgentDetail): Promise<AgentCosts> {
  const inputs = await loadCostInputs(ctx, [agent]);
  return buildAgentCosts(agent, getRegistryEntry(agent), inputs);
}

/** Month-to-date and last-month totals for every visible agent. */
export async function getCostsSummary(ctx: UserContext): Promise<CostsSummary> {
  const agents = await listAgents(ctx);
  const inputs = await loadCostInputs(ctx, agents);
  const perAgent = agents.map((agent) => buildAgentCosts(agent, getRegistryEntry(agent), inputs));
  const totals = { monthToDate: {}, lastMonth: {} };
  for (const costs of perAgent) {
    addTotals(totals.monthToDate, costs.monthToDate.totals);
    addTotals(totals.lastMonth, costs.lastMonth.totals);
  }
  return {
    agents: perAgent.map((c) => ({
      agentId: c.agentId,
      monthToDate: c.monthToDate.totals,
      lastMonth: c.lastMonth.totals,
    })),
    totals,
    sources: inputs.sources,
    generatedAt: new Date().toISOString(),
  };
}
