"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import type { FieldReturnDetail, FieldReturnStatus } from "@/lib/field-sales/retur/queries";
import { lineVariance, isSettled } from "@/lib/field-sales/retur/variance";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
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
import { approveAction } from "@/app/actions/field-returns";
import { ReceiveForm, fieldReturnErrorKey } from "./ReceiveForm";
import { ResolutionControls } from "./ResolutionControls";

type Props = {
  fieldReturn: FieldReturnDetail;
  canManage: boolean;
  canWriteOff: boolean;
};

const STATUS_BADGE_VARIANT: Record<FieldReturnStatus, "secondary" | "destructive" | "default" | "outline"> = {
  PENDING_WAREHOUSE_RECEIVING: "secondary",
  MISMATCH_PENDING_RESOLUTION: "outline",
  PENDING_APPROVAL: "outline",
  APPROVED: "default",
  CANCELLED: "destructive",
};

const STATUS_BADGE_CLASS: Record<FieldReturnStatus, string> = {
  PENDING_WAREHOUSE_RECEIVING: "",
  MISMATCH_PENDING_RESOLUTION: "border-amber-500/40 text-amber-700",
  PENDING_APPROVAL: "border-amber-500/40 text-amber-700",
  APPROVED: "",
  CANCELLED: "",
};

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

/** Every discrepant line with no SETTLING resolution as its latest — mirrors allDiscrepantLinesSettled. */
function outstandingLineCount(lines: FieldReturnDetail["lines"]): number {
  return lines.filter((l) => {
    if (lineVariance(l.qty, l.receivedQty) === 0) return false;
    return !isSettled(l.resolutions[0]?.type ?? null);
  }).length;
}

export function FieldReturnDetailClient({ fieldReturn: r, canManage, canWriteOff }: Props) {
  const t = useTranslations("fieldReturns");
  const tReceiving = useTranslations("fieldReturnReceiving");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [approveOpen, setApproveOpen] = useState(false);

  const outstanding = outstandingLineCount(r.lines);
  const showReceiveForm = canManage && r.status === "PENDING_WAREHOUSE_RECEIVING";
  /*
   * Without canManage, the receive form, the resolution controls and the approve button must
   * not render at all — the entire card is gated here, not just the action buttons inside it.
   * The internal `actionable` check in ResolutionControls still narrows further by status
   * (APPROVED/CANCELLED stay read-only even for a manager).
   */
  const showResolutionControls = canManage && r.status !== "PENDING_WAREHOUSE_RECEIVING";
  const showApprove = canManage && r.status === "PENDING_APPROVAL";

  function callApprove(): void {
    startTransition(async () => {
      try {
        const result = await approveAction(r.id);
        if (result.ok) {
          toast.success(tReceiving("successApproved"));
          setApproveOpen(false);
          router.refresh();
          return;
        }
        setApproveOpen(false);
        if (result.code === "UNRESOLVED_LINES") {
          toast.error(tReceiving("approveErrUnresolvedLines", { count: outstanding }));
          return;
        }
        toast.error(tReceiving(fieldReturnErrorKey(result.code)));
      } catch {
        setApproveOpen(false);
        toast.error(tReceiving(fieldReturnErrorKey("ERROR")));
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap justify-between">
        <div className="flex items-center gap-3 flex-wrap">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/backoffice/field-returns">
              <ArrowLeft className="h-4 w-4 mr-2" />
              {t("detail.back")}
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold font-mono">{r.docNo}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={STATUS_BADGE_VARIANT[r.status]} className={STATUS_BADGE_CLASS[r.status]}>
            {t(`status.${r.status}`)}
          </Badge>
          {showApprove && (
            <Button className="h-10" disabled={isPending} onClick={() => setApproveOpen(true)}>
              <CheckCircle2 className="h-4 w-4" />
              {tReceiving("approveButton")}
            </Button>
          )}
        </div>
      </div>

      <Card className="p-4 space-y-2">
        <h2 className="font-semibold">{t("detail.summaryTitle")}</h2>
        <Field label={t("detail.store")} value={r.storeName} />
        <Field label={t("detail.raisedBy")} value={r.raisedByLabel} />
        <Field label={t("detail.raisedAt")} value={formatDateOnlyJakarta(r.createdAt)} />
        <Field label={t("detail.transport")} value={t(`transport.${r.transport}`)} />
        {r.transport === "EXPEDITION" && (
          <>
            <Field label={t("detail.expeditionName")} value={r.expeditionName} />
            <Field label={t("detail.resiNo")} value={r.resiNo} />
          </>
        )}
        <Field label={t("detail.note")} value={r.note} />
      </Card>

      <Card className="p-4 space-y-2">
        <h2 className="font-semibold">{t("detail.notaPhoto")}</h2>
        <div className="overflow-hidden rounded-md border bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element -- external R2-hosted photo, not an optimizable local asset */}
          <img
            src={r.notaPhotoUrl}
            alt={t("detail.notaPhoto")}
            className="max-h-[70vh] w-full object-contain"
          />
        </div>
      </Card>

      <Card className="p-4">
        <h2 className="font-semibold mb-2">{t("detail.linesTitle")}</h2>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("detail.colProduct")}</TableHead>
                <TableHead>{t("detail.colVariant")}</TableHead>
                <TableHead className="text-right">{t("detail.colQty")}</TableHead>
                <TableHead>{t("detail.colReason")}</TableHead>
                <TableHead>{t("detail.colReasonNote")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.lines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell>
                    <div>
                      <p className="font-medium">{line.itemName}</p>
                      <p className="text-xs text-muted-foreground font-mono">{line.itemSku}</p>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-sm">{line.variantSku || "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{line.qty}</TableCell>
                  <TableCell>{t(`reason.${line.reason}`)}</TableCell>
                  <TableCell className="text-muted-foreground">{line.reasonNote || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      {showReceiveForm && (
        <ReceiveForm
          returnId={r.id}
          lines={r.lines.map((l) => ({
            id: l.id,
            itemName: l.itemName,
            itemSku: l.itemSku,
            variantSku: l.variantSku,
            qty: l.qty,
          }))}
        />
      )}

      {showResolutionControls && (
        <ResolutionControls
          status={r.status}
          lines={r.lines}
          canManage={canManage}
          canWriteOff={canWriteOff}
        />
      )}

      <AlertDialog open={approveOpen} onOpenChange={(open) => !isPending && setApproveOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tReceiving("approveConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{tReceiving("approveConfirmDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending}
              onClick={(e) => {
                /* Keep the dialog open so the pending label is visible; callApprove() closes it. */
                e.preventDefault();
                callApprove();
              }}
            >
              {isPending ? tReceiving("submitting") : tReceiving("approveConfirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
