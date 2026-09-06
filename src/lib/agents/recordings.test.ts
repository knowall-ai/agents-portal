import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentDetail } from '@/types';

vi.mock('@/lib/providers/azure', () => ({
  findVm: vi.fn(),
  listActivityLog: vi.fn(),
  listAgentResources: vi.fn(),
  listRoleAssignments: vi.fn(),
  listSubscriptions: vi.fn(),
  runVmScript: vi.fn(),
}));
vi.mock('@/lib/providers/recordings', async (actual) => ({
  ...(await actual<typeof import('@/lib/providers/recordings')>()),
  listRecordings: vi.fn(),
  getRecordingsStatus: vi.fn(),
  getRecording: vi.fn(),
  resolveVideo: vi.fn(),
  getTranscriptVtt: vi.fn(),
}));
vi.mock('@/lib/registry', () => ({
  getRegistry: () => [],
  getRegistryEntry: (id: string) => REGISTRY[id],
}));

const REGISTRY: Record<string, unknown> = {
  sallie: {
    id: 'sallie',
    recordingsUrl: 'https://sallie.example/recordings',
    subscriptionIds: ['sub'],
    resourceGroups: [],
  },
  badurl: {
    id: 'badurl',
    recordingsUrl: 'http://plain.example/recordings',
    subscriptionIds: ['sub'],
    resourceGroups: [],
  },
};

const provider = await import('@/lib/providers/recordings');
const {
  getRecording,
  getRecordingTranscript,
  getRecordingVideo,
  getRecordings,
  getRecordingsStatus,
  recordingsSource,
} = await import('./service');
const { invalidate } = await import('@/lib/cache');

const agent = (id: string): AgentDetail =>
  ({
    id,
    name: id,
    resources: [{ subscriptionId: 'sub', resourceGroup: 'rg', tenantId: 't' }],
  }) as unknown as AgentDetail;

describe('recordings service', () => {
  beforeEach(() => {
    vi.mocked(provider.listRecordings).mockReset();
    vi.mocked(provider.getRecordingsStatus).mockReset();
    vi.mocked(provider.getRecording).mockReset();
    invalidate('recording');
    vi.stubEnv('RECORDINGS_TOKEN_SALLIE', 'own');
    vi.stubEnv('RECORDINGS_FIXTURE', '');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reads the bridge with the per-agent token and caches the list', async () => {
    vi.mocked(provider.listRecordings).mockResolvedValue([]);
    expect(recordingsSource(agent('sallie'))).toEqual({
      kind: 'bridge',
      url: 'https://sallie.example/recordings',
      token: 'own',
    });
    const first = await getRecordings(agent('sallie'), { limit: 50 });
    const second = await getRecordings(agent('sallie'), { limit: 50 });
    expect(first).toEqual({ available: true, items: [] });
    expect(second.items).toBe(first.items);
    expect(provider.listRecordings).toHaveBeenCalledTimes(1);
    expect(provider.listRecordings).toHaveBeenCalledWith(
      'https://sallie.example/recordings',
      'own',
      'sallie',
      { limit: 50 }
    );
  });

  it('explains why recordings are unavailable instead of calling out', async () => {
    expect((await getRecordings(agent('nobody'))).error).toContain('No recordingsUrl');
    expect((await getRecordings(agent('badurl'))).error).toContain('not a valid https URL');
    vi.stubEnv('RECORDINGS_TOKEN_SALLIE', '');
    expect((await getRecordings(agent('sallie'))).error).toContain('RECORDINGS_TOKEN_SALLIE');
    expect((await getRecordingsStatus(agent('nobody'))).active).toBe(false);
    await expect(getRecording(agent('nobody'), 'rec_1')).rejects.toThrow('No recordingsUrl');
    await expect(getRecordingVideo(agent('nobody'), 'rec_1')).rejects.toThrow('No recordingsUrl');
    await expect(getRecordingTranscript(agent('nobody'), 'rec_1')).rejects.toThrow(
      'No recordingsUrl'
    );
    expect(provider.listRecordings).not.toHaveBeenCalled();
  });

  it('turns a failing bridge into an error the tab can show, and never throws for the status chip', async () => {
    vi.mocked(provider.listRecordings).mockRejectedValue(new Error('Recordings 503 /recordings'));
    vi.mocked(provider.getRecordingsStatus).mockRejectedValue(
      new Error('Recordings 503 /recordings/status')
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await getRecordings(agent('sallie'))).toEqual({
      available: true,
      items: [],
      error: 'Recordings 503 /recordings',
    });
    const status = await getRecordingsStatus(agent('sallie'));
    expect(status.active).toBe(false);
    expect(status.error).toBe('Recordings 503 /recordings/status');
    warn.mockRestore();
  });

  it('serves the fixture on demand or with RECORDINGS_FIXTURE=1, whatever the registry says', async () => {
    const demo = await getRecordings(agent('nobody'), {}, true);
    expect(demo.fixture).toBe(true);
    expect(demo.items.length).toBeGreaterThan(0);
    expect(demo.items.every((item) => item.agent === 'nobody')).toBe(true);
    const detail = await getRecording(agent('nobody'), demo.items[0].id, true);
    expect(detail?.turns.length).toBeGreaterThan(0);
    expect(await getRecording(agent('nobody'), 'rec_missing', true)).toBeNull();

    vi.stubEnv('RECORDINGS_FIXTURE', '1');
    expect((await getRecordings(agent('sallie'))).fixture).toBe(true);
    expect((await getRecordingsStatus(agent('sallie'))).active).toBe(false);
    expect(await getRecordingVideo(agent('sallie'), 'rec_1')).toEqual({ kind: 'missing' });
    expect(await getRecordingTranscript(agent('sallie'), 'rec_1')).toBeNull();
    expect(provider.listRecordings).not.toHaveBeenCalled();
  });
});
