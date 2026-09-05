import { NextResponse, type NextRequest } from 'next/server';
import { adminAgentGate } from '@/lib/admin-route';
import { getBoost, setBoost } from '@/lib/agents/service';

type RouteContext = { params: Promise<{ id: string }> };

function statusFor(error: unknown): number {
  const message = error instanceof Error ? error.message : '';
  if (/^ARM 403/.test(message)) return 403;
  if (/^Hours must be/.test(message) || /not configured/.test(message)) return 400;
  return 502;
}

export async function GET(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  const refresh = req.nextUrl.searchParams.get('refresh') === '1';
  try {
    const gate = await adminAgentGate(req, id);
    if (!gate.ok) return gate.response;

    return NextResponse.json({ boost: await getBoost(gate.ctx, gate.agent, refresh) });
  } catch (error) {
    console.error(`Failed to read boost for ${id}:`, error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to read Boost state', details: message },
      { status: statusFor(error) }
    );
  }
}

/** Body: { action: "on" | "off", hours?: number }. Runs the agent's boost script on its VM as the signed-in user. */
export async function POST(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  try {
    const gate = await adminAgentGate(req, id);
    if (!gate.ok) return gate.response;

    let body: { action?: string; hours?: number };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    if (body.action !== 'on' && body.action !== 'off') {
      return NextResponse.json({ error: 'action must be "on" or "off"' }, { status: 400 });
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
