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

function isPrivateIpv4(ip: string): boolean {
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

/**
 * The IPv4 address an IPv4-mapped IPv6 literal wraps, or null. The URL parser
 * canonicalises these to the hex form (`::ffff:7f00:1`); a DNS lookup can hand
 * back the dotted one (`::ffff:127.0.0.1`). Such an address is exactly as
 * public as the IPv4 inside it, so it must not be refused wholesale.
 */
function mappedIpv4(v6: string): string | null {
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(v6);
  if (dotted) return isIP(dotted[1]) === 4 ? dotted[1] : null;
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(v6);
  if (!hex) return null;
  const high = Number.parseInt(hex[1], 16);
  const low = Number.parseInt(hex[2], 16);
  return `${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`;
}

function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) return isPrivateIpv4(ip);
  const v6 = ip.toLowerCase();
  const mapped = mappedIpv4(v6);
  if (mapped) return isPrivateIpv4(mapped);
  if (v6 === '::1' || v6 === '::') return true;
  // Link-local is fe80::/10 and unique-local fc00::/7 — ranges, not literal
  // prefixes, so fe90:: and febf:: are link-local too.
  const first = Number.parseInt(v6.split(':')[0], 16);
  // An address whose first group we cannot read is refused rather than probed.
  if (!Number.isFinite(first)) return true;
  return (first >= 0xfe80 && first <= 0xfebf) || (first >= 0xfc00 && first <= 0xfdff);
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
      headers: { 'User-Agent': 'knowall-agents-portal/health' },
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
