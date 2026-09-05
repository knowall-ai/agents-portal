import { NextResponse, type NextRequest } from 'next/server';
import { adminAgentGate } from '@/lib/admin-route';
import { getAgentCosts } from '@/lib/agents/service';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  try {
    const gate = await adminAgentGate(req, id);
    if (!gate.ok) return gate.response;

    return NextResponse.json(await getAgentCosts(gate.ctx, gate.agent));
  } catch (error) {
    console.error(`Failed to load costs for ${id}:`, error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'Failed to load costs', details: message }, { status: 502 });
  }
}
