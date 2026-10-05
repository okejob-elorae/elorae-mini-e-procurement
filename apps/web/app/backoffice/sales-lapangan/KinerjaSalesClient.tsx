"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { AlertTriangle, BarChart3, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatIDR } from "@/lib/sales-orders/format";
import { dinamis } from "@/lib/i18n/dinamis";
import { cn } from "@/lib/utils";
import type { AngkaSales, BarisHasil, BarisTanda, FilterRentangData } from "./bentuk";
import { FilterRentang } from "./FilterRentang";
import { GrafikBatang } from "./GrafikBatang";
import { KartuAngka } from "./KartuAngka";
import { TombolEkspor } from "./TombolEkspor";

export type BarisKinerja = { salesmanId: string; nama: string; href: string; angka: AngkaSales };

/** Jumlah kolom yang hanya bermakna per sales (rencana, toko menurun, target) untuk baris total. */
function jumlahTambahan(baris: readonly BarisKinerja[]) {
  let direncanakan = 0;
  let dikunjungi = 0;
  let adaRencana = false;
  let menurun = 0;
  let target = 0;
  let capai = 0;
  const jadwal = { direncanakan: 0, dikunjungi: 0, terlewat: 0 };
  for (const b of baris) {
    if (b.angka.jadwal) {
      jadwal.direncanakan += b.angka.jadwal.direncanakan;
      jadwal.dikunjungi += b.angka.jadwal.dikunjungi;
      jadwal.terlewat += b.angka.jadwal.terlewat;
    }
    if (b.angka.rencana) {
      adaRencana = true;
      direncanakan += b.angka.rencana.direncanakan;
      dikunjungi += b.angka.rencana.dikunjungi;
    }
    menurun += b.angka.tokoMenurun ?? 0;
    if (b.angka.target) {
      target += b.angka.target.target;
      capai += b.angka.target.capai;
    }
  }
  return {
    rencana: adaRencana ? { direncanakan, dikunjungi, persen: direncanakan ? Math.round((dikunjungi / direncanakan) * 100) : null } : null,
    menurun,
    // Target tim = jumlah target sales yang punya target; capaian dibandingkan hanya dengan mereka.
    target: target > 0 ? { target, capai, persen: Math.round((capai / target) * 100) } : null,
    jadwal: jadwal.direncanakan > 0 ? jadwal : null,
  };
}

export function KinerjaSalesClient({
  filter,
  baris,
  total,
  hasil,
  perTanda,
}: {
  filter: FilterRentangData;
  baris: BarisKinerja[];
  total: AngkaSales;
  hasil: BarisHasil[];
  perTanda: BarisTanda[];
}) {
  const t = useTranslations("salesLapangan");
  const td = dinamis(t);
  const tambahan = jumlahTambahan(baris);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("pageTitle")}
        meta={t("rangeMeta", { label: filter.label, count: baris.length })}
        actions={<TombolEkspor filter={filter} />}
      />

      <FilterRentang key={`${filter.preset}|${filter.dari}|${filter.sampai}`} alamat="/backoffice/sales-lapangan" filter={filter} />

      <KartuAngka angka={{ ...total, jadwal: tambahan.jadwal }} />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-5 w-5" aria-hidden />
            {t("table.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className={baris.length === 0 ? "p-0" : undefined}>
          {baris.length === 0 ? (
            <EmptyState icon={Users} title={t("table.emptyTitle")} description={t("table.emptyBody")} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("table.colSales")}</TableHead>
                    <TableHead className="text-right">{t("table.colVisits")}</TableHead>
                    <TableHead className="text-right">{t("table.colEffective")}</TableHead>
                    <TableHead className="hidden text-right 2xl:table-cell">{t("table.colPlan")}</TableHead>
                    <TableHead className="text-right">{t("table.colOrders")}</TableHead>
                    <TableHead className="text-right">{t("table.colValue")}</TableHead>
                    <TableHead className="text-right">{t("table.colCollections")}</TableHead>
                    <TableHead className="text-right">{t("table.colNewStores")}</TableHead>
                    <TableHead className="text-right">{t("table.colFlags")}</TableHead>
                    <TableHead className="text-right">{t("table.colDeclining")}</TableHead>
                    <TableHead className="hidden text-right 2xl:table-cell">{t("table.colTarget")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {baris.map((b) => (
                    <BarisSales
                      key={b.salesmanId}
                      nama={<Link href={b.href} className="font-medium hover:underline">{b.nama}</Link>}
                      angka={b.angka}
                      rencana={b.angka.rencana}
                      menurun={b.angka.tokoMenurun}
                      target={b.angka.target}
                    />
                  ))}
                </TableBody>
                <TableFooter>
                  <BarisSales
                    nama={<span className="font-semibold">{t("table.total")}</span>}
                    angka={{ ...total, jadwal: tambahan.jadwal }}
                    rencana={tambahan.rencana}
                    menurun={tambahan.menurun}
                    target={tambahan.target}
                  />
                </TableFooter>
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

function Sub({ children }: { children: ReactNode }) {
  return <span className="block text-xs font-normal text-muted-foreground">{children}</span>;
}

function BarisSales({
  nama,
  angka,
  rencana,
  menurun,
  target,
}: {
  nama: ReactNode;
  angka: AngkaSales;
  rencana: AngkaSales["rencana"];
  menurun: number | null;
  target: AngkaSales["target"];
}) {
  const t = useTranslations("salesLapangan");
  return (
    <TableRow>
      <TableCell>{nama}</TableCell>
      <TableCell className="text-right tabular-nums">
        {angka.kunjungan}
        <Sub>{t("table.subStores", { count: angka.tokoDikunjungi })}</Sub>
        {/* Jadwal dari kantor: berapa toko terjadwal yang didatangi pada harinya. */}
        {angka.jadwal ? (
          <Sub>
            <span className={cn(angka.jadwal.terlewat > 0 && "font-medium text-amber-700 dark:text-amber-400")}>
              {t("table.subSchedule", { dikunjungi: angka.jadwal.dikunjungi, direncanakan: angka.jadwal.direncanakan })}
            </span>
          </Sub>
        ) : null}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {angka.persenEfektif === null ? "—" : `${angka.persenEfektif}%`}
        <Sub>{t("table.subEffective", { efektif: angka.efektif, kunjungan: angka.kunjungan })}</Sub>
      </TableCell>
      <TableCell className="hidden text-right tabular-nums 2xl:table-cell">
        {rencana ? (
          <>
            {rencana.dikunjungi}/{rencana.direncanakan}
            <Sub>{rencana.persen === null ? "—" : `${rencana.persen}%`}</Sub>
          </>
        ) : (
          "—"
        )}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {angka.pesanan.jumlah}
        <Sub>{t("table.subOrders", { putus: angka.pesanan.putus, konsi: angka.pesanan.konsi })}</Sub>
      </TableCell>
      <TableCell className="text-right tabular-nums">{formatIDR(angka.pesanan.nilaiPutus)}</TableCell>
      <TableCell className="text-right tabular-nums">
        {formatIDR(angka.pelunasan.nilaiTerverifikasi)}
        <Sub>
          {t("table.subCollections", { terverifikasi: angka.pelunasan.terverifikasi, dilaporkan: angka.pelunasan.dilaporkan })}
        </Sub>
      </TableCell>
      <TableCell className="text-right tabular-nums">{angka.tokoBaru}</TableCell>
      <TableCell className={cn("text-right tabular-nums", angka.janggal > 0 && "font-semibold text-amber-600 dark:text-amber-500")}>
        {angka.janggal}
      </TableCell>
      <TableCell className="text-right tabular-nums">{menurun ?? "—"}</TableCell>
      <TableCell className="hidden text-right tabular-nums 2xl:table-cell">
        {target ? (
          <>
            {target.persen}%
            <Sub>
              {formatIDR(target.capai)} / {formatIDR(target.target)}
            </Sub>
          </>
        ) : (
          "—"
        )}
      </TableCell>
    </TableRow>
  );
}
