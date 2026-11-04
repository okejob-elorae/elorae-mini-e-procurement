"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
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
import { terbitkanWorkOrder } from "@/app/actions/production";

/**
 * Konfirmasi terbitkan perintah kerja (dulu satu klik ikon ▷ langsung
 * menerbitkan). Sesudah terbit, isian WO tidak bisa diubah lagi.
 */
export function DialogTerbitWo({
  open,
  onOpenChange,
  woId,
  docNumber,
  onSelesai,
}: {
  open: boolean;
  onOpenChange: (buka: boolean) => void;
  woId: string;
  docNumber: string;
  onSelesai: () => void;
}) {
  const t = useTranslations("workOrders.terbit");
  const tTolak = useTranslations("productionErrors");
  const [sibuk, mulai] = useTransition();

  const kirim = () =>
    mulai(async () => {
      try {
        const hasil = await terbitkanWorkOrder(woId);
        if (!hasil.ok) {
          toast.error(tTolak.has(hasil.code) ? tTolak(hasil.code) : t("gagal"));
        } else {
          toast.success(t("berhasil", { docNumber }));
        }
      } catch {
        toast.error(t("gagal"));
      }
      onOpenChange(false);
      onSelesai();
    });

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("judul", { docNumber })}</AlertDialogTitle>
          <AlertDialogDescription>{t("deskripsi")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={sibuk}>{t("jangan")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={sibuk}
            onClick={(e) => {
              e.preventDefault();
              kirim();
            }}
          >
            {sibuk ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {t("ya")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
