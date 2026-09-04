import type { CurrencyTotals } from '@/types';

const formatters = new Map<string, Intl.NumberFormat>();

export function formatMoney(amount: number, currency: string): string {
  let fmt = formatters.get(currency);
  if (!fmt) {
    try {
      fmt = new Intl.NumberFormat('en-GB', {
        style: 'currency',
        currency,
        maximumFractionDigits: 2,
      });
    } catch {
      fmt = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 });
    }
    formatters.set(currency, fmt);
  }
  return fmt.format(amount);
}

/** "£31.20 · $12.40" — one figure per currency, never converted. */
export function formatTotals(totals: CurrencyTotals, emptyText = '—'): string {
  const parts = Object.entries(totals)
    .filter(([, amount]) => amount !== 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, amount]) => formatMoney(amount, currency));
  return parts.length ? parts.join(' · ') : emptyText;
}
