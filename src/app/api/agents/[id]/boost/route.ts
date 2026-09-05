import { NextResponse, type NextRequest } from 'next/server';
import { getUserContext } from '@/lib/tokens';
import { getAgent, getBoost, setBoost } from '@/lib/agents/service';

type RouteContext = { params: Promise<{ id: string }> };

/** Boost state is per-user and changes on demand: never let a cache hold on to it. */
const NO_STORE = { 'Cache-Control': 'no-store, private' } as const;

function statusFor(error: unknown): number {
  const message = error instanceof Error ? error.message : '';
  if (/^ARM 403/.test(message)) return 403;
  if (/^Hours must be/.test(message) || /not configured/.test(message)) return 400;
  return 502;
}

export async function GET(req: NextRequest, { params }: RouteContext) {
  const ctx = await getUserContext(req);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });

  const { id } = await params;
  const refresh = req.nextUrl.searchParams.get('refresh') === '1';
  try {
    const agent = await getAgent(ctx, id);
    if (!agent)
      return NextResponse.json({ error: 'Agent not found' }, { status: 404, headers: NO_STORE });
    return NextResponse.json({ boost: await getBoost(ctx, agent, refresh) }, { headers: NO_STORE });
  } catch (error) {
    console.error(`Failed to read boost for ${id}:`, error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to read Boost state', details: message },
      { status: statusFor(error), headers: NO_STORE }
    );
  }
}

/** Body: { action: "on" | "off", hours?: number }. Runs the agent's boost script on its VM as the signed-in user. */
export async function POST(req: NextRequest, { params }: RouteContext) {
  const ctx = await getUserContext(req);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  let body: { action?: string; hours?: number } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (body.action !== 'on' && body.action !== 'off') {
    return NextResponse.json({ error: 'action must be "on" or "off"' }, { status: 400 });
  }
  try {
    const agent = await getAgent(ctx, id);
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    const boost = await setBoost(ctx, agent, body.action === 'on', body.hours);
    console.info(`Boost ${body.action} for ${id} by ${ctx.userId}`);
    return NextResponse.json({ boost });
  } catch (error) {
    console.error(`Failed to set boost for ${id}:`, error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to change Boost', details: message },
      { status: statusFor(error) }
    );
  }
}
