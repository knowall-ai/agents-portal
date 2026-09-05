import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { ADMIN_ROLE, VIEWER_ROLE } from '@/lib/roles';

// Only the NextAuth cookie reader and the network are stubbed; the token
// exchange, its caching and the role mapping run for real.
const getToken = vi.hoisted(() => vi.fn());
vi.mock('next-auth/jwt', () => ({ getToken }));

import {
  FOUNDRY_SCOPE,
  GRAPH_SCOPE,
  forbiddenForViewers,
  getResourceToken,
  getUserContext,
  type UserContext,
} from './tokens';

const fetchMock = vi.fn();

/** A fresh refresh token per test, so no test can be served another's cache entry. */
function context(overrides: Partial<UserContext> = {}): UserContext {
  return {
    armToken: 'arm',
    refreshToken: `refresh-${Math.random()}`,
    tenantId: 'tenant-1',
    userId: 'user',
    roles: [],
    isAdmin: true,
    ...overrides,
  };
}

function tokenResponse(body: unknown, ok = true, status = ok ? 200 : 400) {
  return { ok, status, json: async () => body } as unknown as Response;
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  getToken.mockReset();
  vi.stubEnv('AZURE_AD_CLIENT_ID', 'client-id');
  vi.stubEnv('AZURE_AD_CLIENT_SECRET', 'client-secret');
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('getResourceToken', () => {
  it('exchanges the refresh token for the requested scope', async () => {
    fetchMock.mockResolvedValue(tokenResponse({ access_token: 'foundry-token' }));

    await expect(getResourceToken(context(), FOUNDRY_SCOPE)).resolves.toBe('foundry-token');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token');
    expect(init.method).toBe('POST');
    const body = new URLSearchParams(init.body as URLSearchParams);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('scope')).toBe(FOUNDRY_SCOPE);
    expect(body.get('client_id')).toBe('client-id');
  });

  it('returns null without calling Entra when the session has no refresh token', async () => {
    await expect(getResourceToken(context({ refreshToken: undefined }), GRAPH_SCOPE)).resolves.toBe(
      null
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('caches a success, and keys the cache by scope', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse({ access_token: 'foundry-token' }));
    fetchMock.mockResolvedValueOnce(tokenResponse({ access_token: 'graph-token' }));
    const ctx = context();

    await expect(getResourceToken(ctx, FOUNDRY_SCOPE)).resolves.toBe('foundry-token');
    await expect(getResourceToken(ctx, GRAPH_SCOPE)).resolves.toBe('graph-token');
    // Both are now cached: a third call for either scope exchanges nothing
    await expect(getResourceToken(ctx, FOUNDRY_SCOPE)).resolves.toBe('foundry-token');
    await expect(getResourceToken(ctx, GRAPH_SCOPE)).resolves.toBe('graph-token');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns null when the exchange reports missing consent, rather than throwing', async () => {
    fetchMock.mockResolvedValue(
      tokenResponse(
        {
          error: 'invalid_grant',
          error_description: 'AADSTS65001: The user has not consented',
        },
        false,
        400
      )
    );

    await expect(getResourceToken(context(), GRAPH_SCOPE)).resolves.toBe(null);
  });

  it('remembers a failed exchange briefly, then tries again', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T10:00:00Z'));
    const ctx = context();
    fetchMock.mockResolvedValue(tokenResponse({ error: 'invalid_grant' }, false, 400));

    await expect(getResourceToken(ctx, GRAPH_SCOPE)).resolves.toBe(null);
    // Inside the 15 s negative-cache window: no second round trip
    vi.setSystemTime(new Date('2026-01-01T10:00:10Z'));
    await expect(getResourceToken(ctx, GRAPH_SCOPE)).resolves.toBe(null);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Past it, the exchange is retried — and can now succeed
    vi.setSystemTime(new Date('2026-01-01T10:00:20Z'));
    fetchMock.mockResolvedValue(tokenResponse({ access_token: 'graph-token' }));
    await expect(getResourceToken(ctx, GRAPH_SCOPE)).resolves.toBe('graph-token');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // And the success is kept for much longer than the failure was
    vi.setSystemTime(new Date('2026-01-01T10:02:00Z'));
    await expect(getResourceToken(ctx, GRAPH_SCOPE)).resolves.toBe('graph-token');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('getUserContext', () => {
  const req = {} as NextRequest;

  it('returns null when there is no session token', async () => {
    getToken.mockResolvedValue(null);
    await expect(getUserContext(req)).resolves.toBe(null);
  });

  it('returns null when the session carries an error instead of a usable token', async () => {
    getToken.mockResolvedValue({ accessToken: 'arm', error: 'RefreshAccessTokenError' });
    await expect(getUserContext(req)).resolves.toBe(null);
  });

  it('maps the JWT onto the user context, with the admin role read from it', async () => {
    getToken.mockResolvedValue({
      accessToken: 'arm',
      refreshToken: 'refresh',
      tenantId: 'tenant-1',
      id: 'user-1',
      roles: [ADMIN_ROLE],
    });

    await expect(getUserContext(req)).resolves.toEqual({
      armToken: 'arm',
      refreshToken: 'refresh',
      tenantId: 'tenant-1',
      userId: 'user-1',
      roles: [ADMIN_ROLE],
      isAdmin: true,
    });
  });

  it('falls back to the subject and the common tenant, and a viewer is not an admin', async () => {
    getToken.mockResolvedValue({ accessToken: 'arm', sub: 'subject', roles: [VIEWER_ROLE] });

    await expect(getUserContext(req)).resolves.toMatchObject({
      tenantId: 'common',
      userId: 'subject',
      isAdmin: false,
    });
  });
});

describe('forbiddenForViewers', () => {
  it('answers 403 naming the role the caller is missing', async () => {
    const response = forbiddenForViewers();
    expect(response.status).toBe(403);
    expect((await response.json()).error).toMatch(/Portal\.Admin/);
  });
});
