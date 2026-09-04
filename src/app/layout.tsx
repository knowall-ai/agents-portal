import type { Metadata } from 'next';
import { Toaster } from 'sonner';
import SessionProvider from '@/components/providers/SessionProvider';
import './globals.css';

const siteUrl = process.env.NEXTAUTH_URL || 'https://agents.knowall.ai';

export const metadata: Metadata = {
  title: 'Agents Portal - AI Agent Monitoring by KnowAll',
  description:
    'Monitor KnowAll AI and customer AI agents across Azure tenants. See status, skills and recent activity for every agent in one place.',
  keywords: ['ai agents', 'monitoring', 'azure', 'openclaw', 'ai foundry', 'dashboard', 'knowall'],
  authors: [{ name: 'KnowAll AI', url: 'https://knowall.ai' }],
  creator: 'KnowAll AI',
  publisher: 'KnowAll AI',
  metadataBase: new URL(siteUrl),
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: siteUrl,
    siteName: 'Agents Portal',
    title: 'Agents Portal - AI Agent Monitoring by KnowAll',
    description:
      'Monitor KnowAll AI and customer AI agents across Azure tenants. See status, skills and recent activity for every agent in one place.',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Agents Portal - AI Agent Monitoring',
        type: 'image/png',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Agents Portal - AI Agent Monitoring by KnowAll',
    description:
      'Monitor KnowAll AI and customer AI agents across Azure tenants. See status, skills and recent activity for every agent in one place.',
    images: ['/og-image.png'],
  },
  robots: {
    index: true,
    follow: true,
  },
  other: {
    'msapplication-TileColor': '#22c55e',
    'theme-color': '#0f1117',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">
        <SessionProvider>{children}</SessionProvider>
        <Toaster theme="dark" position="bottom-right" richColors closeButton />
      </body>
    </html>
  );
}
