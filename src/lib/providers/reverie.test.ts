import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONNECT_TIMEOUT_MS, isValidBrainUrl, openBrainEvents } from './reverie';

describe('isValidBrainUrl', () => {
  it('accepts https hosts with an optional path and rejects the rest', () => {
    expect(isValidBrainUrl('https://sallie.example.com/reverie')).toBe(true);
    expect(isValidBrainUrl('https://sallie.example.com:8443')).toBe(true);
    expect(isValidBrainUrl('http://sallie.example.com/reverie')).toBe(false);
    expect(isValidBrainUrl('https://sallie.example.com/../etc')).toBe(false);
    expect(isValidBrainUrl('https://sallie.example.com/reverie?x=1')).toBe(false);
  });
});

describe('openBrainEvents', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('gives up when the upstream accepts the connection but never sends headers', async () => {
    // A fetch that resolves only once its signal aborts, like a socket that hangs open
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
          })
      )
    );
    const pending = openBrainEvents('https://sallie.example.com/reverie', 'token');
    const outcome = pending.then(
      () => 'resolved',
      (error: Error) => error.message
    );
    await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS + 1);
    expect(await outcome).toBe('Reverie connect timeout');
  });

  it('keeps a stream that answered in time and stops the timer', async () => {
    const body = new ReadableStream<Uint8Array>();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body, { status: 200 }))
    );
    const response = await openBrainEvents('https://sallie.example.com/reverie', 'token');
    expect(response.ok).toBe(true);
    // well past the connect timeout the stream is still ours to read
    await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS * 2);
    expect(response.body).toBe(body);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('honours the caller signal', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          })
      )
    );
    const controller = new AbortController();
    const pending = openBrainEvents(
      'https://sallie.example.com/reverie',
      'token',
      400,
      controller.signal
    );
    const outcome = pending.then(
      () => 'resolved',
      (error: Error) => error.message
    );
    controller.abort();
    expect(await outcome).toBe('aborted');
  });
});
