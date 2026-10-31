"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, MessageSquareWarning, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { dinamis } from "@/lib/i18n/dinamis";
import { mintaKoreksiAction, tarikKlaimSendiriAction } from "@/app/actions/receivables";
import { tarikReturSendiriAction } from "@/app/actions/store-returns";

/**
 * Sales menarik laporannya sendiri — BKM sebelum keuangan memutuskan, nota
 * retur sebelum gudang menghitung. Alasan wajib, dan kantor diberi tahu:
 * dialognya mengatakan itu terus terang, supaya tidak ada yang mengira
 * penarikan menghapus jejaknya.
 *
 * Server memeriksa ulang semuanya; tombol ini hanya ditampilkan pada keadaan
 * yang biasanya masih boleh.
 *
 * `mode="koreksi"`: laporan yang SUDAH diproses kantor (BKM terverifikasi,
 * nota yang sudah dihitung gudang) tidak bisa ditarik — yang dikirim adalah
 * permintaan koreksi ke kantor, dengan dialog dan aturan alasan yang sama.
 */
export function TombolTarikLaporan({
  jenis,
  id,
  nomor,
  mode = "tarik",
}: {
  jenis: "bkm" | "retur";
  id: string;
  nomor: string;
  mode?: "tarik" | "koreksi";
}) {
  const t = useTranslations("pwaTarik");
  const td = dinamis(t);
  const router = useRouter();
  const [buka, setBuka] = useState(false);
  const [alasan, setAlasan] = useState("");
  const [sibuk, mulai] = useTransition();

  const koreksi = mode === "koreksi";
  // Kunci teks per mode: "koreksi_judul" dsb. untuk permintaan koreksi.
  const k = (kunci: string) => (koreksi ? `koreksi_${kunci}` : kunci);

  const kirim = () =>
    mulai(async () => {
      const hasil = koreksi
        ? await mintaKoreksiAction(jenis, id, alasan)
        : jenis === "bkm"
          ? await tarikKlaimSendiriAction(id, alasan)
          : await tarikReturSendiriAction(id, alasan);
      if (hasil.ok) {
        toast.success(td(k("berhasil"), { nomor }));
        setBuka(false);
        setAlasan("");
        router.refresh();
        return;
      }
      if (hasil.kode === "DIPAKAI_DI_BKM" && "docNo" in hasil) {
        toast.error(t("err.DIPAKAI_DI_BKM", { docNo: hasil.docNo.join(", ") }));
        return;
      }
      const kode = hasil.kode;
      toast.error(t.has(`err.${kode}`) ? td(`err.${kode}`) : t("err.GAGAL"));
      if (kode === "SUDAH_DIPUTUSKAN" || kode === "SUDAH_DIHITUNG" || kode === "SUDAH_DIBATALKAN") {
        setBuka(false);
        router.refresh();
      }
    });

  return (
    <>
      <Button type="button" variant="outline" className="w-full" onClick={() => setBuka(true)}>
        {koreksi ? <MessageSquareWarning className="h-4 w-4" aria-hidden /> : <Undo2 className="h-4 w-4" aria-hidden />}
        {td(k("tombol"))}
      </Button>
      <Dialog open={buka} onOpenChange={(o) => !sibuk && setBuka(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{td(k("judul"), { nomor })}</DialogTitle>
            <DialogDescription>{td(k(jenis === "bkm" ? "penjelasanBkm" : "penjelasanRetur"))}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`tarik-alasan-${id}`}>{t("alasan")}</Label>
            <Textarea
              id={`tarik-alasan-${id}`}
              value={alasan}
              onChange={(e) => setAlasan(e.target.value)}
              placeholder={t("alasanContoh")}
              disabled={sibuk}
              rows={3}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={() => setBuka(false)} disabled={sibuk}>
              {t("batal")}
            </Button>
            <Button
              type="button"
              variant={koreksi ? "default" : "destructive"}
              onClick={kirim}
              disabled={sibuk || alasan.trim() === ""}
            >
              {sibuk ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {td(k("konfirmasi"))}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
