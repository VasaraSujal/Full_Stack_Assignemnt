import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['pdf-parse', 'mammoth'],
  outputFileTracingIncludes: {
    '/api/**/*': ['./src/assets/fonts/**/*'],
  },
};

export default nextConfig;
