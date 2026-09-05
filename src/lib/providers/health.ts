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
import { request } from 'https';
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
 * The eight 16-bit groups of an IPv6 address, or null if it is not one.
 * Every spelling normalises to the same eight numbers, so classification never
 * has to match text: `::ffff:7f00:1`, `::ffff:127.0.0.1` and the expanded
 * `0:0:0:0:0:ffff:127.0.0.1` a resolver may hand back are all the same address.
 */
function ipv6Groups(ip: string): number[] | null {
  if (isIP(ip) !== 6) return null;
  let text = ip;
  // A trailing dotted quad is the last two groups
  const dotted = /\d{1,3}(?:\.\d{1,3}){3}$/.exec(text);
  if (dotted) {
    const [a, b, c, d] = dotted[0].split('.').map(Number);
    const hex = (high: number, low: number) => ((high << 8) | low).toString(16);
    text = `${text.slice(0, dotted.index)}${hex(a, b)}:${hex(c, d)}`;
  }
  const parts = text.split('::');
  if (parts.length > 2) return null;
  const parse = (part: string) => (part ? part.split(':').map((g) => Number.parseInt(g, 16)) : []);
  const left = parse(parts[0]);
  if (parts.length === 1) return left.length === 8 ? left : null;
  const right = parse(parts[1]);
  const gap = 8 - left.length - right.length;
  if (gap < 0) return null;
  return [...left, ...new Array<number>(gap).fill(0), ...right];
}

function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) return isPrivateIpv4(ip);
  const groups = ipv6Groups(ip);
  // An address we cannot read is refused rather than probed
  if (!groups) return true;
  // ::ffff:a.b.c.d (IPv4-mapped) and ::a.b.c.d (IPv4-compatible, which is also
  // how :: and ::1 come out) are exactly as public as the IPv4 inside them.
  if (groups.slice(0, 5).every((g) => g === 0) && (groups[5] === 0xffff || groups[5] === 0)) {
    const [high, low] = groups.slice(6);
    return isPrivateIpv4(`${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`);
  }
  // Link-local is fe80::/10 and unique-local fc00::/7 — ranges, not literal
  // prefixes, so fe90:: and febf:: are link-local too.
  const [first] = groups;
  return (first >= 0xfe80 && first <= 0xfebf) || (first >= 0xfc00 && first <= 0xfdff);
}

/** The public address a URL may be probed at. */
export interface ProbeTarget {
  /** The first validated address, for callers that take one */
  address: string;
  family: 4 | 6;
  /** Every validated address the name resolved to, so the socket can fall back within them */
  addresses: { address: string; family: 4 | 6 }[];
}

/**
 * The address to probe a URL at, or null if it must not be probed at all: only
 * https, no credentials in the URL, and every address the host resolves to
 * public. The address is carried out of here so the connection can be pinned to
 * it — resolving the name a second time would reopen the rebinding hole.
 */
export async function probeTarget(url: string): Promise<ProbeTarget | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return null;
  try {
    const literal = isIP(host);
    const addresses = literal
      ? [{ address: host, family: literal }]
      : await lookup(host, { all: true });
    if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) return null;
    const validated = addresses.map((a) => ({
      address: a.address,
      family: (a.family === 6 ? 6 : 4) as 4 | 6,
    }));
    const [first] = validated;
    return { address: first.address, family: first.family, addresses: validated };
  } catch {
    return null;
  }
}

/** Only https URLs whose host resolves to a public address may be probed. */
export async function isProbeableUrl(url: string): Promise<boolean> {
  return (await probeTarget(url)) !== null;
}

/**
 * What the socket is told when it asks for the hostname: the address the guard
 * already validated. Without this the name is resolved a second time when the
 * request is made and can answer with a private address in between (DNS
 * rebinding). The URL is passed through untouched, so the Host header and the
 * TLS certificate are still checked against the original hostname.
 */
export function connectionPin(target: ProbeTarget) {
  return (
    _hostname: string,
    options: { all?: boolean } | undefined,
    callback: (
      error: null,
      address: string | { address: string; family: number }[],
      family?: number
    ) => void
  ) => {
    // Node's network-family autoselection asks with { all: true } and expects
    // the array form; answering with a string there fails the request. It gets
    // every validated address, so an unreachable first record still falls back
    // to the next one without another DNS lookup
    if (options?.all)
      callback(null, target.addresses ?? [{ address: target.address, family: target.family }]);
    else callback(null, target.address, target.family);
  };
}

const PROBE_TIMEOUT_MS = 6_000;

/**
 * The status an https GET answers with. `https.request` is used rather than
 * fetch because it takes the `lookup` above: fetch offers no way to pin the
 * connection. It does not follow redirects, which is what we want — a redirect
 * to the sign-in page is the answer, not something to chase.
 */
function probeStatus(url: string, target: ProbeTarget): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: 'GET',
        headers: { 'User-Agent': 'knowall-agents-portal/health' },
        timeout: PROBE_TIMEOUT_MS,
        lookup: connectionPin(target),
      },
      (response) => {
        clearTimeout(deadline);
        // The body is irrelevant and may be large: read none of it
        response.destroy();
        resolve(response.statusCode ?? 0);
      }
    );
    req.on('timeout', () => req.destroy(new Error('Probe timed out')));
    req.on('error', (error) => {
      clearTimeout(deadline);
      reject(error);
    });
    // An absolute deadline, armed once the request exists: the socket's own
    // inactivity timeout resets on every byte, so a server trickling headers
    // could otherwise hold getAgent open indefinitely. The handlers above only
    // run after this line, so they always see it.
    const deadline = setTimeout(() => req.destroy(new Error('Probe timed out')), PROBE_TIMEOUT_MS);
    req.end();
  });
}

export async function probeUrl(url: string): Promise<NonNullable<AgentDetail['reachability']>> {
  const checkedAt = new Date().toISOString();
  const target = await probeTarget(url);
  if (!target) {
    return { url, reachable: false, checkedAt };
  }
  try {
    const httpStatus = await probeStatus(url, target);
    return { url, reachable: httpStatus < 400, httpStatus, checkedAt };
  } catch {
    return { url, reachable: false, checkedAt };
  }
}
