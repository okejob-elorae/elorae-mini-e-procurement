"use client";

import { useTranslations } from "next-intl";
import { PackageSearch } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Hasil hitung SPG atas satu kiriman (potong saja, tanpa rupiah) — tanggalnya
 * sudah diformat server (WIB).
 */
export type TerimaTokoTampil = {
  dikirim: number;
  diterima: number;
  kurang: number;
  rusak: number;
  dihitung: string;
};

/** "Diterima toko: N dari M pcs · rusak R" — amber bila kurang atau ada yang rusak. */
export function BarisTerimaToko({ r }: { r: TerimaTokoTampil }) {
  const t = useTranslations("pwa.pesananSaya.terimaToko");
  const selisih = r.kurang > 0 || r.rusak > 0;
  return (
    <div
      className={cn(
        "flex items-start gap-1.5 rounded-md px-3 py-2 text-sm",
        selisih ? "bg-amber-500/10 text-amber-800 dark:text-amber-300" : "bg-muted/60 text-foreground",
      )}
    >
      <PackageSearch className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span className="min-w-0">
        <span className="block font-medium tabular-nums">
          {t("baris", { diterima: r.diterima, dikirim: r.dikirim })}
          {r.rusak > 0 ? ` · ${t("rusak", { rusak: r.rusak })}` : null}
        </span>
        <span className="block text-xs opacity-80">{t("dihitung", { date: r.dihitung })}</span>
      </span>
    </div>
  );
}

/** Pesanan konsi tidak punya daftar pengiriman: hasil hitung SPG-nya berdiri sebagai kartu sendiri. */
export function KartuTerimaToko({ r }: { r: TerimaTokoTampil }) {
  const t = useTranslations("pwa.pesananSaya.terimaToko");
  return (
    <section className="beranda-kartu" aria-labelledby="terima-toko-judul">
      <h2 id="terima-toko-judul" className="beranda-judul">
        {t("judul")}
      </h2>
      <div className="mt-2">
        <BarisTerimaToko r={r} />
      </div>
    </section>
  );
}
