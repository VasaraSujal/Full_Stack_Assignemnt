import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['pdf-parse', 'mammoth', 'pdfkit'],
  outputFileTracingIncludes: {
    '/api/**/*': [
      './src/assets/fonts/**/*',
      './node_modules/pdf-parse/**/*',
      './node_modules/pdfjs-dist/**/*',
      './node_modules/pdfkit/js/data/**/*',
      './node_modules/pdfkit/js/standard-fonts/**/*',
    ],
  },
};

export default nextConfig;
