"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, CalendarRange, ListChecks } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ambilIkhtisarJadwalAction, ambilTahapBulanAction } from "@/app/actions/jadwal-produksi";
import type { HasilBacaJadwal } from "@/app/actions/jadwal-produksi";
import type { IkhtisarBulan, TahapBulan } from "@/lib/production/jadwal-queries";
import type { KodeGalatJadwal } from "@/lib/production/jadwal-jejak";
import { hariIniWib } from "@/lib/tanggal-isian";
import { cn } from "@/lib/utils";
import { RincianJadwal } from "./ringkasan-jadwal";
import { formatPlanNumber } from "./types";
import { tautanRuangKerjaTahap } from "./stage-list";
import { bacaBulanUrl, bulanAwalKalender } from "./kalender-bulan";

/*
 * Tab Kalender Plan Kerja: 12 bulan tahun plan (tahap, qty, langkah telat,
 * tahap tanpa jadwal / tanpa PO) → klik bulan → daftar tahap bulan itu dengan
 * ringkasan jadwal, WO, PO, dan tautan ke ruang kerja tahap. Bulan terpilih
 * disimpan di `?bulan=` supaya tautannya bisa dibagikan.
 */

const BULAN = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

/** Status WO → kunci teks `workOrders.*` yang sudah ada. */
const KUNCI_STATUS_WO: Record<string, string> = {
  DRAFT: "draft",
  ISSUED: "issued",
  IN_PRODUCTION: "inProduction",
  PARTIAL: "partial",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
};

type Muatan<T> = { kunci: string; hasil: HasilBacaJadwal<T> };

/** Panggil aksi baca; kegagalan jaringan dibaca sebagai `GAGAL`, tidak pernah melempar. */
function useBaca<T>(kunci: string, baca: () => Promise<HasilBacaJadwal<T>>): HasilBacaJadwal<T> | null {
  const [muatan, setMuatan] = useState<Muatan<T> | null>(null);
  useEffect(() => {
    let batal = false;
    baca()
      .catch((): HasilBacaJadwal<T> => ({ ok: false, code: "GAGAL" }))
      .then((hasil) => {
        if (!batal) setMuatan({ kunci, hasil });
      });
    return () => {
      batal = true;
    };
    // `kunci` mewakili seluruh masukan `baca`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kunci]);
  return muatan && muatan.kunci === kunci ? muatan.hasil : null;
}

export function PlanKalenderTab({
  tahun,
  lihatPo,
  lihatSpk,
}: {
  /** Tahun plan yang sedang dipilih. */
  tahun: number;
  /** Penonton memegang `purchase_orders:view` — angka "tanpa PO" dan kolom PO. */
  lihatPo: boolean;
  /** Penonton memegang `work_orders:view` — kolom WO. */
  lihatSpk: boolean;
}) {
  const t = useTranslations("jadwalProduksi.plan.kalender");
  const tBulan = useTranslations("jadwalProduksi.plan.bulan");
  const tPlan = useTranslations("jadwalProduksi.plan");
  const tServer = useTranslations("jadwalProduksi.server");
  const tWo = useTranslations("workOrders");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const hariIni = hariIniWib();
  const [tahunIni, bulanIni] = hariIni.split("-").map(Number);
  const bulan = bulanAwalKalender(bacaBulanUrl(searchParams.get("bulan")), tahun, hariIni);
  const [ulang, setUlang] = useState(0);

  const ikhtisar = useBaca<IkhtisarBulan[]>(`${tahun}:${ulang}`, () => ambilIkhtisarJadwalAction(tahun));
  const daftar = useBaca<TahapBulan[]>(`${tahun}:${bulan}:${ulang}`, () =>
    ambilTahapBulanAction(tahun, bulan)
  );

  const pesanGalat = (code: KodeGalatJadwal) =>
    tServer.has(`err${code}`) ? tServer(`err${code}`) : t("gagalMuat");

  const pilihBulan = (b: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("bulan", String(b));
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const namaBulan = (b: number) => tBulan(String(b) as "1");
  const labelStatusWo = (status: string) =>
    KUNCI_STATUS_WO[status] && tWo.has(KUNCI_STATUS_WO[status]) ? tWo(KUNCI_STATUS_WO[status]) : status;

  const galat =
    (ikhtisar && !ikhtisar.ok ? ikhtisar.code : null) ?? (daftar && !daftar.ok ? daftar.code : null);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5" />
            {t("judulTahun", { tahun })}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {galat && (
            <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-destructive">
              <span>{pesanGalat(galat)}</span>
              <Button type="button" size="sm" variant="outline" onClick={() => setUlang((n) => n + 1)}>
                {t("cobaLagi")}
              </Button>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
            {BULAN.map((b) => {
              const data = ikhtisar?.ok ? ikhtisar.data.find((x) => x.bulan === b) : undefined;
              const sekarang = tahun === tahunIni && b === bulanIni;
              const dipilih = b === bulan;
              return (
                <Button
                  key={b}
                  type="button"
                  variant="outline"
                  aria-pressed={dipilih}
                  onClick={() => pilihBulan(b)}
                  className={cn(
                    "h-auto min-w-0 flex-col items-start justify-start gap-1 whitespace-normal p-3 text-left font-normal",
                    dipilih && "ring-2 ring-primary",
                  )}
                >
                  <span className="flex w-full flex-wrap items-center justify-between gap-1">
                    <span className="font-medium">{namaBulan(b)}</span>
                    {sekarang && <Badge variant="secondary">{t("bulanIni")}</Badge>}
                  </span>
                  {!ikhtisar ? (
                    <span className="h-4 w-20 animate-pulse rounded bg-muted" />
                  ) : !data || data.tahap === 0 ? (
                    <span className="text-xs text-muted-foreground">{t("kosongBulanSel")}</span>
                  ) : (
                    <>
                      <span className="text-sm">
                        {t("tahap", { n: data.tahap })} · {t("qty", { qty: formatPlanNumber(data.qty) })}
                      </span>
                      {data.langkahTelat > 0 && (
                        <span className="text-xs font-medium text-red-700 dark:text-red-400">
                          {t("telat", { n: data.langkahTelat })}
                        </span>
                      )}
                      {data.tanpaJadwal > 0 && (
                        <span className="text-xs text-amber-700 dark:text-amber-400">
                          {t("tanpaJadwal", { n: data.tanpaJadwal })}
                        </span>
                      )}
                      {lihatPo && data.tanpaPo > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {t("tanpaPo", { n: data.tanpaPo })}
                        </span>
                      )}
                      {data.selesai > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {t("selesai", { n: data.selesai })}
                        </span>
                      )}
                    </>
                  )}
                </Button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListChecks className="h-5 w-5" />
            {t("judulBulan", { bulan: namaBulan(bulan), tahun })}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!daftar ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
            </div>
          ) : !daftar.ok ? null : daftar.data.length === 0 ? (
            <EmptyState icon={CalendarRange} title={t("kosongBulan")} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("kolomJenis")}</TableHead>
                    <TableHead>{t("kolomTahap")}</TableHead>
                    <TableHead className="text-right">{t("kolomQty")}</TableHead>
                    <TableHead className="hidden xl:table-cell">{t("kolomPenjahit")}</TableHead>
                    <TableHead className="min-w-[180px]">{t("kolomJadwal")}</TableHead>
                    {lihatSpk && <TableHead>{t("kolomWo")}</TableHead>}
                    {lihatPo && <TableHead className="min-w-[120px]">{t("kolomPo")}</TableHead>}
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {daftar.data.map((tahap) => (
                    <TableRow
                      key={tahap.id}
                      className={cn(lihatPo && tahap.po?.length === 0 && "bg-amber-500/10 hover:bg-amber-500/15")}
                    >
                      <TableCell className="whitespace-normal">
                        <span className="font-medium">{tahap.kategori.code}</span>
                        <span className="block text-xs text-muted-foreground">{tahap.kategori.name}</span>
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        <Link href={tautanRuangKerjaTahap(tahap.id)} className="font-medium text-tautan hover:underline">
                          {tahap.name}
                        </Link>
                        {tahap.variantSku && (
                          <span className="block text-xs text-muted-foreground">{tahap.variantSku}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatPlanNumber(tahap.targetQty)}</TableCell>
                      <TableCell className="hidden whitespace-normal xl:table-cell">
                        {tahap.penjahit?.name ?? "—"}
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        <RincianJadwal ringkasan={tahap.ringkasan} />
                      </TableCell>
                      {lihatSpk && (
                        <TableCell className="whitespace-normal">
                          {tahap.wo ? (
                            <Link href={`/backoffice/work-orders/${tahap.wo.id}`} className="text-tautan hover:underline">
                              {tahap.wo.docNumber}
                              <span className="block text-xs text-muted-foreground">
                                {labelStatusWo(tahap.wo.status)}
                              </span>
                            </Link>
                          ) : (
                            <span className="text-xs text-muted-foreground">{t("tanpaWo")}</span>
                          )}
                        </TableCell>
                      )}
                      {lihatPo && (
                        <TableCell className="whitespace-normal">
                          {tahap.po == null ? (
                            "—"
                          ) : tahap.po.length === 0 ? (
                            <Badge
                              variant="outline"
                              className="border-amber-500/60 text-amber-800 dark:text-amber-300"
                            >
                              {t("belumAdaPo")}
                            </Badge>
                          ) : (
                            <span className="flex flex-wrap gap-x-2 gap-y-0.5">
                              {tahap.po.map((po) => (
                                <Link
                                  key={po.id}
                                  href={`/backoffice/purchase-orders/${po.id}`}
                                  className="text-tautan hover:underline"
                                >
                                  {po.docNumber}
                                </Link>
                              ))}
                            </span>
                          )}
                        </TableCell>
                      )}
                      <TableCell>
                        <Button asChild size="sm" variant="outline">
                          <Link href={tautanRuangKerjaTahap(tahap.id)}>
                            <CalendarRange className="h-4 w-4" />
                            {tPlan("ruangKerja")}
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
