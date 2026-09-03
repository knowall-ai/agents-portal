import NextAuth from 'next-auth';
import type { NextRequest } from 'next/server';
import { getAuthOptions, TENANT_COOKIE } from '@/lib/auth';

// The tenant switcher stores the chosen Entra tenant in a cookie; the provider
// is built per request so the next sign-in goes to that tenant's authority.
type RouteContext = { params: Promise<{ nextauth: string[] }> };

async function handler(req: NextRequest, context: RouteContext) {
  const tenantId = req.cookies.get(TENANT_COOKIE)?.value;
  return NextAuth(req, context, getAuthOptions(tenantId));
}

export { handler as GET, handler as POST };
