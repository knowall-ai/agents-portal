/**
 * Tiny in-memory TTL cache shared across API routes in one server process.
 * Keys should include the user's tenant so users never see each other's data.
 */

interface Entry<T> {
  value: T;
  expiresAt: number;
  /** Set on the first failed refresh: the last moment this value may still be served */
  staleUntil?: number;
}

const store = new Map<string, Entry<unknown>>();
/** Loads in progress, so concurrent callers share one loader run per key. */
const inflight = new Map<string, Promise<unknown>>();
/**
 * Bumped by invalidate(). A loader captures the generation it started in and
 * writes nothing if it has moved on: by the time a load that was invalidated
 * mid-flight finishes, a newer load may already have stored a newer value.
 */
const generations = new Map<string, number>();

function generationOf(key: string): number {
  return generations.get(key) ?? 0;
}

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
  // One loader run per key at a time: a second expired caller waits for the
  // first, so an older run can never overwrite a newer result
  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const run = load(key, hit, loader, ttlMs, generationOf(key)).finally(() => {
    if (inflight.get(key) === run) inflight.delete(key);
  });
  inflight.set(key, run);
  return run;
}

async function load<T>(
  key: string,
  hit: Entry<T> | undefined,
  loader: () => Promise<T>,
  ttlMs: number | ((value: T) => number),
  generation: number
): Promise<T> {
  // Invalidated while the loader ran: hand the caller its own result, but leave
  // the store to whatever load replaced this one.
  const mayStore = () => generationOf(key) === generation;
  let value: T;
  try {
    value = await loader();
  } catch (error) {
    // Serve the last good value while the upstream is throttled or flaky, and
    // hold off retrying for a short while so we do not make the throttle worse.
    // The loader may have taken longer than the hold-off, so time the retry
    // from the failure, not from when the loader started.
    const failedAt = Date.now();
    const staleUntil = hit?.staleUntil ?? failedAt + STALE_MAX_MS;
    if (hit && failedAt < staleUntil) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`cache: serving stale ${key} after failure: ${message.slice(0, 160)}`);
      if (mayStore()) {
        store.set(key, { value: hit.value, expiresAt: failedAt + STALE_RETRY_MS, staleUntil });
      }
      return hit.value;
    }
    if (mayStore()) store.delete(key);
    throw error;
  }
  const ttl = typeof ttlMs === 'function' ? ttlMs(value) : ttlMs;
  if (mayStore()) store.set(key, { value, expiresAt: Date.now() + ttl });
  return value;
}

/** How long a stale value is served before the loader is tried again. */
const STALE_RETRY_MS = 30_000;
/** Stale values are never served for longer than this after the first failure. */
const STALE_MAX_MS = 5 * 60_000;

export function invalidate(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) drop(key);
  }
  for (const key of inflight.keys()) {
    if (key.startsWith(prefix)) drop(key);
  }
}

function drop(key: string): void {
  store.delete(key);
  inflight.delete(key);
  generations.set(key, generationOf(key) + 1);
}
