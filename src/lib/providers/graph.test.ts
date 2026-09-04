import { describe, expect, it } from 'vitest';
import { friendlySkuName, summarisePlans } from './graph';

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
