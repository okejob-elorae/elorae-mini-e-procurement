"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cancelShipmentAction } from "@/app/actions/delivery-shipments";
import { pesanGagalPengiriman } from "@/lib/delivery/pesan-galat";

const BATAS_ALASAN = 1000;

type Props = {
  shipmentId: string;
  docNo: string;
  orderType: "PUTUS" | "KONSI";
  /** The goods had already left (IN_TRANSIT): the store's SPG is told it was cancelled. */
  berangkat: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
};

/**
 * "Tidak jadi dikirim" with its required reason (Q1, P25, P41a). The warning says what happens:
 * a putus shipment's nota tagihan, receivable and faktur are cancelled and Keuangan is told at
 * once; a konsi shipment's goods go back to the main warehouse. The server refuses a putus nota
 * that already has a payment report or a store receipt, and names them.
 */
export function CancelShipmentDialog({ shipmentId, docNo, orderType, berangkat, open, onOpenChange, onDone }: Props) {
  const t = useTranslations("deliveryShipments");
  const tTerima = useTranslations("pwa.spgTerima");
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  const trimmed = reason.trim();
  const valid = trimmed.length > 0 && trimmed.length <= BATAS_ALASAN;

  function submit(): void {
    startTransition(async () => {
      try {
        const result = await cancelShipmentAction({ shipmentId, reason: trimmed });
        if (!result.ok) {
          // RECEIVABLE_PAID without a report number reads its own sentence, never "paid ()".
          toast.error(
            pesanGagalPengiriman(result.reason, result.detail, {
              teks: (k, v) => t(k as any, v),
              adaSebab: (k) => tTerima.has(`err.${k}` as any),
              sebab: (k) => tTerima(`err.${k}` as any),
            }),
          );
          return;
        }
        toast.success(t("cancelDialog.done", { docNo }));
        onOpenChange(false);
        onDone();
      } catch {
        toast.error(t("err.UNEXPECTED"));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("cancelDialog.title", { docNo })}</DialogTitle>
          <DialogDescription>
            {orderType === "PUTUS" ? t("cancelDialog.putusWarning") : t("cancelDialog.konsiWarning")}
          </DialogDescription>
        </DialogHeader>
        {berangkat && <p className="text-sm text-muted-foreground">{t("cancelDialog.departedNote")}</p>}
        <div className="space-y-1">
          <Label htmlFor="cancel-shipment-reason">{t("cancelDialog.reasonLabel")}</Label>
          <Textarea
            id="cancel-shipment-reason"
            value={reason}
            maxLength={BATAS_ALASAN}
            rows={3}
            disabled={isPending}
            onChange={(e) => setReason(e.target.value)}
          />
          {!trimmed && <p className="text-xs text-muted-foreground">{t("err.REASON_REQUIRED")}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" className="h-10" disabled={isPending} onClick={() => onOpenChange(false)}>
            {t("cancelDialog.back")}
          </Button>
          <Button variant="destructive" className="h-10" disabled={isPending || !valid} onClick={submit}>
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("cancelDialog.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
