import type { NextConfig } from 'next';
import packageJson from './package.json';

const nextConfig: NextConfig = {
  // Expose app version at build time (from package.json)
  env: {
    NEXT_PUBLIC_APP_VERSION: packageJson.version,
  },

  // Standalone output for Azure App Service deployment
  output: 'standalone',
};

export default nextConfig;
