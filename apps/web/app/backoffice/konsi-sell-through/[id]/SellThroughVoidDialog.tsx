"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import type { SellThroughDetail } from "@/lib/konsi-sell-through/queries";
import { voidSellThroughAction, type SellThroughActionFailure } from "@/app/actions/konsi-sell-through";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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
import { formatRupiahExact } from "./display";

/* Mirrors the writer's cap on the free-text reason, so the input stops where the writer would refuse. */
const REASON_MAX_LENGTH = 1000;

export function SellThroughVoidDialog({
  report,
  open,
  onOpenChange,
  describeError,
}: {
  report: SellThroughDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  describeError: (f: SellThroughActionFailure) => string;
}) {
  const tCommon = useTranslations("common");
  const tVoid = useTranslations("konsiSellThrough.void");
  const router = useRouter();

  const [reason, setReason] = useState("");
  const [voiding, startVoidTransition] = useTransition();

  const fakturIssued = report.taxInvoiceStatus === "CREATED" || report.taxInvoiceStatus === "SENT_TO_STORE";

  function callVoid(): void {
    startVoidTransition(async () => {
      try {
        const result = await voidSellThroughAction(report.id, reason.trim());
        if (result.ok) {
          onOpenChange(false);
          toast.success(tVoid("success"));
          setReason("");
          router.refresh();
          return;
        }
        toast.error(describeError(result));
      } catch {
        toast.error(describeError({ ok: false, reason: "UNEXPECTED" }));
      }
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => !voiding && onOpenChange(next)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{tVoid("confirmTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{tVoid("confirmDescription")}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2 text-sm">
          {report.receivableAmount !== null && (
            <p>{tVoid("receivable", { amount: formatRupiahExact(report.receivableAmount) })}</p>
          )}
          {report.taxInvoiceStatus !== null && <p>{tVoid("faktur")}</p>}
          {fakturIssued && (
            <p className="text-destructive">{tVoid("fakturIssued", { invoiceNo: report.taxInvoiceNo ?? "—" })}</p>
          )}
          <p className="text-muted-foreground">{tVoid("recreateHint")}</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="sell-through-void-reason" className="text-xs text-muted-foreground">
            {tVoid("reasonLabel")}
          </Label>
          <Textarea
            id="sell-through-void-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={tVoid("reasonPlaceholder")}
            disabled={voiding}
            maxLength={REASON_MAX_LENGTH}
            rows={3}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={voiding}>{tCommon("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={voiding || !reason.trim()}
            onClick={(e) => {
              /* Keep the dialog open so the pending label is visible; callVoid() closes it. */
              e.preventDefault();
              callVoid();
            }}
          >
            {voiding ? tVoid("voiding") : tVoid("confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
