import { NextResponse, type NextRequest } from 'next/server';
import { adminAgentGate } from '@/lib/admin-route';
import { getRecordingVideo } from '@/lib/agents/service';
import { isValidRecordingId } from '@/lib/recordings';

type RouteContext = { params: Promise<{ id: string; rid: string }> };

/**
 * Playback. The bridge resolves Teams' short-lived download URL for the
 * recording and we hand the browser straight there (302), so the video bytes
 * never pass through the portal. 409 while Teams is still producing the file.
 */
export async function GET(req: NextRequest, { params }: RouteContext) {
  const { id, rid } = await params;
  if (!isValidRecordingId(rid)) {
    return NextResponse.json({ error: 'Invalid recording id' }, { status: 400 });
  }
  try {
    const gate = await adminAgentGate(req, id);
    if (!gate.ok) return gate.response;
    const video = await getRecordingVideo(gate.agent, rid);
    const headers = { 'Cache-Control': 'no-store, private' };
    if (video.kind === 'missing')
      return NextResponse.json({ error: 'Recording not found' }, { status: 404, headers });
    if (video.kind === 'not-ready')
      return NextResponse.json(
        { error: 'Recording not ready', status: video.status },
        { status: 409, headers }
      );
    return NextResponse.redirect(video.url, { status: 302, headers });
  } catch (error) {
    console.error(`Failed to resolve video ${rid} for ${id}:`, error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'Failed to load video', details: message }, { status: 502 });
  }
}
