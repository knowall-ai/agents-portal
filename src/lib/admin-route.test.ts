import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import type { AgentDetail } from '@/types';
import type { UserContext } from '@/lib/tokens';
import { ADMIN_ROLE, VIEWER_ROLE } from '@/lib/roles';

const getUserContext = vi.fn();
const agentExists = vi.fn();
const getAgent = vi.fn();

vi.mock('@/lib/tokens', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tokens')>()),
  getUserContext: (req: NextRequest) => getUserContext(req),
}));

vi.mock('@/lib/agents/service', () => ({
  agentExists: (...args: unknown[]) => agentExists(...args),
  getAgent: (...args: unknown[]) => getAgent(...args),
}));

const { adminAgentGate } = await import('@/lib/admin-route');

const req = {} as NextRequest;
const agent = { id: 'winnie' } as AgentDetail;

function context(isAdmin: boolean): UserContext {
  return {
    armToken: 'token',
    tenantId: 'tenant',
    userId: 'user',
    roles: isAdmin ? [ADMIN_ROLE] : [VIEWER_ROLE],
    isAdmin,
  };
}

beforeEach(() => {
  getUserContext.mockReset();
  agentExists.mockReset();
  getAgent.mockReset();
  getAgent.mockResolvedValue(agent);
});

describe('adminAgentGate', () => {
  it('answers 401 when unauthenticated, before touching the agent', async () => {
    getUserContext.mockResolvedValue(null);

    const gate = await adminAgentGate(req, 'winnie');

    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.response.status).toBe(401);
    expect(agentExists).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown agent before rejecting a viewer', async () => {
    getUserContext.mockResolvedValue(context(false));
    agentExists.mockResolvedValue(false);

    const gate = await adminAgentGate(req, 'nope');

    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.response.status).toBe(404);
    expect(getAgent).not.toHaveBeenCalled();
  });

  it('answers 403 for a viewer asking about an agent they can see', async () => {
    getUserContext.mockResolvedValue(context(false));
    agentExists.mockResolvedValue(true);

    const gate = await adminAgentGate(req, 'winnie');

    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.response.status).toBe(403);
    // The admin-only detail is never loaded for a viewer.
    expect(getAgent).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown agent when the caller is an admin', async () => {
    getUserContext.mockResolvedValue(context(true));
    agentExists.mockResolvedValue(false);

    const gate = await adminAgentGate(req, 'nope');

    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.response.status).toBe(404);
    expect(getAgent).not.toHaveBeenCalled();
  });

  it('returns the agent for an admin', async () => {
    getUserContext.mockResolvedValue(context(true));
    agentExists.mockResolvedValue(true);

    const gate = await adminAgentGate(req, 'winnie');

    expect(gate.ok).toBe(true);
    if (gate.ok) {
      expect(gate.agent).toBe(agent);
      expect(gate.ctx.isAdmin).toBe(true);
    }
  });

  it('answers 404 when the agent disappears between the two lookups', async () => {
    getUserContext.mockResolvedValue(context(true));
    agentExists.mockResolvedValue(true);
    getAgent.mockResolvedValue(null);

    const gate = await adminAgentGate(req, 'winnie');

    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.response.status).toBe(404);
  });

  it('lets an upstream failure through for the route to map to 502', async () => {
    getUserContext.mockResolvedValue(context(true));
    agentExists.mockRejectedValue(new Error('Resource Graph 500'));

    await expect(adminAgentGate(req, 'winnie')).rejects.toThrow('Resource Graph 500');
  });
});
