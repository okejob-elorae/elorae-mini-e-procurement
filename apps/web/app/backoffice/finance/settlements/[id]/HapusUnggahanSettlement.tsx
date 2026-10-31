"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

const KODE_GALAT = ["ALASAN_WAJIB", "TIDAK_DITEMUKAN", "SUDAH_DIJURNAL", "FORBIDDEN"] as const;

/**
 * Membatalkan unggahan settlement yang BELUM dijurnal (salah unggah / kembar).
 * Server menolak yang sudah dijurnal; alasan wajib dan masuk jejak audit.
 */
export function HapusUnggahanSettlement({ settlementId }: { settlementId: string }) {
  const t = useTranslations("financeSettlements");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [alasan, setAlasan] = useState("");
  const [menghapus, setMenghapus] = useState(false);

  async function hapus() {
    setMenghapus(true);
    try {
      const res = await fetch("/api/finance/settlements/upload", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ settlementId, alasan }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; code?: string };
      if (res.ok && data.ok) {
        toast.success(t("deleteUploadSuccess"));
        setOpen(false);
        router.push("/backoffice/finance/settlements");
        router.refresh();
        return;
      }
      const kode = KODE_GALAT.find((k) => k === data.code);
      toast.error(kode ? t(`deleteUploadErr.${kode}`) : t("deleteUploadErr.ERROR"));
      if (kode === "SUDAH_DIJURNAL") {
        setOpen(false);
        router.refresh();
      }
    } catch {
      toast.error(t("deleteUploadErr.ERROR"));
    } finally {
      setMenghapus(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="outline" className="text-destructive" onClick={() => setOpen(true)}>
        <Trash2 className="h-4 w-4 mr-2" />
        {t("deleteUploadButton")}
      </Button>
      <AlertDialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setAlasan("");
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteUploadTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("deleteUploadDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1">
            <Label htmlFor="hapus-settlement-alasan" className="text-xs text-muted-foreground">
              {t("deleteUploadReason")}
            </Label>
            <Textarea
              id="hapus-settlement-alasan"
              value={alasan}
              onChange={(e) => setAlasan(e.target.value)}
              disabled={menghapus}
              rows={3}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-10" disabled={menghapus}>
              {tCommon("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              className="h-10"
              disabled={menghapus || !alasan.trim()}
              onClick={(e) => {
                // Dialog tetap terbuka selama menghapus; ditutup setelah berhasil.
                e.preventDefault();
                void hapus();
              }}
            >
              {menghapus ? t("deleteUploadPending") : t("deleteUploadConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
