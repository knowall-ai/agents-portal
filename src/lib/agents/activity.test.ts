import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActivityEvent, AgentDetail } from '@/types';

// Only the network-calling providers and the token exchange are stubbed; the
// service's own fan-out, per-source error handling and sorting run for real.
vi.mock('@/lib/providers/azure', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/providers/azure')>()),
  listActivityLog: vi.fn(),
}));
vi.mock('@/lib/providers/github', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/providers/github')>()),
  listRepoCommits: vi.fn(),
}));
vi.mock('@/lib/providers/foundry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/providers/foundry')>()),
  listAssistants: vi.fn(),
  listRecentRuns: vi.fn(),
}));
vi.mock('@/lib/tokens', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tokens')>()),
  getResourceToken: vi.fn(),
}));

const { listActivityLog } = await import('@/lib/providers/azure');
const { listRepoCommits } = await import('@/lib/providers/github');
const { listAssistants, listRecentRuns } = await import('@/lib/providers/foundry');
const { getResourceToken } = await import('@/lib/tokens');
const { getActivity } = await import('./service');

const ctx = {
  armToken: 'arm',
  refreshToken: 'refresh',
  tenantId: 't',
  userId: 'u',
  roles: [] as string[],
  isAdmin: true,
};

/** Two resource groups, a repo and a Foundry project: all three sources are asked. */
const agent = (id: string): AgentDetail =>
  ({
    id,
    name: id,
    repo: 'knowall-ai/agent',
    resources: [
      { subscriptionId: 'sub-1', resourceGroup: 'rg-a' },
      { subscriptionId: 'sub-1', resourceGroup: 'rg-b' },
    ],
    foundryProjects: [{ endpoint: 'https://foundry.example', name: 'proj' }],
  }) as unknown as AgentDetail;

const event = (source: ActivityEvent['source'], timestamp: string): ActivityEvent => ({
  id: `${source}-${timestamp}`,
  agentId: 'a',
  agentName: 'a',
  timestamp,
  source,
  title: source,
  level: 'info',
});

const azureEvent = event('azure', '2026-01-02T00:00:00Z');
const githubEvent = event('github', '2026-01-03T00:00:00Z');
const foundryEvent = event('foundry', '2026-01-01T00:00:00Z');

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.mocked(listActivityLog).mockReset().mockResolvedValue([azureEvent]);
  vi.mocked(listRepoCommits).mockReset().mockResolvedValue([githubEvent]);
  vi.mocked(listRecentRuns).mockReset().mockResolvedValue([foundryEvent]);
  vi.mocked(listAssistants).mockReset().mockResolvedValue([]);
  vi.mocked(getResourceToken).mockReset().mockResolvedValue('foundry-token');
});

describe('getActivity', () => {
  it('merges every source and sorts newest first', async () => {
    const events = await getActivity(ctx, agent('all-sources'));

    // One Azure call per resource group, plus GitHub and Foundry
    expect(listActivityLog).toHaveBeenCalledTimes(2);
    expect(events.map((e) => e.source)).toEqual([
      'github',
      'azure',
      'azure',
      'foundry',
      // both resource groups answered
    ]);
    expect(events.map((e) => e.timestamp)).toEqual(
      [...events.map((e) => e.timestamp)].sort().reverse()
    );
  });

  it('still renders the other sources when the Azure activity log fails', async () => {
    vi.mocked(listActivityLog).mockRejectedValue(new Error('ARM 429 throttled'));

    const events = await getActivity(ctx, agent('azure-down'));

    expect(events.map((e) => e.source)).toEqual(['github', 'foundry']);
  });

  it('still renders the other sources when GitHub fails', async () => {
    vi.mocked(listRepoCommits).mockRejectedValue(new Error('GitHub 401'));

    const events = await getActivity(ctx, agent('github-down'));

    expect(events.map((e) => e.source)).toEqual(['azure', 'azure', 'foundry']);
  });

  it('still renders the other sources when Foundry fails', async () => {
    vi.mocked(listRecentRuns).mockRejectedValue(new Error('Foundry 503'));

    const events = await getActivity(ctx, agent('foundry-down'));

    expect(events.map((e) => e.source)).toEqual(['github', 'azure', 'azure']);
  });

  it('skips Foundry when the scope has not been consented, and skips GitHub with no repo', async () => {
    vi.mocked(getResourceToken).mockResolvedValue(null);
    const noRepo = { ...agent('no-repo'), repo: undefined } as AgentDetail;

    const events = await getActivity(ctx, noRepo);

    expect(events.map((e) => e.source)).toEqual(['azure', 'azure']);
    expect(listRepoCommits).not.toHaveBeenCalled();
    expect(listRecentRuns).not.toHaveBeenCalled();
  });

  it('returns nothing, without failing, when every source is down', async () => {
    vi.mocked(listActivityLog).mockRejectedValue(new Error('ARM 500'));
    vi.mocked(listRepoCommits).mockRejectedValue(new Error('GitHub 500'));
    vi.mocked(listRecentRuns).mockRejectedValue(new Error('Foundry 500'));

    await expect(getActivity(ctx, agent('all-down'))).resolves.toEqual([]);
  });
});
