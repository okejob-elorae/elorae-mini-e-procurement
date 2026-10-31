import type { Metadata } from "next";

/**
 * Portal pesan mandiri toko — di luar `/pwa` dan `/backoffice`, tanpa masuk.
 *
 * - `robots: noindex` — tautan toko tidak boleh pernah masuk mesin pencari.
 * - `referrer: no-referrer` — alamat halaman MEMBAWA TOKEN; tanpa ini setiap
 *   gambar produk dari CDN (R2/Jubelio) menerima alamat lengkapnya di header
 *   `Referer`, dan tautannya bocor ke log pihak lain.
 * - `pwa-app` menghidupkan aturan sasaran sentuh 44 px yang sama dengan aplikasi HP.
 */
export const metadata: Metadata = {
  title: "Pesan barang",
  description: "Pemesanan barang untuk toko mitra Elorae.",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: "no-referrer",
};

export default function PortalTokoLayout({ children }: { children: React.ReactNode }) {
  return <div className="pwa-app mx-auto flex min-h-dvh w-full max-w-xl flex-col bg-background md:border-x">{children}</div>;
}
