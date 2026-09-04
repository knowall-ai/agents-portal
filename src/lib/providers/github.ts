// GitHub: skills (SKILL.md folders) and recent commits for an agent's repo.
import type { ActivityEvent, Skill } from '@/types';

const API = 'https://api.github.com';

function headers(): HeadersInit {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'knowall-agent-dashboard',
  };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

async function ghJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    headers: headers(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`GitHub ${response.status} ${path}`);
  }
  return response.json() as Promise<T>;
}

interface ContentItem {
  name: string;
  path: string;
  type: 'file' | 'dir' | 'symlink' | 'submodule';
  target?: string;
  content?: string;
  encoding?: string;
  html_url?: string;
}

/** Parse `name:` and `description:` from a SKILL.md YAML frontmatter block. */
export function parseSkillFrontmatter(markdown: string): { name?: string; description?: string } {
  const match = markdown.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};
  const result: { name?: string; description?: string } = {};
  for (const line of match[1].split('\n')) {
    const m = line.match(/^(name|description):\s*(.*)$/);
    if (m) result[m[1] as 'name' | 'description'] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return result;
}

/** Resolve a repo path that may be a symlink (e.g. workspace/skills -> ../.claude/skills). */
function resolveSymlink(basePath: string, target: string): string {
  const parts = basePath.split('/').slice(0, -1);
  for (const segment of target.split('/')) {
    if (segment === '..') parts.pop();
    else if (segment && segment !== '.') parts.push(segment);
  }
  return parts.join('/');
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (index < items.length) {
        const item = items[index++];
        results.push(await fn(item));
      }
    })
  );
  return results;
}

/** List skills from `<repo>/<skillsPath>/<skill>/SKILL.md`. */
export async function listRepoSkills(repo: string, skillsPath: string): Promise<Skill[]> {
  let listing = await ghJson<ContentItem | ContentItem[]>(`/repos/${repo}/contents/${skillsPath}`);
  if (!Array.isArray(listing) && listing.type === 'symlink' && listing.target) {
    const resolved = resolveSymlink(skillsPath, listing.target);
    listing = await ghJson<ContentItem[]>(`/repos/${repo}/contents/${resolved}`);
  }
  if (!Array.isArray(listing)) return [];

  const dirs = listing.filter((item) => item.type === 'dir');
  const skills = await mapWithConcurrency(dirs, 6, async (dir): Promise<Skill> => {
    const fallback: Skill = {
      id: `github:${dir.name}`,
      name: dir.name,
      source: 'github',
      sourceLabel: repo,
      url: dir.html_url,
    };
    try {
      const file = await ghJson<ContentItem>(`/repos/${repo}/contents/${dir.path}/SKILL.md`);
      if (file.content && file.encoding === 'base64') {
        const markdown = Buffer.from(file.content, 'base64').toString('utf8');
        const fm = parseSkillFrontmatter(markdown);
        return {
          ...fallback,
          name: fm.name || dir.name,
          description: fm.description,
          url: file.html_url ?? fallback.url,
        };
      }
    } catch {
      // No SKILL.md — keep the folder name
    }
    return fallback;
  });

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

interface RawCommit {
  sha: string;
  html_url: string;
  commit: { message: string; author: { name: string; date: string } };
}

/** Recent commits on the agent's repo as activity events. */
export async function listRepoCommits(
  repo: string,
  agent: { id: string; name: string },
  limit = 15
): Promise<ActivityEvent[]> {
  const commits = await ghJson<RawCommit[]>(`/repos/${repo}/commits?per_page=${limit}`);
  return commits.map((c) => ({
    id: `github:${agent.id}:${c.sha}`,
    agentId: agent.id,
    agentName: agent.name,
    timestamp: c.commit.author.date,
    source: 'github',
    title: c.commit.message.split('\n')[0].slice(0, 120),
    detail: `${repo} @ ${c.sha.slice(0, 7)}`,
    actor: c.commit.author.name,
    level: 'info',
    url: c.html_url,
  }));
}
