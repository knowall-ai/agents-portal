import { NextResponse, type NextRequest } from 'next/server';
import { forbiddenForViewers, getUserContext } from '@/lib/tokens';
import { getAgent, getPermissions } from '@/lib/agents/service';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: RouteContext) {
  const ctx = await getUserContext(req);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ctx.isAdmin) return forbiddenForViewers();

  const { id } = await params;
  try {
    const agent = await getAgent(ctx, id);
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    const permissions = await getPermissions(ctx, agent);
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
