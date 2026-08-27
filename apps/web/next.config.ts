import type { NextConfig } from 'next';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import withPWA from 'next-pwa';
import withSerwistInit from "@serwist/next";

const here = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    unoptimized: true,
  },
  /*
   * `tesseract.js` DIBIARKAN EKSTERNAL, tidak ikut dibundel.
   *
   * Ia memuat inti WASM-nya lewat `require` biasa lalu menjalankannya di worker
   * thread dengan jalur berkas. Sebuah bundler yang memindahkan berkas-berkas
   * itu memutus keduanya, dan putusnya baru ketahuan saat berjalan — bukan saat
   * dibangun. Model bahasanya sendiri ada di `apps/web/tessdata` dan harus ikut
   * disalin ke image (lihat Dockerfile).
   */
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-mariadb", "mariadb", "@prisma/adapter-pg", "pg", "tesseract.js"],
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

const withSerwist = withSerwistInit({
  swSrc: "app/pwa/sw.ts",
  swDest: "public/pwa/sw.js",
  scope: "/pwa/",
  cacheOnNavigation: false,
  disable: process.env.NODE_ENV === "development",
});

export default withSerwist(config);
