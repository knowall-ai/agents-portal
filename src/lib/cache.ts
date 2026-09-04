/**
 * Tiny in-memory TTL cache shared across API routes in one server process.
 * Keys should include the user's tenant so users never see each other's data.
 */

interface Entry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, Entry<unknown>>();

export function getCacheTtlMs(): number {
  const seconds = Number(process.env.CACHE_TTL_SECONDS ?? '60');
  return (Number.isFinite(seconds) && seconds > 0 ? seconds : 60) * 1000;
}

/**
 * `ttlMs` may be a function of the loaded value, so callers can cache a
 * failure briefly (negative caching) while keeping successes for longer.
 */
export async function cached<T>(
  key: string,
  loader: () => Promise<T>,
  ttlMs: number | ((value: T) => number) = getCacheTtlMs()
): Promise<T> {
  const now = Date.now();
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit && hit.expiresAt > now) {
    return hit.value;
  }
  const value = await loader();
  const ttl = typeof ttlMs === 'function' ? ttlMs(value) : ttlMs;
  store.set(key, { value, expiresAt: now + ttl });
  return value;
}

export function invalidate(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}
