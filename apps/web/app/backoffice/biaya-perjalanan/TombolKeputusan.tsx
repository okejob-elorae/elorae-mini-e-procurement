"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Banknote, CircleCheck, CircleX, Loader2 } from "lucide-react";
import { setujuiBiayaAction, tandaiDibayarBiayaAction, tolakBiayaAction } from "@/app/actions/expense-claims";
import { Button } from "@/components/ui/button";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { dinamis } from "@/lib/i18n/dinamis";
import { BATAS_CATATAN } from "@/lib/salesman/biaya";
import { cn } from "@/lib/utils";

/**
 * Tombol keputusan satu klaim: Setujui / Tolak (wajib alasan) untuk yang
 * DIAJUKAN, Tandai dibayar untuk yang DISETUJUI. Tombol hanya muncul bagi yang
 * berizin; server tetap memeriksa ulang (izin, status, bukan milik sendiri).
 * "Tandai dibayar" meminta konfirmasi: uang yang sudah ditandai keluar tidak
 * bisa ditarik kembali dari layar ini. Dialognya meminta rekening sumber uang
 * (`akunKas`) — jurnal pembayarannya mengkredit akun itu; kosong = akun Kas.
 */

/** Pilihan "akun Kas bawaan" (Select tidak menerima nilai kosong). */
const KAS_BAWAAN = "__kas__";
export function TombolKeputusan({
  id,
  status,
  ringkas,
  bolehSetujui,
  bolehBayar,
  akunKas = [],
  tata = "tumpuk",
}: {
  id: string;
  status: string;
  /** "Bensin · Rp 50.000 · Budi" — untuk teks konfirmasi. */
  ringkas: string;
  bolehSetujui: boolean;
  bolehBayar: boolean;
  /** Akun kas/bank yang boleh dipilih sebagai sumber pembayaran. */
  akunKas?: { id: string; label: string }[];
  tata?: "tumpuk" | "baris";
}) {
  const t = useTranslations("biayaPerjalanan");
  const td = dinamis(t);
  const router = useRouter();
  const [pending, mulai] = useTransition();
  const [tolakBuka, setTolakBuka] = useState(false);
  const [bayarBuka, setBayarBuka] = useState(false);
  const [alasan, setAlasan] = useState("");
  const [akun, setAkun] = useState(KAS_BAWAAN);

  const jalankan = (aksi: () => ReturnType<typeof setujuiBiayaAction>, sukses: string, selesai?: () => void) =>
    mulai(async () => {
      const r = await aksi();
      if (r.ok) {
        toast.success(sukses);
        selesai?.();
        router.refresh();
      } else {
        toast.error(td(`err.${r.kode}`));
        if (r.kode === "SUDAH_DIPUTUSKAN") router.refresh();
      }
    });

  const tampilSetujui = bolehSetujui && status === "DIAJUKAN";
  const tampilBayar = bolehBayar && status === "DISETUJUI";
  if (!tampilSetujui && !tampilBayar) return null;

  return (
    <>
      <span className={cn("inline-flex gap-1", tata === "tumpuk" ? "flex-col items-end" : "flex-wrap")}>
        {tampilSetujui ? (
          <>
            <Button size="sm" disabled={pending} onClick={() => jalankan(() => setujuiBiayaAction(id), t("okSetujui"))}>
              {pending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CircleCheck className="mr-1.5 h-3.5 w-3.5" />}
              {t("setujui")}
            </Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => setTolakBuka(true)}>
              <CircleX className="mr-1.5 h-3.5 w-3.5" />
              {t("tolak")}
            </Button>
          </>
        ) : null}
        {tampilBayar ? (
          <Button size="sm" disabled={pending} onClick={() => setBayarBuka(true)}>
            <Banknote className="mr-1.5 h-3.5 w-3.5" />
            {t("tandaiDibayar")}
          </Button>
        ) : null}
      </span>

      <Dialog
        open={tolakBuka}
        onOpenChange={(v) => {
          setTolakBuka(v);
          if (!v) setAlasan("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("tolakJudul")}</DialogTitle>
            <DialogDescription>{t("tolakIsi", { ringkas })}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`alasan-${id}`}>{t("alasanLabel")}</Label>
            <Textarea
              id={`alasan-${id}`}
              value={alasan}
              maxLength={BATAS_CATATAN}
              rows={3}
              placeholder={t("alasanPetunjuk")}
              onChange={(e) => setAlasan(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTolakBuka(false)} disabled={pending}>
              {t("batal")}
            </Button>
            <Button
              variant="destructive"
              disabled={pending || !alasan.trim()}
              onClick={() =>
                jalankan(() => tolakBiayaAction(id, alasan), t("okTolak"), () => {
                  setTolakBuka(false);
                  setAlasan("");
                })
              }
            >
              {pending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              {t("tolak")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={bayarBuka} onOpenChange={setBayarBuka}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("bayarJudul")}</AlertDialogTitle>
            <AlertDialogDescription>{t("bayarIsi", { ringkas })}</AlertDialogDescription>
          </AlertDialogHeader>
          {akunKas.length > 0 ? (
            <div className="space-y-2">
              <Label htmlFor={`akun-${id}`}>{t("bayarDari")}</Label>
              <Select value={akun} onValueChange={setAkun} disabled={pending}>
                <SelectTrigger id={`akun-${id}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={KAS_BAWAAN}>{t("bayarDariKas")}</SelectItem>
                  {akunKas.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{t("batal")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={() =>
                jalankan(() => tandaiDibayarBiayaAction(id, akun === KAS_BAWAAN ? null : akun), t("okBayar"), () => setBayarBuka(false))
              }
            >
              {t("tandaiDibayar")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
