"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ChevronRight, CloudOff, ReceiptText, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatIDR } from "@/lib/sales-orders/format";
import { PERISTIWA_ANTREAN } from "@/lib/pwa/offline/hitung";
import { hitungNotaSpgTertahan } from "@/lib/pwa/offline/spg-jual-antrean";
import { TombolBantuanHp } from "@/app/pwa/TombolBantuanHp";

/** Teks yang sudah diformat server untuk kedua bahasa; klien hanya memilih. */
export type TeksDwibahasa = { id: string; en: string };

export type HariNota = {
  kunci: string;
  jenis: "hariIni" | "kemarin" | "tanggal";
  tanggal: TeksDwibahasa;
  jumlah: number;
  total: number;
  nota: { id: string; docNo: string; jam: TeksDwibahasa; jumlahBarang: number; total: number }[];
};

/**
 * Riwayat nota SPG, dikelompokkan per hari kalender WIB. Tiap baris membuka
 * nota yang sama dengan yang tampil sesudah menyimpan penjualan — untuk
 * dicetak ulang atau dibagikan.
 */
export function NotaSpgClient({
  hariIni,
  hari,
  terpotong,
}: {
  hariIni: { jumlah: number; total: number };
  hari: HariNota[];
  /** Jumlah nota yang ditampilkan kalau daftarnya dipotong; null kalau lengkap. */
  terpotong: number | null;
}) {
  const t = useTranslations("pwa.spgNota");
  const bahasa: keyof TeksDwibahasa = useLocale() === "en" ? "en" : "id";
  // Nota yang dijual tanpa sinyal belum punya nomor dan belum ada di daftar
  // server ini; tanpa keterangan, SPG mengira penjualannya hilang.
  const [tertahan, setTertahan] = useState(0);
  useEffect(() => {
    let aktif = true;
    const hitung = () => {
      hitungNotaSpgTertahan().then(
        (n) => {
          if (aktif) setTertahan(n);
        },
        () => undefined,
      );
    };
    hitung();
    window.addEventListener(PERISTIWA_ANTREAN, hitung);
    return () => {
      aktif = false;
      window.removeEventListener(PERISTIWA_ANTREAN, hitung);
    };
  }, []);

  const judulHari = (h: HariNota) => (h.jenis === "hariIni" ? t("today") : h.jenis === "kemarin" ? t("yesterday") : h.tanggal[bahasa]);

  return (
    <div className="space-y-4 p-4">
      <header>
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <TombolBantuanHp judul={t("title")} />
        </div>
      </header>

      {tertahan > 0 ? (
        <Link href="/pwa/spg/antrean" className="beranda-kartu flex min-h-14 items-center gap-3 transition-colors hover:bg-muted/60">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
            <CloudOff className="h-4 w-4" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-medium leading-tight">{t("pending.title", { count: tertahan })}</span>
            <span className="block text-xs text-muted-foreground">{t("pending.body")}</span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        </Link>
      ) : null}

      {/* Satu kartu lebar, bukan dua ubin: rupiah jutaan tidak muat di separuh
          lebar HP tanpa terpotong. */}
      <section className="beranda-kartu">
        <h2 className="beranda-judul">{t("todayTotal")}</h2>
        <p className="text-3xl font-bold tabular-nums">{formatIDR(hariIni.total)}</p>
        <p className="text-sm text-muted-foreground">{t("todayReceipts", { count: hariIni.jumlah })}</p>
      </section>

      {hari.length === 0 ? (
        <section className="beranda-kartu space-y-3 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-primary text-primary-foreground">
            <ReceiptText className="h-5 w-5" aria-hidden />
          </span>
          <h2 className="text-lg font-semibold">{t("empty.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("empty.body")}</p>
          <Button asChild size="lg" className="w-full">
            <Link href="/pwa/spg/sale">
              <ShoppingCart className="h-4 w-4" aria-hidden />
              {t("empty.cta")}
            </Link>
          </Button>
        </section>
      ) : (
        hari.map((h) => (
          <section key={h.kunci} className="space-y-2" aria-labelledby={`nota-hari-${h.kunci}`}>
            <div className="flex items-baseline justify-between gap-3 px-1">
              <h2 id={`nota-hari-${h.kunci}`} className="font-semibold">
                {judulHari(h)}
              </h2>
              <p className="text-xs tabular-nums text-muted-foreground">{t("dayTotal", { count: h.jumlah, total: formatIDR(h.total) })}</p>
            </div>
            <div className="beranda-kartu beranda-kartu-daftar">
              <ul className="divide-y">
                {h.nota.map((n) => (
                  <li key={n.id}>
                    <Link
                      href={`/pwa/spg/${n.id}/nota`}
                      className="flex min-h-14 items-center gap-3 px-4 py-2 transition-colors hover:bg-muted/60"
                    >
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                        <ReceiptText className="h-4 w-4" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium leading-tight">{n.docNo}</span>
                        <span className="block text-xs tabular-nums text-muted-foreground">
                          {n.jam[bahasa]} · {t("items", { count: n.jumlahBarang })}
                        </span>
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums">{formatIDR(n.total)}</span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ))
      )}

      {terpotong !== null ? <p className="text-center text-xs text-muted-foreground">{t("limitNote", { count: terpotong })}</p> : null}
    </div>
  );
}
