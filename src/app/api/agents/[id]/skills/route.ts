import { NextResponse, type NextRequest } from 'next/server';
import { getUserContext } from '@/lib/tokens';
import { getAgent, getSkills } from '@/lib/agents/service';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: RouteContext) {
  const ctx = await getUserContext(req);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  try {
    const agent = await getAgent(ctx, id);
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    const skills = await getSkills(ctx, agent);
    return NextResponse.json({ skills });
  } catch (error) {
    console.error(`Failed to load skills for ${id}:`, error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'Failed to load skills', details: message }, { status: 502 });
  }
}
