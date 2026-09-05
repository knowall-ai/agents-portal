import { NextResponse, type NextRequest } from 'next/server';
import { getUserContext } from '@/lib/tokens';
import { getAgent, getPresence } from '@/lib/agents/service';

type RouteContext = { params: Promise<{ id: string }> };

/** Teams presence of the agent's account: is it on a call right now. Viewers may read it. */
export async function GET(req: NextRequest, { params }: RouteContext) {
  const ctx = await getUserContext(req);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  try {
    const agent = await getAgent(ctx, id);
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    return NextResponse.json(
      { presence: await getPresence(ctx, agent) },
      { headers: { 'Cache-Control': 'no-store, private' } }
    );
  } catch (error) {
    console.error(`Failed to load presence for ${id}:`, error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to load presence', details: message },
      { status: 502 }
    );
  }
}
