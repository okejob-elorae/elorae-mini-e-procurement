"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatIDR } from "@/lib/sales-orders/format";
import type { PayloadGajiHp } from "@/lib/spg/komisi-hp";
import { formatKoreksi } from "@/lib/spg/koreksi";
import { TautanKembali } from "@/app/pwa/TautanKembali";
import { TombolBantuanHp } from "@/app/pwa/TombolBantuanHp";

/**
 * Gaji & komisi SPG.
 *
 * Dua jenis angka, dan layar menjaganya tetap terpisah: PERKIRAAN komisi bulan berjalan (potong
 * yang SPG ini jual sendiri × tarif per kategori bulan ini) dan pembayaran RESMI — siklus
 * konsinyasi yang dikunci kantor, atau komisi toko putus yang ditetapkan kantor sesudah laporan
 * penjualannya dicek. Hanya yang resmi yang dibayar, di bulan laporannya dicek; setiap baris
 * menyebut bulan penjualannya ("Komisi penjualan Oktober 2026"). Beban barang hilang yang
 * ditetapkan kantor ke SPG ini dipotong dari angka resmi saat dikunci/ditetapkan — barisnya
 * menyebut potongan. Koreksi komisi bulan yang sudah dibayar (+ atau −) ikut pembayaran
 * berikutnya, sekali, tidak pernah di bawah Rp 0. Baris terakhir setiap pembayaran adalah
 * "Diterima" (sudah dibayar) atau "Akan diterima" — angka yang sama dengan kartu beranda — kecuali
 * pembayaran yang menunggu keputusan kantor (`ditahan`) atau yang siklusnya dibuka lagi
 * (`belumPasti`): angkanya belum pasti, jadi tidak ada rupiah yang dijanjikan, di sini maupun di
 * beranda. Bulan toko putus aturan lama yang belum dicek tampil dengan komisi per SPG yang akan
 * dibayar sesudah dicek, angka lamanya disebut sebagai "sebelumnya".
 */
export function GajiSpgClient({
  perkiraan,
  resmi,
  koreksiMenunggu,
  bebanHilang,
}: PayloadGajiHp & { bebanHilang: { sisa: number; maksPotongPersen: number } | null }) {
  const t = useTranslations("pwa.spgGaji");
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
              {t("basisOwn")}
            </Badge>
          </div>
          <p className="text-3xl font-semibold tabular-nums">{formatIDR(perkiraan.bagianSaya)}</p>
          {perkiraan.potongSaya === 0 ? (
            <p className="text-xs opacity-80">{t("estimateNoSales")}</p>
          ) : (
            <p className="text-xs opacity-80">{t("estimateOwnPcs", { pcs: perkiraan.potongSaya })}</p>
          )}
          {perkiraan.potongTanpaTarif > 0 ? (
            <p className="text-xs opacity-80">{t("estimateNoRate", { pcs: perkiraan.potongTanpaTarif })}</p>
          ) : null}
          <p className="text-xs opacity-80">{t("estimateRule")}</p>
        </section>
      ) : (
        <section className="beranda-kartu">
          <p className="text-sm text-muted-foreground">{t("estimateEmpty")}</p>
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
                    <p className="font-medium">{t("salesMonthNote", { month: r.bulanJualLabel })}</p>
                    <p className="text-xs text-muted-foreground">{r.toko}</p>
                    <p className="text-xs text-muted-foreground">{r.jenis === "PUTUS" ? t("kindPutus") : t("kindKonsi")}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.bulanBayarLabel ? t("payoutMonth", { month: r.bulanBayarLabel }) : t("payoutPending")}
                    </p>
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
                  {r.komisiLama !== null ? (
                    <div className="text-xs text-muted-foreground">{t("commissionReplaced", { old: formatIDR(r.komisiLama) })}</div>
                  ) : null}
                  <div className="flex items-baseline justify-between gap-3 border-t pt-1">
                    <dt className="font-medium">{t("total")}</dt>
                    <dd className="whitespace-nowrap font-semibold tabular-nums">{formatIDR(r.total)}</dd>
                  </div>
                  {r.potonganHilang > 0 ? (
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-muted-foreground">{t("lossDeduction")}</dt>
                      <dd className="whitespace-nowrap tabular-nums text-destructive">−{formatIDR(r.potonganHilang)}</dd>
                    </div>
                  ) : null}
                  {r.koreksi.map((k, i) => (
                    <div key={`${r.kunci}-k${i}`} className="space-y-0.5">
                      {k.jumlah !== 0 ? (
                        <div className="flex items-baseline justify-between gap-3">
                          <dt className="min-w-0 text-muted-foreground">
                            {t("correctionLine", { month: k.bulanLabel, store: k.toko })}
                            {!k.diterapkan ? <span className="block text-xs">{t("correctionWith")}</span> : null}
                          </dt>
                          <dd className={`whitespace-nowrap tabular-nums ${k.jumlah < 0 ? "text-destructive" : ""}`}>{formatKoreksi(k.jumlah)}</dd>
                        </div>
                      ) : null}
                      {k.dibawa !== 0 ? (
                        <div className="text-xs text-muted-foreground">
                          {k.jumlah === 0 ? `${t("correctionLine", { month: k.bulanLabel, store: k.toko })}: ` : ""}
                          {t("correctionCarried", { amount: formatKoreksi(k.dibawa) })}
                        </div>
                      ) : null}
                    </div>
                  ))}
                  {r.ditahan ? (
                    <div className="border-t pt-1 text-xs text-muted-foreground">{t("payoutHeld")}</div>
                  ) : r.belumPasti ? (
                    <div className="border-t pt-1 text-xs text-muted-foreground">{t("payoutNotFinal")}</div>
                  ) : (
                    <div className="flex items-baseline justify-between gap-3 border-t pt-1">
                      <dt className="font-medium">{r.dibayarLabel ? t("received") : t("toReceive")}</dt>
                      <dd className="whitespace-nowrap font-semibold tabular-nums">{formatIDR(r.diterima)}</dd>
                    </div>
                  )}
                </dl>
                {r.jenis === "PUTUS" || r.aturanLama ? (
                  <p className="text-xs text-muted-foreground">
                    {r.aturanLama ? t("oldRule") : t("basisOwn")}
                    {r.jenis === "PUTUS" && r.ditetapkanLabel ? ` · ${t("lockedOn", { date: r.ditetapkanLabel })}` : ""}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {koreksiMenunggu.length > 0 ? (
        <section className="beranda-kartu space-y-2">
          <h2 className="beranda-judul">{t("correctionsWaitingTitle")}</h2>
          <p className="text-xs text-muted-foreground">{t("correctionsWaitingNote")}</p>
          <dl className="space-y-1 text-sm">
            {koreksiMenunggu.map((k, i) => (
              <div key={`tunggu-${i}`} className="flex items-baseline justify-between gap-3">
                <dt className="min-w-0 text-muted-foreground">{t("correctionLine", { month: k.bulanLabel, store: k.toko })}</dt>
                <dd className={`whitespace-nowrap tabular-nums ${k.jumlah < 0 ? "text-destructive" : ""}`}>{formatKoreksi(k.jumlah)}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
    </div>
  );
}
