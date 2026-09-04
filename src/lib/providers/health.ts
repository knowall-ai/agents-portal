// Reachability probe for an agent's portal / health URL.
//
// Agent portals sit behind Entra ID SSO (e.g. Caddy + caddy-security), so an
// unauthenticated GET usually answers with a redirect to the sign-in page.
// A 2xx or 3xx response therefore means "the host is up and serving".
//
// The URL can come from a resource tag, so it is treated as untrusted: only
// https to a public host is probed, and the response body is never read.
import { lookup } from 'dns/promises';
import { isIP } from 'net';
import type { AgentDetail } from '@/types';

function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  const v6 = ip.toLowerCase();
  return (
    v6 === '::1' ||
    v6 === '::' ||
    v6.startsWith('fe80') ||
    v6.startsWith('fc') ||
    v6.startsWith('fd') ||
    v6.startsWith('::ffff:')
  );
}

/** Only https URLs whose host resolves to a public address may be probed. */
export async function isProbeableUrl(url: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return false;
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false;
  try {
    const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
    return addresses.length > 0 && addresses.every((a) => !isPrivateAddress(a.address));
  } catch {
    return false;
  }
}

export async function probeUrl(url: string): Promise<NonNullable<AgentDetail['reachability']>> {
  const checkedAt = new Date().toISOString();
  if (!(await isProbeableUrl(url))) {
    return { url, reachable: false, checkedAt };
  }
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(6_000),
      headers: { 'User-Agent': 'knowall-agent-dashboard/health' },
    });
    // Drain nothing: the body is irrelevant and may be large
    response.body?.cancel().catch(() => undefined);
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
