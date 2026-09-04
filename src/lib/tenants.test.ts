import { describe, expect, it } from 'vitest';
import { allowedTenants, isAllowedTenant } from './tenants';

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';

describe('allowedTenants', () => {
  it('prefers the explicit list, then the home tenant, then anything', () => {
    expect(allowedTenants({ AZURE_AD_ALLOWED_TENANTS: `${A}, ${B}` })).toEqual([A, B]);
    expect(allowedTenants({ AZURE_AD_TENANT_ID: A })).toEqual([A]);
    expect(allowedTenants({ AZURE_AD_TENANT_ID: 'common' })).toBeNull();
    expect(allowedTenants({})).toBeNull();
  });
});

describe('isAllowedTenant', () => {
  it('refuses unlisted and unknown tenants once a list exists', () => {
    const env = { AZURE_AD_ALLOWED_TENANTS: A };
    expect(isAllowedTenant(A, env)).toBe(true);
    expect(isAllowedTenant(A.toUpperCase(), env)).toBe(true);
    expect(isAllowedTenant(B, env)).toBe(false);
    expect(isAllowedTenant(undefined, env)).toBe(false);
  });
  it('accepts everyone only when no list can be derived', () => {
    expect(isAllowedTenant(B, {})).toBe(true);
    expect(isAllowedTenant(undefined, {})).toBe(true);
  });
});
