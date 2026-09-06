import { NextResponse, type NextRequest } from 'next/server';
import { adminAgentGate } from '@/lib/admin-route';
import { getRecordingsStatus } from '@/lib/agents/service';

type RouteContext = { params: Promise<{ id: string }> };

/** Whether the agent is recording a call right now (the REC chip). Admin-only like the tab. */
export async function GET(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  try {
    const gate = await adminAgentGate(req, id);
    if (!gate.ok) return gate.response;
    return NextResponse.json(
      { status: await getRecordingsStatus(gate.agent) },
      { headers: { 'Cache-Control': 'no-store, private' } }
    );
  } catch (error) {
    console.error(`Failed to load recording status for ${id}:`, error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to load recording status', details: message },
      { status: 502 }
    );
  }
}
