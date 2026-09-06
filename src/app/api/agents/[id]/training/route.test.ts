import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/tokens', () => ({ getUserContext: vi.fn() }));
vi.mock('@/lib/agents/service', () => ({
  getAgent: vi.fn(),
  getTraining: vi.fn(),
  invalidateTraining: vi.fn(),
}));

import { getUserContext } from '@/lib/tokens';
import { getAgent, getTraining, invalidateTraining } from '@/lib/agents/service';
import { GET } from './route';

const route = { params: Promise.resolve({ id: 'poppie' }) };
const request = (query = '') =>
  new NextRequest(`http://localhost/api/agents/poppie/training${query}`);
const agent = { id: 'poppie', name: 'Poppie' };
const training = { runs: [], curriculum: [], outstanding: [], configured: true };

describe('GET /api/agents/[id]/training', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getUserContext).mockResolvedValue({ tenantId: 't', userId: 'u' } as never);
    vi.mocked(getAgent).mockResolvedValue(agent as never);
    vi.mocked(getTraining).mockResolvedValue(training as never);
  });

  it('serves the training for a visible agent without touching the cache', async () => {
    const response = await GET(request(), route);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ training });
    expect(invalidateTraining).not.toHaveBeenCalled();
  });

  it('drops the cached reads first when asked to refresh', async () => {
    const response = await GET(request('?refresh=1725660000'), route);
    expect(response.status).toBe(200);
    expect(invalidateTraining).toHaveBeenCalledWith('poppie');
    expect(getTraining).toHaveBeenCalledTimes(1);
  });

  it('answers 401 without a session and 404 for an agent the caller cannot see', async () => {
    vi.mocked(getUserContext).mockResolvedValueOnce(null);
    expect((await GET(request(), route)).status).toBe(401);
    vi.mocked(getAgent).mockResolvedValueOnce(null as never);
    expect((await GET(request('?refresh=1'), route)).status).toBe(404);
    expect(invalidateTraining).not.toHaveBeenCalled();
  });

  it('answers 502 when the lookup throws', async () => {
    vi.mocked(getTraining).mockRejectedValueOnce(new Error('GitHub 500 /x'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await GET(request(), route);
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ details: 'GitHub 500 /x' });
    error.mockRestore();
  });
});
