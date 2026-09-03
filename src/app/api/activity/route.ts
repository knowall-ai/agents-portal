import { NextResponse, type NextRequest } from 'next/server';
import { getUserContext } from '@/lib/tokens';
import { getAllActivity } from '@/lib/agents/service';

export async function GET(req: NextRequest) {
  const ctx = await getUserContext(req);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') ?? '60') || 60, 200);
  try {
    const events = await getAllActivity(ctx, limit);
    return NextResponse.json({ events });
  } catch (error) {
    console.error('Failed to load activity feed:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to load activity', details: message },
      { status: 502 }
    );
  }
}
