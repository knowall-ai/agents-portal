import { NextResponse, type NextRequest } from 'next/server';
import { TENANT_COOKIE } from '@/lib/auth';
import { parseTenantSelectRequest } from '@/lib/tenants';

/**
 * Remember which Entra tenant to use for the next sign-in.
 * The caller then triggers signIn(); the NextAuth route reads the cookie.
 */
export async function POST(req: NextRequest) {
  // Runs before sign-in, so there is no session to check; refuse cross-site
  // requests instead, or any origin that is not our own
  const site = req.headers.get('sec-fetch-site');
  const origin = req.headers.get('origin');
  // Fail closed: without a canonical origin there is nothing to compare against,
  // and a browser form post cannot send JSON, so the content type is part of the check
  const self = process.env.NEXTAUTH_URL ? new URL(process.env.NEXTAUTH_URL).origin : null;
  const json = (req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json');
  if (site === 'cross-site' || !self || (origin && origin !== self) || !json) {
    return NextResponse.json({ error: 'Cross-site request refused' }, { status: 403 });
  }
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const tenantId = parseTenantSelectRequest(raw);
  if (!tenantId) {
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
