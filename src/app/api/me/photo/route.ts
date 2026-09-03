import { NextResponse, type NextRequest } from 'next/server';
import { getResourceToken, getUserContext, GRAPH_SCOPE } from '@/lib/tokens';

/** Proxy the signed-in user's Microsoft Graph profile photo. */
export async function GET(req: NextRequest) {
  const ctx = await getUserContext(req);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const token = await getResourceToken(ctx, GRAPH_SCOPE);
  if (!token) return new NextResponse(null, { status: 404 });

  const response = await fetch('https://graph.microsoft.com/v1.0/me/photo/$value', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return new NextResponse(null, { status: 404 });

  return new NextResponse(await response.arrayBuffer(), {
    headers: {
      'Content-Type': response.headers.get('Content-Type') ?? 'image/jpeg',
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
