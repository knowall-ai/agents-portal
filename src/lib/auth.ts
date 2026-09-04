// NextAuth configuration for Microsoft Entra ID (Azure AD)
//
// Sign-in requests an Azure Resource Manager (ARM) token so the dashboard can
// query Azure Resource Graph and the Activity Log as the signed-in user. Tokens
// for other resources (Azure AI Foundry, Microsoft Graph) are obtained on the
// server by exchanging the refresh token — see src/lib/tokens.ts.
import type { NextAuthOptions } from 'next-auth';
import type { JWT } from 'next-auth/jwt';
import AzureADProvider from 'next-auth/providers/azure-ad';

const isDev = process.env.NODE_ENV === 'development';

/** Cookie that remembers which Entra tenant the user chose to sign in to. */
export const TENANT_COOKIE = 'agents-portal-tenant';

/** Resource scope requested at sign-in: Azure Resource Manager. */
export const ARM_SCOPE = 'https://management.azure.com/user_impersonation';

const SIGN_IN_SCOPES = ['openid', 'profile', 'email', 'offline_access', ARM_SCOPE];

declare module 'next-auth' {
  interface Session {
    tenantId?: string;
    error?: string;
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    accessTokenExpires?: number;
    tenantId?: string;
    error?: string;
    id?: string;
  }
}

function redactSensitive(obj: unknown): unknown {
  if (!obj || typeof obj !== 'object') return obj;
  const sensitiveKeys = ['accesstoken', 'refreshtoken', 'access_token', 'refresh_token', 'secret'];
  const redacted = { ...(obj as Record<string, unknown>) };
  for (const key of Object.keys(redacted)) {
    if (sensitiveKeys.some((sk) => key.toLowerCase().includes(sk))) {
      redacted[key] = '[REDACTED]';
    } else if (typeof redacted[key] === 'object' && redacted[key] !== null) {
      redacted[key] = redactSensitive(redacted[key]);
    }
  }
  return redacted;
}

/** Read the `tid` claim from an ID token without verifying it (NextAuth already verified it). */
function tenantFromIdToken(idToken?: string): string | undefined {
  if (!idToken) return undefined;
  try {
    const payload = idToken.split('.')[1];
    const json = Buffer.from(payload, 'base64url').toString('utf8');
    const claims = JSON.parse(json) as { tid?: string };
    return claims.tid;
  } catch {
    return undefined;
  }
}

function tokenEndpoint(tenantId: string): string {
  return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
}

/**
 * Build NextAuth options. `tenantId` selects the Entra authority used for the
 * next sign-in (from the tenant switcher); it defaults to AZURE_AD_TENANT_ID or
 * "common", which sends the user to their home tenant.
 */
export function getAuthOptions(tenantId?: string): NextAuthOptions {
  const authority = tenantId || process.env.AZURE_AD_TENANT_ID || 'common';

  return {
    debug: isDev,
    providers: [
      AzureADProvider({
        clientId: process.env.AZURE_AD_CLIENT_ID ?? '',
        clientSecret: process.env.AZURE_AD_CLIENT_SECRET ?? '',
        tenantId: authority,
        authorization: {
          params: {
            scope: SIGN_IN_SCOPES.join(' '),
          },
        },
      }),
    ],
    callbacks: {
      async jwt({ token, account, user }) {
        if (account && user) {
          return {
            ...token,
            accessToken: account.access_token,
            refreshToken: account.refresh_token,
            accessTokenExpires: account.expires_at ? account.expires_at * 1000 : undefined,
            tenantId: tenantFromIdToken(account.id_token) ?? authority,
            id: user.id,
          } as JWT;
        }

        if (token.accessTokenExpires && Date.now() < token.accessTokenExpires - 60_000) {
          return token;
        }

        return refreshAccessToken(token);
      },
      async session({ session, token }) {
        // Tokens stay server-side (read from the JWT in API routes via getUserContext);
        // only non-sensitive claims reach the browser.
        session.tenantId = token.tenantId;
        session.error = token.error;
        if (token.id) session.user.id = token.id;
        return session;
      },
    },
    pages: {
      signIn: '/login',
      error: '/login',
    },
    session: {
      strategy: 'jwt',
      maxAge: 24 * 60 * 60,
    },
    logger: {
      error(code, metadata) {
        console.error('NextAuth error:', code, redactSensitive(metadata));
      },
      warn(code) {
        if (isDev) console.warn('NextAuth warning:', code);
      },
      debug(code, metadata) {
        if (isDev) console.log('NextAuth debug:', code, redactSensitive(metadata));
      },
    },
  };
}

/** Default options — used by getServerSession, where the authority does not matter. */
export const authOptions: NextAuthOptions = getAuthOptions();

async function refreshAccessToken(token: JWT): Promise<JWT> {
  if (!token.refreshToken) {
    return { ...token, error: 'RefreshAccessTokenError' };
  }
  try {
    const response = await fetch(tokenEndpoint(token.tenantId ?? 'common'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.AZURE_AD_CLIENT_ID ?? '',
        client_secret: process.env.AZURE_AD_CLIENT_SECRET ?? '',
        grant_type: 'refresh_token',
        refresh_token: token.refreshToken,
        scope: SIGN_IN_SCOPES.join(' '),
      }),
    });
    const data = await response.json();
    if (!response.ok) throw data;
    return {
      ...token,
      accessToken: data.access_token,
      accessTokenExpires: Date.now() + data.expires_in * 1000,
      refreshToken: data.refresh_token ?? token.refreshToken,
      error: undefined,
    };
  } catch (error) {
    console.error('Error refreshing access token:', redactSensitive(error));
    return { ...token, error: 'RefreshAccessTokenError' };
  }
}

export default authOptions;
