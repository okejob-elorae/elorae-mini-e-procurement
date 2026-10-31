"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ChevronRight, ImageOff, RotateCcw, Send, Sparkles, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { HasilSaranTawar, SaranTawarBaris } from "@/lib/salesman/saran-tawar-queries";

/** Kartu memuat paling banyak delapan baris; sisanya ada di "Kirim katalog". */
const BARIS_TAMPIL = 8;

const IKON = {
  ANDALAN_TOKO: RotateCcw,
  LARIS_DI_AREA: TrendingUp,
  BARU: Sparkles,
} as const;

/**
 * "Yang perlu ditawarkan" di halaman toko: barang andalan toko yang terlambat
 * dipesan ulang, yang laris di toko sejenis tapi belum dimiliki toko ini, dan
 * barang baru — masing-masing dengan alasannya dalam satu kalimat. Aturannya
 * di `lib/salesman/saran-tawar.ts`.
 *
 * Hanya untuk salesman keliling (halaman mengirim null untuk SPG). Tidak
 * pernah menampilkan harga: kartu ini sama untuk toko putus dan konsinyasi.
 */
export function SaranTawar({ storeId, data }: { storeId: string; data: HasilSaranTawar | null }) {
  const t = useTranslations("pwa.saranTawar");
  const locale = useLocale();
  if (!data) return null;

  const angka = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const katalog = `/pwa/stores/${storeId}/catalog`;
  const { pembanding } = data;

  const alasan = (s: SaranTawarBaris): { utama: string; tambahan: string | null } => {
    switch (s.alasan) {
      case "ANDALAN_TOKO":
        return { utama: t("andalan", { jeda: s.jedaBiasa, hari: s.hariSejakPesan }), tambahan: null };
      case "LARIS_DI_AREA":
        return {
          utama:
            pembanding.jenis === "AREA"
              ? t("larisArea", { area: pembanding.kode, pcs: s.pcs, hari: data.hariArea, toko: s.toko })
              : t("larisJenis", { jenis: pembanding.termsType, pcs: s.pcs, hari: data.hariArea, toko: s.toko }),
          tambahan: s.hariSejakPesan !== null ? t("larisTerakhir", { hari: s.hariSejakPesan }) : null,
        };
      case "BARU":
        return { utama: t("baru", { hari: s.umurHari }), tambahan: null };
    }
  };

  return (
    <section className="beranda-kartu beranda-kartu-daftar" aria-labelledby="saran-tawar-judul">
      <div className="px-4 pb-3 pt-4">
        <h2 id="saran-tawar-judul" className="beranda-judul">
          {t("title")}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {pembanding.jenis === "AREA"
            ? t("hintArea", { area: pembanding.nama })
            : t("hintJenis", { jenis: pembanding.termsType })}
        </p>
      </div>

      {data.saran.length === 0 ? (
        <p className="border-t px-4 py-3 text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="divide-y border-t">
          {data.saran.slice(0, BARIS_TAMPIL).map((s) => {
            const Ikon = IKON[s.alasan];
            const { utama, tambahan } = alasan(s);
            return (
              <li key={s.itemId}>
                {/* Katalog dibuka sudah tersaring ke barang ini (`?q=` = kata cari awal). */}
                <Link
                  href={`${katalog}?q=${encodeURIComponent(s.sku)}`}
                  className="flex min-h-14 items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/60"
                >
                  <span className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-md bg-muted">
                    {s.gambarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={s.gambarUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                    ) : (
                      <>
                        <ImageOff className="h-5 w-5 text-muted-foreground" aria-hidden />
                        <span className="sr-only">{t("tanpaFoto")}</span>
                      </>
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium leading-tight">{s.nama}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {s.sku} · {t("stok", { jumlah: angka.format(s.tersedia) })}
                    </span>
                    <span className="mt-1 flex items-start gap-1.5 text-xs font-medium text-primary">
                      <Ikon className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
                      <span className="min-w-0">
                        {utama}
                        {tambahan ? <span className="block font-normal text-muted-foreground">{tambahan}</span> : null}
                      </span>
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {/* Hanya "Kirim katalog": katalognya sendiri sudah dibuka dari kepala
          halaman (Lihat katalog) atau tombol Buat pesanan selama kunjungan, dan
          setiap baris di atas membuka barangnya di katalog. */}
      <div className="border-t p-3">
        <Button asChild variant="outline" className="w-full">
          <Link href={`/pwa/stores/${storeId}/kirim-katalog`}>
            <Send className="h-4 w-4" aria-hidden />
            {t("kirimKatalog")}
          </Link>
        </Button>
      </div>
    </section>
  );
}
