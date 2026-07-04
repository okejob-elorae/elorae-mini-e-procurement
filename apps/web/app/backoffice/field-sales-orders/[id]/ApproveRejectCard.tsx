"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import type { FieldSalesOrderStatus } from "@/lib/field-sales/queries";
import {
  approveFieldSalesOrderAction,
  rejectFieldSalesOrderAction,
  type ActionResult,
} from "@/app/actions/field-sales-orders";

type Props = {
  orderId: string;
  status: FieldSalesOrderStatus;
  canApprove: boolean;
};

export function ApproveRejectCard({ orderId, status, canApprove }: Props) {
  const t = useTranslations("fieldSalesOrders");
  const tCommon = useTranslations("common");
  const [isPending, startTransition] = useTransition();
  const [approveDialogOpen, setApproveDialogOpen] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  if (!canApprove || status !== "PENDING_APPROVAL") return null;

  function handleResult(r: ActionResult, successMessage: string): void {
    if (r.ok) {
      toast.success(successMessage);
      setApproveDialogOpen(false);
      setRejectDialogOpen(false);
      setRejectReason("");
    } else if (r.reason === "FORBIDDEN") {
      toast.error(t("errForbidden"));
    } else if (r.reason === "INVALID_TRANSITION") {
      toast.error(t("errAlreadyDecided"));
    } else {
      toast.error(t("errNotFound"));
    }
  }

  function callApprove(): void {
    startTransition(async () => {
      try {
        const r = await approveFieldSalesOrderAction(orderId);
        handleResult(r, t("approved"));
      } catch {
        toast.error(t("errGeneric"));
      }
    });
  }

  function callReject(): void {
    const reason = rejectReason.trim();
    if (!reason) return;
    startTransition(async () => {
      try {
        const r = await rejectFieldSalesOrderAction(orderId, reason);
        handleResult(r, t("rejected"));
      } catch {
        toast.error(t("errGeneric"));
      }
    });
  }

  return (
    <Card className="p-4">
      <div className="flex gap-2">
        <Button disabled={isPending} onClick={() => setApproveDialogOpen(true)}>
          {t("approve")}
        </Button>
        <Button
          variant="destructive"
          disabled={isPending}
          onClick={() => setRejectDialogOpen(true)}
        >
          {t("reject")}
        </Button>
      </div>

      <AlertDialog open={approveDialogOpen} onOpenChange={setApproveDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("approve")}</AlertDialogTitle>
            <AlertDialogDescription>{t("approveConfirm")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction disabled={isPending} onClick={callApprove}>
              {t("approve")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={rejectDialogOpen}
        onOpenChange={(open) => {
          setRejectDialogOpen(open);
          if (!open) setRejectReason("");
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("reject")}</AlertDialogTitle>
            <AlertDialogDescription>{t("rejectConfirm")}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">{t("rejectReasonLabel")}</label>
            <Textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              disabled={isPending}
              rows={3}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending || !rejectReason.trim()}
              onClick={callReject}
            >
              {t("reject")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
