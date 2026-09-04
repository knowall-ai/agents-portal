import { NextResponse, type NextRequest } from 'next/server';
import { getUserContext } from '@/lib/tokens';
import { getCostsSummary } from '@/lib/agents/service';

export async function GET(req: NextRequest) {
  const ctx = await getUserContext(req);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    return NextResponse.json(await getCostsSummary(ctx));
  } catch (error) {
    console.error('Failed to load cost summary:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'Failed to load costs', details: message }, { status: 502 });
  }
}
