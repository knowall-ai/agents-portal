import { NextResponse, type NextRequest } from 'next/server';
import { getUserContext } from '@/lib/tokens';
import { getAgent, getMetrics } from '@/lib/agents/service';

type RouteContext = { params: Promise<{ id: string }> };

/** VM CPU over the last `hours` (default 72, max 168) from Azure Monitor. */
export async function GET(req: NextRequest, { params }: RouteContext) {
  const ctx = await getUserContext(req);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const requested = Number(req.nextUrl.searchParams.get('hours') ?? '72');
  const hours = Number.isFinite(requested) ? Math.min(168, Math.max(1, Math.round(requested))) : 72;
  try {
    const agent = await getAgent(ctx, id);
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    const metrics = await getMetrics(ctx, agent, hours);
    return NextResponse.json({ metrics });
  } catch (error) {
    console.error(`Failed to load metrics for ${id}:`, error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to load metrics', details: message },
      { status: 502 }
    );
  }
}
