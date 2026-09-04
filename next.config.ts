import type { NextConfig } from 'next';
import packageJson from './package.json';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
];

const nextConfig: NextConfig = {
  // Expose app version at build time (from package.json)
  env: {
    NEXT_PUBLIC_APP_VERSION: packageJson.version,
  },

  // Standalone output for Azure App Service deployment
  output: 'standalone',

  // Never advertise the framework
  poweredByHeader: false,

  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
};

export default nextConfig;
