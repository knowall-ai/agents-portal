// Pure cost aggregation: turns provider rows into per-agent breakdowns.
import type {
  AgentDetail,
  AgentRegistryEntry,
  CostLine,
  CostPeriod,
  CostSourceStatus,
  CurrencyTotals,
  AgentCosts,
} from '@/types';
import type { AzureCostRow, LlmCostRow, Timeframe } from '@/lib/providers/costs';

export interface CostInputs {
  azure: Record<Timeframe, AzureCostRow[]>;
  openai: Record<Timeframe, LlmCostRow[]>;
  anthropic: Record<Timeframe, LlmCostRow[]>;
  sources: CostSourceStatus[];
}

export function sumByCurrency(lines: CostLine[]): CurrencyTotals {
  const totals: CurrencyTotals = {};
  for (const line of lines) {
    totals[line.currency] = (totals[line.currency] ?? 0) + line.amount;
  }
  for (const key of Object.keys(totals)) totals[key] = Math.round(totals[key] * 100) / 100;
  return totals;
}

export function addTotals(into: CurrencyTotals, from: CurrencyTotals): CurrencyTotals {
  for (const [currency, amount] of Object.entries(from)) {
    into[currency] = Math.round(((into[currency] ?? 0) + amount) * 100) / 100;
  }
  return into;
}

function period(lines: CostLine[]): CostPeriod {
  const rounded = lines
    .filter((l) => l.amount !== 0)
    .map((l) => ({ ...l, amount: Math.round(l.amount * 100) / 100 }))
    .sort((a, b) => a.source.localeCompare(b.source) || b.amount - a.amount);
  return { lines: rounded, totals: sumByCurrency(rounded) };
}

function linesFor(
  agent: AgentDetail,
  entry: AgentRegistryEntry | undefined,
  inputs: CostInputs,
  timeframe: Timeframe,
  includeFixed: boolean
): CostLine[] {
  const lines: CostLine[] = [];
  const groups = new Set(agent.resourceGroups.map((g) => g.toLowerCase()));
  const subscriptions = new Set(agent.resources.map((r) => r.subscriptionId));

  for (const row of inputs.azure[timeframe]) {
    if (!groups.has(row.resourceGroup) || !subscriptions.has(row.subscriptionId)) continue;
    lines.push({ source: 'azure', label: row.service, amount: row.amount, currency: row.currency });
  }

  const openaiProject = agent.openaiProjectId ?? entry?.openaiProjectId;
  if (openaiProject) {
    for (const row of inputs.openai[timeframe]) {
      if (row.groupId !== openaiProject) continue;
      lines.push({
        source: 'openai',
        label: 'OpenAI API usage',
        amount: row.amount,
        currency: row.currency,
      });
    }
  }

  const anthropicWorkspace = agent.anthropicWorkspaceId ?? entry?.anthropicWorkspaceId;
  if (anthropicWorkspace) {
    for (const row of inputs.anthropic[timeframe]) {
      if (row.groupId !== anthropicWorkspace) continue;
      lines.push({
        source: 'anthropic',
        label: 'Anthropic API usage',
        amount: row.amount,
        currency: row.currency,
      });
    }
  }

  if (includeFixed) {
    for (const fixed of entry?.fixedCosts ?? []) {
      lines.push({
        source: 'fixed',
        label: fixed.label,
        amount: fixed.amount,
        currency: fixed.currency,
      });
    }
  }
  return lines;
}

/** Per-agent breakdown for the current and previous calendar month. */
export function buildAgentCosts(
  agent: AgentDetail,
  entry: AgentRegistryEntry | undefined,
  inputs: CostInputs,
  now = new Date()
): AgentCosts {
  const sources: CostSourceStatus[] = inputs.sources.map((s) => {
    if (
      s.source === 'openai' &&
      s.status === 'ok' &&
      !(agent.openaiProjectId ?? entry?.openaiProjectId)
    ) {
      return {
        ...s,
        status: 'no-mapping',
        detail:
          'Tag a resource agent-openai-project=proj_… (or set openaiProjectId in the registry)',
      };
    }
    if (
      s.source === 'anthropic' &&
      s.status === 'ok' &&
      !(agent.anthropicWorkspaceId ?? entry?.anthropicWorkspaceId)
    ) {
      return {
        ...s,
        status: 'no-mapping',
        detail:
          'Tag a resource agent-anthropic-workspace=wrkspc_… (or set anthropicWorkspaceId in the registry)',
      };
    }
    return s;
  });
  if (entry?.fixedCosts?.length) sources.push({ source: 'fixed', status: 'ok' });

  return {
    agentId: agent.id,
    monthToDate: period(linesFor(agent, entry, inputs, 'MonthToDate', true)),
    lastMonth: period(linesFor(agent, entry, inputs, 'TheLastMonth', true)),
    sources,
    generatedAt: now.toISOString(),
  };
}
