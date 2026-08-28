import type { Metadata, Viewport } from 'next';
import {
  Archivo,
  Bricolage_Grotesque,
  DM_Sans,
  Figtree,
  Fraunces,
  Gabarito,
  Geist,
  Geist_Mono,
  Instrument_Sans,
  Instrument_Serif,
  Inter,
  Manrope,
  Onest,
  Outfit,
  Plus_Jakarta_Sans,
  Poppins,
  Schibsted_Grotesk,
  Sora,
  Space_Grotesk,
  Syne,
  Unbounded,
} from 'next/font/google';
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
  variable: '--font-jakarta',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});


/*
 * Dua puluh pilihan huruf, dideklarasikan semua di sini.
 *
 * `next/font` menyimpan sendiri berkasnya (tidak memanggil Google saat
 * dijalankan) dan membuat satu variabel CSS per huruf. Peramban hanya MENGUNDUH
 * huruf yang benar-benar dipakai — sebuah `@font-face` yang tidak menyentuh
 * teks apa pun tidak pernah diambil. Jadi mendeklarasikan dua puluh menambah
 * waktu build, bukan berat halaman.
 *
 * Nama variabelnya harus sama persis dengan `lib/theme/fonts.ts`; ada tes yang
 * membandingkan keduanya, karena yang meleset hanya terlihat sebagai pilihan
 * yang diklik tapi tidak mengubah apa pun.
 */
const inter = Inter({ variable: '--font-inter', subsets: ['latin'], display: 'swap' });
const geist = Geist({ variable: '--font-geist', subsets: ['latin'], display: 'swap' });
const dmSans = DM_Sans({ variable: '--font-dm-sans', subsets: ['latin'], display: 'swap' });
const manrope = Manrope({ variable: '--font-manrope', subsets: ['latin'], display: 'swap' });
const figtree = Figtree({ variable: '--font-figtree', subsets: ['latin'], display: 'swap' });
const outfit = Outfit({ variable: '--font-outfit', subsets: ['latin'], display: 'swap' });
const onest = Onest({ variable: '--font-onest', subsets: ['latin'], display: 'swap' });
const schibsted = Schibsted_Grotesk({
  variable: '--font-schibsted',
  subsets: ['latin'],
  display: 'swap',
});
const archivo = Archivo({ variable: '--font-archivo', subsets: ['latin'], display: 'swap' });
const instrumentSans = Instrument_Sans({
  variable: '--font-instrument-sans',
  subsets: ['latin'],
  display: 'swap',
});
const spaceGrotesk = Space_Grotesk({
  variable: '--font-space-grotesk',
  subsets: ['latin'],
  display: 'swap',
});
const sora = Sora({ variable: '--font-sora', subsets: ['latin'], display: 'swap' });
const gabarito = Gabarito({ variable: '--font-gabarito', subsets: ['latin'], display: 'swap' });
const bricolage = Bricolage_Grotesque({
  variable: '--font-bricolage',
  subsets: ['latin'],
  display: 'swap',
});
const syne = Syne({ variable: '--font-syne', subsets: ['latin'], display: 'swap' });
const unbounded = Unbounded({ variable: '--font-unbounded', subsets: ['latin'], display: 'swap' });
const fraunces = Fraunces({ variable: '--font-fraunces', subsets: ['latin'], display: 'swap' });

/* Dua yang TIDAK punya versi variabel di Google Fonts, jadi beratnya disebut
   satu per satu. Tanpa itu build gagal dengan galat yang tidak menyebut
   sebabnya. */
const poppins = Poppins({
  variable: '--font-poppins',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});
const instrumentSerif = Instrument_Serif({
  variable: '--font-instrument-serif',
  subsets: ['latin'],
  weight: ['400'],
  display: 'swap',
});

/** Semua variabel huruf, dipasang sekaligus di elemen akar. */
const SEMUA_FONT = [
  inter,
  geist,
  dmSans,
  manrope,
  figtree,
  outfit,
  onest,
  schibsted,
  archivo,
  instrumentSans,
  spaceGrotesk,
  sora,
  gabarito,
  bricolage,
  syne,
  unbounded,
  fraunces,
  poppins,
  instrumentSerif,
]
  .map((f) => f.variable)
  .join(' ');

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
      className={`${appSans.variable} ${geistMono.variable} ${SEMUA_FONT}`}
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
