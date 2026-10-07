"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowRight, Coins, Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { dinamis } from "@/lib/i18n/dinamis";
import { formatIDR } from "@/lib/sales-orders/format";
import { formatPersen, namaBulan, type DasarKomisi } from "@/lib/salesman/komisi";
import type { PotonganHilangSales } from "@/lib/spg/hilang-queries";
import { eksporLaporanKomisi } from "./actions";
import { TandaiDipotongDialog } from "./TandaiDipotongDialog";

export type BarisLaporanJson = {
  salesmanId: string;
  nama: string;
  omzet: number;
  target: number | null;
  capaianPersen: number | null;
  dasarNilai: number;
  bagianPenjual: number;
  bagianPenagih: number;
  tarifDasar: number;
  tarifDipakai: number;
  komisi: number;
};

type Props = {
  bulan: string;
  pilihan: string[];
  skema: { aktif: boolean; dasar: DasarKomisi; tarifPersen: number; jumlahTingkat: number; bagianPenagihPersen: number };
  baris: BarisLaporanJson[];
  /** Beban barang hilang bagian SALES per salesman (sisa, dipotong bulan ini, saran). */
  potonganHilang: Record<string, PotonganHilangSales>;
  maksPotongPersen: number;
  /** `receivables:manage` — yang boleh menandai potongan beban. */
  bolehPotong: boolean;
};

/**
 * Laporan komisi salesman satu bulan. Bulan dipilih lewat alamat (`?bulan=`),
 * jadi laporan bulan tertentu bisa dibuka ulang dan dibagikan.
 */
export function KomisiSalesmanClient({ bulan, pilihan, skema, baris, potonganHilang, maksPotongPersen, bolehPotong }: Props) {
  const t = useTranslations("komisiSalesman.laporan");
  const tHilang = useTranslations("komisiSalesmanHilang");
  const tBulan = dinamis(useTranslations("komisiSalesman"));
  const tDinamis = dinamis(t);
  const locale = useLocale();
  const router = useRouter();
  const [pindah, mulaiPindah] = useTransition();
  const [mengekspor, setMengekspor] = useState(false);
  const persen = (n: number) => formatPersen(n, locale);
  const tertagih = skema.dasar === "TERTAGIH";

  const jumlah = (f: (b: BarisLaporanJson) => number) => baris.reduce((n, b) => n + f(b), 0);
  const totalKomisi = jumlah((b) => b.komisi);
  const hilang = (id: string): PotonganHilangSales => potonganHilang[id] ?? { sisa: 0, dipotongBulanIni: 0, saran: 0 };
  const adaHilang = baris.some((b) => hilang(b.salesmanId).sisa > 0 || hilang(b.salesmanId).dipotongBulanIni > 0);

  async function ekspor() {
    setMengekspor(true);
    try {
      const r = await eksporLaporanKomisi(bulan, {
        judul: t("excelTitle"),
        bulan: namaBulan(tBulan, bulan, "panjang"),
        disiapkan: t("excelPreparedBy"),
        dicetak: t("excelPrintedAt"),
        kolom: {
          salesman: t("colSalesman"),
          omzet: t("colSales"),
          target: t("colTarget"),
          capaian: t("colAchievementPct"),
          dasar: tDinamis(`colBasis${skema.dasar}`),
          bagianPenjual: t("colSellerShare"),
          bagianPenagih: t("colCollectorShare"),
          tarif: t("colRatePct"),
          komisi: t("colCommission"),
          bebanHilang: tHilang("excelSisa"),
          dipotongHilang: tHilang("excelDipotong"),
        },
        total: t("total"),
        catatan: t("footnote"),
      });
      if (!r.ok) {
        toast.error(r.code === "FORBIDDEN" ? t("errForbidden") : t("exportFailed"));
        return;
      }
      const bin = atob(r.base64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(
        new Blob([arr], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = r.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t("exportStarted"));
    } catch {
      toast.error(t("exportFailed"));
    } finally {
      setMengekspor(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        meta={skema.aktif ? t("meta", { total: formatIDR(totalKomisi), count: baris.length }) : t("inactive")}
        actions={
          <Button variant="outline" onClick={ekspor} disabled={mengekspor || baris.length === 0}>
            {mengekspor ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            {t("exportExcel")}
          </Button>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Select
          value={bulan}
          onValueChange={(v) => mulaiPindah(() => router.push(`/backoffice/laporan/komisi-salesman?bulan=${v}`))}
        >
          <SelectTrigger className="w-[200px]" aria-label={t("monthLabel")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {pilihan.map((b) => (
              <SelectItem key={b} value={b}>
                {namaBulan(tBulan, b, "panjang")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {pindah ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden /> : null}
        <p className="text-sm text-muted-foreground">
          {tDinamis(`scheme${skema.dasar}`, {
            rate: persen(skema.tarifPersen),
            tiers: skema.jumlahTingkat,
            split: persen(skema.bagianPenagihPersen),
          })}{" "}
          <Link
            href="/backoffice/settings/salesman"
            className="inline-flex items-center gap-1 font-medium underline decoration-muted-foreground/50 underline-offset-2 hover:decoration-foreground"
          >
            {t("openSettings")}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Coins className="h-5 w-5" />
            {t("listTitle", { month: namaBulan(tBulan, bulan, "panjang") })}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {baris.length === 0 ? (
            <EmptyState icon={Coins} title={t("emptyTitle")} description={t("emptyDescription")} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("colSalesman")}</TableHead>
                    <TableHead className="text-right">{t("colSales")}</TableHead>
                    <TableHead className="hidden text-right 2xl:table-cell">{t("colTarget")}</TableHead>
                    <TableHead className="text-right">{t("colAchievement")}</TableHead>
                    <TableHead className="text-right">{tDinamis(`colBasis${skema.dasar}`)}</TableHead>
                    {tertagih ? (
                      <>
                        <TableHead className="text-right">{t("colSellerShare")}</TableHead>
                        <TableHead className="text-right">{t("colCollectorShare")}</TableHead>
                      </>
                    ) : null}
                    <TableHead className="text-right">{t("colRate")}</TableHead>
                    <TableHead className="text-right">{t("colCommission")}</TableHead>
                    {adaHilang ? <TableHead className="text-right">{tHilang("kolom")}</TableHead> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {baris.map((b) => (
                    <TableRow key={b.salesmanId}>
                      <TableCell className="whitespace-normal font-medium">{b.nama}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatIDR(b.omzet)}</TableCell>
                      <TableCell className="hidden text-right tabular-nums 2xl:table-cell">
                        {b.target === null ? "—" : formatIDR(b.target)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {b.capaianPersen === null ? (
                          <span className="text-muted-foreground">{t("noTarget")}</span>
                        ) : (
                          `${persen(b.capaianPersen)}%`
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatIDR(b.dasarNilai)}</TableCell>
                      {tertagih ? (
                        <>
                          <TableCell className="text-right tabular-nums">{formatIDR(b.bagianPenjual)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatIDR(b.bagianPenagih)}</TableCell>
                        </>
                      ) : null}
                      <TableCell className="text-right tabular-nums">
                        {persen(b.tarifDipakai)}%
                        {b.tarifDipakai > b.tarifDasar ? (
                          <span className="block text-xs text-muted-foreground">{t("tierUp", { base: persen(b.tarifDasar) })}</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{formatIDR(b.komisi)}</TableCell>
                      {adaHilang ? (
                        <TableCell className="text-right tabular-nums">
                          {hilang(b.salesmanId).sisa > 0 || hilang(b.salesmanId).dipotongBulanIni > 0 ? (
                            <>
                              <span className="block">{tHilang("sisa", { nilai: formatIDR(hilang(b.salesmanId).sisa) })}</span>
                              {hilang(b.salesmanId).dipotongBulanIni > 0 ? (
                                <span className="block text-xs text-muted-foreground">
                                  {tHilang("dipotongBulanIni", { nilai: formatIDR(hilang(b.salesmanId).dipotongBulanIni) })}
                                </span>
                              ) : null}
                              {bolehPotong && hilang(b.salesmanId).sisa > 0 ? (
                                <TandaiDipotongDialog
                                  salesmanId={b.salesmanId}
                                  nama={b.nama}
                                  bulan={bulan}
                                  bulanLabel={namaBulan(tBulan, bulan, "panjang")}
                                  sisa={hilang(b.salesmanId).sisa}
                                  saran={hilang(b.salesmanId).saran}
                                  maksPotongPersen={maksPotongPersen}
                                />
                              ) : null}
                            </>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell className="font-semibold">{t("total")}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{formatIDR(jumlah((b) => b.omzet))}</TableCell>
                    <TableCell className="hidden 2xl:table-cell" />
                    <TableCell />
                    <TableCell className="text-right font-semibold tabular-nums">{formatIDR(jumlah((b) => b.dasarNilai))}</TableCell>
                    {tertagih ? (
                      <>
                        <TableCell className="text-right font-semibold tabular-nums">{formatIDR(jumlah((b) => b.bagianPenjual))}</TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">{formatIDR(jumlah((b) => b.bagianPenagih))}</TableCell>
                      </>
                    ) : null}
                    <TableCell />
                    <TableCell className="text-right font-semibold tabular-nums">{formatIDR(totalKomisi)}</TableCell>
                    {adaHilang ? (
                      <TableCell className="text-right font-semibold tabular-nums">
                        {formatIDR(baris.reduce((n, b) => n + hilang(b.salesmanId).sisa, 0))}
                      </TableCell>
                    ) : null}
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          )}
          {adaHilang ? <p className="mt-4 text-xs text-muted-foreground">{tHilang("catatanKaki", { persen: maksPotongPersen })}</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}
