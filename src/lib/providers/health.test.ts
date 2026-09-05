import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// DNS and the network are the only boundaries; the guard itself runs for real.
const lookup = vi.hoisted(() => vi.fn());
vi.mock('dns/promises', () => ({ lookup }));

import { isProbeableUrl, probeUrl } from './health';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
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
    lookup.mockResolvedValue([{ address: '::ffff:127.0.0.1' }]);
    await expect(isProbeableUrl('https://agents.example.com')).resolves.toBe(false);
    lookup.mockResolvedValue([{ address: '::ffff:93.184.216.34' }]);
    await expect(isProbeableUrl('https://agents.example.com')).resolves.toBe(true);
  });

  it('refuses a name that does not resolve at all', async () => {
    lookup.mockResolvedValue([]);
    await expect(isProbeableUrl('https://nowhere.example.com')).resolves.toBe(false);
    lookup.mockRejectedValue(new Error('ENOTFOUND'));
    await expect(isProbeableUrl('https://nowhere.example.com')).resolves.toBe(false);
  });
});

describe('probeUrl', () => {
  const body = { cancel: () => Promise.resolve() };

  it('reports a 2xx or a sign-in redirect as reachable', async () => {
    for (const status of [200, 302]) {
      fetchMock.mockResolvedValue({ status, body } as unknown as Response);
      await expect(probeUrl('https://agents.example.com')).resolves.toMatchObject({
        url: 'https://agents.example.com',
        reachable: true,
        httpStatus: status,
      });
    }
  });

  it('reports a server error as unreachable but keeps the status', async () => {
    fetchMock.mockResolvedValue({ status: 502, body } as unknown as Response);
    await expect(probeUrl('https://agents.example.com')).resolves.toMatchObject({
      reachable: false,
      httpStatus: 502,
    });
  });

  it('reports a refused URL as unreachable without probing it', async () => {
    const result = await probeUrl('http://10.0.0.5/health');
    expect(result).toMatchObject({ url: 'http://10.0.0.5/health', reachable: false });
    expect(result.httpStatus).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a failed probe as unreachable rather than throwing', async () => {
    fetchMock.mockRejectedValue(new Error('The operation was aborted due to timeout'));
    const result = await probeUrl('https://agents.example.com');
    expect(result.reachable).toBe(false);
    expect(result.httpStatus).toBeUndefined();
    expect(Date.parse(result.checkedAt)).not.toBeNaN();
  });

  it('never reads the response body', async () => {
    const cancel = vi.fn(() => Promise.resolve());
    fetchMock.mockResolvedValue({ status: 200, body: { cancel } } as unknown as Response);
    await probeUrl('https://agents.example.com');
    expect(cancel).toHaveBeenCalled();
    const [, init] = fetchMock.mock.calls[0];
    expect(init.redirect).toBe('manual');
  });
});
