/**
 * Which Entra tenants may sign in. AZURE_AD_ALLOWED_TENANTS is a comma-separated
 * list of tenant ids; when unset, AZURE_AD_TENANT_ID is the only allowed tenant
 * if it names one. With neither set (authority "common" or "organizations")
 * there is no allow-list at all.
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

/**
 * Sign-in is refused unless the tenant is on the allow-list. Without a list the
 * app registration is multi-tenant with nothing to check against, so every
 * Microsoft account would be admitted: refuse instead, and deploy with
 * AZURE_AD_ALLOWED_TENANTS set.
 */
export function isAllowedTenant(
  tenantId: string | undefined,
  env: Record<string, string | undefined> = process.env
): boolean {
  const allowed = allowedTenants(env);
  if (allowed === null) return false;
  return !!tenantId && allowed.includes(tenantId.toLowerCase());
}

const TENANT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$|^common$|^organizations$/i;

/**
 * The tenant id in a `POST /api/tenants/select` body. The body must be an
 * object with a single `tenantId` string naming a tenant or an authority;
 * arrays, primitives, unknown keys and non-string ids are rejected rather than
 * coerced into the regex.
 */
export function parseTenantSelectRequest(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const { tenantId, ...rest } = body as Record<string, unknown>;
  if (Object.keys(rest).length > 0) return null;
  if (typeof tenantId !== 'string' || !TENANT_ID.test(tenantId)) return null;
  return tenantId;
}

/**
 * The tenant `config/agents.json` describes: AZURE_AD_TENANT_ID when it names a
 * tenant, otherwise the single tenant in AZURE_AD_ALLOWED_TENANTS. Null when the
 * portal trusts several tenants, in which case registry entries must name their
 * own `subscriptionIds` to claim resources — resource-group names are only
 * unique inside a subscription.
 */
export function registryTenant(
  env: Record<string, string | undefined> = process.env
): string | null {
  const home = env.AZURE_AD_TENANT_ID?.trim().toLowerCase();
  if (home && home !== 'common' && home !== 'organizations') return home;
  const allowed = allowedTenants(env);
  return allowed?.length === 1 ? allowed[0] : null;
}
