"use client";

import { useLocale, useTranslations } from "next-intl";
import { Layers, Package, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { dinamis } from "@/lib/i18n/dinamis";
import { formatIDR } from "@/lib/sales-orders/format";
import type { Kemajuan } from "@/lib/salesman/dasbor";
import { namaBulan } from "@/lib/salesman/komisi";
import type { LajuTarget, UkuranTarget } from "@/lib/salesman/target-rinci";
// Hanya TIPE dari berkas kueri — Prisma tidak boleh ikut ke bundel HP.
import type { BarisTargetHp } from "@/lib/salesman/target-rinci-queries";
import { cn } from "@/lib/utils";

import { TautanKembali } from "@/app/pwa/TautanKembali";
import { TombolBantuanHp } from "@/app/pwa/TombolBantuanHp";
export type DataTargetSaya = {
  bulan: string;
  /** SPG: capaian dari nota penjualannya di toko, bersih dari retur pembeli. */
  spg: boolean;
  /**
   * Target total bulan ini — angka yang sama dengan kartu "Bulan ini" di
   * beranda: putus + van untuk sales (tanpa konsinyasi), nota bersih untuk SPG.
   */
  total: { omzet: number; kemajuan: Kemajuan | null };
  /** Dari `targetSayaHp`: setiap target dalam rupiah dihitung tanpa konsinyasi. */
  baris: BarisTargetHp[];
};

const NADA_LAJU: Record<LajuTarget, string> = {
  TERCAPAI: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  SESUAI: "bg-sky-500/15 text-sky-800 dark:text-sky-300",
  TERTINGGAL: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  TIDAK_TERCAPAI: "bg-rose-500/15 text-rose-800 dark:text-rose-300",
  BELUM_MULAI: "bg-muted text-muted-foreground",
};

/**
 * Target per kategori dan per barang bulan ini. Satu kartu per target:
 * berapa sudah tercapai, kurang berapa lagi, dan apakah lajunya cukup untuk
 * sisa bulan — "baru 40%" di tanggal 10 itu sesuai jalur, bukan tertinggal.
 */
export function TargetSayaClient({ data }: { data: DataTargetSaya }) {
  const t = useTranslations("pwa.target");
  const tDinamis = dinamis(t);
  const tBulan = dinamis(useTranslations("komisiSalesman"));
  const locale = useLocale();
  const angkaPcs = new Intl.NumberFormat(locale === "en" ? "en-US" : "id-ID", { maximumFractionDigits: 2 });
  const angka = (n: number, ukuran: UkuranTarget) => (ukuran === "NILAI" ? formatIDR(n) : t("pcs", { n: angkaPcs.format(n) }));
  const bulan = namaBulan(tBulan, data.bulan, "panjang");
  const total = data.total.kemajuan;

  return (
    <div className="space-y-4 p-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <TautanKembali cadangan="/pwa" />
      </Button>

      <header>
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <TombolBantuanHp judul={t("title")} />
        </div>
        <p className="text-sm text-muted-foreground">{t("subtitle", { month: bulan })}</p>
      </header>

      <section className="beranda-kartu">
        <h2 className="beranda-judul">{t("totalTitle")}</h2>
        {total ? (
          <>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {t("of", { capai: formatIDR(data.total.omzet), target: formatIDR(total.target) })}
            </p>
            <Batang persen={total.persen} label={t("totalTitle")} />
            <p className="mt-1.5 text-xs font-medium tabular-nums">
              {total.tercapai
                ? t("reached")
                : t("totalShort", { amount: formatIDR(total.sisa), pct: total.persen })}
            </p>
          </>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">{t("totalNotSet", { omzet: formatIDR(data.total.omzet) })}</p>
        )}
        {/* Sales: rupiah putus + van saja. Selalu tampil, bukan hanya saat ada
            konsinyasi — keterangan bersyarat justru memberi tahu bahwa ada. */}
        {!data.spg ? <p className="mt-1 text-xs text-muted-foreground">{t("tanpaKonsi")}</p> : null}
      </section>

      {data.baris.length === 0 ? (
        <section className="beranda-kartu">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
              <Target className="h-4 w-4" aria-hidden />
            </span>
            <div>
              <h2 className="font-semibold">{t("emptyTitle")}</h2>
              <p className="text-sm text-muted-foreground">{t("emptyBody")}</p>
            </div>
          </div>
        </section>
      ) : (
        <ul className="space-y-3" aria-label={t("listLabel")}>
          {data.baris.map((b) => {
            const Ikon = b.scope === "KATEGORI" ? Layers : Package;
            return (
              <li key={b.kunci} className="beranda-kartu">
                <div className="flex items-start gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                    <Ikon className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                          {tDinamis(`scope.${b.scope}`)}
                        </p>
                        <p className="font-semibold leading-tight">{b.nama}</p>
                        {b.sku ? <p className="truncate font-mono text-xs text-muted-foreground">{b.sku}</p> : null}
                      </div>
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
                          NADA_LAJU[b.laju],
                        )}
                      >
                        {tDinamis(`laju.${b.laju}`)}
                      </span>
                    </div>

                    <p className="mt-2 text-sm tabular-nums">
                      {t("of", { capai: angka(b.capai, b.measure), target: angka(b.target, b.measure) })}
                      <span className="text-muted-foreground"> · {b.persen}%</span>
                    </p>
                    <Batang persen={b.persen} label={b.nama} />
                    {/* Selalu tampil untuk jenis target ini, bukan hanya saat ada
                        konsinyasi — keterangan bersyarat justru memberi tahu bahwa ada. */}
                    {b.tanpaKonsi ? <p className="mt-1 text-xs text-muted-foreground">{t("tanpaKonsi")}</p> : null}
                    <p className="mt-1.5 text-xs font-medium tabular-nums">
                      {b.kurang > 0 ? t("short", { amount: angka(b.kurang, b.measure) }) : t("reached")}
                    </p>
                    {b.laju === "SESUAI" && b.perHari !== null ? (
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {t("paceOnTrack", { amount: angka(b.perHari, b.measure) })}
                      </p>
                    ) : null}
                    {b.laju === "TERTINGGAL" && b.perHari !== null ? (
                      <p className="text-xs text-amber-800 dark:text-amber-300 tabular-nums">
                        {t("paceBehind", { amount: angka(b.perHari, b.measure), days: b.sisaHari })}
                      </p>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Batang({ persen, label }: { persen: number; label: string }) {
  const lebar = Math.max(0, Math.min(100, persen));
  return (
    <div
      className="mt-2 h-2.5 overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={lebar}
      aria-label={label}
    >
      <div className="h-full rounded-full bg-primary transition-[width] duration-700" style={{ width: `${lebar}%` }} />
    </div>
  );
}
