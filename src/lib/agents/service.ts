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
import type { ActivityEvent, AgentDetail, FoundryAssistant, Skill } from '@/types';
import { buildAgent, groupResources, sortAgents } from './discover';

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
