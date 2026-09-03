// Reachability probe for an agent's portal / health URL.
//
// Agent portals sit behind Entra ID SSO (e.g. Caddy + caddy-security), so an
// unauthenticated GET usually answers with a redirect to the sign-in page.
// A 2xx or 3xx response therefore means "the host is up and serving".
import type { AgentDetail } from '@/types';

export async function probeUrl(url: string): Promise<NonNullable<AgentDetail['reachability']>> {
  const checkedAt = new Date().toISOString();
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(6_000),
      headers: { 'User-Agent': 'knowall-agent-dashboard/health' },
    });
    return {
      url,
      reachable: response.status < 400,
      httpStatus: response.status,
      checkedAt,
    };
  } catch {
    return { url, reachable: false, checkedAt };
  }
}
