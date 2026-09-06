/**
 * Pure logic for the Training tab: reading the shapes the training harness
 * publishes to `knowall-ai/agent-training` and working out what is still due.
 *
 * The harness owns those files (knowall-ai/agent-training#14), so nothing here
 * assumes a field is present: an unknown or missing value is dropped rather
 * than failing the whole run, and a file that cannot be read at all is skipped.
 */
import type {
  CurriculumScenario,
  OutstandingScenario,
  TrainingArtefacts,
  TrainingCadence,
  TrainingGit,
  TrainingQuestion,
  TrainingRun,
  TrainingSummary,
} from '@/types';

const CADENCES: readonly TrainingCadence[] = [
  'once',
  'daily',
  'weekly',
  'monthly',
  'on-change',
  'on-demand',
];

/** How long a passing run keeps a scenario satisfied, by cadence. */
const DAY_MS = 24 * 60 * 60 * 1000;
const CADENCE_WINDOW_MS: Record<TrainingCadence, number | null> = {
  // `once`, `on-change` and `on-demand` are satisfied by any pass: the portal
  // cannot see the change or the request that would make them due again.
  once: null,
  'on-change': null,
  'on-demand': null,
  daily: DAY_MS,
  weekly: 7 * DAY_MS,
  monthly: 30 * DAY_MS,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Strings from an array field, ignoring anything that is not a usable string. */
function strList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : summariseItem(item)))
    .filter((item): item is string => Boolean(item));
}

/** A breach/limitation/change-request may arrive as an object; render its text. */
function summariseItem(item: unknown): string | undefined {
  if (!isRecord(item)) return undefined;
  return (
    str(item.message) ??
    str(item.detail) ??
    str(item.description) ??
    str(item.title) ??
    str(item.text) ??
    str(item.id)
  );
}

function parseQuestions(value: unknown): TrainingQuestion[] {
  if (!Array.isArray(value)) return [];
  const questions: TrainingQuestion[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const check = isRecord(raw.check) ? raw.check : undefined;
    const verifyRaw = isRecord(raw.verify) ? raw.verify : undefined;
    const verifyStatus = knownStatus(str(verifyRaw?.status));
    const verify = verifyStatus ? { kind: str(verifyRaw?.kind), status: verifyStatus } : undefined;
    const notes = strList(raw.notes);
    questions.push({
      id: str(raw.id),
      prompt: str(raw.prompt) ?? str(raw.question) ?? str(raw.q) ?? str(raw.text),
      // An action row (leave the call, boost on) has no answer check ("n/a");
      // its verification is the result
      status: knownStatus(str(check?.status) ?? str(raw.status)) ?? verify?.status,
      detail: str(check?.detail),
      verify,
      lag: num(raw.lag) ?? num(raw.lag_s) ?? num(raw.reply_s) ?? num(check?.lag),
      notes: notes.length > 0 ? notes : undefined,
    });
  }
  return questions;
}

/**
 * The harness leaves each question's lag null and publishes the reply times
 * as `totals.latencies_s`, one per question in order; use those when a
 * question has no lag of its own.
 */
function withLatencies(questions: TrainingQuestion[], totals: unknown): TrainingQuestion[] {
  const latencies = isRecord(totals) && Array.isArray(totals.latencies_s) ? totals.latencies_s : [];
  return questions.map((question, index) => {
    const latency = num(latencies[index]);
    return question.lag === undefined && latency !== undefined
      ? { ...question, lag: latency }
      : question;
  });
}

function knownStatus(value: string | undefined): 'pass' | 'fail' | 'skipped' | undefined {
  return value === 'pass' || value === 'fail' || value === 'skipped' ? value : undefined;
}

function parseTotals(value: unknown): Record<string, number> | undefined {
  if (!isRecord(value)) return undefined;
  const totals: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    const n = num(raw);
    if (n !== undefined) totals[key] = n;
  }
  return Object.keys(totals).length > 0 ? totals : undefined;
}

function parseGit(value: unknown): TrainingGit | undefined {
  if (!isRecord(value)) return undefined;
  const git: TrainingGit = {
    agentTraining: str(value.agent_training) ?? str(value.agentTraining),
    agentPresence: str(value.agent_presence) ?? str(value.agentPresence),
    agentRepo: str(value.agent_repo) ?? str(value.agentRepo),
  };
  return Object.values(git).some(Boolean) ? git : undefined;
}

function parseArtefacts(value: unknown): TrainingArtefacts | undefined {
  if (!isRecord(value)) return undefined;
  const artefacts: TrainingArtefacts = {
    reportMd: str(value.report_md) ?? str(value.reportMd),
    recording: str(value.recording),
    transcript: str(value.transcript),
  };
  return Object.values(artefacts).some(Boolean) ? artefacts : undefined;
}

/**
 * One run file into a `TrainingRun`. `json` is the parsed file, or its raw text
 * (parsed here). Anything that is not a JSON object — invalid JSON, an array, a
 * bare scalar — is warned about and skipped by returning `null`.
 */
export function parseTrainingRun(json: unknown, path: string): TrainingRun | null {
  let value = json;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      console.warn(`Training run ${path} is not valid JSON; skipping`);
      return null;
    }
  }
  if (!isRecord(value)) {
    console.warn(`Training run ${path} is not a JSON object; skipping`);
    return null;
  }

  const result = str(value.result)?.toLowerCase();
  return {
    path,
    result: result === 'pass' || result === 'fail' ? result : undefined,
    agent: str(value.agent),
    scenario: str(value.scenario),
    startedAt: str(value.started_at) ?? str(value.startedAt),
    mode: str(value.mode),
    source: str(value.source),
    runId: str(value.run_id) ?? str(value.runId),
    operator: str(value.operator),
    job: str(value.job),
    totals: parseTotals(value.totals),
    breaches: strList(value.breaches),
    limitations: strList(value.limitations),
    changeRequests: strList(value.change_requests ?? value.changeRequests),
    questions: withLatencies(parseQuestions(value.questions), value.totals),
    git: parseGit(value.git),
    artefacts: parseArtefacts(value.artefacts),
  };
}

/** Remove a trailing `# comment`, leaving `#` inside quotes alone. */
function stripComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i);
    }
  }
  return line;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  const first = trimmed[0];
  if (trimmed.length >= 2 && (first === '"' || first === "'") && trimmed.endsWith(first))
    return trimmed.slice(1, -1);
  return trimmed;
}

/** `[a, b]` (or `[]`) into its items. */
function flowList(value: string): string[] {
  return value
    .slice(1, -1)
    .split(',')
    .map(unquote)
    .filter((item) => item !== '');
}

interface Draft {
  id?: string;
  title?: string;
  agents: string[];
  cadence?: string;
  note?: string;
  requires?: string;
}

/** A folded (`>`) or literal (`|`) block scalar being collected line by line. */
interface BlockScalar {
  key: 'note' | 'requires';
  folded: boolean;
  lines: string[];
}

function finish(draft: Draft | null, into: CurriculumScenario[]): void {
  if (!draft?.id) return;
  const cadence = draft.cadence?.toLowerCase();
  into.push({
    id: draft.id,
    title: draft.title,
    agents: draft.agents,
    cadence: CADENCES.includes(cadence as TrainingCadence)
      ? (cadence as TrainingCadence)
      : // An absent or unrecognised cadence is treated as `once`: a single pass
        // satisfies it, so an unknown value never nags.
        'once',
    note: draft.note,
    requires: draft.requires,
  });
}

/**
 * `curriculum.yaml` at the root of the training repo. Deliberately a subset:
 * a `scenarios:` sequence of flat mappings (`id`, `title`, `agents`, `cadence`,
 * `note`, `requires`) where `agents` is a flow list (`[a, b]`) or a block
 * sequence and `note`/`requires` may be folded (`>`) or literal (`|`) block
 * scalars. Comments, blank lines and quoted scalars are handled; anything else
 * is ignored rather than pulling a YAML library into the bundle.
 */
export function parseCurriculum(yamlText: string): CurriculumScenario[] {
  const scenarios: CurriculumScenario[] = [];
  let inScenarios = false;
  let draft: Draft | null = null;
  let keyIndent = Number.MAX_SAFE_INTEGER;
  let listKey: 'agents' | null = null;
  let block: BlockScalar | null = null;
  const closeBlock = () => {
    if (block && draft) {
      const text = block.folded ? block.lines.join(' ') : block.lines.join('\n');
      draft[block.key] = text.trim() || undefined;
    }
    block = null;
  };

  for (const raw of yamlText.split(/\r?\n/)) {
    const rawIndent = raw.length - raw.trimStart().length;
    // Inside a block scalar every deeper-indented line is content, `#` included
    if (block && (raw.trim() === '' || rawIndent > keyIndent)) {
      block.lines.push(raw.trim());
      continue;
    }
    closeBlock();
    const line = stripComment(raw);
    if (line.trim() === '') continue;
    const indent = line.length - line.trimStart().length;
    const text = line.trim();

    if (!inScenarios) {
      if (/^scenarios:/.test(text)) inScenarios = true;
      continue;
    }

    const isItem = text === '-' || text.startsWith('- ');
    // A block-sequence entry at or past the indent of the current mapping's
    // keys belongs to the key that opened it (YAML allows `agents:` and its
    // `- x` entries at the same indent); an item further left starts a scenario.
    if (isItem && listKey && indent >= keyIndent) {
      const item = unquote(text.slice(1));
      if (item !== '') draft?.agents.push(item);
      continue;
    }
    if (isItem) {
      finish(draft, scenarios);
      draft = { agents: [] };
      keyIndent = Number.MAX_SAFE_INTEGER;
      listKey = null;
      const rest = text.slice(1).trim();
      if (rest === '') continue;
      keyIndent = indent + (line.trimStart().length - rest.length);
      block = applyKey(draft, rest, () => (listKey = 'agents'));
      continue;
    }
    if (!draft || indent === 0) {
      // Back at the top level: the scenarios block has ended.
      finish(draft, scenarios);
      draft = null;
      inScenarios = false;
      listKey = null;
      continue;
    }
    keyIndent = Math.min(keyIndent, indent);
    listKey = null;
    block = applyKey(draft, text, () => (listKey = 'agents'));
  }
  closeBlock();
  finish(draft, scenarios);
  return scenarios;
}

/**
 * Apply one `key: value` line to the scenario being built. Returns the block
 * scalar it opened when the value is a `>`/`|` indicator, for the caller to
 * fill from the following lines.
 */
function applyKey(draft: Draft, text: string, openAgentsList: () => void): BlockScalar | null {
  const match = text.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
  if (!match) return null;
  const [, key, rawValue] = match;
  const value = rawValue.trim();
  if (key === 'id') draft.id = unquote(value) || undefined;
  else if (key === 'title') draft.title = unquote(value) || undefined;
  else if (key === 'cadence') draft.cadence = unquote(value) || undefined;
  else if (key === 'agents') {
    if (value.startsWith('[') && value.endsWith(']')) draft.agents = flowList(value);
    else if (value === '') openAgentsList();
  } else if (key === 'note' || key === 'requires') {
    if (/^[>|][+-]?$/.test(value)) return { key, folded: value.startsWith('>'), lines: [] };
    draft[key] = unquote(value) || undefined;
  }
  return null;
}

/** Checks run, passed and failed for one run, plus how many breaches it raised. */
export function summariseRun(run: TrainingRun): TrainingSummary {
  const passed = run.questions.filter((q) => q.status === 'pass').length;
  const failed = run.questions.filter((q) => q.status === 'fail').length;
  // `totals.checks_run` is the harness's own count; the questions array is the
  // fallback when it did not publish one.
  const checksRun = run.totals?.checks_run ?? run.questions.length;
  return { checksRun, passed, failed, breaches: run.breaches.length };
}

function startedMs(run: TrainingRun): number {
  const ms = run.startedAt ? Date.parse(run.startedAt) : NaN;
  return Number.isNaN(ms) ? 0 : ms;
}

/** True when the scenario is required for this agent (no `agents` means all). */
export function scenarioAppliesTo(scenario: CurriculumScenario, agentId: string): boolean {
  if (scenario.agents.length === 0) return true;
  const id = agentId.toLowerCase();
  return scenario.agents.some((a) => a.toLowerCase() === id);
}

/**
 * Curriculum scenarios still due for the agent, in curriculum order, each with
 * why: never run, the most recent run failed, or the last pass is older than
 * the cadence allows. `runs` are that agent's runs, in any order.
 */
export function outstandingFor(
  agentId: string,
  runs: TrainingRun[],
  curriculum: CurriculumScenario[],
  now: Date = new Date()
): OutstandingScenario[] {
  const outstanding: OutstandingScenario[] = [];
  for (const scenario of curriculum) {
    if (!scenarioAppliesTo(scenario, agentId)) continue;

    const mine = runs
      .filter((run) => run.scenario?.toLowerCase() === scenario.id.toLowerCase())
      .sort((a, b) => startedMs(b) - startedMs(a));
    const latest = mine[0];
    if (!latest) {
      outstanding.push({ scenario, reason: 'never-run' });
      continue;
    }

    const lastRunAt = latest.startedAt;
    const lastPass = mine.find((run) => run.result === 'pass');
    const lastPassAt = lastPass?.startedAt;
    if (latest.result !== 'pass') {
      outstanding.push({ scenario, reason: 'last-failed', lastRunAt, lastPassAt });
      continue;
    }

    const window = CADENCE_WINDOW_MS[scenario.cadence];
    if (window === null) continue;
    const passedAt = startedMs(latest);
    if (now.getTime() - passedAt > window)
      outstanding.push({ scenario, reason: 'overdue', lastRunAt, lastPassAt });
  }
  return outstanding;
}

/** Runs newest first; runs with no readable `started_at` sort last. */
export function sortRuns(runs: TrainingRun[]): TrainingRun[] {
  return [...runs].sort((a, b) => startedMs(b) - startedMs(a));
}
