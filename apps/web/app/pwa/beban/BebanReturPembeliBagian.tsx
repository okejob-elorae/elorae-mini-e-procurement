"use client";

import { useLocale, useTranslations } from "next-intl";
import { Undo2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatRupiah } from "@/lib/format/rupiah";
import { dinamis } from "@/lib/i18n/dinamis";
import type { BebanSpgSayaHp } from "@/lib/spg/beban-spg-queries";
import { cn } from "@/lib/utils";

/** Satu beban retur pembeli dengan label bulan yang sudah diformat di server (id dan en). */
export type BebanReturPembeliTampil = Omit<BebanSpgSayaHp, "potongan" | "kembali"> & {
  potongan: (BebanSpgSayaHp["potongan"][number] & { bulanLabel: { id: string; en: string } })[];
  kembali: (NonNullable<BebanSpgSayaHp["kembali"]> & { bulanLabel: { id: string; en: string } | null }) | null;
};

/**
 * Bagian "Retur pembeli ditolak" di layar Beban saya (HP SPG): beban SPG karena kasir telanjur
 * mengembalikan uang pembeli untuk laporan yang kemudian DITOLAK kantor (pemilik P13, P13a).
 * Per beban: nomor laporan, tanggal lapor, besarnya (dan tanda bila diubah kantor dari angka
 * nota, P81), potongan per bulan pembayaran (komisi dulu, lalu gaji — P5), sisanya, keputusan
 * barangnya (dikembalikan ke stok dengan uang SPG dibayar kembali, atau dibeli SPG — P79). Tanpa
 * harga satuan apa pun.
 */
export function BebanReturPembeliBagian({ beban }: { beban: BebanReturPembeliTampil[] }) {
  const t = useTranslations("bebanReturPembeliSaya");
  const td = dinamis(t);
  const bahasa = useLocale() === "en" ? "en" : "id";
  const aktif = beban.filter((b) => b.keadaan !== "BATAL");
  const sisa = aktif.reduce((n, b) => n + b.sisa, 0);

  return (
    <section className="space-y-3" aria-labelledby="judul-beban-retur-pembeli">
      <div className="space-y-1">
        <h2 id="judul-beban-retur-pembeli" className="text-lg font-semibold">
          {t("judul")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {sisa > 0 ? t("ringkas", { n: aktif.filter((b) => b.sisa > 0).length, sisa: formatRupiah(sisa) }) : t("semuaLunas")}
        </p>
      </div>

      <div className="space-y-3">
        {beban.map((b) => (
          <Card key={b.id} className={cn("py-0", b.sisa > 0 && b.keadaan !== "BATAL" && "border-destructive/40")}>
            <CardContent className="space-y-3 py-4">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Undo2 className="h-4 w-4" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block font-semibold">{b.docNo}</span>
                  <span className="block text-xs text-muted-foreground">{t("dilaporkan", { tanggal: b.dilaporkan[bahasa] })}</span>
                </span>
              </div>

              <dl className="space-y-1 text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground">{t("besar")}</dt>
                  <dd className="font-semibold tabular-nums">{formatRupiah(b.jumlah)}</dd>
                </div>
                {b.diubahKantor ? (
                  <p className="text-xs text-muted-foreground">
                    {b.alasanJumlah ? t("diubahKantorAlasan", { alasan: b.alasanJumlah }) : t("diubahKantor")}
                  </p>
                ) : null}
                {b.potongan.map((p, i) => (
                  <div key={`${b.id}-${i}`} className="flex items-baseline justify-between gap-3">
                    <dt className="min-w-0 text-muted-foreground">
                      {p.keUtang ? t("keUtang", { bulan: p.bulanLabel[bahasa] }) : t("dipotongBulan", { bulan: p.bulanLabel[bahasa] })}
                    </dt>
                    <dd className="tabular-nums">−{formatRupiah(p.jumlah)}</dd>
                  </div>
                ))}
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground">{t("sisa")}</dt>
                  <dd className={cn("font-bold tabular-nums", b.sisa > 0 ? "text-destructive" : "text-emerald-700 dark:text-emerald-400")}>
                    {formatRupiah(b.sisa)}
                  </dd>
                </div>
              </dl>

              <p
                className={cn(
                  "rounded-lg px-3 py-2 text-sm leading-relaxed",
                  b.keadaan === "TERBUKA" || b.keadaan === "DIUTANGKAN"
                    ? "bg-destructive/10 text-destructive"
                    : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
                )}
              >
                {b.keadaan === "KEMBALI_STOK" && b.kembali
                  ? b.kembali.dibayar
                    ? t("kembaliDibayar", { jumlah: formatRupiah(b.kembali.jumlah), bulan: b.kembali.bulanLabel?.[bahasa] ?? "—" })
                    : t("kembaliMenunggu", { jumlah: formatRupiah(b.kembali.jumlah) })
                  : td(`keadaan_${b.keadaan}`)}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
