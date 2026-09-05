import { afterEach, describe, expect, it, vi } from 'vitest';
import { cached } from './cache';

afterEach(() => {
  vi.useRealTimers();
});

describe('cached', () => {
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
