import type { NextConfig } from 'next';
import path from 'node:path';
import withPWA from 'next-pwa';

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // Next.js 16 uses Turbopack by default; empty config silences webpack conflict (PWA is disabled in dev)
  turbopack: {
    root: path.resolve(process.cwd()),
  },
  webpack: (config, { isServer }) => {
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
