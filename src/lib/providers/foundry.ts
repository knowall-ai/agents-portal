// Azure AI Foundry: projects, assistants (agents) and recent runs.
//
// Foundry projects hang off an AI Services account. The project's "AI Foundry API"
// endpoint speaks the OpenAI-compatible Assistants API, authenticated with a
// token for https://ai.azure.com.
import type {
  ActivityEvent,
  AzureResource,
  FoundryAssistant,
  FoundryProject,
  Skill,
} from '@/types';

const ARM = 'https://management.azure.com';
const API_VERSION = 'v1';

async function getJson<T>(url: string, token: string): Promise<T> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status} ${url}: ${body.slice(0, 300)}`);
  }
  return response.json() as Promise<T>;
}

/** Find Foundry projects under the agent's AI Services accounts (ARM token). */
export async function listFoundryProjects(
  armToken: string,
  resources: AzureResource[]
): Promise<FoundryProject[]> {
  const accounts = resources.filter(
    (r) => r.type === 'microsoft.cognitiveservices/accounts' && /aiservices/i.test(r.kind ?? '')
  );
  const projects: FoundryProject[] = [];
  await Promise.all(
    accounts.map(async (account) => {
      try {
        const result = await getJson<{
          value: { name: string; properties: { endpoints?: Record<string, string> } }[];
        }>(`${ARM}${account.id}/projects?api-version=2025-06-01`, armToken);
        for (const project of result.value ?? []) {
          const endpoint = project.properties.endpoints?.['AI Foundry API'];
          if (!endpoint) continue;
          projects.push({
            accountId: account.id,
            accountName: account.name,
            projectName: project.name.split('/').pop() ?? project.name,
            endpoint: endpoint.replace(/\/$/, ''),
          });
        }
      } catch (error) {
        console.warn(`Foundry projects lookup failed for ${account.name}:`, error);
      }
    })
  );
  return projects;
}

interface RawAssistant {
  id: string;
  name: string;
  model: string;
  description?: string | null;
  created_at: number;
  tools?: { type: string; function?: { name?: string } }[];
  metadata?: Record<string, string>;
}

export async function listAssistants(
  foundryToken: string,
  projects: FoundryProject[]
): Promise<FoundryAssistant[]> {
  const assistants: FoundryAssistant[] = [];
  await Promise.all(
    projects.map(async (project) => {
      try {
        const result = await getJson<{ data: RawAssistant[] }>(
          `${project.endpoint}/assistants?api-version=${API_VERSION}&limit=100`,
          foundryToken
        );
        for (const a of result.data ?? []) {
          assistants.push({
            id: a.id,
            name: a.name,
            model: a.model,
            description: a.description ?? undefined,
            createdAt: new Date(a.created_at * 1000).toISOString(),
            tools: (a.tools ?? []).map((t) =>
              t.type === 'function' && t.function?.name ? `function:${t.function.name}` : t.type
            ),
            metadata: a.metadata ?? {},
            projectName: project.projectName,
          });
        }
      } catch (error) {
        console.warn(`Foundry assistants lookup failed for ${project.projectName}:`, error);
      }
    })
  );
  return assistants;
}

/** Represent each Foundry assistant's tools as skills. */
export function assistantsToSkills(assistants: FoundryAssistant[]): Skill[] {
  const skills = new Map<string, Skill>();
  for (const assistant of assistants) {
    for (const tool of assistant.tools) {
      const name = tool.replace(/^function:/, '');
      const existing = skills.get(name);
      const label = `${assistant.name} (${assistant.model})`;
      if (existing) {
        existing.sourceLabel = `${existing.sourceLabel}, ${label}`;
      } else {
        skills.set(name, {
          id: `foundry:${name}`,
          name,
          description: tool.startsWith('function:')
            ? 'Function tool exposed to the Foundry assistant'
            : `Built-in ${tool} tool`,
          source: 'foundry',
          sourceLabel: label,
        });
      }
    }
  }
  return [...skills.values()];
}

interface RawThread {
  id: string;
  created_at: number;
}

interface RawRun {
  id: string;
  status: string;
  model: string;
  assistant_id: string;
  created_at: number;
  completed_at?: number | null;
  failed_at?: number | null;
  last_error?: { message?: string } | null;
  usage?: { total_tokens?: number } | null;
}

/** Recent assistant runs across the project's latest threads. */
export async function listRecentRuns(
  foundryToken: string,
  projects: FoundryProject[],
  assistants: FoundryAssistant[],
  agent: { id: string; name: string },
  threadLimit = 8
): Promise<ActivityEvent[]> {
  const byAssistant = new Map(assistants.map((a) => [a.id, a]));
  const events: ActivityEvent[] = [];

  await Promise.all(
    projects.map(async (project) => {
      try {
        const threads = await getJson<{ data: RawThread[] }>(
          `${project.endpoint}/threads?api-version=${API_VERSION}&limit=${threadLimit}&order=desc`,
          foundryToken
        );
        await Promise.all(
          (threads.data ?? []).map(async (thread) => {
            const runs = await getJson<{ data: RawRun[] }>(
              `${project.endpoint}/threads/${thread.id}/runs?api-version=${API_VERSION}&limit=5&order=desc`,
              foundryToken
            );
            for (const run of runs.data ?? []) {
              const assistant = byAssistant.get(run.assistant_id);
              const finished = run.completed_at ?? run.failed_at ?? run.created_at;
              const failed = run.status === 'failed' || run.status === 'expired';
              events.push({
                id: `foundry:${run.id}`,
                agentId: agent.id,
                agentName: agent.name,
                timestamp: new Date(finished * 1000).toISOString(),
                source: 'foundry',
                title: `Run ${run.status} — ${assistant?.name ?? run.assistant_id}`,
                detail: [
                  run.model,
                  run.usage?.total_tokens ? `${run.usage.total_tokens} tokens` : undefined,
                  run.last_error?.message,
                ]
                  .filter(Boolean)
                  .join(' · '),
                level: failed ? 'error' : run.status === 'completed' ? 'success' : 'info',
              });
            }
          })
        );
      } catch (error) {
        console.warn(`Foundry runs lookup failed for ${project.projectName}:`, error);
      }
    })
  );
  return events;
}
