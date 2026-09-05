import { NextResponse, type NextRequest } from 'next/server';
import { getUserContext } from '@/lib/tokens';
import { getAgent, getMetrics } from '@/lib/agents/service';

type RouteContext = { params: Promise<{ id: string }> };

const MAX_HOURS = 168;

/** `hours` is optional (default 72); anything else in the query, or a non-integer, is refused. */
function parseHours(query: URLSearchParams): number | null {
  const keys = [...query.keys()];
  if (keys.some((k) => k !== 'hours') || query.getAll('hours').length > 1) return null;
  const raw = query.get('hours');
  if (raw === null) return 72;
  if (!/^\d{1,3}$/.test(raw)) return null;
  const hours = parseInt(raw, 10);
  return hours >= 1 && hours <= MAX_HOURS ? hours : null;
}

/** VM CPU over the last `hours` (default 72, max 168) from Azure Monitor. */
export async function GET(req: NextRequest, { params }: RouteContext) {
  const ctx = await getUserContext(req);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const hours = parseHours(req.nextUrl.searchParams);
  if (hours === null) {
    return NextResponse.json(
      { error: 'hours must be an integer from 1 to 168 and the only query parameter' },
      { status: 400 }
    );
  }
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
