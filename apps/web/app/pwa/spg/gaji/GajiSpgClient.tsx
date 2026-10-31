"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatIDR } from "@/lib/sales-orders/format";
import type { PayloadGajiHp } from "@/lib/spg/komisi-hp";
import { TautanKembali } from "@/app/pwa/TautanKembali";
import { TombolBantuanHp } from "@/app/pwa/TombolBantuanHp";

/**
 * Gaji & komisi SPG.
 *
 * Dua jenis angka, dan layar menjaganya tetap terpisah: PERKIRAAN komisi bulan
 * berjalan (penjualan bersih yang sudah dicatat × tarif komisi barang, dengan
 * dasar yang disebut terang) dan angka RESMI per bulan — siklus konsinyasi
 * yang dikunci kantor, atau komisi toko putus yang ditetapkan kantor. Hanya
 * yang resmi yang dibayar. Beban barang hilang yang ditetapkan kantor ke SPG
 * ini dipotong dari angka resmi saat dikunci/ditetapkan — barisnya menyebut
 * potongan dan yang diterima.
 */
export function GajiSpgClient({
  konsi,
  perkiraan,
  resmi,
  bebanHilang,
}: PayloadGajiHp & { bebanHilang: { sisa: number; maksPotongPersen: number } | null }) {
  const t = useTranslations("pwa.spgGaji");
  const bagiRata = perkiraan?.dasar === "BAGI_RATA";
  return (
    <div className="space-y-4 p-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <TautanKembali cadangan="/pwa/spg/lainnya" />
      </Button>
      <header>
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <TombolBantuanHp judul={t("title")} />
        </div>
      </header>

      {perkiraan ? (
        <section className="beranda-kartu beranda-kartu-utama space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h2 className="beranda-judul">{t("estimateTitle", { month: perkiraan.bulanLabel })}</h2>
            <Badge variant="secondary" className="shrink-0">
              {bagiRata ? t("basisShared") : t("basisOwn")}
            </Badge>
          </div>
          <p className="text-3xl font-semibold tabular-nums">{formatIDR(perkiraan.bagianSaya)}</p>
          <p className="text-xs opacity-80">
            {!bagiRata
              ? t("estimateOwnPcs", { pcs: perkiraan.potongSaya })
              : perkiraan.jumlahSpg > 1
                ? t("estimateSharedPcs", { total: formatIDR(perkiraan.totalToko ?? 0), pcs: perkiraan.potongToko ?? 0, count: perkiraan.jumlahSpg })
                : t("estimateAlonePcs", { pcs: perkiraan.potongToko ?? 0 })}
          </p>
          {(bagiRata ? perkiraan.potongToko : perkiraan.potongSaya) === 0 ? (
            <p className="text-xs opacity-80">{t("estimateNoSales")}</p>
          ) : null}
        </section>
      ) : (
        <section className="beranda-kartu">
          <p className="text-sm text-muted-foreground">{konsi ? t("estimateEmpty") : t("estimatePutusOff")}</p>
        </section>
      )}

      {bebanHilang ? (
        <section className="beranda-kartu space-y-2">
          <h2 className="beranda-judul">{t("lossOpenTitle")}</h2>
          <p className="text-2xl font-semibold tabular-nums">{formatIDR(bebanHilang.sisa)}</p>
          <p className="text-xs text-muted-foreground">{t("lossOpenNote", { pct: bebanHilang.maksPotongPersen })}</p>
          <Button asChild variant="outline" size="sm">
            <Link href="/pwa/beban">{t("lossOpenLink")}</Link>
          </Button>
        </section>
      ) : null}

      <section className="space-y-2">
        <h2 className="beranda-judul">{t("officialTitle")}</h2>
        {resmi.length === 0 ? (
          <p className="beranda-kartu text-sm text-muted-foreground">{t("officialEmpty")}</p>
        ) : (
          <ul className="space-y-2">
            {resmi.map((r) => (
              <li key={r.kunci} className="beranda-kartu space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{r.bulanLabel}</p>
                    <p className="text-xs text-muted-foreground">{r.toko}</p>
                    <p className="text-xs text-muted-foreground">{r.jenis === "PUTUS" ? t("kindPutus") : t("kindKonsi")}</p>
                  </div>
                  {r.dibayarLabel ? (
                    <Badge variant="secondary" className="shrink-0 bg-emerald-500/15 text-emerald-800 dark:text-emerald-300">
                      {t("paidOn", { date: r.dibayarLabel })}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="shrink-0 border-amber-500/50 text-amber-800 dark:text-amber-300">
                      {t("unpaid")}
                    </Badge>
                  )}
                </div>
                {/* Satu baris per nominal: tiga kolom di HP memotong atau
                    membungkus angka jutaan. */}
                <dl className="space-y-1 text-sm">
                  {r.gaji !== null ? (
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-muted-foreground">{t("base")}</dt>
                      <dd className="whitespace-nowrap tabular-nums">{formatIDR(r.gaji)}</dd>
                    </div>
                  ) : null}
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-muted-foreground">
                      {r.potong !== null ? t("commissionPcs", { pcs: r.potong }) : t("commission")}
                    </dt>
                    <dd className="whitespace-nowrap tabular-nums">{formatIDR(r.komisi)}</dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3 border-t pt-1">
                    <dt className="font-medium">{t("total")}</dt>
                    <dd className="whitespace-nowrap font-semibold tabular-nums">{formatIDR(r.total)}</dd>
                  </div>
                  {r.potonganHilang > 0 ? (
                    <>
                      <div className="flex items-baseline justify-between gap-3">
                        <dt className="text-muted-foreground">{t("lossDeduction")}</dt>
                        <dd className="whitespace-nowrap tabular-nums text-destructive">−{formatIDR(r.potonganHilang)}</dd>
                      </div>
                      <div className="flex items-baseline justify-between gap-3 border-t pt-1">
                        <dt className="font-medium">{t("received")}</dt>
                        <dd className="whitespace-nowrap font-semibold tabular-nums">{formatIDR(r.diterima)}</dd>
                      </div>
                    </>
                  ) : null}
                </dl>
                {r.jenis === "PUTUS" ? (
                  <p className="text-xs text-muted-foreground">
                    {r.dasar === "PER_SPG" ? t("basisOwn") : t("basisShared")}
                    {r.ditetapkanLabel ? ` · ${t("lockedOn", { date: r.ditetapkanLabel })}` : ""}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
