import { afterEach, describe, expect, it, vi } from 'vitest';
import { friendlySkuName, getUserLicensing, getUserPresence, summarisePlans } from './graph';

describe('friendlySkuName', () => {
  it('maps known SKUs and prettifies unknown ones', () => {
    expect(friendlySkuName('ENTERPRISEPACK')).toBe('Office 365 E3');
    expect(friendlySkuName('PHONESYSTEM_VIRTUALUSER')).toBe(
      'Microsoft Teams Phone Resource Account'
    );
    expect(friendlySkuName('SOME_NEW_SKU')).toBe('SOME NEW SKU');
  });
});

describe('summarisePlans', () => {
  it('lists provisioned capabilities once and counts the rest', () => {
    const { capabilities, otherPlans } = summarisePlans([
      { servicePlanName: 'TEAMS1', provisioningStatus: 'Success' },
      { servicePlanName: 'EXCHANGE_S_ENTERPRISE', provisioningStatus: 'Success' },
      { servicePlanName: 'SHAREPOINTENTERPRISE', provisioningStatus: 'Success' },
      { servicePlanName: 'SHAREPOINTSTANDARD', provisioningStatus: 'Success' },
      { servicePlanName: 'SWAY', provisioningStatus: 'Success' },
      { servicePlanName: 'YAMMER_ENTERPRISE', provisioningStatus: 'Disabled' },
    ]);
    expect(capabilities).toEqual(['Teams', 'Exchange mailbox', 'SharePoint & OneDrive']);
    expect(otherPlans).toBe(1);
  });
});

describe('user lookups', () => {
  // Stands in for the agent's own address; percent-encoding it is not redaction,
  // so neither spelling may reach a thrown message.
  const account = 'agent identity+secret';
  const leaked = new RegExp(`${account}|${encodeURIComponent(account)}`);

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const failWith = (status: number) =>
    vi.fn(async () => new Response('{}', { status, statusText: 'Nope' }));

  it('keeps the account out of a failed presence lookup', async () => {
    vi.stubGlobal('fetch', failWith(404));
    await expect(getUserPresence('token', account)).rejects.toThrow('Graph 404 presence lookup');
    await expect(getUserPresence('token', account)).rejects.not.toThrow(leaked);
  });

  it('keeps the account out of a failed licence lookup', async () => {
    vi.stubGlobal('fetch', failWith(403));
    await expect(getUserLicensing('token', account)).rejects.toThrow('Graph 403 licence lookup');
    await expect(getUserLicensing('token', account)).rejects.not.toThrow(leaked);
  });

  it('reports a transport failure without the account either', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error(`connect ECONNREFUSED for /users/${encodeURIComponent(account)}`);
      })
    );
    await expect(getUserPresence('token', account)).rejects.toThrow(
      'presence lookup failed: Error'
    );
    await expect(getUserPresence('token', account)).rejects.not.toThrow(leaked);
  });
});
