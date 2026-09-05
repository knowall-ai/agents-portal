import { afterEach, describe, expect, it, vi } from 'vitest';
import { cached, getCacheTtlMs, invalidate } from './cache';

afterEach(() => {
  vi.useRealTimers();
});

describe('cached', () => {
  it('runs one loader per key for concurrent callers, so an older run cannot overwrite a newer one', async () => {
    const key = `test:single-flight:${Math.random()}`;
    let resolveFirst: (value: string) => void = () => undefined;
    const loader = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveFirst = resolve;
        })
    );
    const first = cached(key, loader, 60_000);
    const second = cached(key, loader, 60_000);
    expect(loader).toHaveBeenCalledTimes(1);
    resolveFirst('fresh');
    await expect(first).resolves.toBe('fresh');
    await expect(second).resolves.toBe('fresh');
    // Settled: the next call after expiry loads again exactly once
    await expect(cached(key, loader, 60_000)).resolves.toBe('fresh');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('holds off retrying for 30 s measured from the failure, not from the call', async () => {
    vi.useFakeTimers();
    const key = `test:${Math.random()}`;
    expect(await cached(key, async () => 'good', 1000)).toBe('good');
    vi.advanceTimersByTime(2000);

    // A loader that fails only after the hold-off has already elapsed
    const slowFailure = vi.fn(async () => {
      vi.advanceTimersByTime(31_000);
      throw new Error('upstream down');
    });
    expect(await cached(key, slowFailure, 1000)).toBe('good');

    const second = vi.fn(async () => 'fresh');
    expect(await cached(key, second, 1000)).toBe('good');
    expect(second).not.toHaveBeenCalled();
  });

  it('stops serving a stale value once the stale window has passed', async () => {
    vi.useFakeTimers();
    const key = `test:${Math.random()}`;
    expect(await cached(key, async () => 'good', 1000)).toBe('good');
    vi.advanceTimersByTime(2000);
    await expect(
      cached(
        key,
        async () => {
          throw new Error('first failure');
        },
        1000
      )
    ).resolves.toBe('good');

    vi.advanceTimersByTime(6 * 60_000);
    await expect(
      cached(
        key,
        async () => {
          throw new Error('still down');
        },
        1000
      )
    ).rejects.toThrow('still down');
  });
});

describe('invalidate', () => {
  it('drops stored keys under the prefix and leaves the rest alone', async () => {
    const stamp = Math.random();
    const kept = vi.fn(async () => 'other');
    await cached(`keep:${stamp}`, kept, 60_000);
    const dropped = vi.fn(async () => 'first');
    await cached(`drop:${stamp}:a`, dropped, 60_000);
    await cached(`drop:${stamp}:b`, dropped, 60_000);
    expect(dropped).toHaveBeenCalledTimes(2);

    invalidate(`drop:${stamp}`);

    const reloaded = vi.fn(async () => 'second');
    await expect(cached(`drop:${stamp}:a`, reloaded, 60_000)).resolves.toBe('second');
    await expect(cached(`drop:${stamp}:b`, reloaded, 60_000)).resolves.toBe('second');
    // The unrelated key is still served from the cache
    await expect(cached(`keep:${stamp}`, kept, 60_000)).resolves.toBe('other');
    expect(kept).toHaveBeenCalledTimes(1);
  });

  it('drops a load already in flight, so the next caller starts a fresh one', async () => {
    const key = `test:inflight:${Math.random()}`;
    let release: (value: string) => void = () => undefined;
    const slow = vi.fn(() => new Promise<string>((resolve) => (release = resolve)));
    const first = cached(key, slow, 60_000);

    invalidate(key);

    const second = vi.fn(async () => 'fresh');
    await expect(cached(key, second, 60_000)).resolves.toBe('fresh');
    expect(second).toHaveBeenCalledTimes(1);
    release('stale');
    await expect(first).resolves.toBe('stale');
  });

  it('does not let a load invalidated mid-flight overwrite the newer value', async () => {
    const key = `test:overwrite:${Math.random()}`;
    let release: (value: string) => void = () => undefined;
    const slow = vi.fn(() => new Promise<string>((resolve) => (release = resolve)));
    const first = cached(key, slow, 60_000);

    invalidate(key);

    // A newer load starts and stores its result while the old one is still running
    await expect(cached(key, async () => 'fresh', 60_000)).resolves.toBe('fresh');

    // The old loader finishes last. Its own caller still gets its value...
    release('stale');
    await expect(first).resolves.toBe('stale');

    // ...but it must not have written it over the newer one.
    const reload = vi.fn(async () => 'reloaded');
    await expect(cached(key, reload, 60_000)).resolves.toBe('fresh');
    expect(reload).not.toHaveBeenCalled();
  });

  it('does not let a load invalidated mid-flight resurrect a stale value on failure', async () => {
    const key = `test:stale-overwrite:${Math.random()}`;
    expect(await cached(key, async () => 'good', 0)).toBe('good');

    let fail: (error: Error) => void = () => undefined;
    const slow = vi.fn(() => new Promise<string>((_, reject) => (fail = reject)));
    const first = cached(key, slow, 60_000);

    invalidate(key);
    await expect(cached(key, async () => 'fresh', 60_000)).resolves.toBe('fresh');

    fail(new Error('upstream down'));
    await expect(first).resolves.toBe('good');

    const reload = vi.fn(async () => 'reloaded');
    await expect(cached(key, reload, 60_000)).resolves.toBe('fresh');
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('getCacheTtlMs', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('reads CACHE_TTL_SECONDS and falls back to 60 s for anything unusable', () => {
    vi.stubEnv('CACHE_TTL_SECONDS', '5');
    expect(getCacheTtlMs()).toBe(5000);
    vi.stubEnv('CACHE_TTL_SECONDS', 'not-a-number');
    expect(getCacheTtlMs()).toBe(60_000);
    vi.stubEnv('CACHE_TTL_SECONDS', '0');
    expect(getCacheTtlMs()).toBe(60_000);
  });
});
