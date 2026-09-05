import { NextResponse, type NextRequest } from 'next/server';
import { getUserContext } from '@/lib/tokens';
import { getAgent, getAvatar } from '@/lib/agents/service';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * The picture is read with the viewer's own tokens, so the same URL answers
 * differently per user. Never let a browser or proxy reuse it: the server-side
 * per-user cache in getAvatar is what keeps this cheap.
 */
const NO_STORE = { 'Cache-Control': 'private, no-store' };

/**
 * The agent's picture from Azure or Entra (see getAvatar). A Bot Service icon
 * is a redirect to its https URL; an account photo is served with its own
 * content type. 404 when there is neither, which the Avatar component turns
 * into initials; 502 when a lookup failed, so a transient outage never reads
 * as "this agent has no picture".
 */
export async function GET(req: NextRequest, { params }: RouteContext) {
  const ctx = await getUserContext(req);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const agent = await getAgent(ctx, id);
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

  const result = await getAvatar(ctx, agent);
  if (result.status === 'failed') {
    return NextResponse.json(
      { error: `Avatar lookup failed: ${result.message}` },
      { status: 502, headers: NO_STORE }
    );
  }
  if (result.status === 'none') {
    return new NextResponse(null, { status: 404, headers: NO_STORE });
  }
  const { avatar } = result;
  if ('redirect' in avatar) {
    return NextResponse.redirect(avatar.redirect, { status: 302, headers: NO_STORE });
  }
  return new NextResponse(Buffer.from(avatar.base64, 'base64'), {
    headers: {
      'Content-Type': avatar.contentType,
      ...NO_STORE,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
