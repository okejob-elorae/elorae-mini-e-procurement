"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Calculator, Eye, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/ui/status-pill";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { RentangTanggalInput } from "@/components/ui/rentang-tanggal-input";
import { formatRupiah } from "@/lib/format/rupiah";
import { getStatusMeta } from "@/lib/ui/status-map";
import { updateWOHppAdjustments } from "@/app/actions/production";
import type { HPPBreakdown } from "@/app/actions/hpp";
import { formatPersenSatuDesimal, formatRupiahSen, type HasilRekomendasi } from "@/lib/items/rekomendasi-harga";
import { formatDisplayDate } from "@/lib/date-only";
import {
  alamatSaringanHpp,
  formatQty,
  hppSatuan,
  STATUS_SPK,
  type SaringanHpp,
  type SaringanStatusHpp,
} from "./hpp-tampil";

/** Satu WO + SATU rekomendasi harga barang jadinya (jawaban pemilik P4a, 2026-11-02). */
export type BarisHpp = HPPBreakdown & { status: string; rekomendasi: HasilRekomendasi };

type Pilihan = { value: string; label: string };

const fmtUang = (n: number | null | undefined) => (n != null ? formatRupiah(n) : "—");

/**
 * HPP per perintah kerja. Satu angka HPP/pcs untuk satu WO — biaya tercatat — di tabel maupun
 * rincian; angka "bila semua biaya termasuk PPN" hanya di rincian dan selalu berlabel
 * (`hppSatuan`). Isian markup per WO dihapus (P4a): kolom "Rekomendasi harga barang" menampilkan
 * rekomendasi barang jadinya — markup/margin dan bantalan margin dari pengaturan barang, dari HPP
 * terbaru barang itu — sama dengan formulir barang. Biaya tambahan WO tetap (biaya produksi).
 */
export function HppPageClient({
  rows,
  saringan,
  pilihanBarang,
  pilihanPemasok,
  bolehAtur,
}: {
  rows: BarisHpp[];
  saringan: SaringanHpp;
  pilihanBarang: Pilihan[];
  pilihanPemasok: Pilihan[];
  bolehAtur: boolean;
}) {
  const t = useTranslations("hpp");
  const tStatus = useTranslations("statuses");
  const router = useRouter();
  const pathname = usePathname();
  const [memuat, mulai] = useTransition();

  const [detailId, setDetailId] = useState<string | null>(null);
  const detailRow = rows.find((r) => r.woId === detailId) ?? null;
  const [editAdditional, setEditAdditional] = useState("");
  const [savingAdjustments, setSavingAdjustments] = useState(false);

  /** Saringan ditulis ke alamat; halaman server memuat ulang datanya. */
  const ubahSaringan = (ubah: Partial<SaringanHpp>) => {
    const baru = { ...saringan, ...ubah };
    mulai(() => router.replace(`${pathname}${alamatSaringanHpp(baru)}`, { scroll: false }));
  };

  const labelStatus = (status: string) => tStatus(getStatusMeta("workOrder", status).labelKey as never);

  const openDetail = (row: BarisHpp) => {
    setDetailId(row.woId);
    setEditAdditional(row.additionalCost != null ? String(row.additionalCost) : "");
  };

  /** "Rp 152.000 · markup 50,0% (= margin 33,3%) · HPP terbaru RCPT/…", atau yang kurang. */
  const tampilRekomendasi = (r: HasilRekomendasi) => {
    if (!r.ada) {
      return { harga: null, keterangan: t("rekomendasiBarangBelum", { kurang: r.kurang.length > 1 ? "KEDUANYA" : (r.kurang[0] ?? "HPP") }) };
    }
    return {
      harga: formatRupiahSen(r.harga),
      keterangan: t("rekomendasiBarangDari", {
        markup: r.markup != null ? formatPersenSatuDesimal(r.markup) : "—",
        margin: formatPersenSatuDesimal(r.margin),
        dokumen: r.dokumen,
        tanggal: formatDisplayDate(r.tanggal),
      }),
    };
  };

  const handleSaveAdjustments = async () => {
    if (!detailRow || !bolehAtur) return;
    const additional = editAdditional === "" ? undefined : parseFloat(editAdditional);
    if (additional !== undefined && (Number.isNaN(additional) || additional < 0)) {
      toast.error(t("additionalCostInvalid"));
      return;
    }
    setSavingAdjustments(true);
    try {
      await updateWOHppAdjustments(detailRow.woId, { hppAdditionalCost: additional });
      toast.success(t("adjustmentsSaved"));
      // Baris (dan rincian yang terbuka) ikut diperbarui dari server.
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("saveFailed"));
    } finally {
      setSavingAdjustments(false);
    }
  };

  const detailHpp = detailRow ? hppSatuan(detailRow) : null;

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} meta={t("jumlahWo", { count: rows.length })} />

      {/* Saringan — langsung berlaku, tersimpan di alamat. */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-2">
          <Label>{t("finishedGood")}</Label>
          <SearchableCombobox
            options={[{ value: "", label: t("semuaBarang") }, ...pilihanBarang]}
            value={saringan.barang}
            onValueChange={(v) => ubahSaringan({ barang: v })}
            placeholder={t("semuaBarang")}
            triggerClassName="w-[240px]"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="hpp-rentang">{t("rentangTanggal")}</Label>
          <RentangTanggalInput
            id="hpp-rentang"
            dari={saringan.dari}
            sampai={saringan.sampai}
            onChange={({ dari, sampai }) => ubahSaringan({ dari, sampai })}
            className="min-w-[220px]"
          />
        </div>
        <div className="space-y-2">
          <Label>{t("vendor")}</Label>
          <SearchableCombobox
            options={[{ value: "", label: t("semuaPemasok") }, ...pilihanPemasok]}
            value={saringan.vendor}
            onValueChange={(v) => ubahSaringan({ vendor: v })}
            placeholder={t("semuaPemasok")}
            triggerClassName="w-[220px]"
          />
        </div>
        <div className="space-y-2">
          <Label>{t("colStatus")}</Label>
          <Select value={saringan.status} onValueChange={(v) => ubahSaringan({ status: v as SaringanStatusHpp })}>
            <SelectTrigger className="w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="AKTIF">{t("statusAktif")}</SelectItem>
              <SelectItem value="SEMUA">{t("statusSemua")}</SelectItem>
              {STATUS_SPK.map((s) => (
                <SelectItem key={s} value={s}>
                  {labelStatus(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {memuat ? <Loader2 aria-hidden className="mb-2.5 h-4 w-4 animate-spin text-muted-foreground" /> : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator aria-hidden className="h-5 w-5" />
            {t("cardTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyState icon={Calculator} title={t("noRows")} />
          ) : (
            <div className="space-y-2">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("woDocNumber")}</TableHead>
                      <TableHead>{t("colStatus")}</TableHead>
                      <TableHead>{t("articleFg")}</TableHead>
                      <TableHead className="text-right whitespace-normal">{t("actualQty")}</TableHead>
                      <TableHead className="hidden text-right whitespace-normal 2xl:table-cell">{t("fabricCostPcs")}</TableHead>
                      <TableHead className="hidden text-right whitespace-normal 2xl:table-cell">{t("accessoriesCostPcs")}</TableHead>
                      <TableHead className="hidden text-right whitespace-normal 2xl:table-cell">{t("serviceCostPcs")}</TableHead>
                      <TableHead className="text-right whitespace-normal 2xl:hidden">{t("costComponentsPcs")}</TableHead>
                      <TableHead className="text-right whitespace-normal">{t("hppPcs")}</TableHead>
                      <TableHead className="hidden 2xl:table-cell">{t("ppnStatus")}</TableHead>
                      {/* Satu rekomendasi barang jadinya, bukan harga jual (harga jual diketik di halaman barang). */}
                      <TableHead className="text-right whitespace-normal">{t("rekomendasiBarang")}</TableHead>
                      <TableHead className="sticky right-0 bg-card">
                        <span className="sr-only">{t("detail")}</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.woId}>
                        <TableCell className="font-medium">{row.woDocNumber}</TableCell>
                        <TableCell>
                          <StatusPill tone={getStatusMeta("workOrder", row.status).tone}>{labelStatus(row.status)}</StatusPill>
                        </TableCell>
                        <TableCell className="whitespace-normal min-w-[160px] max-w-[260px]">
                          {row.finishedGoodSku} — {row.finishedGoodName}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatQty(row.actualQty ?? row.plannedQty)}</TableCell>
                        <TableCell className="hidden text-right tabular-nums 2xl:table-cell">{fmtUang(row.fabricCostPerPcs)}</TableCell>
                        <TableCell className="hidden text-right tabular-nums 2xl:table-cell">{fmtUang(row.accessoriesCostPerPcs)}</TableCell>
                        <TableCell className="hidden text-right tabular-nums 2xl:table-cell">{fmtUang(row.serviceCostPerPcs)}</TableCell>
                        {/* Di bawah 2xl tiga komponen ditumpuk dalam satu sel. */}
                        <TableCell className="text-right text-xs leading-5 tabular-nums 2xl:hidden">
                          <div>
                            <span className="text-muted-foreground">{t("componentFabric")}</span> {fmtUang(row.fabricCostPerPcs)}
                          </div>
                          <div>
                            <span className="text-muted-foreground">{t("componentAccessories")}</span> {fmtUang(row.accessoriesCostPerPcs)}
                          </div>
                          <div>
                            <span className="text-muted-foreground">{t("componentService")}</span> {fmtUang(row.serviceCostPerPcs)}
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">{fmtUang(hppSatuan(row).tercatat)}</TableCell>
                        <TableCell className="hidden 2xl:table-cell">
                          <Badge variant={row.hasMixedPPN ? "secondary" : "outline"}>
                            {row.hasMixedPPN ? t("ppnMixed") : t("ppnOk")}
                          </Badge>
                        </TableCell>
                        <TableCell className="min-w-[180px] whitespace-normal text-right tabular-nums">
                          {(() => {
                            const r = tampilRekomendasi(row.rekomendasi);
                            return (
                              <>
                                <div className="font-medium">{r.harga ?? "—"}</div>
                                <div className="text-xs text-muted-foreground">{r.keterangan}</div>
                              </>
                            );
                          })()}
                        </TableCell>
                        <TableCell className="sticky right-0 bg-card">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openDetail(row)}
                            className="border-muted-foreground/25 hover:border-muted-foreground/50"
                            aria-label={`${t("detail")} — ${row.woDocNumber}`}
                          >
                            <Eye className="h-4 w-4" />
                            <span className="hidden 2xl:inline">{t("detail")}</span>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!detailRow} onOpenChange={(open) => !open && setDetailId(null)}>
        <DialogContent className="max-w-2xl lg:max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {t("detailTitle")} — {detailRow?.woDocNumber}
            </DialogTitle>
            <DialogDescription className="sr-only">{t("detailDesc")}</DialogDescription>
          </DialogHeader>
          {detailRow && detailHpp && (
            <div className="space-y-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("category")}</TableHead>
                    <TableHead>{t("itemName")}</TableHead>
                    <TableHead className="text-right">{t("unitCost")}</TableHead>
                    <TableHead className="text-right">{t("qtyPerPcs")}</TableHead>
                    <TableHead className="text-right">{t("costPerPcs")}</TableHead>
                    <TableHead className="text-right">{t("finalPrice")}</TableHead>
                    <TableHead>{t("ppnIncluded")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detailRow.lines.map((line, i) => (
                    <TableRow key={i}>
                      <TableCell>
                        {t.has(`categoryLabel.${line.category}`) ? t(`categoryLabel.${line.category}`) : line.category}
                      </TableCell>
                      <TableCell className="whitespace-normal min-w-[160px]">
                        <div>{line.itemName}</div>
                        {/* Selisih harga invoice yang DITERIMA pemilik (P49): angka yang berubah dan sebabnya. */}
                        {line.koreksi ? (
                          <div className="text-xs text-muted-foreground">
                            {t("dikoreksiDari", { dari: formatRupiah(line.koreksi.dari), nomor: line.koreksi.invoiceNo.join(", ") })}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmtUang(line.unitCost)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatQty(line.qtyPerPcs)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtUang(line.costPerPcs)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtUang(line.nettCostPerPcs ?? line.costPerPcs)}</TableCell>
                      <TableCell>{line.ppnIncluded ? t("yes") : t("no")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {/* Angka yang sama dengan kolom HPP/pcs di tabel; termasuk PPN disebut terpisah. */}
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t pt-2">
                <div className="font-medium tabular-nums">
                  {t("subtotalPerPcs")} {fmtUang(detailHpp.tercatat)}
                </div>
                <div className="text-sm text-muted-foreground tabular-nums">
                  {t("subtotalTermasukPpn")} {fmtUang(detailHpp.termasukPpn)}
                </div>
                {detailRow.hasMixedPPN && <Badge variant="secondary">{t("ppnMixed")}</Badge>}
              </div>
              {bolehAtur && (
                <div className="grid gap-4 sm:grid-cols-2 pt-4 border-t">
                  <div className="space-y-2">
                    <Label htmlFor="hpp-tambahan">{t("additionalCostEdit")}</Label>
                    <Input
                      id="hpp-tambahan"
                      type="number"
                      min={0}
                      step={1}
                      value={editAdditional}
                      onChange={(e) => setEditAdditional(e.target.value)}
                      placeholder="0"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Button onClick={handleSaveAdjustments} disabled={savingAdjustments}>
                      {savingAdjustments ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                      {t("saveAdjustments")}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
