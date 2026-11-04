"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CircleCheck, CircleX, Loader2, PackageCheck, XCircle } from "lucide-react";
import {
  batalkanTukarKantorAction,
  selesaikanTukarAction,
  setujuiTukarAction,
  tolakTukarAction,
  type HasilKeputusanTukarAksi,
} from "@/app/actions/tukar-barang";
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { dinamis, type TerjemahDinamis } from "@/lib/i18n/dinamis";
import { formatIDR } from "@/lib/sales-orders/format";
import { BATAS_TEKS_TUKAR } from "@/lib/salesman/tukar-barang";

type Mode = "setujui" | "tolak" | "batal";

/** Teks galat sebuah keputusan — termasuk rincian stok kurang dan selisih nilai. */
function pesanGagalTukar(r: Exclude<HasilKeputusanTukarAksi, { ok: true }>, td: TerjemahDinamis): string {
  if (r.kode === "STOK_KURANG") {
    return td("err.STOK_KURANG", {
      baris: r.kurang.map((k) => td("kurangBaris", { nama: k.productName, tersedia: k.tersedia, butuh: k.butuh })).join(", "),
    });
  }
  if (r.kode === "SELISIH_NILAI") {
    return td("err.SELISIH_NILAI", { masuk: formatIDR(r.masuk), keluar: formatIDR(r.keluar) });
  }
  return td(`err.${r.kode}`);
}

/**
 * Tombol keputusan satu dokumen tukar barang. Tombol hanya muncul bagi yang
 * berizin dan bukan pengajunya; server tetap memeriksa ulang (izin, status,
 * bukan milik sendiri, stok, nilai). "Selesaikan" meminta konfirmasi: stok
 * gudang bergerak dan tidak bisa dibatalkan dari layar ini.
 */
export function TombolKeputusanTukar({
  id,
  status,
  docNo,
  bolehSetujui,
  bolehSelesaikan,
  milikSendiri,
}: {
  id: string;
  status: string;
  docNo: string;
  bolehSetujui: boolean;
  bolehSelesaikan: boolean;
  milikSendiri: boolean;
}) {
  const t = useTranslations("tukarBarang");
  const td = dinamis(t);
  const router = useRouter();
  const [pending, mulai] = useTransition();
  const [mode, setMode] = useState<Mode | null>(null);
  const [teks, setTeks] = useState("");
  const [selesaiBuka, setSelesaiBuka] = useState(false);

  const jalankan = (aksi: () => Promise<HasilKeputusanTukarAksi>, sukses: string, selesai?: () => void) =>
    mulai(async () => {
      try {
        const r = await aksi();
        if (r.ok) {
          toast.success(sukses);
          selesai?.();
          router.refresh();
        } else {
          toast.error(pesanGagalTukar(r, td));
          if (r.kode === "SUDAH_DIPUTUSKAN" || r.kode === "SUDAH_SELESAI") router.refresh();
        }
      } catch {
        toast.error(t("err.GAGAL"));
      }
    });

  if (milikSendiri) return null;
  const tampilSetujui = bolehSetujui && status === "DIAJUKAN";
  const tampilBatal = bolehSetujui && (status === "DIAJUKAN" || status === "DISETUJUI");
  const tampilSelesai = bolehSelesaikan && status === "DISETUJUI";
  if (!tampilSetujui && !tampilBatal && !tampilSelesai) return null;

  const tutupDialog = () => {
    setMode(null);
    setTeks("");
  };
  const wajibTeks = mode === "tolak" || mode === "batal";

  const kirimDialog = () => {
    if (mode === "setujui") jalankan(() => setujuiTukarAction(id, teks), t("okSetujui", { docNo }), tutupDialog);
    else if (mode === "tolak") jalankan(() => tolakTukarAction(id, teks), t("okTolak", { docNo }), tutupDialog);
    else if (mode === "batal") jalankan(() => batalkanTukarKantorAction(id, teks), t("okBatal", { docNo }), tutupDialog);
  };

  return (
    <>
      <span className="inline-flex flex-wrap gap-2">
        {tampilSetujui ? (
          <>
            <Button disabled={pending} onClick={() => setMode("setujui")}>
              <CircleCheck className="h-4 w-4" />
              {t("setujui")}
            </Button>
            <Button variant="outline" disabled={pending} onClick={() => setMode("tolak")}>
              <CircleX className="h-4 w-4" />
              {t("tolak")}
            </Button>
          </>
        ) : null}
        {tampilSelesai ? (
          <Button disabled={pending} onClick={() => setSelesaiBuka(true)}>
            <PackageCheck className="h-4 w-4" />
            {t("selesaikan")}
          </Button>
        ) : null}
        {tampilBatal ? (
          <Button variant="ghost" disabled={pending} onClick={() => setMode("batal")}>
            <XCircle className="h-4 w-4" />
            {t("batalkan")}
          </Button>
        ) : null}
      </span>

      <Dialog open={mode !== null} onOpenChange={(v) => (v ? undefined : tutupDialog())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{mode ? td(`dialog.${mode}.judul`) : ""}</DialogTitle>
            <DialogDescription>{mode ? td(`dialog.${mode}.isi`, { docNo }) : ""}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`tukar-teks-${id}`}>
              {mode ? td(`dialog.${mode}.label`) : ""}
              {wajibTeks ? <span className="ml-1 text-destructive">*</span> : null}
            </Label>
            <Textarea
              id={`tukar-teks-${id}`}
              value={teks}
              maxLength={BATAS_TEKS_TUKAR}
              rows={3}
              onChange={(e) => setTeks(e.target.value)}
              disabled={pending}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={tutupDialog} disabled={pending}>
              {t("kembali")}
            </Button>
            <Button
              variant={mode === "setujui" ? "default" : "destructive"}
              disabled={pending || (wajibTeks && !teks.trim())}
              onClick={kirimDialog}
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {mode ? td(`dialog.${mode}.tombol`) : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={selesaiBuka} onOpenChange={setSelesaiBuka}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("selesaiJudul")}</AlertDialogTitle>
            <AlertDialogDescription>{t("selesaiIsi", { docNo })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{t("kembali")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                jalankan(() => selesaikanTukarAction(id), t("okSelesai", { docNo }), () => setSelesaiBuka(false));
              }}
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t("selesaikan")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
