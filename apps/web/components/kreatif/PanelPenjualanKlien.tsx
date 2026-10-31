"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Pencil, Plus, ShoppingBag, Trash2 } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TanggalInput } from "@/components/ui/tanggal-input";
import { Textarea } from "@/components/ui/textarea";
import { hapusPenjualanAction, simpanPenjualanAction } from "@/app/actions/kreatif-konten";
import { angkaTitik, rupiahTeks } from "@/lib/creative/angka-konten";
import { bacaAngka, bacaBilanganBulat } from "@/lib/creative/angka-masuk";
import { SUMBER_PENJUALAN, type TotalPenjualan } from "@/lib/creative/penjualan-aturan";
import type { BarisPenjualan } from "@/lib/creative/penjualan-queries";
import { hariIniWib, labelTanggal } from "@/lib/tanggal-isian";
import { useKabarKonten } from "./kabar-konten";

type Isian = { tanggal: string; orders: string; gmv: string; komisi: string; sumber: string; catatan: string };

const TANPA_SUMBER = "tanpa";

function awal(b: BarisPenjualan | null, hariIni: string): Isian {
  return {
    tanggal: b?.tanggal ?? hariIni,
    orders: b ? String(b.orders) : "",
    gmv: b ? String(b.gmv).replace(".", ",") : "",
    komisi: b ? String(b.komisi).replace(".", ",") : "",
    sumber: b?.sumber ?? TANPA_SUMBER,
    catatan: b?.catatan ?? "",
  };
}

/** Panel Penjualan: tabel penjualan afiliasi per kolaborasi, total, tambah/ubah/hapus. */
export function PanelPenjualanKlien({
  kolaborasiId,
  baris,
  total,
  bolehMengelola,
}: {
  kolaborasiId: string;
  baris: BarisPenjualan[];
  total: TotalPenjualan;
  bolehMengelola: boolean;
}) {
  const t = useTranslations("kreatifRuang.penjualan");
  const locale = useLocale();
  const router = useRouter();
  const kabar = useKabarKonten();
  const [hariIni] = useState(() => hariIniWib());
  const [dialog, setDialog] = useState<{ baris: BarisPenjualan | null } | null>(null);
  const [isi, setIsi] = useState<Isian>(() => awal(null, hariIni));
  const [hapus, setHapus] = useState<BarisPenjualan | null>(null);
  const [pending, start] = useTransition();

  const buka = (b: BarisPenjualan | null) => {
    setIsi(awal(b, hariIni));
    setDialog({ baris: b });
  };
  const ubah = <K extends keyof Isian>(k: K, v: Isian[K]) => setIsi((s) => ({ ...s, [k]: v }));

  const simpan = () => {
    const lama = dialog?.baris ?? null;
    const orders = isi.orders.trim() ? bacaBilanganBulat(isi.orders) : 0;
    const gmv = isi.gmv.trim() ? bacaAngka(isi.gmv) : 0;
    const komisi = isi.komisi.trim() ? bacaAngka(isi.komisi) : 0;
    if (orders === null || gmv === null || gmv < 0 || komisi === null || komisi < 0) {
      toast.error(t("tidakTerbaca"));
      return;
    }
    const sumber = isi.sumber === TANPA_SUMBER ? null : isi.sumber;
    const catatan = isi.catatan.trim() || null;
    const kirim: Parameters<typeof simpanPenjualanAction>[0] = { id: lama?.id ?? null, kolaborasiId };
    if (!lama || isi.tanggal !== lama.tanggal) kirim.date = isi.tanggal;
    if (!lama || orders !== lama.orders) kirim.orders = orders;
    if (!lama || gmv !== lama.gmv) kirim.gmv = gmv;
    if (!lama || komisi !== lama.komisi) kirim.commission = komisi;
    if (!lama || sumber !== lama.sumber) kirim.source = sumber;
    if (!lama || catatan !== lama.catatan) kirim.note = catatan;
    start(async () => {
      const r = await simpanPenjualanAction(kirim);
      if (r.ok) {
        kabar.sukses(lama ? "penjualan.okUbah" : "penjualan.okTambah");
        setDialog(null);
        router.refresh();
      } else {
        kabar.gagal(r.kode);
      }
    });
  };

  const hapusSekarang = () => {
    const b = hapus;
    if (!b) return;
    start(async () => {
      const r = await hapusPenjualanAction(b.id);
      if (r.ok) {
        kabar.sukses("penjualan.okHapus");
        setHapus(null);
        router.refresh();
      } else {
        kabar.gagal(r.kode);
      }
    });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <ShoppingBag className="h-5 w-5" />
          {t("judul")}
        </CardTitle>
        {bolehMengelola ? (
          <Button size="sm" onClick={() => buka(null)}>
            <Plus className="h-4 w-4" />
            {t("tambah")}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className={baris.length === 0 ? "" : "px-0"}>
        {baris.length === 0 ? (
          <EmptyState icon={ShoppingBag} title={t("kosong")} description={t("kosongIsi")} className="py-6" />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">{t("kolom.tanggal")}</TableHead>
                  <TableHead className="text-right">{t("kolom.order")}</TableHead>
                  <TableHead className="text-right">{t("kolom.gmv")}</TableHead>
                  <TableHead className="text-right">{t("kolom.komisi")}</TableHead>
                  <TableHead>{t("kolom.sumber")}</TableHead>
                  <TableHead>{t("kolom.catatan")}</TableHead>
                  {bolehMengelola ? (
                    <TableHead className="pr-6 text-right">
                      <span className="sr-only">{t("kolom.aksi")}</span>
                    </TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {baris.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="pl-6 tabular-nums">{labelTanggal(b.tanggal, locale)}</TableCell>
                    <TableCell className="text-right tabular-nums">{angkaTitik(b.orders)}</TableCell>
                    <TableCell className="text-right tabular-nums">{rupiahTeks(b.gmv)}</TableCell>
                    <TableCell className="text-right tabular-nums">{rupiahTeks(b.komisi)}</TableCell>
                    <TableCell className="text-sm">{b.sumber ?? "—"}</TableCell>
                    <TableCell className="max-w-56 truncate text-sm text-muted-foreground" title={b.catatan ?? undefined}>
                      {b.catatan ?? "—"}
                    </TableCell>
                    {bolehMengelola ? (
                      <TableCell className="pr-6">
                        <div className="flex justify-end gap-0.5">
                          <Button variant="ghost" size="icon-sm" aria-label={t("ubah")} title={t("ubah")} onClick={() => buka(b)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon-sm" aria-label={t("hapus")} title={t("hapus")} className="text-destructive" onClick={() => setHapus(b)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="pl-6 font-medium">{t("total", { n: baris.length })}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{angkaTitik(total.orders)}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{rupiahTeks(total.gmv)}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{rupiahTeks(total.komisi)}</TableCell>
                  <TableCell colSpan={bolehMengelola ? 3 : 2} />
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{dialog?.baris ? t("dialogUbah") : t("dialogTambah")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="jual-tanggal">{t("kolom.tanggal")}</Label>
                <TanggalInput id="jual-tanggal" value={isi.tanggal} max={hariIni} required onChange={(e) => ubah("tanggal", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("kolom.sumber")}</Label>
                <Select value={isi.sumber} onValueChange={(v) => ubah("sumber", v)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={TANPA_SUMBER}>{t("tanpaSumber")}</SelectItem>
                    {SUMBER_PENJUALAN.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s === "Lainnya" ? t("sumberLainnya") : s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="jual-order">{t("kolom.order")}</Label>
                <Input id="jual-order" inputMode="numeric" className="text-right tabular-nums" value={isi.orders} placeholder="0" onChange={(e) => ubah("orders", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="jual-gmv">{t("kolom.gmv")}</Label>
                <Input id="jual-gmv" inputMode="decimal" className="text-right tabular-nums" value={isi.gmv} placeholder="0" onChange={(e) => ubah("gmv", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="jual-komisi">{t("kolom.komisi")}</Label>
                <Input id="jual-komisi" inputMode="decimal" className="text-right tabular-nums" value={isi.komisi} placeholder="0" onChange={(e) => ubah("komisi", e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="jual-catatan">{t("kolom.catatan")}</Label>
              <Textarea id="jual-catatan" rows={2} maxLength={1000} value={isi.catatan} onChange={(e) => ubah("catatan", e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)} disabled={pending}>
              {t("batal")}
            </Button>
            <Button onClick={simpan} disabled={pending || !isi.tanggal}>
              {t("simpan")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={hapus !== null} onOpenChange={(o) => !o && setHapus(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("hapusJudul")}</AlertDialogTitle>
            <AlertDialogDescription>
              {hapus ? t("hapusIsi", { tanggal: labelTanggal(hapus.tanggal, locale), gmv: rupiahTeks(hapus.gmv) }) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{t("batal")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={pending} onClick={hapusSekarang}>
              {t("hapus")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
