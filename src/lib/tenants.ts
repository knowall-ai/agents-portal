/**
 * Which Entra tenants may sign in. AZURE_AD_ALLOWED_TENANTS is a comma-separated
 * list of tenant ids; when unset, AZURE_AD_TENANT_ID is the only allowed tenant
 * if it names one. With neither set (authority "common") every tenant is
 * accepted, which is only acceptable while nothing sensitive is deployed.
 */
export function allowedTenants(
  env: Record<string, string | undefined> = process.env
): string[] | null {
  const list = (env.AZURE_AD_ALLOWED_TENANTS ?? '')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  if (list.length > 0) return list;
  const home = env.AZURE_AD_TENANT_ID?.trim().toLowerCase();
  return home && home !== 'common' && home !== 'organizations' ? [home] : null;
}

export function isAllowedTenant(
  tenantId: string | undefined,
  env: Record<string, string | undefined> = process.env
): boolean {
  const allowed = allowedTenants(env);
  if (allowed === null) return true;
  return !!tenantId && allowed.includes(tenantId.toLowerCase());
}
