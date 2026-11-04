import type { NextConfig } from 'next';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import withPWA from 'next-pwa';
import withSerwistInit from "@serwist/next";

const here = path.dirname(fileURLToPath(import.meta.url));
const appVersion: string = JSON.parse(readFileSync(path.join(here, 'package.json'), 'utf8')).version;

const nextConfig: NextConfig = {
  output: "standalone",
  // The login footer shows this instead of a hardcoded "v1.0.0" that never moved.
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
  },
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
  // Packer videos can be tens of MB. Default proxy body buffer is 10MB and
  // truncates multipart → "Failed to parse body as FormData".
  experimental: {
    proxyClientMaxBodySize: "100mb",
    /* The Master Produk import sends up to 1,000 parsed rows to its server actions as JSON. */
    serverActions: {
      bodySizeLimit: "3mb",
    },
  },
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
    /**
     * `@undecaf/zbar-wasm` exposes its inlined WASM build only behind a custom export
     * condition, `zbar-inlined` — its `exports` map declares no subpath for it, so the file
     * cannot be imported by path (that is what broke the web image build once already).
     * Without this condition the bare specifier resolves to the non-inlined build, which
     * fetches a separate .wasm at runtime; the barcode scanner still works, so the symptom
     * is a slower first scan rather than an error.
     *
     * Prepended rather than assigned, because Next sets its own conditions and this callback
     * runs for the SERVER compilation too — hardcoding a browser-shaped list here would be
     * wrong for half its invocations. The condition is inert for every package that does not
     * declare it, which today is all of them but this one. Turbopack (dev) exposes no
     * equivalent, so dev gets the non-inlined build.
     */
    const resolve = config.resolve ?? {};
    resolve.conditionNames = ["zbar-inlined", ...(resolve.conditionNames ?? ["..."])];
    config.resolve = resolve;
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
