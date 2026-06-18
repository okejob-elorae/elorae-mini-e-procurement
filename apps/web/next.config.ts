import type { NextConfig } from 'next';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import withPWA from 'next-pwa';

const here = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    unoptimized: true,
  },
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-mariadb", "mariadb"],
  async redirects() {
    return [
      { source: '/backoffice/reports', destination: '/backoffice/dashboard', permanent: false },
    ];
  },
  // Next.js 16 uses Turbopack by default; empty config silences webpack conflict (PWA is disabled in dev)
  turbopack: {
    root: path.join(here, '../..'),
  },
  outputFileTracingRoot: path.join(here, '../..'),
  webpack: (config) => {
    // PWA configuration uses webpack (production build)
    return config;
  },
};

const config = withPWA({
  dest: 'public',
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === 'development',
  runtimeCaching: [
    {
      urlPattern: /^https?.*/,
      handler: 'NetworkFirst',
      options: {
        cacheName: 'offlineCache',
        expiration: {
          maxEntries: 200,
          maxAgeSeconds: 24 * 60 * 60,
        },
      },
    },
  ],
})(nextConfig);

export default config;
