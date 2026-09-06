import { NextResponse, type NextRequest } from 'next/server';
import { adminAgentGate } from '@/lib/admin-route';
import { getRecording } from '@/lib/agents/service';
import { isValidRecordingId } from '@/lib/recordings';

type RouteContext = { params: Promise<{ id: string; rid: string }> };

/** One recording with its per-turn transcript. Admin-only. */
export async function GET(req: NextRequest, { params }: RouteContext) {
  const { id, rid } = await params;
  if (!isValidRecordingId(rid)) {
    return NextResponse.json({ error: 'Invalid recording id' }, { status: 400 });
  }
  const demo = req.nextUrl.searchParams.get('demo') === '1';
  try {
    const gate = await adminAgentGate(req, id);
    if (!gate.ok) return gate.response;
    const recording = await getRecording(gate.agent, rid, demo);
    if (!recording) return NextResponse.json({ error: 'Recording not found' }, { status: 404 });
    return NextResponse.json({ recording }, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    console.error(`Failed to load recording ${rid} for ${id}:`, error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to load recording', details: message },
      { status: 502 }
    );
  }
}
