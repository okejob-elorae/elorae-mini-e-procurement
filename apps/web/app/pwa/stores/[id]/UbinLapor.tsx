"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Banknote, Undo2, type LucideIcon } from "lucide-react";

export type Ubin = { href: string; label: string; ikon: LucideIcon };

/** Ubin bertumpuk dua kolom; label boleh dua baris supaya tidak terpotong di HP sempit. */
export function GridUbin({ ubin }: { ubin: Ubin[] }) {
  if (ubin.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-2">
      {ubin.map(({ href, label, ikon: Ikon }) => (
        <Link
          key={href}
          href={href}
          className="flex min-h-16 items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm font-medium leading-tight transition-colors hover:bg-muted active:bg-muted"
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
            <Ikon className="h-4 w-4" aria-hidden />
          </span>
          <span className="min-w-0">{label}</span>
        </Link>
      ))}
    </div>
  );
}

export type JenisUbinLapor = "laporPelunasan" | "laporRetur";

/**
 * Lapor pelunasan dan lapor retur langsung dari halaman toko (salesman).
 *
 * Formulirnya membaca `?toko=` dan memilih toko ini bila penonton boleh
 * melapor untuknya — aturan yang sama dengan pemilih toko formulir; selain itu
 * diabaikan diam-diam. Pelunasan: toko PUTUS seperti sebelumnya; toko
 * KONSINYASI hanya untuk pemegang tokonya (P31 — tagihan konsinyasi dengan
 * nominal hanya sampai ke pemegang toko, dan penulisnya menolak yang lain).
 * SPG tidak menagih dan punya layar retur sendiri.
 */
export function ubinLapor(m: {
  storeId: string;
  termsType: "PUTUS" | "KONSI";
  spg: boolean;
  /** Penonton adalah pemegang toko sekarang (`Store.salesmanId`). */
  pemegang?: boolean;
}): Array<{ jenis: JenisUbinLapor; href: string; ikon: LucideIcon }> {
  if (m.spg) return [];
  const toko = encodeURIComponent(m.storeId);
  return [
    ...(m.termsType === "PUTUS" || m.pemegang
      ? [{ jenis: "laporPelunasan" as const, href: `/pwa/bkm/baru?toko=${toko}`, ikon: Banknote }]
      : []),
    { jenis: "laporRetur" as const, href: `/pwa/retur/baru?toko=${toko}`, ikon: Undo2 },
  ];
}

/** `ubinLapor` dengan label terjemahan. */
export function useUbinLapor(m: {
  storeId: string;
  termsType: "PUTUS" | "KONSI";
  spg: boolean;
  pemegang?: boolean;
}): Ubin[] {
  const t = useTranslations("pwa.kunjunganBerjalan");
  return ubinLapor(m).map((u) => ({ href: u.href, label: t(u.jenis), ikon: u.ikon }));
}

/** Ubin lapor di luar kunjungan — selama kunjungan keduanya ada di kartu Kunjungan berjalan. */
export function LaporDariToko({
  storeId,
  termsType,
  pemegang = false,
}: {
  storeId: string;
  termsType: "PUTUS" | "KONSI";
  pemegang?: boolean;
}) {
  return <GridUbin ubin={useUbinLapor({ storeId, termsType, spg: false, pemegang })} />;
}
