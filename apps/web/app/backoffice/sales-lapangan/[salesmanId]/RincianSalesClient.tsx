"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { AlertTriangle, ArrowLeft, BarChart3, CalendarRange, ExternalLink, Footprints, MapPin, Store } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatIDR } from "@/lib/sales-orders/format";
import { dinamis } from "@/lib/i18n/dinamis";
import type { KodeRingkasan } from "@/lib/salesman/hasil-kunjungan";
import type { StatusJadwal } from "@/lib/salesman/jadwal";
import type { AlasanRencana, KodeJanggal } from "@/lib/salesman/metrik-lapangan";
import type { AngkaSales, BarisHasil, BarisTanda, FilterRentangData } from "../bentuk";
import { FilterRentang } from "../FilterRentang";
import { GrafikBatang } from "../GrafikBatang";
import { KartuAngka } from "../KartuAngka";

export type TandaRincian = { kode: KodeJanggal; param: Record<string, string | number> };

export type KunjunganRincian = {
  id: string;
  storeId: string;
  toko: string;
  kodeToko: string;
  /** Diisi hanya bila rentangnya lebih dari satu hari; diformat di server. */
  tanggal: string | null;
  jamMasuk: string;
  jamKeluar: string | null;
  durasiMenit: number | null;
  ditutupOtomatis: boolean;
  kodeHasil: KodeRingkasan;
  catatan: string | null;
  efektif: boolean;
  pesanan: number;
  pesananDitolak: number;
  nilaiPutus: number;
  konsi: number;
  klaim: number;
  nilaiKlaim: number;
  retur: number;
  van: number;
  nilaiVan: number;
  jarakMeter: number | null;
  tanda: TandaRincian[];
  peta: string;
};

export type JadwalRincian = {
  dayKey: string;
  /** Diformat di server. */
  tanggal: string;
  storeId: string;
  nama: string;
  catatan: string | null;
  status: StatusJadwal;
};

const NADA_JADWAL: Record<StatusJadwal, StatusTone> = { DIKUNJUNGI: "settled", TERLEWAT: "attention", MENUNGGU: "waiting", IZIN: "inactive" };

function nadaHasil(kode: KodeRingkasan): StatusTone {
  if (kode === "TRANSAKSI") return "settled";
  if (kode === "TRANSAKSI_TERTUNDA") return "progress";
  if (kode === "KOSONG") return "inactive";
  return "waiting";
}

export function RincianSalesClient({
  nama,
  kembali,
  alamat,
  filter,
  angka,
  hasil,
  perTanda,
  rencana,
  tokoBaru,
  kunjungan,
  jadwal = [],
  alamatJadwal,
}: {
  nama: string;
  kembali: string;
  alamat: string;
  filter: FilterRentangData;
  angka: AngkaSales;
  hasil: BarisHasil[];
  perTanda: BarisTanda[];
  rencana: { storeId: string; nama: string; alasan: AlasanRencana[]; dikunjungi: boolean }[];
  tokoBaru: { storeId: string; nama: string; sumber: "USULAN" | "PESANAN_PERTAMA" }[];
  kunjungan: KunjunganRincian[];
  /** Toko yang dijadwalkan kantor di rentang, dengan status kepatuhannya. */
  jadwal?: JadwalRincian[];
  /** Tautan ke layar jadwal kantor untuk sales ini. */
  alamatJadwal?: string;
}) {
  const t = useTranslations("salesLapangan");
  const td = dinamis(t);
  const durasi = (menit: number) =>
    menit >= 60 ? t("durationHours", { jam: Math.floor(menit / 60), menit: menit % 60 }) : t("durationMinutes", { menit });
  // Belum didatangi dulu: itu yang perlu ditanyakan atasan.
  const rencanaUrut = [...rencana].sort((a, b) => Number(a.dikunjungi) - Number(b.dikunjungi));

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href={kembali}>
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {t("detail.back")}
        </Link>
      </Button>

      <PageHeader title={nama} meta={t("detail.rangeMeta", { label: filter.label })} />

      <FilterRentang key={`${filter.preset}|${filter.dari}|${filter.sampai}`} alamat={alamat} filter={filter} />

      <KartuAngka angka={angka} />

      {jadwal.length > 0 ? (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0 pb-3">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2 text-base">
                <CalendarRange className="h-5 w-5" aria-hidden />
                {t("schedule.title")}
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                {angka.jadwal
                  ? t("schedule.summary", {
                      dikunjungi: angka.jadwal.dikunjungi,
                      direncanakan: angka.jadwal.direncanakan,
                      terlewat: angka.jadwal.terlewat,
                    })
                  : null}
              </p>
            </div>
            {alamatJadwal ? (
              <Button asChild variant="outline" size="sm">
                <Link href={alamatJadwal}>{t("schedule.open")}</Link>
              </Button>
            ) : null}
          </CardHeader>
          <CardContent>
            <ul className="max-h-80 divide-y overflow-y-auto rounded-md border">
              {jadwal.map((j) => (
                <li key={`${j.dayKey}:${j.storeId}`} className="flex flex-wrap items-center gap-3 px-3 py-2">
                  <span className="w-28 shrink-0 text-xs tabular-nums text-muted-foreground">{j.tanggal}</span>
                  <span className="min-w-0 flex-1">
                    <Link href={`/backoffice/stores/${j.storeId}`} className="font-medium hover:underline">
                      {j.nama}
                    </Link>
                    {j.catatan ? <span className="block text-xs text-muted-foreground">{j.catatan}</span> : null}
                  </span>
                  <StatusPill tone={NADA_JADWAL[j.status]}>{td(`schedule.status.${j.status}`)}</StatusPill>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <MapPin className="h-5 w-5" aria-hidden />
              {t("plan.title")}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {angka.rencana && angka.rencana.direncanakan > 0
                ? t("plan.summary", {
                    dikunjungi: angka.rencana.dikunjungi,
                    direncanakan: angka.rencana.direncanakan,
                    persen: angka.rencana.persen ?? 0,
                  })
                : t("plan.none")}
            </p>
          </CardHeader>
          {rencanaUrut.length > 0 ? (
            <CardContent>
              <ul className="max-h-80 divide-y overflow-y-auto rounded-md border">
                {rencanaUrut.map((s) => (
                  <li key={s.storeId} className="flex flex-wrap items-center gap-3 px-3 py-2">
                    <Link href={`/backoffice/stores/${s.storeId}`} className="min-w-0 flex-1 font-medium hover:underline">
                      {s.nama}
                    </Link>
                    <span className="text-xs text-muted-foreground">{s.alasan.map((a) => td(`reason.${a}`)).join(" · ")}</span>
                    <StatusPill tone={s.dikunjungi ? "settled" : "attention"}>
                      {s.dikunjungi ? t("plan.visited") : t("plan.notVisited")}
                    </StatusPill>
                  </li>
                ))}
              </ul>
            </CardContent>
          ) : null}
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Footprints className="h-5 w-5" aria-hidden />
              {t("detail.otherTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y text-sm">
              <Baris label={t("detail.fieldTime")} nilai={angka.hariAktif > 0 ? durasi(angka.menitLapangan) : "—"}>
                {angka.hariAktif > 1 ? t("detail.fieldTimeDays", { hari: angka.hariAktif }) : null}
              </Baris>
              <Baris
                label={t("detail.target")}
                nilai={angka.target ? `${angka.target.persen}%` : "—"}
              >
                {angka.target
                  ? `${formatIDR(angka.target.capai)} / ${formatIDR(angka.target.target)}`
                  : t("detail.targetNone")}
              </Baris>
              <Baris label={t("detail.declining")} nilai={angka.tokoMenurun === null ? "—" : String(angka.tokoMenurun)}>
                {t("detail.decliningHint")}
              </Baris>
              <Baris label={t("detail.vanSales")} nilai={formatIDR(angka.van.nilai)}>
                {t("detail.count", { count: angka.van.jumlah })}
              </Baris>
              <Baris label={t("detail.returns")} nilai={String(angka.retur)} />
              <Baris label={t("detail.rejected")} nilai={String(angka.pesanan.ditolak)} />
              <Baris label={t("detail.remote")} nilai={String(angka.pesanan.jarakJauh)} />
            </dl>
            {tokoBaru.length > 0 ? (
              <div className="mt-4 space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("detail.newStores")}</p>
                <ul className="space-y-1 text-sm">
                  {tokoBaru.map((s) => (
                    <li key={s.storeId} className="flex items-center justify-between gap-2">
                      <Link href={`/backoffice/stores/${s.storeId}`} className="truncate hover:underline">
                        {s.nama}
                      </Link>
                      <span className="shrink-0 text-xs text-muted-foreground">{td(`newStoreSource.${s.sumber}`)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Store className="h-5 w-5" aria-hidden />
            {t("visits.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className={kunjungan.length === 0 ? "p-0" : undefined}>
          {kunjungan.length === 0 ? (
            <EmptyState icon={Store} title={t("visits.emptyTitle")} description={t("visits.emptyBody")} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("visits.colTime")}</TableHead>
                    <TableHead>{t("visits.colStore")}</TableHead>
                    <TableHead>{t("visits.colOutcome")}</TableHead>
                    <TableHead>{t("visits.colTransactions")}</TableHead>
                    <TableHead>{t("visits.colCheckin")}</TableHead>
                    <TableHead className="text-right">{t("visits.colMap")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {kunjungan.map((k) => {
                    const transaksi = [
                      k.pesanan > 0
                        ? k.nilaiPutus > 0
                          ? t("visits.txOrdersValue", { count: k.pesanan, nilai: formatIDR(k.nilaiPutus) })
                          : t("visits.txOrders", { count: k.pesanan })
                        : null,
                      k.konsi > 0 ? t("visits.txKonsi", { count: k.konsi }) : null,
                      k.pesananDitolak > 0 ? t("visits.txRejected", { count: k.pesananDitolak }) : null,
                      k.klaim > 0 ? t("visits.txClaims", { count: k.klaim, nilai: formatIDR(k.nilaiKlaim) }) : null,
                      k.retur > 0 ? t("visits.txReturns", { count: k.retur }) : null,
                      k.van > 0 ? t("visits.txVan", { count: k.van, nilai: formatIDR(k.nilaiVan) }) : null,
                    ].filter((x): x is string => x !== null);
                    return (
                      <TableRow key={k.id} className="align-top">
                        <TableCell className="tabular-nums">
                          {k.tanggal ? <span className="block text-xs text-muted-foreground">{k.tanggal}</span> : null}
                          {k.jamKeluar ? `${k.jamMasuk}–${k.jamKeluar}` : k.jamMasuk}
                          <span className="block text-xs text-muted-foreground">
                            {k.jamKeluar
                              ? k.ditutupOtomatis
                                ? t("visits.autoClosed")
                                : durasi(k.durasiMenit ?? 0)
                              : t("visits.open")}
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-normal">
                          <Link href={`/backoffice/stores/${k.storeId}`} className="font-medium hover:underline">
                            {k.toko}
                          </Link>
                          <span className="block font-mono text-xs text-muted-foreground">{k.kodeToko}</span>
                        </TableCell>
                        <TableCell className="max-w-64 whitespace-normal">
                          <StatusPill tone={nadaHasil(k.kodeHasil)} detail={k.catatan ?? undefined}>
                            {td(`outcome.${k.kodeHasil}`)}
                          </StatusPill>
                        </TableCell>
                        <TableCell className="whitespace-normal text-sm">
                          {transaksi.length === 0 ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <ul className="space-y-0.5">
                              {transaksi.map((x) => (
                                <li key={x}>{x}</li>
                              ))}
                            </ul>
                          )}
                        </TableCell>
                        <TableCell className="max-w-72 whitespace-normal">
                          {k.jarakMeter !== null && k.tanda.every((x) => x.kode !== "LUAR_RADIUS") ? (
                            <span className="block text-xs text-muted-foreground">
                              {t("visits.distance", { jarak: k.jarakMeter })}
                            </span>
                          ) : null}
                          {k.tanda.length === 0 ? (
                            k.jarakMeter === null ? <span className="text-muted-foreground">—</span> : null
                          ) : (
                            <ul className="space-y-1">
                              {k.tanda.map((x) => (
                                <li key={x.kode}>
                                  <Badge
                                    variant="outline"
                                    className="border-transparent bg-amber-500/15 text-amber-800 dark:text-amber-300"
                                  >
                                    <AlertTriangle className="mr-1 h-3 w-3" aria-hidden />
                                    {td(`flag.${x.kode}`)}
                                  </Badge>
                                  <span className="block text-xs text-muted-foreground">
                                    {td(`flagDetail.${x.kode}`, x.param)}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button asChild variant="ghost" size="sm">
                            <a href={k.peta} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="h-4 w-4" aria-hidden />
                              <span className="sr-only sm:not-sr-only">{t("visits.openMap")}</span>
                            </a>
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="h-5 w-5" aria-hidden />
              {t("outcomes.title")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <GrafikBatang
              kosong={t("outcomes.empty")}
              baris={hasil.map((h) => ({
                kunci: h.kode,
                label: td(`outcome.${h.kode}`),
                jumlah: h.jumlah,
                nada: h.kode === "TRANSAKSI" || h.kode === "TRANSAKSI_TERTUNDA" ? "hijau" : "utama",
              }))}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-5 w-5" aria-hidden />
              {t("flags.title")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <GrafikBatang
              kosong={t("flags.empty")}
              baris={perTanda.map((x) => ({ kunci: x.kode, label: td(`flag.${x.kode}`), jumlah: x.jumlah, nada: "kuning" }))}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Baris({ label, nilai, children }: { label: string; nilai: string; children?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0">
      <dt className="min-w-0">
        <span className="block">{label}</span>
        {children ? <span className="block text-xs text-muted-foreground">{children}</span> : null}
      </dt>
      <dd className="shrink-0 font-semibold tabular-nums">{nilai}</dd>
    </div>
  );
}
