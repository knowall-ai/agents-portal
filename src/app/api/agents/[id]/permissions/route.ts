import { NextResponse, type NextRequest } from 'next/server';
import { adminAgentGate } from '@/lib/admin-route';
import { getPermissions } from '@/lib/agents/service';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  try {
    const gate = await adminAgentGate(req, id);
    if (!gate.ok) return gate.response;

    const permissions = await getPermissions(gate.ctx, gate.agent);
    return NextResponse.json({ permissions });
  } catch (error) {
    console.error(`Failed to load permissions for ${id}:`, error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to load permissions', details: message },
      { status: 502 }
    );
  }
}
