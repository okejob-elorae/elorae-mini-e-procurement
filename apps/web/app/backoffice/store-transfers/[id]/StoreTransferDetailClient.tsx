"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2, XCircle } from "lucide-react";
import type { StoreTransferDetail, StoreTransferStatusValue } from "@/lib/stores/transfer/queries";
import {
  approveStoreTransferAction,
  cancelStoreTransferAction,
  type StoreTransferActionResult,
} from "@/app/actions/store-transfers";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

const STATUS_BADGE_VARIANT: Record<StoreTransferStatusValue, "secondary" | "destructive" | "default" | "outline"> = {
  PENDING: "outline",
  APPROVED: "default",
  CANCELLED: "destructive",
};

const STATUS_BADGE_CLASS: Record<StoreTransferStatusValue, string> = {
  PENDING: "border-amber-500/40 text-amber-700",
  APPROVED: "",
  CANCELLED: "",
};

type ActionErrorCode = Exclude<StoreTransferActionResult, { ok: true }>["code"];

function errKey(code: ActionErrorCode): string {
  return `err.${code}`;
}

function formatRupiah(value: number): string {
  return `Rp ${Math.round(value).toLocaleString("id-ID")}`;
}

type Props = {
  transfer: StoreTransferDetail;
  canManage: boolean;
};

export function StoreTransferDetailClient({ transfer, canManage }: Props) {
  const t = useTranslations("storeTransfers");
  const tDetail = useTranslations("storeTransfers.detail");
  const tApprove = useTranslations("storeTransfers.approve");
  const tCancel = useTranslations("storeTransfers.cancel");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();

  const [approveOpen, setApproveOpen] = useState(false);
  const [approving, startApproveTransition] = useTransition();

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, startCancelTransition] = useTransition();

  const canApprove = canManage && transfer.status === "PENDING";
  const canCancel = canManage && transfer.status === "PENDING";

  function formatDateTime(date: Date): string {
    return new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  function callApprove(): void {
    startApproveTransition(async () => {
      try {
        const result = await approveStoreTransferAction(transfer.id);
        setApproveOpen(false);
        if (result.ok) {
          toast.success(tApprove("success"));
          router.refresh();
          return;
        }
        toast.error(t(errKey(result.code), { detail: result.detail ?? "" }));
      } catch {
        setApproveOpen(false);
        toast.error(t(errKey("ERROR")));
      }
    });
  }

  function callCancel(): void {
    startCancelTransition(async () => {
      try {
        const result = await cancelStoreTransferAction(transfer.id);
        setCancelOpen(false);
        if (result.ok) {
          toast.success(tCancel("success"));
          router.refresh();
          return;
        }
        toast.error(t(errKey(result.code)));
      } catch {
        setCancelOpen(false);
        toast.error(t(errKey("ERROR")));
      }
    });
  }

  const totalQty = transfer.lines.reduce((sum, l) => sum + l.qty, 0);
  const totalValue = transfer.lines.reduce((sum, l) => sum + l.lineValue, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap justify-between">
        <div className="flex items-center gap-3 flex-wrap">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/backoffice/store-transfers">
              <ArrowLeft className="h-4 w-4 mr-2" />
              {tDetail("back")}
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold font-mono">{transfer.docNo}</h1>
          <Badge variant={STATUS_BADGE_VARIANT[transfer.status]} className={STATUS_BADGE_CLASS[transfer.status]}>
            {t(`status.${transfer.status}`)}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {canCancel && (
            <Button
              variant="outline"
              className="h-10 text-destructive"
              disabled={cancelling}
              onClick={() => setCancelOpen(true)}
            >
              <XCircle className="h-4 w-4" />
              {tCancel("button")}
            </Button>
          )}
          {canApprove && (
            <Button className="h-10" disabled={approving} onClick={() => setApproveOpen(true)}>
              <CheckCircle2 className="h-4 w-4" />
              {tApprove("button")}
            </Button>
          )}
        </div>
      </div>

      <Card className="p-4 space-y-2">
        <h2 className="font-semibold">{tDetail("summaryTitle")}</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="flex justify-between gap-4 text-sm">
            <span className="text-muted-foreground">{tDetail("fromStore")}</span>
            <span className="text-right">{transfer.fromStoreName}</span>
          </div>
          <div className="flex justify-between gap-4 text-sm">
            <span className="text-muted-foreground">{tDetail("toStore")}</span>
            <span className="text-right">{transfer.toStoreName}</span>
          </div>
          <div className="flex justify-between gap-4 text-sm">
            <span className="text-muted-foreground">{tDetail("createdBy")}</span>
            <span className="text-right">{transfer.createdByLabel}</span>
          </div>
          <div className="flex justify-between gap-4 text-sm">
            <span className="text-muted-foreground">{tDetail("createdAt")}</span>
            <span className="text-right">{formatDateTime(transfer.createdAt)}</span>
          </div>
          {transfer.approvedByLabel && (
            <div className="flex justify-between gap-4 text-sm">
              <span className="text-muted-foreground">{tDetail("approvedBy")}</span>
              <span className="text-right">{transfer.approvedByLabel}</span>
            </div>
          )}
          {transfer.approvedAt && (
            <div className="flex justify-between gap-4 text-sm">
              <span className="text-muted-foreground">{tDetail("approvedAt")}</span>
              <span className="text-right">{formatDateTime(transfer.approvedAt)}</span>
            </div>
          )}
        </div>
        {transfer.note && (
          <p className="text-sm text-muted-foreground">
            {tDetail("note")}: {transfer.note}
          </p>
        )}
      </Card>

      {transfer.status === "PENDING" && (
        <Alert>
          <AlertDescription>{tDetail("pendingNote")}</AlertDescription>
        </Alert>
      )}

      {/*
       * StoreTransferLine.unitCost is the create-time snapshot of the source's avgCost — the
       * approve path (cancelStoreTransfer's sibling, approveStoreTransfer) deliberately RE-READS
       * the source's avgCost fresh at approval instead of reusing this snapshot, because the
       * source can reprice between creation and approval. So once APPROVED, the unit
       * cost/line value/total below can genuinely disagree with what the ledger actually moved —
       * this alert says so explicitly rather than letting the estimate stand in for the real
       * figure on a document that already happened.
       */}
      {transfer.status === "APPROVED" && (
        <Alert>
          <AlertDescription>{tDetail("approvedValueNote")}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{tDetail("linesTitle")}</CardTitle>
          <CardDescription>{tDetail("estimateNote")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tDetail("colProduct")}</TableHead>
                  <TableHead>{tDetail("colVariant")}</TableHead>
                  <TableHead className="text-right">{tDetail("colQty")}</TableHead>
                  <TableHead className="text-right">{tDetail("colUnitCost")}</TableHead>
                  <TableHead className="text-right">{tDetail("colLineValue")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transfer.lines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>
                      <span className="font-mono text-xs text-muted-foreground mr-1">{l.itemSku}</span>
                      {l.productName}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{l.variantSku || "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.qty}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatRupiah(l.unitCost)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatRupiah(l.lineValue)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={2}>{tDetail("colTotal")}</TableCell>
                  <TableCell className="text-right tabular-nums">{totalQty}</TableCell>
                  <TableCell />
                  <TableCell className="text-right tabular-nums">{formatRupiah(totalValue)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={approveOpen} onOpenChange={(open) => !approving && setApproveOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tApprove("confirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {tApprove("confirmDescription", { from: transfer.fromStoreName, to: transfer.toStoreName })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={approving}>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={approving}
              onClick={(e) => {
                /* Keep the dialog open so the pending label is visible; callApprove() closes it. */
                e.preventDefault();
                callApprove();
              }}
            >
              {approving ? tApprove("submitting") : tApprove("confirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={cancelOpen} onOpenChange={(open) => !cancelling && setCancelOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tCancel("confirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{tCancel("confirmDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelling}>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={cancelling}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                /* Keep the dialog open so the pending label is visible; callCancel() closes it. */
                e.preventDefault();
                callCancel();
              }}
            >
              {cancelling ? tCancel("submitting") : tCancel("confirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
