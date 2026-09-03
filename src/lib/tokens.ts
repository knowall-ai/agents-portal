// Server-side token exchange for resources other than ARM.
//
// Entra issues one access token per resource. The refresh token obtained at
// sign-in can be exchanged for an access token for any resource the user has
// consented to (Azure AI Foundry, Microsoft Graph), so API routes call
// getResourceToken() with the resource they need.
import { getToken } from 'next-auth/jwt';
import type { NextRequest } from 'next/server';
import { createHash } from 'crypto';
import { cached } from './cache';

export const FOUNDRY_SCOPE = 'https://ai.azure.com/.default';
export const GRAPH_SCOPE = 'https://graph.microsoft.com/User.Read';

export interface UserContext {
  /** ARM access token from the session */
  armToken: string;
  refreshToken?: string;
  tenantId: string;
  userId: string;
}

/** Load the caller's tokens from the NextAuth JWT cookie. Returns null when unauthenticated. */
export async function getUserContext(req: NextRequest): Promise<UserContext | null> {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token?.accessToken || token.error) return null;
  return {
    armToken: token.accessToken,
    refreshToken: token.refreshToken,
    tenantId: token.tenantId ?? 'common',
    userId: token.id ?? token.sub ?? 'unknown',
  };
}

/**
 * Exchange the refresh token for an access token to another resource.
 * Cached per (refresh token, scope) for a few minutes.
 */
export async function getResourceToken(ctx: UserContext, scope: string): Promise<string | null> {
  if (!ctx.refreshToken) return null;
  const key = `token:${scope}:${createHash('sha256').update(ctx.refreshToken).digest('hex')}`;

  return cached(
    key,
    async () => {
      const response = await fetch(
        `https://login.microsoftonline.com/${ctx.tenantId}/oauth2/v2.0/token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: process.env.AZURE_AD_CLIENT_ID ?? '',
            client_secret: process.env.AZURE_AD_CLIENT_SECRET ?? '',
            grant_type: 'refresh_token',
            refresh_token: ctx.refreshToken as string,
            scope,
          }),
        }
      );
      const data = await response.json();
      if (!response.ok) {
        console.warn(`Token exchange for ${scope} failed:`, data?.error, data?.error_description);
        return null;
      }
      return data.access_token as string;
    },
    5 * 60 * 1000
  );
}
