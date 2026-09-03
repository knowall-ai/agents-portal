import { NextResponse, type NextRequest } from 'next/server';
import { TENANT_COOKIE } from '@/lib/auth';

const TENANT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$|^common$|^organizations$/i;

/**
 * Remember which Entra tenant to use for the next sign-in.
 * The caller then triggers signIn(); the NextAuth route reads the cookie.
 */
export async function POST(req: NextRequest) {
  let tenantId: string | undefined;
  try {
    ({ tenantId } = (await req.json()) as { tenantId?: string });
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!tenantId || !TENANT_ID.test(tenantId)) {
    return NextResponse.json({ error: 'Invalid tenantId' }, { status: 400 });
  }

  const response = NextResponse.json({ ok: true, tenantId });
  response.cookies.set(TENANT_COOKIE, tenantId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
