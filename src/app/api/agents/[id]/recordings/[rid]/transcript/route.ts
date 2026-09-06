import { NextResponse, type NextRequest } from 'next/server';
import { adminAgentGate } from '@/lib/admin-route';
import { getRecordingTranscript } from '@/lib/agents/service';
import { isValidRecordingId } from '@/lib/recordings';

type RouteContext = { params: Promise<{ id: string; rid: string }> };

/** Teams' own transcript of the recording as WebVTT. Admin-only. */
export async function GET(req: NextRequest, { params }: RouteContext) {
  const { id, rid } = await params;
  if (!isValidRecordingId(rid)) {
    return NextResponse.json({ error: 'Invalid recording id' }, { status: 400 });
  }
  try {
    const gate = await adminAgentGate(req, id);
    if (!gate.ok) return gate.response;
    const vtt = await getRecordingTranscript(gate.agent, rid);
    if (vtt === null) return NextResponse.json({ error: 'No transcript' }, { status: 404 });
    return new NextResponse(vtt, {
      headers: {
        'Content-Type': 'text/vtt; charset=utf-8',
        'Content-Disposition': `attachment; filename="${rid}.vtt"`,
        'Cache-Control': 'no-store, private',
      },
    });
  } catch (error) {
    console.error(`Failed to load transcript ${rid} for ${id}:`, error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to load transcript', details: message },
      { status: 502 }
    );
  }
}
