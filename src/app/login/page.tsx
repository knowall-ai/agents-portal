'use client';

import { signIn, useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { AgentDashboardIcon } from '@/components/common';

const errorMessages: Record<string, string> = {
  OAuthCallback: 'Microsoft sign-in failed. Check the redirect URI on the app registration.',
  AccessDenied: 'Your account is not allowed to sign in to this tenant.',
  Configuration: 'Sign-in is not configured. Set AZURE_AD_CLIENT_ID and AZURE_AD_CLIENT_SECRET.',
};

function LoginView() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const error = params.get('error');

  useEffect(() => {
    if (session) router.push('/');
  }, [session, router]);

  if (status === 'loading') {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        style={{ backgroundColor: 'var(--background)' }}
      >
        <Loader2 className="h-8 w-8 animate-spin" style={{ color: 'var(--primary)' }} />
      </div>
    );
  }

  return (
    <div
      className="flex min-h-screen items-center justify-center"
      style={{ backgroundColor: 'var(--background)' }}
    >
      <div className="card w-full max-w-md p-8">
        <div className="mb-8 flex flex-col items-center">
          <AgentDashboardIcon size={64} className="mb-4" />
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            <span style={{ color: 'var(--primary)' }}>Agent</span> Dashboard
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
            by KnowAll
          </p>
        </div>

        <div className="mb-8 text-center">
          <h2 className="mb-2 text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
            Welcome back
          </h2>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Sign in with your Microsoft account to see the agents in your tenant
          </p>
        </div>

        {error && (
          <div
            className="mb-6 rounded-md border p-3 text-sm"
            style={{
              borderColor: 'var(--status-offline)',
              color: 'var(--text-primary)',
              backgroundColor: 'rgba(239,68,68,0.1)',
            }}
            role="alert"
          >
            {errorMessages[error] ?? `Sign-in error: ${error}`}
          </div>
        )}

        <button
          onClick={() => signIn('azure-ad', { callbackUrl: '/' })}
          className="flex w-full items-center justify-center gap-3 rounded-lg px-4 py-3 font-medium transition-colors"
          style={{
            backgroundColor: 'var(--surface-hover)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border)',
            cursor: 'pointer',
          }}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 21 21"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <rect x="1" y="1" width="9" height="9" fill="#f25022" />
            <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
            <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
            <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
          </svg>
          Sign in with Microsoft
        </button>

        <div className="mt-8 border-t pt-6" style={{ borderColor: 'var(--border)' }}>
          <p className="text-center text-xs" style={{ color: 'var(--text-muted)' }}>
            Agent Dashboard reads Azure Resource Graph as you. You&apos;ll only see agents in
            subscriptions you have access to, including ones delegated via Azure Lighthouse.
          </p>
        </div>

        <div className="mt-6 text-center">
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Need help?{' '}
            <a
              href="mailto:support@knowall.ai"
              className="hover:underline"
              style={{ color: 'var(--primary)' }}
            >
              Contact support
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div
          className="flex min-h-screen items-center justify-center"
          style={{ backgroundColor: 'var(--background)' }}
        >
          <Loader2 className="h-8 w-8 animate-spin" style={{ color: 'var(--primary)' }} />
        </div>
      }
    >
      <LoginView />
    </Suspense>
  );
}
