// Shared gate for the admin-only agent routes (costs, licences, permissions, boost).
import { NextResponse, type NextRequest } from 'next/server';
import { forbiddenForViewers, getUserContext, type UserContext } from '@/lib/tokens';
import { agentExists, getAgent } from '@/lib/agents/service';
import type { AgentDetail } from '@/types';

export type AdminAgentGate =
  | { ok: true; ctx: UserContext; agent: AgentDetail }
  | { ok: false; response: NextResponse };

/**
 * Resolve the caller and the agent for an admin-only route, in the order the
 * repo's API contract expects: 401 unauthenticated, 404 for an id the caller
 * cannot see, then 403 for a viewer. Existence is checked before the viewer
 * rejection so an unknown id answers 404 whatever role the caller holds, and it
 * uses only the agents list the caller can already read — the admin-only data is
 * never loaded for a viewer. Upstream failures throw, for the route to map to 502.
 */
export async function adminAgentGate(req: NextRequest, id: string): Promise<AdminAgentGate> {
  const ctx = await getUserContext(req);
  if (!ctx) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  if (!(await agentExists(ctx, id))) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Agent not found' }, { status: 404 }),
    };
  }
  if (!ctx.isAdmin) return { ok: false, response: forbiddenForViewers() };

  const agent = await getAgent(ctx, id);
  if (!agent) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Agent not found' }, { status: 404 }),
    };
  }
  return { ok: true, ctx, agent };
}
