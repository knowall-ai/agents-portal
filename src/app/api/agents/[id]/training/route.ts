import { NextResponse, type NextRequest } from 'next/server';
import { getUserContext } from '@/lib/tokens';
import { getAgent, getTraining } from '@/lib/agents/service';

type RouteContext = { params: Promise<{ id: string }> };

/** Training runs and curriculum for one agent. Readable by viewers. */
export async function GET(req: NextRequest, { params }: RouteContext) {
  const ctx = await getUserContext(req);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  try {
    const agent = await getAgent(ctx, id);
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    const training = await getTraining(ctx, agent);
    return NextResponse.json({ training });
  } catch (error) {
    console.error(`Failed to load training for ${id}:`, error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to load training', details: message },
      { status: 502 }
    );
  }
}
