import type { Metadata } from "next";

/**
 * Formulir data KOL — di luar `/pwa` dan `/backoffice`, tanpa masuk; dibuka KOL dari link WhatsApp.
 *
 * - `robots: noindex` — link pribadi tidak boleh masuk mesin pencari.
 * - `referrer: no-referrer` — alamat halaman MEMBAWA TOKEN; tanpa ini tautannya bocor ke pihak lain
 *   lewat header `Referer`.
 * - `pwa-app` menghidupkan aturan sasaran sentuh 44 px yang sama dengan aplikasi HP.
 */
export const metadata: Metadata = {
  title: "Data kerja sama",
  description: "Formulir data pengiriman dan pembayaran untuk kerja sama dengan Elorae.",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: "no-referrer",
};

export default function FormulirKolLayout({ children }: { children: React.ReactNode }) {
  return <div className="pwa-app mx-auto flex min-h-dvh w-full max-w-xl flex-col bg-background md:border-x">{children}</div>;
}
