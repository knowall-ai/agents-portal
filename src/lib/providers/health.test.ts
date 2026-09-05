import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// DNS and the network are the only boundaries; the guard itself runs for real.
const lookup = vi.hoisted(() => vi.fn());
const request = vi.hoisted(() => vi.fn());
vi.mock('dns/promises', () => ({ lookup }));
vi.mock('https', () => ({ request }));

import { connectionPin, isProbeableUrl, probeUrl } from './health';

type RequestHandler = (response: { statusCode?: number; destroy: () => void }) => void;

/** A stand-in https.ClientRequest that answers with `statusCode`. */
function answersWith(statusCode: number) {
  return (_url: string, _options: unknown, handler: RequestHandler) => {
    queueMicrotask(() => handler({ statusCode, destroy: () => undefined }));
    return { on: () => undefined, end: () => undefined, destroy: () => undefined };
  };
}

/** A stand-in that fails the socket instead of answering. */
function failsWith(error: Error) {
  return () => {
    const listeners: Record<string, (e: Error) => void> = {};
    queueMicrotask(() => listeners.error?.(error));
    return {
      on: (event: string, listener: (e: Error) => void) => {
        listeners[event] = listener;
      },
      end: () => undefined,
      destroy: () => undefined,
    };
  };
}

beforeEach(() => {
  request.mockReset();
  request.mockImplementation(answersWith(200));
  lookup.mockReset();
  // Public by default; the tests that care override it.
  lookup.mockResolvedValue([{ address: '93.184.216.34' }]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isProbeableUrl', () => {
  it('allows https to a host that resolves to a public address', async () => {
    await expect(isProbeableUrl('https://agents.example.com/health')).resolves.toBe(true);
    expect(lookup).toHaveBeenCalledWith('agents.example.com', { all: true });
  });

  it('refuses anything that is not https', async () => {
    for (const url of [
      'http://agents.example.com',
      'ftp://agents.example.com',
      'file:///etc/passwd',
      'not a url',
      '',
    ]) {
      await expect(isProbeableUrl(url), url).resolves.toBe(false);
    }
    expect(lookup).not.toHaveBeenCalled();
  });

  it('refuses credentials smuggled into the URL', async () => {
    await expect(isProbeableUrl('https://user:pass@agents.example.com')).resolves.toBe(false);
    await expect(isProbeableUrl('https://user@agents.example.com')).resolves.toBe(false);
  });

  it('refuses loopback and internal names without asking DNS', async () => {
    for (const url of [
      'https://localhost/health',
      'https://vm.local',
      'https://vm.internal',
      'https://portal.corp.internal',
    ]) {
      await expect(isProbeableUrl(url), url).resolves.toBe(false);
    }
    expect(lookup).not.toHaveBeenCalled();
  });

  it('refuses literal loopback and private addresses', async () => {
    for (const host of [
      '127.0.0.1',
      '0.0.0.0',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '[::1]',
      '[::]',
      '[fe80::1]',
      // Link-local is fe80::/10, not just the literal fe80 prefix
      '[fe90::1]',
      '[febf::1]',
      '[fd00::1]',
      '[fc00::1]',
      '[fdff::1]',
      // IPv4-mapped: as private as the address inside it
      '[::ffff:127.0.0.1]',
      '[::ffff:10.0.0.5]',
      '[0:0:0:0:0:ffff:192.168.1.1]',
    ]) {
      await expect(isProbeableUrl(`https://${host}/health`), host).resolves.toBe(false);
    }
    expect(lookup).not.toHaveBeenCalled();
  });

  it('allows a literal public address, including an IPv4-mapped one', async () => {
    await expect(isProbeableUrl('https://93.184.216.34/health')).resolves.toBe(true);
    await expect(isProbeableUrl('https://[2606:2800:220:1::1]/health')).resolves.toBe(true);
    // ::ffff:93.184.216.34 wraps a public address, so refusing it would be wrong
    await expect(isProbeableUrl('https://[::ffff:93.184.216.34]/health')).resolves.toBe(true);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('refuses a name that resolves into a private range (DNS rebinding)', async () => {
    lookup.mockResolvedValue([{ address: '93.184.216.34' }, { address: '10.0.0.5' }]);
    await expect(isProbeableUrl('https://agents.example.com')).resolves.toBe(false);
  });

  it('refuses a name resolving to a private address that DNS reports in mapped form', async () => {
    // Every spelling of the same address, in every case: the URL parser
    // canonicalises literals, but a resolver can hand back any of these.
    for (const address of [
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      '0:0:0:0:0:ffff:127.0.0.1',
      '0:0:0:0:0:ffff:7f00:1',
      '0:0:0:0:0:FFFF:127.0.0.1',
      '0:0:0:0:0:ffff:10.0.0.1',
      '0:0:0:0:0:FFFF:0A00:1',
      '0:0:0:0:0:0:0:1',
    ]) {
      lookup.mockResolvedValue([{ address }]);
      await expect(isProbeableUrl('https://agents.example.com'), address).resolves.toBe(false);
    }
    for (const address of [
      '::ffff:93.184.216.34',
      '::ffff:5db8:d822',
      '0:0:0:0:0:ffff:93.184.216.34',
      '0:0:0:0:0:FFFF:5DB8:D822',
      '2606:2800:220:1::1',
    ]) {
      lookup.mockResolvedValue([{ address }]);
      await expect(isProbeableUrl('https://agents.example.com'), address).resolves.toBe(true);
    }
  });

  it('refuses a name that does not resolve at all', async () => {
    lookup.mockResolvedValue([]);
    await expect(isProbeableUrl('https://nowhere.example.com')).resolves.toBe(false);
    lookup.mockRejectedValue(new Error('ENOTFOUND'));
    await expect(isProbeableUrl('https://nowhere.example.com')).resolves.toBe(false);
  });
});

describe('probeUrl', () => {
  it('reports a 2xx or a sign-in redirect as reachable', async () => {
    for (const status of [200, 302]) {
      request.mockImplementation(answersWith(status));
      await expect(probeUrl('https://agents.example.com')).resolves.toMatchObject({
        url: 'https://agents.example.com',
        reachable: true,
        httpStatus: status,
      });
    }
  });

  it('reports a server error as unreachable but keeps the status', async () => {
    request.mockImplementation(answersWith(502));
    await expect(probeUrl('https://agents.example.com')).resolves.toMatchObject({
      reachable: false,
      httpStatus: 502,
    });
  });

  it('reports a refused URL as unreachable without probing it', async () => {
    const result = await probeUrl('http://10.0.0.5/health');
    expect(result).toMatchObject({ url: 'http://10.0.0.5/health', reachable: false });
    expect(result.httpStatus).toBeUndefined();
    expect(request).not.toHaveBeenCalled();
  });

  it('reports a failed probe as unreachable rather than throwing', async () => {
    request.mockImplementation(failsWith(new Error('ECONNREFUSED')));
    const result = await probeUrl('https://agents.example.com');
    expect(result.reachable).toBe(false);
    expect(result.httpStatus).toBeUndefined();
    expect(Date.parse(result.checkedAt)).not.toBeNaN();
  });

  it('pins the connection to the address the guard validated (DNS rebinding)', async () => {
    lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);

    await probeUrl('https://agents.example.com/health');

    const [url, options] = request.mock.calls[0];
    // The URL is passed through untouched, so the Host header and the TLS
    // certificate are still checked against the original hostname...
    expect(url).toBe('https://agents.example.com/health');
    // ...but the socket is handed the address the guard already validated, so a
    // second DNS answer of 10.0.0.5 can never be connected to.
    const resolved = vi.fn();
    options.lookup('agents.example.com', {}, resolved);
    expect(resolved).toHaveBeenCalledWith(null, '93.184.216.34', 4);
    expect(options.timeout).toBe(6_000);
  });

  it('pins to the IPv6 address and family when that is what the host resolves to', async () => {
    lookup.mockResolvedValue([{ address: '2606:2800:220:1::1', family: 6 }]);

    await probeUrl('https://agents.example.com');

    const resolved = vi.fn();
    request.mock.calls[0][1].lookup('agents.example.com', {}, resolved);
    expect(resolved).toHaveBeenCalledWith(null, '2606:2800:220:1::1', 6);
  });

  it('never reads the response body', async () => {
    const destroy = vi.fn();
    request.mockImplementation((_url: string, _options: unknown, handler: RequestHandler) => {
      queueMicrotask(() => handler({ statusCode: 200, destroy }));
      return { on: () => undefined, end: () => undefined, destroy: () => undefined };
    });
    await probeUrl('https://agents.example.com');
    expect(destroy).toHaveBeenCalled();
  });
});

describe('connectionPin', () => {
  it('answers every hostname with the one address that was validated', () => {
    const resolved = vi.fn();
    connectionPin({ address: '93.184.216.34', family: 4 })('anything.example', {}, resolved);
    expect(resolved).toHaveBeenCalledWith(null, '93.184.216.34', 4);
  });

  it('answers in array form when Node asks for every address (family autoselection)', () => {
    const resolved = vi.fn();
    connectionPin({ address: '93.184.216.34', family: 4 })(
      'anything.example',
      { all: true },
      resolved
    );
    expect(resolved).toHaveBeenCalledWith(null, [{ address: '93.184.216.34', family: 4 }]);
  });
});

describe('probe deadline', () => {
  it('gives up after the deadline even when the socket never goes idle', async () => {
    vi.useFakeTimers();
    try {
      const destroy = vi.fn();
      const listeners: Record<string, (e: Error) => void> = {};
      // A request that never answers and never reports a socket timeout
      request.mockImplementation(() => ({
        on: (event: string, listener: (e: Error) => void) => {
          listeners[event] = listener;
        },
        end: () => undefined,
        destroy: (error: Error) => {
          destroy(error);
          listeners.error?.(error);
        },
      }));
      const pending = probeUrl('https://agents.example.com');
      await vi.advanceTimersByTimeAsync(6_100);
      const result = await pending;
      expect(destroy).toHaveBeenCalled();
      expect(result.reachable).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
