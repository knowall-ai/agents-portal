import { NextResponse, type NextRequest } from 'next/server';
import { getUserContext } from '@/lib/tokens';
import { listAgents } from '@/lib/agents/service';
import { toSummary } from '@/lib/agents/discover';

export async function GET(req: NextRequest) {
  const ctx = await getUserContext(req);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const agents = await listAgents(ctx);
    return NextResponse.json({
      tenantId: ctx.tenantId,
      agents: agents.map(toSummary),
    });
  } catch (error) {
    console.error('Failed to list agents:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'Failed to list agents', details: message }, { status: 502 });
  }
}
