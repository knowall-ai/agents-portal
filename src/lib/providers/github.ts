// GitHub: skills (SKILL.md folders), SOUL.md, training runs and recent commits
// for an agent's repo.
import { parseCurriculum, parseTrainingRun } from '@/lib/training';
import type { ActivityEvent, AgentSoul, CurriculumScenario, Skill, TrainingRun } from '@/types';

const API = 'https://api.github.com';

function headers(anonymous = false): HeadersInit {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'knowall-agents-portal',
  };
  if (!anonymous && process.env.GITHUB_TOKEN)
    h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

const REPO_SLUG = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** True for an `owner/name` slug with no path tricks. */
export function isValidRepo(repo: string): boolean {
  return REPO_SLUG.test(repo) && !repo.includes('..');
}

async function ghJson<T>(path: string, anonymous = false): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    headers: headers(anonymous),
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
  const lines = match[1].split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(name|description):\s*(.*)$/);
    if (!m) continue;
    const key = m[1] as 'name' | 'description';
    let value = m[2].trim();
    if (value === '>' || value === '|' || value === '>-' || value === '|-') {
      // Folded (>) or literal (|) block scalar: gather the indented lines that follow
      const block: string[] = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) block.push(lines[++i].trim());
      value = block.join(value.startsWith('>') ? ' ' : '\n');
    }
    result[key] = value.replace(/^["']|["']$/g, '');
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
  if (!isValidRepo(repo)) throw new Error(`Invalid repo slug: ${repo}`);
  if (skillsPath.includes('..')) throw new Error(`Invalid skills path: ${skillsPath}`);
  let listing = await ghJson<ContentItem | ContentItem[]>(`/repos/${repo}/contents/${skillsPath}`);
  if (!Array.isArray(listing) && listing.type === 'symlink' && listing.target) {
    const resolved = resolveSymlink(skillsPath, listing.target);
    listing = await ghJson<ContentItem[]>(`/repos/${repo}/contents/${resolved}`);
  }
  if (!Array.isArray(listing)) return [];

  const dirs = listing.filter((item) => item.type === 'dir');
  const skills = await mapWithConcurrency(dirs, 6, async (dir): Promise<Skill> => {
    const fallback: Skill = {
      id: `github:${repo}:${dir.name}`,
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

/** Fetch a markdown file from the repo, or null when it does not exist. */
export async function getRepoMarkdown(repo: string, path: string): Promise<AgentSoul | null> {
  if (!isValidRepo(repo)) throw new Error(`Invalid repo slug: ${repo}`);
  if (path.includes('..')) throw new Error(`Invalid path: ${path}`);
  let file: ContentItem | ContentItem[];
  try {
    file = await ghJson<ContentItem | ContentItem[]>(`/repos/${repo}/contents/${path}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('GitHub 404 ')) return null;
    throw error;
  }
  if (Array.isArray(file) || !file.content || file.encoding !== 'base64') return null;
  return {
    path,
    markdown: Buffer.from(file.content, 'base64').toString('utf8'),
    url: file.html_url,
  };
}

interface RawCommit {
  sha: string;
  html_url: string;
  commit: { message: string; author: { name: string; date: string } };
}

/**
 * Commits on the agent's repo from the last `sinceDays`, newest first, paged
 * 100 at a time up to `limit`. Both bounds must be positive integers.
 */
export async function listRepoCommits(
  repo: string,
  agent: { id: string; name: string },
  limit = 15,
  sinceDays = 90,
  options: { anonymous?: boolean } = {}
): Promise<ActivityEvent[]> {
  if (!isValidRepo(repo)) throw new Error(`Invalid repo slug: ${repo}`);
  if (!Number.isInteger(limit) || limit < 1 || limit > 5000)
    throw new Error(`Invalid limit: ${limit}`);
  if (!Number.isInteger(sinceDays) || sinceDays < 1 || sinceDays > 3650)
    throw new Error(`Invalid sinceDays: ${sinceDays}`);
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();
  const commits: RawCommit[] = [];
  try {
    for (let page = 1; commits.length < limit; page++) {
      const perPage = Math.min(100, limit - commits.length);
      const batch = await ghJson<RawCommit[]>(
        `/repos/${repo}/commits?per_page=${perPage}&page=${page}&since=${since}`,
        options.anonymous === true
      );
      commits.push(...batch);
      if (batch.length < perPage) break;
    }
  } catch (error) {
    console.warn(`listRepoCommits: failed to page commits for ${repo}`, error);
  }
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

/** Default repo holding the training harness's published runs and curriculum. */
export const DEFAULT_TRAINING_REPO = 'knowall-ai/agent-training';

/** At most this many run files are fetched per agent, newest first. */
const MAX_TRAINING_RUNS = 50;

/**
 * GitHub answers 404 for a private repo the token cannot read as well as for a
 * path that does not exist. Before treating a 404 as an absent optional file,
 * confirm the repo itself is readable so a wrong `GITHUB_TOKEN` or repo name
 * surfaces as an error instead of an empty Training tab.
 */
async function absentOrInaccessible(repo: string, error: unknown): Promise<void> {
  if (!(error instanceof Error && error.message.startsWith('GitHub 404 '))) throw error;
  try {
    await ghJson<unknown>(`/repos/${repo}`);
  } catch (repoError) {
    if (repoError instanceof Error && repoError.message.startsWith('GitHub 404 '))
      throw new Error(`GitHub repo ${repo} not found or not readable with GITHUB_TOKEN`);
    throw repoError;
  }
}

/**
 * The run files to read: the newest `limit` overall, plus the newest file for
 * each scenario in `keepScenarios` that the cap would otherwise drop, so the
 * compliance check always sees each scenario's latest result. Run files are
 * named `<started_at>-<scenario>[-<run-id>].json`; a file belongs to the
 * longest scenario id its name after the timestamp equals or continues with a
 * dash, so `lag-repro` files are never mistaken for `lag` runs with a run id.
 */
export function selectRunFiles<T extends { name: string }>(
  files: T[],
  limit: number,
  keepScenarios: string[]
): T[] {
  const newest = [...files].sort((a, b) => b.name.localeCompare(a.name));
  const chosen = newest.slice(0, limit);
  const rest = newest.slice(limit);
  const ids = [...keepScenarios].map((id) => id.toLowerCase()).sort((a, b) => b.length - a.length);
  const scenarioOf = (name: string): string | undefined => {
    const tail = name
      .replace(/\.json$/i, '')
      .replace(TIMESTAMP_PREFIX, '')
      .toLowerCase();
    return ids.find((id) => tail === id || tail.startsWith(`${id}-`));
  };
  const covered = new Set(chosen.map((f) => scenarioOf(f.name)));
  for (const file of rest) {
    const id = scenarioOf(file.name);
    if (id === undefined || covered.has(id)) continue;
    covered.add(id);
    chosen.push(file);
  }
  return chosen;
}

/** The ISO start time that begins a run file name, colons written as dashes. */
const TIMESTAMP_PREFIX =
  /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(?:[.-]\d+)?(?:Z|[+-]\d{2}-?\d{2})?-?/;

/** A path segment that cannot escape the directory it is joined to. */
function isSafeSegment(segment: string): boolean {
  return /^[A-Za-z0-9_.-]+$/.test(segment) && !segment.includes('..');
}

/** Decode a base64 `contents` response, or null when it is not a plain file. */
function fileText(file: ContentItem | ContentItem[]): string | null {
  if (Array.isArray(file) || !file.content || file.encoding !== 'base64') return null;
  return Buffer.from(file.content, 'base64').toString('utf8');
}

/**
 * Training runs published under `runs/<agentId>/` in the training repo, newest
 * first and capped at 50 files plus the latest file of every scenario in
 * `keepScenarios` (see `selectRunFiles`). Run file names begin with the ISO
 * start time, so the listing sorts by name before anything is fetched. A
 * missing directory in a readable repo means the agent has no runs yet, not a
 * failure; a file that cannot be read or parsed is warned about and skipped so
 * one bad run never blanks the tab.
 */
export async function listTrainingRuns(
  repo: string,
  agentId: string,
  keepScenarios: string[] = []
): Promise<TrainingRun[]> {
  if (!isValidRepo(repo)) throw new Error(`Invalid repo slug: ${repo}`);
  if (!isSafeSegment(agentId)) throw new Error(`Invalid agent id: ${agentId}`);

  let listing: ContentItem | ContentItem[];
  try {
    listing = await ghJson<ContentItem | ContentItem[]>(`/repos/${repo}/contents/runs/${agentId}`);
  } catch (error) {
    await absentOrInaccessible(repo, error);
    return [];
  }
  if (!Array.isArray(listing)) return [];

  const files = selectRunFiles(
    listing.filter((item) => item.type === 'file' && item.name.endsWith('.json')),
    MAX_TRAINING_RUNS,
    keepScenarios
  );

  const runs = await mapWithConcurrency(files, 6, async (item): Promise<TrainingRun | null> => {
    try {
      const file = await ghJson<ContentItem>(`/repos/${repo}/contents/${item.path}`);
      const text = fileText(file);
      if (text === null) return null;
      const run = parseTrainingRun(text, item.path);
      return run ? { ...run, url: file.html_url ?? item.html_url } : null;
    } catch (error) {
      console.warn(`listTrainingRuns: failed to read ${item.path} in ${repo}`, error);
      return null;
    }
  });

  return runs.filter((run): run is TrainingRun => run !== null);
}

/**
 * `curriculum.yaml` at the root of the training repo. A readable repo without
 * one has no curriculum, which is not an error; a repo that cannot be read is.
 */
export async function getCurriculum(repo: string): Promise<CurriculumScenario[]> {
  if (!isValidRepo(repo)) throw new Error(`Invalid repo slug: ${repo}`);
  let file: ContentItem | ContentItem[];
  try {
    file = await ghJson<ContentItem | ContentItem[]>(`/repos/${repo}/contents/curriculum.yaml`);
  } catch (error) {
    await absentOrInaccessible(repo, error);
    return [];
  }
  const text = fileText(file);
  return text === null ? [] : parseCurriculum(text);
}
