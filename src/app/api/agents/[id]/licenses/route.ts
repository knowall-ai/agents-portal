import { NextResponse, type NextRequest } from 'next/server';
import { adminAgentGate } from '@/lib/admin-route';
import { getLicensing } from '@/lib/agents/service';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  try {
    const gate = await adminAgentGate(req, id);
    if (!gate.ok) return gate.response;

    const licensing = await getLicensing(gate.ctx, gate.agent);
    return NextResponse.json({ licensing });
  } catch (error) {
    console.error(`Failed to load licences for ${id}:`, error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to load licences', details: message },
      { status: 502 }
    );
  }
}
