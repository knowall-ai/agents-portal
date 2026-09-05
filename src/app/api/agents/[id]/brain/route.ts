import { NextResponse, type NextRequest } from 'next/server';
import { getUserContext } from '@/lib/tokens';
import { getAgent, getBrain } from '@/lib/agents/service';
import { parseDemoQuery } from '@/lib/brain-query';

type RouteContext = { params: Promise<{ id: string }> };

/** Snapshot of the agent's graph memory (Reverie), or why it is not available. */
export async function GET(req: NextRequest, { params }: RouteContext) {
  const ctx = await getUserContext(req);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const demo = parseDemoQuery(req.nextUrl.searchParams);
  if (demo === null) {
    return NextResponse.json(
      { error: 'Only demo=1 is accepted as a query parameter' },
      { status: 400 }
    );
  }
  try {
    const agent = await getAgent(ctx, id);
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    return NextResponse.json(
      { brain: await getBrain(agent, demo) },
      { headers: { 'Cache-Control': 'no-store, private' } }
    );
  } catch (error) {
    console.error(`Failed to load brain for ${id}:`, error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'Failed to load brain', details: message }, { status: 502 });
  }
}
