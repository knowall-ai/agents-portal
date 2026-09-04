import { describe, expect, it } from 'vitest';
import { ADMIN_ROLE, VIEWER_ROLE, isPortalAdmin, rolesFromIdToken } from './roles';

function idToken(claims: Record<string, unknown>): string {
  const b64 = (s: string) => Buffer.from(s).toString('base64url');
  return `${b64('{"alg":"none"}')}.${b64(JSON.stringify(claims))}.sig`;
}

describe('isPortalAdmin', () => {
  it('admits the admin role and refuses a viewer-only token', () => {
    expect(isPortalAdmin([ADMIN_ROLE], false)).toBe(true);
    expect(isPortalAdmin([ADMIN_ROLE, VIEWER_ROLE], true)).toBe(true);
    expect(isPortalAdmin([VIEWER_ROLE], false)).toBe(false);
    expect(isPortalAdmin([VIEWER_ROLE], true)).toBe(false);
  });

  it('treats a missing claim as admin only while roles are not required', () => {
    expect(isPortalAdmin(undefined, false)).toBe(true);
    expect(isPortalAdmin([], false)).toBe(true);
    expect(isPortalAdmin(undefined, true)).toBe(false);
    expect(isPortalAdmin([], true)).toBe(false);
  });
});

describe('rolesFromIdToken', () => {
  it('reads string roles and ignores anything else', () => {
    expect(rolesFromIdToken(idToken({ roles: [ADMIN_ROLE, 7, VIEWER_ROLE] }))).toEqual([
      ADMIN_ROLE,
      VIEWER_ROLE,
    ]);
    expect(rolesFromIdToken(idToken({ tid: 'x' }))).toEqual([]);
    expect(rolesFromIdToken('not.a.token')).toEqual([]);
    expect(rolesFromIdToken(undefined)).toEqual([]);
  });
});
