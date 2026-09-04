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
 * Until app roles are assigned, a token carries no `roles` claim and everyone
 * is treated as an admin, which is today's behaviour. Once roles are in place,
 * set PORTAL_REQUIRE_ROLES=1 so a missing claim means viewer, not admin.
 */
export function isPortalAdmin(
  roles: readonly string[] | undefined,
  requireRoles = process.env.PORTAL_REQUIRE_ROLES === '1'
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
