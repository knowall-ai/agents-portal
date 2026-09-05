import { describe, expect, it } from 'vitest';
import {
  allowedTenants,
  isAllowedTenant,
  parseTenantSelectRequest,
  registryTenant,
} from './tenants';

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';

describe('allowedTenants', () => {
  it('prefers the explicit list, then the home tenant, then nothing', () => {
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
  it('refuses everyone when no allow-list can be derived', () => {
    expect(isAllowedTenant(A, {})).toBe(false);
    expect(isAllowedTenant(undefined, {})).toBe(false);
    expect(isAllowedTenant(A, { AZURE_AD_TENANT_ID: 'common' })).toBe(false);
    expect(isAllowedTenant(A, { AZURE_AD_TENANT_ID: 'organizations' })).toBe(false);
    expect(isAllowedTenant(A, { AZURE_AD_ALLOWED_TENANTS: '  ,  ' })).toBe(false);
  });
});

describe('registryTenant', () => {
  it('is the home tenant, or the only allowed tenant', () => {
    expect(registryTenant({ AZURE_AD_TENANT_ID: A.toUpperCase() })).toBe(A);
    expect(registryTenant({ AZURE_AD_TENANT_ID: 'common', AZURE_AD_ALLOWED_TENANTS: A })).toBe(A);
  });
  it('is null when several tenants are trusted, or none is known', () => {
    expect(registryTenant({ AZURE_AD_ALLOWED_TENANTS: `${A},${B}` })).toBeNull();
    expect(registryTenant({ AZURE_AD_TENANT_ID: 'common' })).toBeNull();
    expect(registryTenant({})).toBeNull();
  });
});

describe('parseTenantSelectRequest', () => {
  it('accepts only an object with a single tenantId string', () => {
    expect(parseTenantSelectRequest({ tenantId: A })).toBe(A);
    expect(parseTenantSelectRequest({ tenantId: 'common' })).toBe('common');
    expect(parseTenantSelectRequest({ tenantId: 'organizations' })).toBe('organizations');
  });
  it('rejects malformed bodies instead of coercing them', () => {
    expect(parseTenantSelectRequest(null)).toBeNull();
    expect(parseTenantSelectRequest([A])).toBeNull();
    expect(parseTenantSelectRequest('common')).toBeNull();
    expect(parseTenantSelectRequest({ tenantId: [A] })).toBeNull();
    expect(parseTenantSelectRequest({ tenantId: A, extra: 1 })).toBeNull();
    expect(parseTenantSelectRequest({ tenantId: 'not-a-tenant' })).toBeNull();
    expect(parseTenantSelectRequest({})).toBeNull();
  });
});
