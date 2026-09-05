/**
 * Portal roles come from Entra app roles on the portal's app registration and
 * arrive in the ID token's `roles` claim. Azure RBAC decides *which* agents a
 * user can see (Resource Graph only returns what their token can read); app
 * roles decide *what* the portal shows for them.
 */

/** KnowAll staff: every tab, costs, permissions and the Boost action. */
export const ADMIN_ROLE = 'Portal.Admin';
/** Customers: their agents' Overview, Skills, Activity and Brain, read-only. */
export const VIEWER_ROLE = 'Portal.Viewer';

/**
 * Whether a token must carry an app role to be an admin. Production fails
 * closed: a missing `roles` claim means viewer unless PORTAL_REQUIRE_ROLES=0
 * says otherwise. Development is open until PORTAL_REQUIRE_ROLES=1, so a
 * local app registration without roles still shows every tab.
 */
export function rolesRequired(
  env: Partial<Record<'NODE_ENV' | 'PORTAL_REQUIRE_ROLES', string>> = process.env
): boolean {
  const flag = env.PORTAL_REQUIRE_ROLES;
  if (flag === '1') return true;
  if (flag === '0') return false;
  return env.NODE_ENV === 'production';
}

export function isPortalAdmin(
  roles: readonly string[] | undefined,
  requireRoles = rolesRequired()
): boolean {
  if (roles?.includes(ADMIN_ROLE)) return true;
  if (requireRoles) return false;
  return !roles || roles.length === 0;
}

/** Read the `roles` claim from an ID token without verifying it (NextAuth already did). */
export function rolesFromIdToken(idToken?: string): string[] {
  if (!idToken) return [];
  try {
    const payload = idToken.split('.')[1];
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      roles?: unknown;
    };
    return Array.isArray(claims.roles) ? claims.roles.filter((r) => typeof r === 'string') : [];
  } catch {
    return [];
  }
}
