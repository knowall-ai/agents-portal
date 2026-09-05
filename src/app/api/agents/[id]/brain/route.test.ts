import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/tokens', () => ({ getUserContext: vi.fn() }));
vi.mock('@/lib/agents/service', () => ({ getAgent: vi.fn(), getBrain: vi.fn() }));

import { getUserContext } from '@/lib/tokens';
import { getAgent, getBrain } from '@/lib/agents/service';
import { GET } from './route';

const route = { params: Promise.resolve({ id: 'sallie' }) };
const request = (query: string) =>
  new NextRequest(`http://localhost/api/agents/sallie/brain${query}`);
const agent = { id: 'sallie', name: 'Sallie' };

describe('GET /api/agents/[id]/brain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getUserContext).mockResolvedValue({
      tenantId: 't',
      userId: 'u',
      armToken: 'arm',
    } as never);
    vi.mocked(getAgent).mockResolvedValue(agent as never);
    vi.mocked(getBrain).mockResolvedValue({ available: true, fixture: true } as never);
  });

  it('answers 400 to any query other than demo=1, before touching the brain', async () => {
    for (const query of ['?demo=0', '?demo=true', '?demo=1&demo=1', '?demo=1&limit=5', '?x=1']) {
      const response = await GET(request(query), route);
      expect(response.status, query).toBe(400);
    }
    expect(getBrain).not.toHaveBeenCalled();
  });

  it('forwards the demo flag to getBrain', async () => {
    expect((await GET(request(''), route)).status).toBe(200);
    expect(getBrain).toHaveBeenLastCalledWith(agent, false);
    const demo = await GET(request('?demo=1'), route);
    expect(demo.status).toBe(200);
    expect(getBrain).toHaveBeenLastCalledWith(agent, true);
    expect(await demo.json()).toEqual({ brain: { available: true, fixture: true } });
  });

  it('answers 401 without a session', async () => {
    vi.mocked(getUserContext).mockResolvedValue(null);
    expect((await GET(request('?demo=1'), route)).status).toBe(401);
    expect(getAgent).not.toHaveBeenCalled();
  });
});
