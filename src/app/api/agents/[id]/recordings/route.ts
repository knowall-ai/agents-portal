import { NextResponse, type NextRequest } from 'next/server';
import { adminAgentGate } from '@/lib/admin-route';
import { getRecordings } from '@/lib/agents/service';
import { isValidRecordingId } from '@/lib/recordings';
import { RECORDINGS_PAGE } from '@/lib/providers/recordings';

type RouteContext = { params: Promise<{ id: string }> };

const NO_STORE = { 'Cache-Control': 'no-store, private' };

/**
 * The agent's call recordings, newest first. Admin-only: they are customer
 * meeting content. `?before=<id>` pages older; `?demo=1` serves the fixture.
 */
export async function GET(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  const query = req.nextUrl.searchParams;
  const before = query.get('before') ?? undefined;
  if (before !== undefined && !isValidRecordingId(before)) {
    return NextResponse.json({ error: 'Invalid before cursor' }, { status: 400 });
  }
  const demo = query.get('demo') === '1';
  try {
    const gate = await adminAgentGate(req, id);
    if (!gate.ok) return gate.response;
    const recordings = await getRecordings(gate.agent, { limit: RECORDINGS_PAGE, before }, demo);
    return NextResponse.json({ recordings }, { headers: NO_STORE });
  } catch (error) {
    console.error(`Failed to load recordings for ${id}:`, error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to load recordings', details: message },
      { status: 502 }
    );
  }
}
