"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronRight, PackageX } from "lucide-react";
import type { BarangDisisihkan } from "@/lib/spg/retur-pembeli-queries";

/**
 * Barang retur pembeli yang DISISIHKAN di toko (pemilik P12 "di sisihkan dahulu"): laporannya
 * masih menunggu kantor, atau ditolak dengan beban SPG dan barangnya belum diputuskan (P79).
 * Barang itu tidak di rak dan tidak dihitung opname — layar hitung menyebutnya supaya SPG tidak
 * ikut menghitungnya.
 *
 * - `daftar` (opname, hitung stok bulanan): spanduk dengan daftar barangnya.
 * - `ringkas` (layar Stok): jumlah potong dan tautan ke layar Retur pembeli.
 *
 * Tanpa harga — hanya barang, ukuran, jumlah potong, dan nomor laporan.
 */
export function BarangDisisihkanBanner({
  barang,
  tampilan = "daftar",
}: {
  barang: readonly BarangDisisihkan[];
  tampilan?: "daftar" | "ringkas";
}) {
  const t = useTranslations("pwa.spgDisisihkan");
  if (barang.length === 0) return null;
  const pcs = barang.reduce((n, b) => n + b.qty, 0);

  if (tampilan === "ringkas") {
    return (
      <Link
        href="/pwa/spg/retur-pembeli"
        className="flex min-h-14 items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300"
      >
        <PackageX className="h-5 w-5 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">{t("ringkas", { pcs })}</span>
        <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
      </Link>
    );
  }

  return (
    <section
      className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-3 text-sm text-amber-800 dark:text-amber-300"
      aria-labelledby="barang-disisihkan-judul"
    >
      <div className="flex items-start gap-2">
        <PackageX className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
        <div className="min-w-0 space-y-1">
          <h2 id="barang-disisihkan-judul" className="font-semibold">
            {t("judul")}
          </h2>
          <p className="text-xs opacity-90">{t("isi", { pcs })}</p>
        </div>
      </div>
      <ul className="space-y-1 pl-7">
        {barang.map((b, i) => (
          <li key={`${b.docNo}-${b.variantSku}-${i}`} className="flex items-start justify-between gap-3">
            <span className="min-w-0 break-words">
              {b.productName}
              <span className="block text-xs opacity-80">
                {t(b.tanda === "MENUNGGU_KANTOR" ? "menungguKantor" : "tungguKeputusan", { docNo: b.docNo })}
              </span>
            </span>
            <span className="shrink-0 tabular-nums">{t("pcs", { pcs: b.qty })}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
