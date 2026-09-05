import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { AgentDetail } from '@/types';
import type { UserContext } from '@/lib/tokens';
import { ADMIN_ROLE, VIEWER_ROLE } from '@/lib/roles';

// Only the caller's identity and the two service calls that reach Azure are
// stubbed: the route's own gating, body validation and status mapping run for
// real, and so does the shared adminAgentGate.
vi.mock('@/lib/tokens', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tokens')>()),
  getUserContext: vi.fn(),
}));
vi.mock('@/lib/agents/service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/agents/service')>()),
  agentExists: vi.fn(),
  getAgent: vi.fn(),
  getBoost: vi.fn(),
  setBoost: vi.fn(),
}));

const { getUserContext } = await import('@/lib/tokens');
const { agentExists, getAgent, getBoost, setBoost } = await import('@/lib/agents/service');
const { GET, POST } = await import('./route');

const route = { params: Promise.resolve({ id: 'sallie' }) };
const agent = { id: 'sallie', name: 'Sallie' } as unknown as AgentDetail;
const boost = { supported: true, active: true, source: 'vm' as const };

function context(isAdmin: boolean): UserContext {
  return {
    armToken: 'arm',
    tenantId: 'tenant',
    userId: 'user',
    roles: isAdmin ? [ADMIN_ROLE] : [VIEWER_ROLE],
    isAdmin,
  };
}

const url = 'http://localhost/api/agents/sallie/boost';

function post(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // The same-origin check fails closed without a canonical origin
  vi.stubEnv('NEXTAUTH_URL', 'https://agents.example.org');
  vi.mocked(getUserContext).mockResolvedValue(context(true));
  vi.mocked(agentExists).mockResolvedValue(true);
  vi.mocked(getAgent).mockResolvedValue(agent);
  vi.mocked(getBoost).mockResolvedValue(boost as never);
  vi.mocked(setBoost).mockResolvedValue(boost as never);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/agents/[id]/boost — access', () => {
  it('answers 401 without a session, before looking the agent up', async () => {
    vi.mocked(getUserContext).mockResolvedValue(null);
    const response = await POST(post({ action: 'refresh' }), route);
    expect(response.status).toBe(401);
    expect(agentExists).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown agent before rejecting a viewer', async () => {
    vi.mocked(getUserContext).mockResolvedValue(context(false));
    vi.mocked(agentExists).mockResolvedValue(false);
    const response = await POST(post({ action: 'refresh' }), route);
    expect(response.status).toBe(404);
    expect(getBoost).not.toHaveBeenCalled();
  });

  it('answers 403 for a viewer on an agent they can see', async () => {
    vi.mocked(getUserContext).mockResolvedValue(context(false));
    const response = await POST(post({ action: 'refresh' }), route);
    expect(response.status).toBe(403);
    expect(getBoost).not.toHaveBeenCalled();
  });

  it('refuses a cross-site POST, after the gate and before the body is read', async () => {
    const response = await POST(post({ action: 'on' }, { 'sec-fetch-site': 'cross-site' }), route);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Cross-site request refused' });
    expect(setBoost).not.toHaveBeenCalled();
  });

  it('refuses a POST from a foreign origin', async () => {
    const foreign = await POST(post({ action: 'on' }, { origin: 'https://evil.example' }), route);
    expect(foreign.status).toBe(403);
    const own = await POST(post({ action: 'on' }, { origin: 'https://agents.example.org' }), route);
    expect(own.status).toBe(200);
  });

  it('fails closed when the deployment has no canonical origin', async () => {
    vi.stubEnv('NEXTAUTH_URL', '');
    const response = await POST(post({ action: 'on' }), route);
    expect(response.status).toBe(403);
    expect(setBoost).not.toHaveBeenCalled();
  });

  it('refuses a body that a browser form could have sent', async () => {
    const response = await POST(post({ action: 'on' }, { 'content-type': 'text/plain' }), route);
    expect(response.status).toBe(403);
    expect(setBoost).not.toHaveBeenCalled();
  });
});

describe('POST /api/agents/[id]/boost — body validation', () => {
  it('answers 400 to a malformed body without touching the VM', async () => {
    const bodies: unknown[] = [
      null,
      ['on'],
      { action: 'reboot' },
      { action: 'on', script: '/tmp/evil.sh' },
      { action: 'off', hours: 2 },
      { action: 'on', hours: 0.3 },
    ];
    for (const body of bodies) {
      const response = await POST(post(body), route);
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
    expect(setBoost).not.toHaveBeenCalled();
    expect(getBoost).not.toHaveBeenCalled();
  });

  it('answers 400 to a body that is not JSON at all', async () => {
    const response = await POST(post('not json'), route);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid JSON body' });
  });
});

describe('POST /api/agents/[id]/boost — actions', () => {
  it('asks the VM for its state on refresh', async () => {
    const response = await POST(post({ action: 'refresh' }), route);
    expect(response.status).toBe(200);
    expect(getBoost).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user' }), agent, true);
    expect(await response.json()).toEqual({ boost });
    expect(setBoost).not.toHaveBeenCalled();
  });

  it('passes a half-hour boost through to setBoost', async () => {
    const response = await POST(post({ action: 'on', hours: 0.5 }), route);
    expect(response.status).toBe(200);
    expect(setBoost).toHaveBeenCalledWith(expect.anything(), agent, true, 0.5);
  });

  it('turns boost off with no duration', async () => {
    const response = await POST(post({ action: 'off' }), route);
    expect(response.status).toBe(200);
    expect(setBoost).toHaveBeenCalledWith(expect.anything(), agent, false, undefined);
  });
});

describe('POST /api/agents/[id]/boost — failures', () => {
  it('maps an out-of-range duration reported by the service to 400', async () => {
    vi.mocked(setBoost).mockRejectedValue(
      new Error('Hours must be a multiple of 0.25 between 0.25 and 8, got 9')
    );
    const response = await POST(post({ action: 'on', hours: 9 }), route);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'Failed to change Boost' });
  });

  it('maps an agent without a boost script to 400', async () => {
    vi.mocked(setBoost).mockRejectedValue(new Error('Boost is not configured for this agent'));
    expect((await POST(post({ action: 'on' }), route)).status).toBe(400);
  });

  it('maps an ARM authorisation failure to 403', async () => {
    vi.mocked(setBoost).mockRejectedValue(new Error('ARM 403 AuthorizationFailed'));
    expect((await POST(post({ action: 'on' }), route)).status).toBe(403);
  });

  it('maps any other upstream failure to 502', async () => {
    vi.mocked(setBoost).mockRejectedValue(new Error('ARM 500 run-command timed out'));
    const response = await POST(post({ action: 'on' }), route);
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ details: 'ARM 500 run-command timed out' });
  });
});

describe('GET /api/agents/[id]/boost', () => {
  const get = () => new NextRequest(url);

  it('reads the cached state without asking the VM, and is never cached', async () => {
    const response = await GET(get(), route);
    expect(response.status).toBe(200);
    expect(getBoost).toHaveBeenCalledWith(expect.anything(), agent, false);
    expect(response.headers.get('cache-control')).toBe('no-store, private');
    expect(await response.json()).toEqual({ boost });
  });

  it('answers 401 without a session', async () => {
    vi.mocked(getUserContext).mockResolvedValue(null);
    expect((await GET(get(), route)).status).toBe(401);
  });

  it('answers 403 to a viewer', async () => {
    vi.mocked(getUserContext).mockResolvedValue(context(false));
    expect((await GET(get(), route)).status).toBe(403);
  });

  it('maps an upstream failure to 502 and still refuses to be cached', async () => {
    vi.mocked(getBoost).mockRejectedValue(new Error('ARM 500'));
    const response = await GET(get(), route);
    expect(response.status).toBe(502);
    expect(response.headers.get('cache-control')).toBe('no-store, private');
  });
});
