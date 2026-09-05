import { beforeEach, describe, expect, it, vi } from 'vitest';
import { azureAvatarPath, isDefaultBotIcon } from './discover';
import type { AgentDetail, AzureResource } from '@/types';

// Only the two network-calling providers and the token exchange are stubbed;
// everything else in the service runs for real.
vi.mock('@/lib/providers/azure', () => ({
  findVm: vi.fn(),
  getBotIconUrl: vi.fn(),
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
  getUserPhoto: vi.fn(),
}));
vi.mock('@/lib/tokens', () => ({
  FOUNDRY_SCOPE: 'foundry',
  GRAPH_DIRECTORY_SCOPE: 'user-read-all',
  GRAPH_DIRECTORY_READ_ALL_SCOPE: 'directory-read-all',
  getResourceToken: vi.fn(),
}));

const { getBotIconUrl } = await import('@/lib/providers/azure');
const { getUserPhoto } = await import('@/lib/providers/graph');
const { getResourceToken } = await import('@/lib/tokens');
const { getAvatar } = await import('./service');
const { invalidate } = await import('@/lib/cache');

const resource = (type: string): AzureResource => ({
  id: `/subscriptions/s/resourceGroups/rg/providers/${type}/x`,
  name: 'x',
  type,
  location: 'uksouth',
  resourceGroup: 'rg',
  subscriptionId: 's',
  tenantId: 't',
  tags: {},
  state: 'running',
});

describe('isDefaultBotIcon', () => {
  it('treats the Bot Framework placeholder, nothing and junk as no icon', () => {
    expect(
      isDefaultBotIcon(
        'https://docs.botframework.com/static/devportal/client/images/bot-framework-default.png'
      )
    ).toBe(true);
    expect(isDefaultBotIcon(undefined)).toBe(true);
    expect(isDefaultBotIcon('not a url')).toBe(true);
  });
  it('keeps an icon the owner set', () => {
    expect(isDefaultBotIcon('https://example.blob.core.windows.net/icons/winnie.png')).toBe(false);
  });
});

describe('azureAvatarPath', () => {
  it('points at the avatar route when there is a bot or an account to read', () => {
    expect(azureAvatarPath('winnie-dev', [resource('microsoft.botservice/botservices')])).toBe(
      '/api/agents/winnie-dev/avatar'
    );
    expect(
      azureAvatarPath('sallie', [resource('microsoft.compute/virtualmachines')], 'sallie')
    ).toBe('/api/agents/sallie/avatar');
  });
  it('gives nothing when the agent has neither', () => {
    expect(azureAvatarPath('planned', [])).toBeUndefined();
    expect(
      azureAvatarPath('vm-only', [resource('microsoft.compute/virtualmachines')])
    ).toBeUndefined();
  });
});

describe('getAvatar', () => {
  const ctx = {
    armToken: 'arm',
    refreshToken: 'refresh',
    tenantId: 't',
    userId: 'u',
    roles: [] as string[],
    isAdmin: true,
  };
  const agent = (id: string, over: Partial<AgentDetail> = {}): AgentDetail =>
    ({
      id,
      name: id,
      kind: 'botframework',
      customer: 'KnowAll',
      environment: 'prod',
      status: 'online',
      statusReason: '',
      resourceGroups: ['rg'],
      delegated: false,
      resourceCount: 1,
      source: 'tags',
      resources: [resource('microsoft.botservice/botservices')],
      foundryProjects: [],
      ...over,
    }) as AgentDetail;

  beforeEach(() => {
    vi.mocked(getBotIconUrl).mockReset();
    vi.mocked(getUserPhoto).mockReset();
    vi.mocked(getResourceToken).mockReset();
    invalidate('avatar:');
  });

  it('redirects to the Bot Service icon the owner set', async () => {
    vi.mocked(getBotIconUrl).mockResolvedValue('https://cdn.example.com/winnie.png');
    await expect(getAvatar(ctx, agent('bot-icon'))).resolves.toEqual({
      status: 'found',
      avatar: { redirect: 'https://cdn.example.com/winnie.png' },
    });
  });

  it('still falls back to the account photo when the bot lookup fails', async () => {
    vi.mocked(getBotIconUrl).mockRejectedValue(new Error('ARM 403'));
    vi.mocked(getResourceToken).mockResolvedValue('graph-token');
    vi.mocked(getUserPhoto).mockResolvedValue({ contentType: 'image/jpeg', base64: 'aGk=' });
    await expect(
      getAvatar(ctx, agent('fallback', { teamsUpn: 'a@example.test' }))
    ).resolves.toEqual({ status: 'found', avatar: { contentType: 'image/jpeg', base64: 'aGk=' } });
  });

  it('reports no avatar when every source answers that there is none', async () => {
    vi.mocked(getBotIconUrl).mockResolvedValue(undefined);
    vi.mocked(getResourceToken).mockResolvedValue('graph-token');
    vi.mocked(getUserPhoto).mockResolvedValue(null);
    const none = agent('no-picture', { teamsUpn: 'a@example.test' });
    await expect(getAvatar(ctx, none)).resolves.toEqual({ status: 'none' });

    // Settled answers are cached, so a second read does not hit the providers
    await expect(getAvatar(ctx, none)).resolves.toEqual({ status: 'none' });
    expect(vi.mocked(getBotIconUrl)).toHaveBeenCalledTimes(1);
  });

  it('treats a missing Graph consent as no avatar rather than a failure', async () => {
    vi.mocked(getBotIconUrl).mockResolvedValue(undefined);
    vi.mocked(getResourceToken).mockResolvedValue(null);
    await expect(
      getAvatar(ctx, agent('no-consent', { teamsUpn: 'a@example.test' }))
    ).resolves.toEqual({ status: 'none' });
    expect(vi.mocked(getUserPhoto)).not.toHaveBeenCalled();
  });

  it('reports an upstream failure and does not cache it', async () => {
    vi.mocked(getBotIconUrl).mockRejectedValue(new Error('ARM 500'));
    vi.mocked(getResourceToken).mockResolvedValue('graph-token');
    vi.mocked(getUserPhoto).mockRejectedValue(new Error('Graph 503 photo'));
    const flaky = agent('flaky', { teamsUpn: 'a@example.test' });
    await expect(getAvatar(ctx, flaky)).resolves.toEqual({
      status: 'failed',
      message: 'Graph 503 photo',
    });

    // The next request retries instead of serving 404 for an hour
    vi.mocked(getBotIconUrl).mockResolvedValue('https://cdn.example.com/flaky.png');
    await expect(getAvatar(ctx, flaky)).resolves.toEqual({
      status: 'found',
      avatar: { redirect: 'https://cdn.example.com/flaky.png' },
    });
  });
});
