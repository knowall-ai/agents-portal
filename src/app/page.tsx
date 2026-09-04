'use client';

import { Suspense } from 'react';
import { useSession } from 'next-auth/react';
import { MainLayout } from '@/components/layout';
import { LoadingSpinner } from '@/components/common';
import { AgentsView } from '@/components/agents';
import LandingPage from '@/components/LandingPage';

export default function HomePage() {
  const { data: session, status } = useSession();

  if (status === 'loading') {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        style={{ backgroundColor: 'var(--background)' }}
      >
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  // Show landing page for unauthenticated users
  if (!session) {
    return <LandingPage />;
  }

  return (
    <MainLayout>
      <Suspense fallback={<LoadingSpinner className="py-12" />}>
        <AgentsView />
      </Suspense>
    </MainLayout>
  );
}
