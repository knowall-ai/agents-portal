import { NextResponse, type NextRequest } from 'next/server';
import { TENANT_COOKIE } from '@/lib/auth';

const TENANT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$|^common$|^organizations$/i;

/**
 * Remember which Entra tenant to use for the next sign-in.
 * The caller then triggers signIn(); the NextAuth route reads the cookie.
 */
export async function POST(req: NextRequest) {
  // Runs before sign-in, so there is no session to check; refuse cross-site
  // requests instead, or any origin that is not our own
  const site = req.headers.get('sec-fetch-site');
  const origin = req.headers.get('origin');
  const self = process.env.NEXTAUTH_URL ? new URL(process.env.NEXTAUTH_URL).origin : null;
  if (site === 'cross-site' || (origin && self && origin !== self)) {
    return NextResponse.json({ error: 'Cross-site request refused' }, { status: 403 });
  }
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
