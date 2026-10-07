"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Loader2, PackageOpen, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDisplayDateTime } from "@/lib/date-only";
import { formatRupiah } from "@/lib/format/rupiah";
import { newLocalId } from "@/lib/pwa/id-lokal";
import { BATAS_CATATAN_KEMBALI } from "@/lib/production/kembali-bahan";
import { getBahanWo, kembalikanBahan } from "@/app/actions/production";
import type { RingkasanBahanWo } from "@/lib/production/kembali-bahan-queries";

const angka = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("id-ID", { maximumFractionDigits: 2 });

/**
 * Tabel bahan WO dari DOKUMEN: kebutuhan per pcs dan total (rencana), yang
 * sudah dikeluarkan, yang sudah kembali ke gudang, dan yang masih di CMT —
 * plus "Kembalikan bahan" (sisa potong, atau supaya WO bisa dibatalkan).
 */
export function KartuBahanWo({
  woId,
  bolehKelola,
  bolehKembali,
  alasanTidakBoleh,
  versi,
  onBerubah,
}: {
  woId: string;
  bolehKelola: boolean;
  /** WO belum batal. */
  bolehKembali: boolean;
  /** Teks alasan bila tombol mati karena status WO. */
  alasanTidakBoleh?: string;
  /** Naikkan untuk memuat ulang (sesudah bahan keluar dsb.). */
  versi: number;
  onBerubah: () => void;
}) {
  const t = useTranslations("workOrders.bahan");
  const tTolak = useTranslations("productionErrors");
  const locale = useLocale();
  const [data, setData] = useState<RingkasanBahanWo | null>(null);
  const [gagalMuat, setGagalMuat] = useState(false);
  const [buka, setBuka] = useState(false);
  const [isian, setIsian] = useState<Record<string, string>>({});
  const [catatan, setCatatan] = useState("");
  const [kunci, setKunci] = useState(() => newLocalId());
  const [sibuk, mulai] = useTransition();

  const muat = useCallback(() => {
    getBahanWo(woId)
      .then((r) => {
        setData(r);
        setGagalMuat(false);
      })
      .catch(() => setGagalMuat(true));
  }, [woId]);

  useEffect(() => {
    muat();
  }, [muat, versi]);

  const barisDiCmt = (data?.baris ?? []).filter((b) => b.diCmt > 0.005);
  const terisi = barisDiCmt.some((b) => Number((isian[b.itemId] ?? "").replace(",", ".")) > 0);

  const ubahIsian = (itemId: string, nilai: string) => {
    setIsian((s) => ({ ...s, [itemId]: nilai }));
    // Isian lain = permintaan lain: kunci baru.
    setKunci(newLocalId());
  };

  const namaBarang = (itemId?: string) => data?.baris.find((b) => b.itemId === itemId)?.nama ?? "";

  const kirim = () =>
    mulai(async () => {
      try {
        const hasil = await kembalikanBahan({
          woId,
          kunci,
          catatan,
          baris: barisDiCmt.map((b) => ({ itemId: b.itemId, qty: isian[b.itemId] ?? "0" })),
        });
        if (!hasil.ok) {
          if (hasil.code === "MELEBIHI_SISA") {
            toast.error(t("tolakMelebihi", { barang: namaBarang(hasil.itemId), sisa: angka(hasil.sisa) }));
          } else if (hasil.code === "QTY_TIDAK_VALID" || hasil.code === "BUKAN_BAHAN_WO" || hasil.code === "BARANG_GANDA") {
            toast.error(t(`tolak.${hasil.code}`, { barang: namaBarang(hasil.itemId) }));
          } else if (hasil.code === "TANPA_BARIS" || hasil.code === "CATATAN_TERLALU_PANJANG") {
            toast.error(t(`tolak.${hasil.code}`));
          } else {
            toast.error(tTolak.has(hasil.code) ? tTolak(hasil.code) : t("gagal"));
          }
          muat();
          return;
        }
        toast.success(t(hasil.dibatasi ? "berhasilDibatasi" : "berhasil", { nilai: formatRupiah(hasil.totalNilai) }));
        setBuka(false);
        setIsian({});
        setCatatan("");
        setKunci(newLocalId());
        muat();
        onBerubah();
      } catch {
        toast.error(t("gagal"));
      }
    });

  const tombolMati = !bolehKelola ? t("tanpaIzin") : !bolehKembali ? (alasanTidakBoleh ?? "") : barisDiCmt.length === 0 ? t("tidakAdaDiCmt") : null;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <PackageOpen className="h-5 w-5" />
          {t("judul")}
        </CardTitle>
        <div className="flex flex-col items-end gap-1">
          <Button variant="outline" size="sm" disabled={tombolMati != null} onClick={() => setBuka(true)}>
            <Undo2 className="mr-2 h-4 w-4" />
            {t("tombol")}
          </Button>
          {tombolMati ? <p className="text-xs text-muted-foreground">{tombolMati}</p> : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {gagalMuat ? (
          <p className="text-sm text-destructive">{t("gagalMuat")}</p>
        ) : !data ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : data.baris.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("kosong")}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("kolBahan")}</TableHead>
                  <TableHead className="text-right">{t("kolPerPcs")}</TableHead>
                  <TableHead className="text-right">{t("kolRencana")}</TableHead>
                  <TableHead className="text-right">{t("kolKeluar")}</TableHead>
                  <TableHead className="text-right">{t("kolKembali")}</TableHead>
                  <TableHead className="text-right">{t("kolDiCmt")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.baris.map((b) => (
                  <TableRow key={b.itemId}>
                    <TableCell className="whitespace-normal">
                      <p className="font-medium">{b.nama}</p>
                      {b.sku ? <p className="text-xs text-muted-foreground">{b.sku}</p> : null}
                    </TableCell>
                    <TableCell className="text-right">
                      {b.perPcs == null ? "—" : `${angka(b.perPcs)} ${b.satuan}`}
                      {b.susutPersen ? (
                        <span className="block text-xs text-muted-foreground">{t("susut", { persen: angka(b.susutPersen) })}</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right">{b.rencana == null ? "—" : `${angka(b.rencana)} ${b.satuan}`}</TableCell>
                    <TableCell className="text-right">{angka(b.keluar)} {b.satuan}</TableCell>
                    <TableCell className="text-right">{angka(b.kembali)} {b.satuan}</TableCell>
                    <TableCell className="text-right font-medium">{angka(b.diCmt)} {b.satuan}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {data && data.riwayat.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">{t("riwayatJudul")}</p>
            <ul className="space-y-1 text-sm">
              {data.riwayat.map((r) => (
                <li key={r.id} className="flex flex-wrap justify-between gap-x-4 gap-y-0.5 border-b pb-1 last:border-0">
                  <span>
                    {r.docNumber} · {r.nama} · {angka(r.qty)} {r.satuan}
                    {r.catatan ? <span className="text-muted-foreground"> · {r.catatan}</span> : null}
                  </span>
                  <span className="text-muted-foreground">
                    {formatRupiah(r.nilai)} · {formatDisplayDateTime(r.createdAt, locale)}
                    {r.oleh ? ` · ${r.oleh}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>

      <Dialog open={buka} onOpenChange={(v) => !sibuk && setBuka(v)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("dialogJudul")}</DialogTitle>
            <DialogDescription>{t("dialogDeskripsi")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {barisDiCmt.map((b) => (
              <div key={b.itemId} className="grid grid-cols-[1fr_8rem] items-center gap-3">
                <Label htmlFor={`kembali-${b.itemId}`} className="block font-normal">
                  <span className="font-medium">{b.nama}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t("maksimal", { qty: angka(b.diCmt), satuan: b.satuan })}
                  </span>
                </Label>
                <Input
                  id={`kembali-${b.itemId}`}
                  inputMode="decimal"
                  value={isian[b.itemId] ?? ""}
                  placeholder="0"
                  onChange={(e) => ubahIsian(b.itemId, e.target.value)}
                />
              </div>
            ))}
            <div className="space-y-1">
              <Label htmlFor="catatan-kembali">{t("catatanLabel")}</Label>
              <Textarea
                id="catatan-kembali"
                rows={2}
                maxLength={BATAS_CATATAN_KEMBALI}
                value={catatan}
                placeholder={t("catatanPlaceholder")}
                onChange={(e) => {
                  setCatatan(e.target.value);
                  setKunci(newLocalId());
                }}
              />
            </div>
          </div>
          <DialogFooter className="flex-col items-stretch gap-1 sm:flex-row sm:items-center sm:justify-end">
            {!terisi ? <p className="text-xs text-muted-foreground sm:mr-auto">{t("isiDulu")}</p> : null}
            <Button variant="outline" disabled={sibuk} onClick={() => setBuka(false)}>
              {t("batal")}
            </Button>
            <Button disabled={!terisi || sibuk} onClick={kirim}>
              {sibuk ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t("simpan")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
