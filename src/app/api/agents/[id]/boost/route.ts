import { NextResponse, type NextRequest } from 'next/server';
import { adminAgentGate } from '@/lib/admin-route';
import { getBoost, parseBoostRequest, setBoost } from '@/lib/agents/service';

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
  const { id } = await params;
  // GET is read-only: cached state only. Asking the VM is a write (a run-command
  // that lands in the Activity Log), so it goes through POST {action: "refresh"}.
  try {
    const gate = await adminAgentGate(req, id);
    if (!gate.ok) return gate.response;

    return NextResponse.json(
      { boost: await getBoost(gate.ctx, gate.agent, false) },
      { headers: NO_STORE }
    );
  } catch (error) {
    console.error(`Failed to read boost for ${id}:`, error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to read Boost state', details: message },
      { status: statusFor(error), headers: NO_STORE }
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
  const { id } = await params;
  try {
    const gate = await adminAgentGate(req, id);
    if (!gate.ok) return gate.response;
    if (!sameOrigin(req)) {
      return NextResponse.json({ error: 'Cross-site request refused' }, { status: 403 });
    }

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const body = parseBoostRequest(raw);
    if (!body) {
      return NextResponse.json(
        { error: 'Body must be { action: "on" | "off" | "refresh", hours?: number }' },
        { status: 400 }
      );
    }
    if (body.action === 'refresh') {
      return NextResponse.json({ boost: await getBoost(gate.ctx, gate.agent, true) });
    }
    const boost = await setBoost(gate.ctx, gate.agent, body.action === 'on', body.hours);
    console.info(`Boost ${body.action} for ${id} by ${gate.ctx.userId}`);
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
