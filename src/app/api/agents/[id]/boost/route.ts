import { NextResponse, type NextRequest } from 'next/server';
import { getUserContext } from '@/lib/tokens';
import { getAgent, getBoost, setBoost } from '@/lib/agents/service';

type RouteContext = { params: Promise<{ id: string }> };

function statusFor(error: unknown): number {
  const message = error instanceof Error ? error.message : '';
  if (/^ARM 403/.test(message)) return 403;
  if (/^Hours must be/.test(message) || /not configured/.test(message)) return 400;
  return 502;
}

export async function GET(req: NextRequest, { params }: RouteContext) {
  const ctx = await getUserContext(req);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  // GET is read-only: cached state only. Asking the VM is a write (a run-command
  // that lands in the Activity Log), so it goes through POST {action: "refresh"}.
  try {
    const agent = await getAgent(ctx, id);
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    return NextResponse.json({ boost: await getBoost(ctx, agent, false) });
  } catch (error) {
    console.error(`Failed to read boost for ${id}:`, error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to read Boost state', details: message },
      { status: statusFor(error) }
    );
  }
}

/** Only our own pages may drive the VM: refuse cross-site and foreign-origin requests. */
function sameOrigin(req: NextRequest): boolean {
  if (req.headers.get('sec-fetch-site') === 'cross-site') return false;
  const origin = req.headers.get('origin');
  const self = process.env.NEXTAUTH_URL ? new URL(process.env.NEXTAUTH_URL).origin : null;
  return !origin || !self || origin === self;
}

/**
 * Body: { action: "on" | "off" | "refresh", hours?: number }. on/off run the
 * agent's boost script on its VM as the signed-in user; refresh asks the VM
 * for its current state. All three are run-commands, hence POST.
 */
export async function POST(req: NextRequest, { params }: RouteContext) {
  const ctx = await getUserContext(req);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: 'Cross-site request refused' }, { status: 403 });
  }

  const { id } = await params;
  let body: { action?: string; hours?: number } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (body.action !== 'on' && body.action !== 'off' && body.action !== 'refresh') {
    return NextResponse.json({ error: 'action must be "on", "off" or "refresh"' }, { status: 400 });
  }
  try {
    const agent = await getAgent(ctx, id);
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    if (body.action === 'refresh') {
      return NextResponse.json({ boost: await getBoost(ctx, agent, true) });
    }
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
