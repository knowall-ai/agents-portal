// Cost providers: Azure Cost Management, OpenAI and Anthropic admin billing APIs.
//
// All three report per calendar month. Azure is queried with the user's own ARM
// token (Cost Management Reader or better on the subscription). OpenAI and
// Anthropic need organisation admin keys held by the server; their spend is
// attributed to agents through openaiProjectId / anthropicWorkspaceId in the
// registry. Amounts are kept in their native currency — nothing is converted.

export type Timeframe = 'MonthToDate' | 'TheLastMonth';

export interface AzureCostRow {
  subscriptionId: string;
  resourceGroup: string;
  service: string;
  amount: number;
  currency: string;
}

export interface Window {
  start: Date;
  end: Date;
}

/** UTC calendar-month windows: [1st of this month, now) and [1st of last month, 1st of this month). */
export function monthWindows(now = new Date()): Record<Timeframe, Window> {
  const thisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return {
    MonthToDate: { start: thisMonth, end: now },
    TheLastMonth: { start: lastMonth, end: thisMonth },
  };
}

/**
 * Retry on 429, honouring the longest back-off the service asks for. Cost
 * Management throttles third-party client apps to roughly one query every
 * 25–40 s and reports it in its own headers rather than Retry-After alone.
 */
async function fetchWithRetry(url: string, init: RequestInit, retries = 3): Promise<Response> {
  let response = await fetch(url, init);
  for (let attempt = 0; attempt < retries && response.status === 429; attempt++) {
    const seconds = [
      'Retry-After',
      'x-ms-ratelimit-microsoft.costmanagement-clienttype-retry-after',
      'x-ms-ratelimit-microsoft.costmanagement-entity-retry-after',
      'x-ms-ratelimit-microsoft.costmanagement-tenant-retry-after',
    ]
      .map((h) => Number(response.headers.get(h) ?? '0'))
      .filter((n) => Number.isFinite(n) && n > 0);
    const waitMs = Math.min(Math.max(...seconds, 5) * 1000 + 1_000, 60_000);
    console.warn(
      `429 from ${new URL(url).host}; waiting ${waitMs / 1000}s (attempt ${attempt + 1}/${retries})`
    );
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    response = await fetch(url, init);
  }
  return response;
}

// Cost Management rejects concurrent queries from the same principal with 429,
// so calls are serialised through one queue per server process.
let costQueue: Promise<unknown> = Promise.resolve();
function serialised<T>(task: () => Promise<T>): Promise<T> {
  const run = costQueue.then(task, task);
  costQueue = run.catch(() => undefined);
  return run;
}

// ---------------------------------------------------------------------------
// Azure Cost Management
// ---------------------------------------------------------------------------

interface CostQueryResponse {
  properties: {
    columns: { name: string; type: string }[];
    rows: (string | number)[][];
    nextLink?: string | null;
  };
}

/** Actual cost for one subscription, grouped by resource group and service. */
export async function queryAzureCosts(
  armToken: string,
  subscriptionId: string,
  timeframe: Timeframe,
  now = new Date()
): Promise<AzureCostRow[]> {
  // Cost Management rejects timeframe "TheLastMonth" ("currently not supported"),
  // so previous months are asked for as an explicit Custom period.
  const window = monthWindows(now)[timeframe];
  const lastDay = new Date(window.end.getTime() - 1);
  const body = {
    type: 'ActualCost',
    ...(timeframe === 'MonthToDate'
      ? { timeframe: 'MonthToDate' }
      : {
          timeframe: 'Custom',
          timePeriod: {
            from: window.start.toISOString(),
            to: `${lastDay.toISOString().slice(0, 10)}T23:59:59Z`,
          },
        }),
    dataset: {
      granularity: 'None',
      aggregation: { totalCost: { name: 'Cost', function: 'Sum' } },
      grouping: [
        { type: 'Dimension', name: 'ResourceGroupName' },
        { type: 'Dimension', name: 'ServiceName' },
      ],
    },
  };

  return serialised(() => runCostQuery(armToken, subscriptionId, body));
}

async function runCostQuery(
  armToken: string,
  subscriptionId: string,
  body: Record<string, unknown>
): Promise<AzureCostRow[]> {
  const rows: AzureCostRow[] = [];
  let url: string | null | undefined =
    `https://management.azure.com/subscriptions/${subscriptionId}/providers/Microsoft.CostManagement/query?api-version=2023-11-01`;

  while (url) {
    const response = await fetchWithRetry(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${armToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      const text = await response.text();
      if (response.status === 429) {
        throw new Error(
          'Azure Cost Management is rate limiting requests (429); it will be retried in a few minutes'
        );
      }
      let message = text.slice(0, 200);
      try {
        message = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? message;
      } catch {
        // keep raw text
      }
      throw new Error(`Cost Management ${response.status}: ${message}`);
    }
    const data = (await response.json()) as CostQueryResponse;
    const col = (name: string) =>
      data.properties.columns.findIndex((c) => c.name.toLowerCase() === name.toLowerCase());
    const iCost = col('Cost');
    const iGroup = col('ResourceGroupName');
    const iService = col('ServiceName');
    const iCurrency = col('Currency');
    for (const row of data.properties.rows) {
      rows.push({
        subscriptionId,
        resourceGroup: String(row[iGroup] ?? '').toLowerCase(),
        service: String(row[iService] ?? 'Other'),
        amount: Number(row[iCost] ?? 0),
        currency: String(row[iCurrency] ?? 'USD'),
      });
    }
    url = data.properties.nextLink;
  }
  return rows;
}

// ---------------------------------------------------------------------------
// OpenAI — GET /v1/organization/costs (admin key), grouped by project
// ---------------------------------------------------------------------------

export interface LlmCostRow {
  /** Project (OpenAI) or workspace (Anthropic) id; empty string when unattributed */
  groupId: string;
  amount: number;
  currency: string;
}

interface OpenAICostsPage {
  data: {
    results: { amount: { value: number; currency: string }; project_id: string | null }[];
  }[];
  has_more: boolean;
  next_page: string | null;
}

export async function fetchOpenAICosts(window: Window, adminKey: string): Promise<LlmCostRow[]> {
  const totals = new Map<string, LlmCostRow>();
  let page: string | null = null;
  do {
    const params = new URLSearchParams({
      start_time: String(Math.floor(window.start.getTime() / 1000)),
      end_time: String(Math.floor(window.end.getTime() / 1000)),
      bucket_width: '1d',
      limit: '31',
    });
    params.append('group_by', 'project_id');
    if (page) params.set('page', page);

    const response = await fetchWithRetry(
      `https://api.openai.com/v1/organization/costs?${params}`,
      {
        headers: { Authorization: `Bearer ${adminKey}` },
        signal: AbortSignal.timeout(30_000),
      }
    );
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI costs ${response.status}: ${text.slice(0, 200)}`);
    }
    const body = (await response.json()) as OpenAICostsPage;
    for (const bucket of body.data) {
      for (const result of bucket.results) {
        const key = result.project_id ?? '';
        const currency = (result.amount.currency || 'usd').toUpperCase();
        const existing = totals.get(key) ?? { groupId: key, amount: 0, currency };
        existing.amount += result.amount.value;
        totals.set(key, existing);
      }
    }
    page = body.has_more ? body.next_page : null;
  } while (page);
  return [...totals.values()];
}

// ---------------------------------------------------------------------------
// Anthropic — GET /v1/organizations/cost_report (admin key), grouped by workspace
// ---------------------------------------------------------------------------

interface AnthropicCostPage {
  data: {
    results: { amount: string; currency: string; workspace_id: string | null }[];
  }[];
  has_more: boolean;
  next_page: string | null;
}

export async function fetchAnthropicCosts(window: Window, adminKey: string): Promise<LlmCostRow[]> {
  const totals = new Map<string, LlmCostRow>();
  let page: string | null = null;
  do {
    const params = new URLSearchParams({
      starting_at: window.start.toISOString(),
      ending_at: window.end.toISOString(),
      bucket_width: '1d',
      limit: '31',
    });
    params.append('group_by[]', 'workspace_id');
    if (page) params.set('page', page);

    const response = await fetchWithRetry(
      `https://api.anthropic.com/v1/organizations/cost_report?${params}`,
      {
        headers: { 'x-api-key': adminKey, 'anthropic-version': '2023-06-01' },
        signal: AbortSignal.timeout(30_000),
      }
    );
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Anthropic cost report ${response.status}: ${text.slice(0, 200)}`);
    }
    const body = (await response.json()) as AnthropicCostPage;
    for (const bucket of body.data) {
      for (const result of bucket.results) {
        const key = result.workspace_id ?? '';
        const currency = (result.currency || 'USD').toUpperCase();
        const existing = totals.get(key) ?? { groupId: key, amount: 0, currency };
        existing.amount += Number(result.amount);
        totals.set(key, existing);
      }
    }
    page = body.has_more ? body.next_page : null;
  } while (page);
  return [...totals.values()];
}
