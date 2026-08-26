import type { Metadata, Viewport } from 'next';
import { Geist_Mono, Plus_Jakarta_Sans } from 'next/font/google';
import { SessionProvider } from 'next-auth/react';
import { Toaster } from '@/components/ui/sonner';
import { ThemeProvider } from '@/components/theme-provider';
import { LocaleProvider } from '@/components/providers/LocaleProvider';
import { ThemeColorProvider } from '@/components/providers/ThemeColorProvider';
import { GlobalLoadingBar } from '@/components/GlobalLoadingBar';
import { getThemeInitScript } from '@/lib/theme/theme-init-script';
import './globals.css';

/*
 * Plus Jakarta Sans by Tokotype — drawn in Jakarta, for Jakarta's city
 * identity. Warmer and more humanist than the engineered-neutral grotesque it
 * replaces, which is what made the interface read as stiff, and a face with an
 * actual reason to be on an Indonesian product rather than a safe default.
 * Weights are pinned so headings can carry real weight contrast.
 */
const appSans = Plus_Jakarta_Sans({
  variable: '--font-app-sans',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Elorae ERP - Procurement & Production Management',
  description: 'Enterprise Resource Planning for Textile/Garment Manufacturing',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Elorae ERP',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#0f172a',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="id"
      className={`${appSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <link rel="apple-touch-icon" href="/icons/icon-192x192.png" />
        <script
          id="elorae-theme-init"
          dangerouslySetInnerHTML={{ __html: getThemeInitScript() }}
        />
      </head>
      <body className="font-sans antialiased" suppressHydrationWarning>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <GlobalLoadingBar />
          <SessionProvider>
            <ThemeColorProvider>
              <LocaleProvider>{children}</LocaleProvider>
            </ThemeColorProvider>
          </SessionProvider>
          <Toaster position="top-center" richColors />
        </ThemeProvider>
      </body>
    </html>
  );
}
