import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentDetail } from '@/types';

// Only the network-calling providers and the token exchange are stubbed;
// the service's own caching and error handling run for real.
vi.mock('@/lib/providers/azure', () => ({
  findVm: vi.fn(),
  listActivityLog: vi.fn(),
  listAgentResources: vi.fn(),
  listRoleAssignments: vi.fn(),
  listSubscriptions: vi.fn(),
  runVmScript: vi.fn(),
}));
vi.mock('@/lib/providers/graph', () => ({
  getAppAccess: vi.fn(),
  getUserAccess: vi.fn(),
  getUserLicensing: vi.fn(),
  getUserPresence: vi.fn(),
}));
// Real scope constants, so a change to them cannot pass unnoticed here
vi.mock('@/lib/tokens', async (actual) => ({
  ...(await actual<typeof import('@/lib/tokens')>()),
  getResourceToken: vi.fn(),
}));

const { getUserPresence } = await import('@/lib/providers/graph');
const { getResourceToken } = await import('@/lib/tokens');
const { getPresence } = await import('./service');
const { invalidate } = await import('@/lib/cache');

const ctx = { armToken: 'arm', refreshToken: 'refresh', tenantId: 't', userId: 'u' };

const agent = (id: string, teamsUpn?: string): AgentDetail =>
  ({
    id,
    name: id,
    kind: 'openclaw',
    customer: 'KnowAll',
    environment: 'prod',
    status: 'online',
    statusReason: '',
    resourceGroups: ['rg'],
    delegated: false,
    resourceCount: 1,
    source: 'tags',
    teamsUpn,
    resources: [],
    foundryProjects: [],
  }) as unknown as AgentDetail;

describe('getPresence', () => {
  beforeEach(() => {
    vi.mocked(getUserPresence).mockReset();
    vi.mocked(getResourceToken).mockReset();
    invalidate('presence:');
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('says so, without calling Graph, when the agent has no Teams account', async () => {
    const presence = await getPresence(ctx, agent('no-account'));
    expect(presence.onCall).toBe(false);
    expect(presence.availability).toBe('PresenceUnknown');
    expect(presence.error).toMatch(/agent-teams-upn/);
    expect(vi.mocked(getResourceToken)).not.toHaveBeenCalled();
  });

  it('says so when Presence.Read.All has not been consented', async () => {
    vi.mocked(getResourceToken).mockResolvedValue(null);
    const presence = await getPresence(ctx, agent('no-consent', 'agent-account'));
    expect(presence.onCall).toBe(false);
    expect(presence.error).toMatch(/Presence\.Read\.All/);
    expect(vi.mocked(getUserPresence)).not.toHaveBeenCalled();
  });

  it('reads the call activity from Graph', async () => {
    vi.mocked(getResourceToken).mockResolvedValue('graph-token');
    vi.mocked(getUserPresence).mockResolvedValue({
      availability: 'Busy',
      activity: 'InACall',
    });
    const presence = await getPresence(ctx, agent('busy', 'agent-account'));
    expect(presence).toMatchObject({ availability: 'Busy', activity: 'InACall', onCall: true });
    expect(presence.error).toBeUndefined();
  });

  it('throws a Graph failure with a cold cache, so the route can answer 502', async () => {
    vi.mocked(getResourceToken).mockResolvedValue('graph-token');
    vi.mocked(getUserPresence).mockRejectedValue(new Error('Graph 503 presence lookup'));
    await expect(getPresence(ctx, agent('cold-failure', 'agent-account'))).rejects.toThrow(
      'Graph 503 presence lookup'
    );
  });

  it('serves the last good reading when a later poll fails', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T10:00:00Z'));
    vi.mocked(getResourceToken).mockResolvedValue('graph-token');
    vi.mocked(getUserPresence).mockResolvedValue({
      availability: 'Busy',
      activity: 'InACall',
    });
    const first = await getPresence(ctx, agent('flaky', 'agent-account'));
    expect(first.onCall).toBe(true);

    // Past the 20 s TTL, so the loader runs again — and fails
    vi.setSystemTime(new Date('2026-01-01T10:00:30Z'));
    vi.mocked(getUserPresence).mockRejectedValue(new Error('Graph 503 presence lookup'));
    await expect(getPresence(ctx, agent('flaky', 'agent-account'))).resolves.toEqual(first);
  });
});
