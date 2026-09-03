import { NextResponse, type NextRequest } from 'next/server';
import { getUserContext } from '@/lib/tokens';
import { listTenants } from '@/lib/providers/azure';
import { cached } from '@/lib/cache';

export async function GET(req: NextRequest) {
  const ctx = await getUserContext(req);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const tenants = await cached(`tenants:${ctx.tenantId}:${ctx.userId}`, () =>
      listTenants(ctx.armToken, ctx.tenantId)
    );
    return NextResponse.json({ tenants, current: ctx.tenantId });
  } catch (error) {
    console.error('Failed to list tenants:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to list tenants', details: message },
      { status: 502 }
    );
  }
}
