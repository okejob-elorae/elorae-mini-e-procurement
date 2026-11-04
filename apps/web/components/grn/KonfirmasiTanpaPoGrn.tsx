"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
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
import { putuskanGrnTanpaPoAction } from "@/app/actions/grn";

/**
 * Konfirmasi admin atas GRN tanpa PO (keputusan pemilik 2026-11-02, P51a). Hanya tampil bagi pemegang
 * `goods_receipts:confirm_no_po` — izin yang sama dengan aksinya. Sesudah dikonfirmasi barangnya masuk stok
 * dan menjadi utang ke pemasok, persis seperti penerimaan ber-PO. Menolak belum tersedia (menunggu pemilik).
 */
export function KonfirmasiTanpaPoGrn({ grnId, docNumber, onSelesai }: { grnId: string; docNumber: string; onSelesai: () => void | Promise<void> }) {
  const t = useTranslations("inventory.grnTanpaPo");
  const tUmum = useTranslations("common");
  const [buka, setBuka] = useState(false);
  const [sibuk, setSibuk] = useState(false);

  const jalankan = async () => {
    setSibuk(true);
    try {
      const r = await putuskanGrnTanpaPoAction(grnId, "KONFIRMASI");
      if (r.ok) toast.success(t("dikonfirmasiToast", { nomor: r.docNumber }));
      else toast.error(t.has(`err.${r.code}`) ? t(`err.${r.code}`) : t("err.GAGAL"));
      await onSelesai();
    } catch {
      toast.error(t("err.GAGAL"));
    } finally {
      setSibuk(false);
      setBuka(false);
    }
  };

  return (
    <>
      <Button type="button" size="sm" disabled={sibuk} onClick={() => setBuka(true)}>
        {sibuk && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {t("konfirmasi")}
      </Button>
      <AlertDialog open={buka} onOpenChange={(v) => !v && !sibuk && setBuka(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("dialogJudul", { nomor: docNumber })}</AlertDialogTitle>
            <AlertDialogDescription>{t("dialogIsi")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sibuk}>{tUmum("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={sibuk}
              onClick={(e) => {
                e.preventDefault();
                void jalankan();
              }}
            >
              {sibuk && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("konfirmasi")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
