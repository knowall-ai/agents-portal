import { describe, expect, it } from 'vitest';
import type { AgentDetail } from '@/types';
import { buildAgentCosts, sumByCurrency } from './costs';
import { monthWindows } from '@/lib/providers/costs';

const agent = {
  id: 'sallie',
  resourceGroups: ['ka-agents'],
  resources: [{ subscriptionId: 'sub', resourceGroup: 'ka-agents' }],
} as unknown as AgentDetail;

const inputs = {
  azure: {
    MonthToDate: [
      {
        subscriptionId: 'sub',
        resourceGroup: 'ka-agents',
        service: 'Virtual Machines',
        amount: 14.671,
        currency: 'GBP',
      },
      {
        subscriptionId: 'sub',
        resourceGroup: 'ka-agents',
        service: 'Storage',
        amount: 1.96,
        currency: 'GBP',
      },
      {
        subscriptionId: 'sub',
        resourceGroup: 'other',
        service: 'Storage',
        amount: 99,
        currency: 'GBP',
      },
      {
        subscriptionId: 'other-sub',
        resourceGroup: 'ka-agents',
        service: 'Storage',
        amount: 50,
        currency: 'GBP',
      },
    ],
    TheLastMonth: [
      {
        subscriptionId: 'sub',
        resourceGroup: 'ka-agents',
        service: 'Virtual Machines',
        amount: 40,
        currency: 'GBP',
      },
    ],
  },
  openai: {
    MonthToDate: [
      { groupId: 'proj_sallie', amount: 12.5, currency: 'USD' },
      { groupId: 'proj_other', amount: 100, currency: 'USD' },
    ],
    TheLastMonth: [],
  },
  anthropic: {
    MonthToDate: [{ groupId: 'wrkspc_s', amount: 3.25, currency: 'USD' }],
    TheLastMonth: [],
  },
  sources: [
    { source: 'azure' as const, status: 'ok' as const },
    { source: 'openai' as const, status: 'ok' as const },
    { source: 'anthropic' as const, status: 'not-configured' as const },
  ],
};

describe('buildAgentCosts', () => {
  it('attributes Azure rows by resource group and subscription only', () => {
    const costs = buildAgentCosts(agent, undefined, inputs);
    const azure = costs.monthToDate.lines.filter((l) => l.source === 'azure');
    expect(azure.map((l) => l.label)).toEqual(['Virtual Machines', 'Storage']);
    expect(costs.monthToDate.totals).toEqual({ GBP: 16.63 });
    expect(costs.lastMonth.totals).toEqual({ GBP: 40 });
  });

  it('adds LLM spend only for mapped projects/workspaces and keeps currencies separate', () => {
    const costs = buildAgentCosts(
      agent,
      {
        id: 'sallie',
        name: 'Sallie',
        openaiProjectId: 'proj_sallie',
        fixedCosts: [{ label: 'ChatGPT', amount: 20, currency: 'USD' }],
      },
      inputs
    );
    expect(costs.monthToDate.totals).toEqual({ GBP: 16.63, USD: 32.5 });
    expect(costs.monthToDate.lines.find((l) => l.source === 'fixed')?.label).toBe('ChatGPT');
    expect(costs.monthToDate.lines.some((l) => l.source === 'anthropic')).toBe(false);
  });

  it('reports no-mapping when a provider is configured but the agent is not linked', () => {
    const costs = buildAgentCosts(agent, undefined, inputs);
    expect(costs.sources.find((s) => s.source === 'openai')?.status).toBe('no-mapping');
    expect(costs.sources.find((s) => s.source === 'anthropic')?.status).toBe('not-configured');
  });
});

describe('helpers', () => {
  it('sums by currency with rounding', () => {
    expect(
      sumByCurrency([
        { source: 'azure', label: 'a', amount: 0.1, currency: 'GBP' },
        { source: 'azure', label: 'b', amount: 0.2, currency: 'GBP' },
        { source: 'openai', label: 'c', amount: 1, currency: 'USD' },
      ])
    ).toEqual({ GBP: 0.3, USD: 1 });
  });
  it('builds UTC calendar-month windows', () => {
    const w = monthWindows(new Date('2026-09-04T10:00:00Z'));
    expect(w.MonthToDate.start.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(w.TheLastMonth.start.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(w.TheLastMonth.end.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });
});
