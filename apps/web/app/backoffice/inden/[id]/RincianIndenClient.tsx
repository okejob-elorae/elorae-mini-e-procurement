"use client";

import { Fragment, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeft, CalendarClock, Loader2, PackageCheck, Pencil, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatDisplayDate, formatDisplayDateTime } from "@/lib/date-only";
import { formatRupiah } from "@/lib/format/rupiah";
import { rentangKirim, rentangTanggal } from "@/lib/field-sales/inden";
import type { RincianJendelaInden } from "@/lib/field-sales/inden-queries";
import { rilisJendelaIndenAction } from "@/app/actions/inden";
import { cn } from "@/lib/utils";
import { LencanaKeadaan } from "../LencanaKeadaan";
import { FormJendelaInden, type NilaiAwalJendela, type PilihanBarang } from "../FormJendelaInden";

const NADA_STATUS: Record<RincianJendelaInden["pesanan"][number]["status"], "secondary" | "default" | "destructive"> = {
  PENDING_APPROVAL: "secondary",
  APPROVED: "default",
  REJECTED: "destructive",
};

export function RincianIndenClient({
  rincian,
  canManage,
  bisaUbah,
  pilihan,
  awal,
  dipesanItemIds,
}: {
  rincian: RincianJendelaInden;
  canManage: boolean;
  bisaUbah: boolean;
  pilihan: PilihanBarang[];
  awal: NilaiAwalJendela;
  dipesanItemIds: string[];
}) {
  const t = useTranslations("inden");
  const tFso = useTranslations("fieldSalesOrders");
  const locale = useLocale();
  const router = useRouter();
  const [ubah, setUbah] = useState(false);
  const [konfirmasi, setKonfirmasi] = useState(false);
  const [pending, startTransition] = useTransition();

  const kirim = rentangKirim(rincian.shipFrom, rincian.shipTo, locale);
  const menunggu = rincian.pesanan.filter((p) => p.status === "PENDING_APPROVAL").length;
  const disetujui = rincian.pesanan.filter((p) => p.status === "APPROVED").length;
  const dirilis = rincian.keadaan === "DIRILIS";

  function rilis() {
    startTransition(async () => {
      try {
        const r = await rilisJendelaIndenAction(rincian.id);
        setKonfirmasi(false);
        if (r.ok) {
          if (r.sudahDirilis) toast.info(t("rilis.sudah"));
          else toast.success(t("rilis.berhasil", { pesanan: r.pesanan, baris: r.baris }));
          if (r.oversell.length > 0) toast.warning(t("rilis.kurangStok", { n: r.oversell.length }));
          router.refresh();
          return;
        }
        if (r.kode === "BARANG_BELUM_TERCATAT") {
          // Nama baris pesanan sudah membawa label varian (`buildOrderLines`).
          const daftar = r.baris.map((b) => b.productName).join(", ");
          toast.error(t("rilis.belumTercatat", { barang: daftar }), { duration: 12000 });
          return;
        }
        toast.error(t(`rilis.tolak.${r.kode}`));
      } catch {
        toast.error(t("rilis.gagal"));
      }
    });
  }

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/backoffice/inden">
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t("kembali")}
        </Link>
      </Button>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{rincian.name}</h1>
            <LencanaKeadaan keadaan={rincian.keadaan} />
          </div>
          <p className="text-sm text-muted-foreground">
            {t("periode", { rentang: rentangTanggal(rincian.opensAt, rincian.closesAt, locale) })}
            {kirim ? ` · ${t(`kirim.${kirim.jenis}`, { teks: kirim.teks })}` : ""}
          </p>
          {rincian.note && <p className="max-w-2xl whitespace-pre-line text-sm">{rincian.note}</p>}
        </div>
        {bisaUbah && !ubah && (
          <Button variant="outline" onClick={() => setUbah(true)}>
            <Pencil className="mr-2 h-4 w-4" />
            {t("ubah")}
          </Button>
        )}
      </div>

      {ubah && bisaUbah ? (
        <FormJendelaInden pilihan={pilihan} awal={awal} dipesanItemIds={dipesanItemIds} onSelesai={() => setUbah(false)} />
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Ringkas judul={t("ringkas.dipesan")} nilai={rincian.total.dipesan.toLocaleString("id-ID")} bawah={rincian.total.rencana === null ? t("ringkas.tanpaRencana") : t("ringkas.dariRencana", { rencana: rincian.total.rencana.toLocaleString("id-ID") })} />
        <Ringkas judul={t("ringkas.pesanan")} nilai={String(menunggu + disetujui)} bawah={t("ringkas.pesananRinci", { menunggu, disetujui })} />
        <Ringkas
          judul={t("ringkas.stok")}
          nilai={dirilis ? t("ringkas.sudahDirilis") : t("ringkas.belumDirilis")}
          bawah={dirilis && rincian.releasedAt ? formatDisplayDateTime(rincian.releasedAt, locale) : t("ringkas.belumDirilisIsi")}
        />
      </div>

      {canManage && !dirilis && (
        <Card className="border-amber-500/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PackageCheck className="h-5 w-5" aria-hidden />
              {t("rilis.judul")}
            </CardTitle>
            <CardDescription>{t("rilis.isi")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => setKonfirmasi(true)} disabled={pending}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("rilis.tombol")}
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5" aria-hidden />
            {t("barangJudul")}
          </CardTitle>
          <CardDescription>{t("barangIsi")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("kolom.sku")}</TableHead>
                  <TableHead>{t("kolom.nama")}</TableHead>
                  <TableHead className="text-right">{t("kolom.rencana")}</TableHead>
                  <TableHead className="text-right">{t("kolom.menunggu")}</TableHead>
                  <TableHead className="text-right">{t("kolom.disetujui")}</TableHead>
                  <TableHead className="text-right">{t("kolom.dipesan")}</TableHead>
                  <TableHead className="text-right">{t("kolom.sisa")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rincian.barang.map((b) => (
                  <Fragment key={b.itemId}>
                    <TableRow>
                      <TableCell className="font-mono text-sm">{b.sku}</TableCell>
                      <TableCell className="min-w-[10rem] whitespace-normal">
                        {b.nameId}
                        {!b.isActive && (
                          <Badge variant="outline" className="ml-2 align-middle text-muted-foreground">
                            {t("barangNonaktif")}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{b.rencana === null ? "—" : b.rencana}</TableCell>
                      <TableCell className="text-right tabular-nums">{b.menunggu}</TableCell>
                      <TableCell className="text-right tabular-nums">{b.disetujui}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{b.dipesan}</TableCell>
                      <TableCell
                        className={cn("text-right tabular-nums", b.sisa !== null && b.sisa < 0 && "font-medium text-amber-700 dark:text-amber-400")}
                      >
                        {b.sisa === null ? "—" : b.sisa < 0 ? t("lebih", { n: -b.sisa }) : b.sisa}
                      </TableCell>
                    </TableRow>
                    {/* Per varian: produksi butuh ukuran/warna, bukan hanya total per barang. */}
                    {b.perVarianBerlabel.some((v) => v.variantSku !== "") &&
                      b.perVarianBerlabel.map((v) => (
                        <TableRow key={`${b.itemId}-${v.variantSku}`} className="border-0 bg-muted/30 hover:bg-muted/30">
                          <TableCell />
                          <TableCell className="whitespace-normal py-1.5 pl-6 text-sm text-muted-foreground">
                            {v.label ?? (v.variantSku || t("tanpaVarian"))}
                            {v.label && <span className="ml-1 font-mono text-xs">({v.variantSku})</span>}
                          </TableCell>
                          <TableCell />
                          <TableCell className="py-1.5 text-right text-sm tabular-nums">{v.menunggu}</TableCell>
                          <TableCell className="py-1.5 text-right text-sm tabular-nums">{v.disetujui}</TableCell>
                          <TableCell className="py-1.5 text-right text-sm tabular-nums">{v.dipesan}</TableCell>
                          <TableCell />
                        </TableRow>
                      ))}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShoppingBag className="h-5 w-5" aria-hidden />
            {t("pesananJudul")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {rincian.pesanan.length === 0 ? (
            <EmptyState icon={ShoppingBag} title={t("pesananKosongJudul")} description={t("pesananKosongIsi")} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tFso("colOrderNo")}</TableHead>
                    <TableHead>{tFso("colStore")}</TableHead>
                    <TableHead className="hidden 2xl:table-cell">{tFso("colSalesman")}</TableHead>
                    <TableHead className="text-right">{t("kolom.pcs")}</TableHead>
                    <TableHead className="text-right">{tFso("colTotal")}</TableHead>
                    <TableHead>{tFso("colCreated")}</TableHead>
                    <TableHead>{tFso("colStatus")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rincian.pesanan.map((p) => (
                    <TableRow
                      key={p.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => router.push(`/backoffice/field-sales-orders/${p.id}`)}
                    >
                      <TableCell className="font-mono text-sm">
                        <Link href={`/backoffice/field-sales-orders/${p.id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                          {p.orderNo}
                        </Link>
                      </TableCell>
                      <TableCell className="min-w-[9rem] max-w-[14rem] whitespace-normal">{p.storeName}</TableCell>
                      <TableCell className="hidden 2xl:table-cell">{p.salesmanName}</TableCell>
                      <TableCell className="text-right tabular-nums">{p.pcs}</TableCell>
                      <TableCell className="text-right">{formatRupiah(p.total)}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatDisplayDate(p.createdAt, locale)}</TableCell>
                      <TableCell>
                        <Badge variant={NADA_STATUS[p.status]}>
                          {p.status === "PENDING_APPROVAL"
                            ? tFso("statusPending")
                            : p.status === "APPROVED"
                              ? tFso("statusApproved")
                              : tFso("statusRejected")}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        {t("dibuatOleh", { nama: rincian.createdByName ?? "—", tanggal: formatDisplayDateTime(rincian.createdAt, locale) })}
      </p>

      <AlertDialog open={konfirmasi} onOpenChange={(o) => !pending && setKonfirmasi(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("rilis.konfirmasiJudul", { nama: rincian.name })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("rilis.konfirmasiIsi", { disetujui, menunggu })}
              {rincian.keadaan === "BUKA" ? ` ${t("rilis.konfirmasiMasihBuka")}` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{t("batal")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                rilis();
              }}
            >
              {pending ? t("rilis.memproses") : t("rilis.tombol")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Ringkas({ judul, nilai, bawah }: { judul: string; nilai: string; bawah: string }) {
  return (
    <Card className="gap-1 p-4">
      <p className="text-xs text-muted-foreground">{judul}</p>
      <p className="text-xl font-semibold tabular-nums">{nilai}</p>
      <p className="text-xs text-muted-foreground">{bawah}</p>
    </Card>
  );
}
