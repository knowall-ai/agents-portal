import { NextResponse, type NextRequest } from 'next/server';
import { getUserContext } from '@/lib/tokens';
import { getAgent, getAvatar } from '@/lib/agents/service';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * The agent's picture from Azure or Entra (see getAvatar). A Bot Service icon
 * is a redirect to its https URL; an account photo is served with its own
 * content type. 404 when there is neither, which the Avatar component turns
 * into initials.
 */
export async function GET(req: NextRequest, { params }: RouteContext) {
  const ctx = await getUserContext(req);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const agent = await getAgent(ctx, id);
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

  const avatar = await getAvatar(ctx, agent);
  if (!avatar) {
    return new NextResponse(null, {
      status: 404,
      headers: { 'Cache-Control': 'private, max-age=300' },
    });
  }
  if ('redirect' in avatar) {
    return NextResponse.redirect(avatar.redirect, {
      status: 302,
      headers: { 'Cache-Control': 'private, max-age=3600' },
    });
  }
  return new NextResponse(Buffer.from(avatar.base64, 'base64'), {
    headers: {
      'Content-Type': avatar.contentType,
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
