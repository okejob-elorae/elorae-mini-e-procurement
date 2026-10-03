"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Check, ChevronRight, Info, Trophy, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { dinamis } from "@/lib/i18n/dinamis";
import { formatIDR } from "@/lib/sales-orders/format";
import {
  formatPersen,
  namaBulan,
  type DasarKomisi,
  type PeranTagih,
  type TingkatBerikut,
  type TingkatKomisi,
} from "@/lib/salesman/komisi";
import { cn } from "@/lib/utils";

import { TautanKembali } from "@/app/pwa/TautanKembali";
export type DataInsentif = {
  bulan: { kunci: string; href: string }[];
  bulanDipilih: string;
  /** Bulan yang dipilih adalah bulan berjalan — hanya di sini "kurang X lagi" masih berarti. */
  bulanBerjalan: boolean;
  aktif: boolean;
  dasar: DasarKomisi;
  komisi: number;
  dasarNilai: number;
  tarifDasar: number;
  tarifDipakai: number;
  capaianPersen: number | null;
  target: number | null;
  omzet: { putus: number; konsi: number; van: number; total: number };
  tingkat: (TingkatKomisi & { tercapai: boolean })[];
  tingkatBerikut: TingkatBerikut | null;
  bagianPenagihPersen: number;
  tertagih: { bagianPenjual: number; bagianPenagih: number; total: number };
  baris: {
    kunci: string;
    docNo: string;
    toko: string;
    invoiceNo: string;
    /** Tanggal verifikasi, sudah diformat di server. */
    tanggal: string;
    nilai: number;
    dilunasi: number;
    peran: PeranTagih;
    bagian: number;
  }[];
};

const NADA_PERAN: Record<PeranTagih, string> = {
  SENDIRI: "bg-primary/15 text-foreground",
  PENJUAL: "bg-primary/15 text-foreground",
  PENAGIH: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  TANPA_PENJUAL: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
};

/**
 * Insentif saya. Semua angka di sini PERKIRAAN dari skema yang diatur kantor;
 * kalimat itu tampil di kartu utama, bukan tersembunyi di catatan kaki —
 * salesman yang mengira angka ini pasti akan merasa dipotong saat gajian.
 */
export function InsentifClient({ data }: { data: DataInsentif }) {
  const t = useTranslations("pwa.insentif");
  const tBulan = dinamis(useTranslations("komisiSalesman"));
  const tDinamis = dinamis(t);
  const locale = useLocale();
  const persen = (n: number) => formatPersen(n, locale);
  const bulanPanjang = namaBulan(tBulan, data.bulanDipilih, "panjang");
  const lebarCapaian = data.capaianPersen === null ? 0 : Math.min(100, data.capaianPersen);

  return (
    <div className="space-y-4 p-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <TautanKembali cadangan="/pwa" />
      </Button>

      <header>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </header>

      {/* Bulan sebagai tautan: alamatnya bisa dibuka ulang dan tombol kembali HP bekerja. */}
      <nav aria-label={t("monthsLabel")} className="-mx-4 overflow-x-auto px-4">
        <ul className="flex gap-1.5">
          {data.bulan.map((b) => {
            const aktif = b.kunci === data.bulanDipilih;
            return (
              <li key={b.kunci} className="shrink-0">
                <Link
                  href={b.href}
                  replace
                  aria-current={aktif ? "page" : undefined}
                  className={cn(
                    "flex min-h-11 items-center rounded-full border px-3.5 text-sm font-medium whitespace-nowrap transition-colors",
                    aktif ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted/60",
                  )}
                >
                  {namaBulan(tBulan, b.kunci, "pendek")}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {!data.aktif ? (
        <section className="beranda-kartu">
          <div className="flex items-start gap-3">
            <Info className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
            <div>
              <h2 className="font-semibold">{t("inactiveTitle")}</h2>
              <p className="text-sm text-muted-foreground">{t("inactiveBody")}</p>
            </div>
          </div>
        </section>
      ) : (
        <>
          <section className="beranda-kartu beranda-kartu-utama">
            <h2 className="beranda-judul">{t("estimateTitle", { month: bulanPanjang })}</h2>
            <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">{formatIDR(data.komisi)}</p>
            <p className="mt-1 text-sm tabular-nums opacity-90">
              {tDinamis(`formula${data.dasar}`, { rate: persen(data.tarifDipakai), amount: formatIDR(data.dasarNilai) })}
            </p>
            {data.tarifDipakai > data.tarifDasar ? (
              <p className="mt-0.5 text-xs opacity-80">{t("tierApplied", { base: persen(data.tarifDasar) })}</p>
            ) : null}
            <p className="mt-3 inline-flex rounded-full px-2.5 py-1 text-xs font-medium" style={{ background: "color-mix(in oklab, var(--primary-foreground) 16%, transparent)" }}>
              {t("estimateNote")}
            </p>
          </section>

          {data.bulanBerjalan && data.tingkatBerikut ? (
            <section className="beranda-kartu" style={{ borderColor: "var(--primary)", borderWidth: 2 }}>
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                  <TrendingUp className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="font-semibold leading-tight tabular-nums">
                    {t("nudge", { amount: formatIDR(data.tingkatBerikut.kurangNilai), rate: persen(data.tingkatBerikut.tarifPersen) })}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t("nudgeHint", { pct: persen(data.tingkatBerikut.capaianPersen) })}
                  </p>
                </div>
              </div>
            </section>
          ) : null}
        </>
      )}

      <section className="beranda-kartu">
        <h2 className="beranda-judul">{t("targetTitle")}</h2>
        {data.target !== null && data.capaianPersen !== null ? (
          <>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {t("targetOf", { omzet: formatIDR(data.omzet.total), target: formatIDR(data.target) })}
            </p>
            <div
              className="mt-2 h-2.5 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={lebarCapaian}
              aria-label={t("targetTitle")}
            >
              <div className="h-full rounded-full bg-primary transition-[width] duration-700" style={{ width: `${lebarCapaian}%` }} />
            </div>
            <p className="mt-1.5 text-xs font-medium tabular-nums">{t("achieved", { pct: persen(data.capaianPersen) })}</p>
          </>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">{t("noTarget", { omzet: formatIDR(data.omzet.total) })}</p>
        )}

        {data.aktif && data.tingkat.length > 0 ? (
          <div className="mt-3 border-t pt-3">
            <p className="text-xs font-medium text-muted-foreground">{t("tiersTitle", { base: persen(data.tarifDasar) })}</p>
            <ul className="mt-1.5 space-y-1">
              {data.tingkat.map((x) => {
                const tercapai = x.tercapai;
                return (
                  <li key={x.capaianPersen} className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          "grid h-5 w-5 place-items-center rounded-full border",
                          tercapai ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground",
                        )}
                        aria-hidden
                      >
                        {tercapai ? <Check className="h-3 w-3" /> : null}
                      </span>
                      {t("tierRow", { pct: persen(x.capaianPersen) })}
                    </span>
                    <span className="font-semibold tabular-nums">{persen(x.tarifPersen)}%</span>
                  </li>
                );
              })}
            </ul>
            {data.target === null ? <p className="mt-1.5 text-xs text-muted-foreground">{t("tiersNeedTarget")}</p> : null}
          </div>
        ) : null}
      </section>

      {data.dasar === "TERTAGIH" ? (
        <>
          <section className="beranda-kartu">
            <h2 className="beranda-judul">{t("collectedTitle")}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{t("collectedHint")}</p>
            <dl className="mt-3 grid grid-cols-2 gap-3">
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">{t("sellerShare")}</dt>
                <dd className="truncate text-base font-semibold tabular-nums">{formatIDR(data.tertagih.bagianPenjual)}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">{t("collectorShare")}</dt>
                <dd className="truncate text-base font-semibold tabular-nums">{formatIDR(data.tertagih.bagianPenagih)}</dd>
              </div>
            </dl>
            <p className="mt-2 text-xs text-muted-foreground">
              {data.bagianPenagihPersen > 0
                ? t("splitHint", { pct: persen(data.bagianPenagihPersen) })
                : t("splitHintNone")}
            </p>
          </section>

          <section className="beranda-kartu beranda-kartu-daftar" aria-label={t("listTitle")}>
            <h2 className="beranda-judul px-4 pt-4">{t("listTitle")}</h2>
            {data.baris.length === 0 ? (
              <p className="px-4 pb-4 pt-2 text-sm text-muted-foreground">{t("listEmpty")}</p>
            ) : (
              <ul className="mt-2 divide-y">
                {data.baris.map((b) => (
                  <li key={b.kunci} className="flex min-h-14 items-start gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium leading-tight">{b.toko}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {t("rowMeta", { invoice: b.invoiceNo, doc: b.docNo, date: b.tanggal })}
                      </p>
                      <Badge variant="secondary" className={cn("mt-1 border-0 text-[11px]", NADA_PERAN[b.peran])}>
                        {tDinamis(`role${b.peran}`)}
                      </Badge>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-semibold tabular-nums">{formatIDR(b.bagian)}</p>
                      {b.bagian !== b.dilunasi ? (
                        <p className="text-[11px] text-muted-foreground tabular-nums">
                          {t("rowOfInvoice", { amount: formatIDR(b.dilunasi) })}
                        </p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : (
        <section className="beranda-kartu">
          <h2 className="beranda-judul">{t("salesTitle")}</h2>
          <dl className="mt-3 grid grid-cols-3 gap-2">
            {(["putus", "konsi", "van"] as const).map((k) => (
              <div key={k} className="min-w-0">
                <dt className="text-xs text-muted-foreground">{tDinamis(`channel_${k}`)}</dt>
                <dd className="truncate text-sm font-semibold tabular-nums">{formatIDR(data.omzet[k])}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-xs text-muted-foreground">{t("salesHint")}</p>
        </section>
      )}

      <nav className="beranda-kartu beranda-kartu-daftar" aria-label={t("moreLabel")}>
        <Link href="/pwa/peringkat" className="flex min-h-14 items-center gap-3 px-4 py-2 transition-colors hover:bg-muted/60">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
            <Trophy className="h-4 w-4" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-medium leading-tight">{t("leaderboardLink")}</span>
            <span className="block text-xs text-muted-foreground">{t("leaderboardHint")}</span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        </Link>
      </nav>

      <p className="text-center text-xs text-muted-foreground">{t("footer")}</p>
    </div>
  );
}
