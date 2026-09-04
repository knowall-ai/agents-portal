'use client';

import { Cloud, Brain, Sparkles, Receipt, AlertTriangle, Info } from 'lucide-react';
import { EmptyState, LoadingSpinner } from '@/components/common';
import { formatMoney, formatTotals } from '@/lib/format';
import type { AgentCosts, CostLine, CostSource, CostSourceStatus } from '@/types';

const sourceLabel: Record<CostSource, string> = {
  azure: 'Azure',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  fixed: 'Subscriptions',
};

const sourceIcon: Record<CostSource, React.ReactNode> = {
  azure: <Cloud size={14} />,
  openai: <Sparkles size={14} />,
  anthropic: <Brain size={14} />,
  fixed: <Receipt size={14} />,
};

interface CostBreakdownProps {
  costs: AgentCosts | null;
  isLoading: boolean;
  error?: string | null;
}

function findLine(lines: CostLine[], line: CostLine): CostLine | undefined {
  return lines.find(
    (l) => l.source === line.source && l.label === line.label && l.currency === line.currency
  );
}

export default function CostBreakdown({ costs, isLoading, error }: CostBreakdownProps) {
  if (isLoading && !costs) return <LoadingSpinner className="py-8" message="Loading costs..." />;
  if (error && !costs) return <EmptyState title="Could not load costs" description={error} />;
  if (!costs) return null;

  // Union of lines across both periods so every row shows both columns
  const rows: CostLine[] = [...costs.monthToDate.lines];
  for (const line of costs.lastMonth.lines) {
    if (!findLine(rows, line)) rows.push({ ...line, amount: 0 });
  }
  rows.sort((a, b) => a.source.localeCompare(b.source) || b.amount - a.amount);

  const problems = costs.sources.filter((s) => s.status !== 'ok');
  const azureFailed = costs.sources.some((s) => s.source === 'azure' && s.status === 'error');

  return (
    <div>
      {rows.length === 0 ? (
        <EmptyState
          icon={azureFailed ? <AlertTriangle size={28} /> : <Receipt size={28} />}
          title={
            azureFailed
              ? 'Azure costs unavailable right now'
              : 'No costs recorded this month or last'
          }
          description={
            azureFailed
              ? 'The Azure cost lookup failed — details below. Refresh in a couple of minutes.'
              : 'Azure costs appear once Cost Management has processed usage (up to 24 hours).'
          }
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="table-header">
              <tr className="text-left text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
                <th className="px-4 py-2 font-medium">Source</th>
                <th className="px-4 py-2 font-medium">Item</th>
                <th className="px-4 py-2 text-right font-medium">Month to date</th>
                <th className="px-4 py-2 text-right font-medium">Last month</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((line) => {
                const last = findLine(costs.lastMonth.lines, line);
                return (
                  <tr key={`${line.source}:${line.label}:${line.currency}`} className="table-row">
                    <td
                      className="px-4 py-2 whitespace-nowrap"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      <span className="flex items-center gap-2">
                        {sourceIcon[line.source]}
                        {sourceLabel[line.source]}
                      </span>
                    </td>
                    <td className="px-4 py-2" style={{ color: 'var(--text-primary)' }}>
                      {line.label}
                    </td>
                    <td
                      className="px-4 py-2 text-right font-mono"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {line.amount ? formatMoney(line.amount, line.currency) : '—'}
                    </td>
                    <td
                      className="px-4 py-2 text-right font-mono"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      {last ? formatMoney(last.amount, last.currency) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="table-header font-semibold">
                <td className="px-4 py-2" colSpan={2} style={{ color: 'var(--text-primary)' }}>
                  Total
                </td>
                <td className="px-4 py-2 text-right font-mono" style={{ color: 'var(--primary)' }}>
                  {formatTotals(costs.monthToDate.totals)}
                </td>
                <td
                  className="px-4 py-2 text-right font-mono"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {formatTotals(costs.lastMonth.totals)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {problems.length > 0 && (
        <ul
          className="space-y-1 border-t p-4 text-xs"
          style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
        >
          {problems.map((s: CostSourceStatus) => (
            <li key={s.source} className="flex items-start gap-2">
              {s.status === 'error' ? (
                <AlertTriangle
                  size={12}
                  className="mt-0.5 shrink-0"
                  style={{ color: 'var(--status-degraded)' }}
                />
              ) : (
                <Info size={12} className="mt-0.5 shrink-0" />
              )}
              <span>
                <strong style={{ color: 'var(--text-secondary)' }}>{sourceLabel[s.source]}:</strong>{' '}
                {s.status === 'not-configured' && 'not configured'}
                {s.status === 'no-mapping' && 'not linked to this agent'}
                {s.status === 'error' && 'lookup failed'}
                {s.detail && ` — ${s.detail}`}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="px-4 pb-3 text-[11px]" style={{ color: 'var(--text-muted)' }}>
        Figures are shown in each provider&apos;s billing currency and are not converted. Azure
        costs lag usage by up to 24 hours.
      </p>
    </div>
  );
}
