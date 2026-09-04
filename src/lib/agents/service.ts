// Agent service: composes Azure discovery, the registry, Foundry, GitHub and
// health probes into the shapes the API routes return.
import { cached } from '@/lib/cache';
import { getRegistry, getRegistryEntry } from '@/lib/registry';
import { listActivityLog, listAgentResources, listSubscriptions } from '@/lib/providers/azure';
import {
  assistantsToSkills,
  listAssistants,
  listFoundryProjects,
  listRecentRuns,
} from '@/lib/providers/foundry';
import { listRepoCommits, listRepoSkills } from '@/lib/providers/github';
import { probeUrl } from '@/lib/providers/health';
import { FOUNDRY_SCOPE, getResourceToken, type UserContext } from '@/lib/tokens';
import type {
  ActivityEvent,
  AgentCosts,
  AgentDetail,
  CostSourceStatus,
  CostsSummary,
  FoundryAssistant,
  Skill,
} from '@/types';
import { buildAgent, groupResources, sortAgents } from './discover';
import { addTotals, buildAgentCosts, type CostInputs } from './costs';
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

export async function getAgent(ctx: UserContext, id: string): Promise<AgentDetail | null> {
  const agents = await listAgents(ctx);
  const agent = agents.find((a) => a.id === id.toLowerCase());
  if (!agent) return null;

  return cached(`agent:${scope(ctx)}:${agent.id}`, async () => {
    const entry = getRegistryEntry(agent.id);
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
      const entry = getRegistryEntry(agent.id);
      const [repoSkills, assistants] = await Promise.all([
        entry?.repo && entry.skillsPath
          ? listRepoSkills(entry.repo, entry.skillsPath).catch((error) => {
              console.warn(`GitHub skills lookup failed for ${agent.id}:`, error);
              return [] as Skill[];
            })
          : Promise.resolve([] as Skill[]),
        getAssistants(ctx, agent),
      ]);
      return [...repoSkills, ...assistantsToSkills(assistants)];
    },
    10 * 60 * 1000
  );
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

    const github = agent.repo
      ? listRepoCommits(agent.repo, who).catch((error) => {
          console.warn(`GitHub commits failed for ${agent.repo}:`, error);
          return [] as ActivityEvent[];
        })
      : Promise.resolve([] as ActivityEvent[]);

    const foundry = (async () => {
      if (agent.foundryProjects.length === 0) return [] as ActivityEvent[];
      const token = await getResourceToken(ctx, FOUNDRY_SCOPE);
      if (!token) return [] as ActivityEvent[];
      const assistants = await getAssistants(ctx, agent);
      return listRecentRuns(token, agent.foundryProjects, assistants, who).catch((error) => {
        console.warn(`Foundry runs failed for ${agent.id}:`, error);
        return [] as ActivityEvent[];
      });
    })();

    const results = await Promise.all([...azure, github, foundry]);
    return results
      .flat()
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, 50);
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
  return buildAgentCosts(agent, getRegistryEntry(agent.id), inputs);
}

/** Month-to-date and last-month totals for every visible agent. */
export async function getCostsSummary(ctx: UserContext): Promise<CostsSummary> {
  const agents = await listAgents(ctx);
  const inputs = await loadCostInputs(ctx, agents);
  const perAgent = agents.map((agent) =>
    buildAgentCosts(agent, getRegistryEntry(agent.id), inputs)
  );
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
