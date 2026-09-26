"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, CheckCircle2, ClipboardList, XCircle } from "lucide-react";
import type { SellThroughDetail, SellThroughLineDetail } from "@/lib/konsi-sell-through/queries";
import { resolutionArmsFor, resolutionNeedsReason, type SellThroughResolutionValue } from "@/lib/konsi-sell-through/derive";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { formatDateTime } from "@/lib/sales-orders/format";
import {
  resolveSellThroughLineAction,
  cancelSellThroughAction,
  type SellThroughActionFailure,
} from "@/app/actions/konsi-sell-through";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
import { SellThroughApproveDialog } from "./SellThroughApproveDialog";
import { SellThroughInvoiceCard } from "./SellThroughInvoiceCard";
import { SellThroughVoidDialog } from "./SellThroughVoidDialog";
import { formatRupiahExact, productNamesForKeys } from "./display";

const STATUS_BADGE_VARIANT: Record<SellThroughDetail["status"], "secondary" | "destructive" | "default"> = {
  DRAFT: "secondary",
  APPROVED: "default",
  CANCELLED: "destructive",
  VOIDED: "destructive",
};

/* Mirrors the writer's cap on both free-text reasons, so the input stops where the writer would refuse. */
const REASON_MAX_LENGTH = 1000;

export function SellThroughDetailClient({
  report,
  canManage,
  canPrint,
  salesmanCandidates,
}: {
  report: SellThroughDetail;
  canManage: boolean;
  canPrint: boolean;
  salesmanCandidates: Array<{ id: string; name: string }>;
}) {
  const t = useTranslations("konsiSellThrough");
  const tDetail = useTranslations("konsiSellThrough.detail");
  const tApprove = useTranslations("konsiSellThrough.approve");
  const tCancel = useTranslations("konsiSellThrough.cancel");
  const tVoid = useTranslations("konsiSellThrough.void");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();

  const [resolutions, setResolutions] = useState<Record<string, SellThroughResolutionValue | "">>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [savingLineId, setSavingLineId] = useState<string | null>(null);
  const [, startSaveTransition] = useTransition();

  const [approveOpen, setApproveOpen] = useState(false);

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, startCancelTransition] = useTransition();

  const [voidOpen, setVoidOpen] = useState(false);

  const isDraft = report.status === "DRAFT";
  const isSpgPos = report.method === "SPG_POS";
  /* Every SPG_POS report shows its resolutions; only a DRAFT viewed by a manager can edit them. */
  const canEditResolution = isSpgPos && isDraft && canManage;
  const heldLines = report.lines.filter((l) => l.held);
  const lateLineCount = report.lines.filter((l) => l.hasLateMovements).length;
  const statusKey = report.status === "APPROVED" ? (report.baseline ? "APPROVED_BASELINE" : "APPROVED_INVOICED") : report.status;
  /* Every column left of Line Total, so the footer's total sits under it. */
  const totalLabelSpan = isSpgPos ? 10 : 9;

  /**
   * An over-long reason arrives under three different codes (INVALID_RESOLUTION on resolve,
   * REASON_REQUIRED on cancel, BASELINE_REASON_REQUIRED on a baseline approve) and gets its own
   * copy on all three. UNPRICED carries the refused line keys, comma-joined, which are named back
   * as products; with no detail it falls back to the preview's own unpriced keys.
   */
  function errorMessage(result: SellThroughActionFailure): string {
    if (result.detail === "REASON_TOO_LONG") return t("err.REASON_TOO_LONG");
    if (result.reason === "UNPRICED") {
      const keys = result.detail ? result.detail.split(",") : report.unpricedKeys;
      return t("err.UNPRICED", { products: productNamesForKeys(report.lines, keys), n: keys.length });
    }
    if (result.reason === "HAS_SUCCESSOR" || result.reason === "SETTLEMENT_PENDING") {
      return t(`err.${result.reason}`, { docNo: result.detail ?? "" });
    }
    return t(`err.${result.reason}`, { detail: result.detail ?? "" });
  }

  function effectiveResolution(line: SellThroughLineDetail): SellThroughResolutionValue | "" {
    return resolutions[line.id] ?? line.resolution ?? line.suggestedResolution ?? "";
  }

  function effectiveReason(line: SellThroughLineDetail): string {
    return reasons[line.id] ?? line.resolutionReason ?? "";
  }

  function isSuggested(line: SellThroughLineDetail): boolean {
    return line.resolution === null && line.suggestedResolution !== null && effectiveResolution(line) === line.suggestedResolution;
  }

  function updateResolution(lineId: string, value: SellThroughResolutionValue | ""): void {
    setResolutions((prev) => ({ ...prev, [lineId]: value }));
  }

  function updateReason(lineId: string, value: string): void {
    setReasons((prev) => ({ ...prev, [lineId]: value }));
  }

  function saveLine(line: SellThroughLineDetail): void {
    const resolution = effectiveResolution(line);
    if (resolution === "") return;
    const reason = effectiveReason(line).trim();
    if (resolutionNeedsReason(resolution) && reason === "") return;

    setSavingLineId(line.id);
    startSaveTransition(async () => {
      try {
        const result = await resolveSellThroughLineAction({ lineId: line.id, resolution, reason: reason || null });
        setSavingLineId(null);
        if (result.ok) {
          toast.success(tDetail("resolutionSaved"));
          setResolutions((prev) => {
            const next = { ...prev };
            delete next[line.id];
            return next;
          });
          setReasons((prev) => {
            const next = { ...prev };
            delete next[line.id];
            return next;
          });
          router.refresh();
          return;
        }
        toast.error(errorMessage(result));
      } catch {
        setSavingLineId(null);
        toast.error(t("err.UNEXPECTED"));
      }
    });
  }

  function callCancel(): void {
    if (!cancelReason.trim()) return;
    startCancelTransition(async () => {
      try {
        const result = await cancelSellThroughAction(report.id, cancelReason.trim());
        setCancelOpen(false);
        if (result.ok) {
          toast.success(tCancel("success"));
          setCancelReason("");
          router.refresh();
          return;
        }
        toast.error(errorMessage(result));
      } catch {
        setCancelOpen(false);
        toast.error(t("err.UNEXPECTED"));
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap justify-between">
        <div className="flex items-center gap-3 flex-wrap">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/backoffice/konsi-sell-through">
              <ArrowLeft className="h-4 w-4 mr-2" />
              {tDetail("back")}
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold font-mono">{report.docNo}</h1>
          <Badge variant={STATUS_BADGE_VARIANT[report.status]}>{t(`status.${statusKey}`)}</Badge>
        </div>
        <div className="flex items-center gap-2">
          {canManage && isDraft && (
            <Button variant="outline" className="h-10 text-destructive" disabled={cancelling} onClick={() => setCancelOpen(true)}>
              <XCircle className="h-4 w-4" />
              {tCancel("button")}
            </Button>
          )}
          {canManage && isDraft && (
            <Button className="h-10" disabled={heldLines.length > 0} onClick={() => setApproveOpen(true)}>
              <CheckCircle2 className="h-4 w-4" />
              {tApprove("button")}
            </Button>
          )}
          {canManage && report.status === "APPROVED" && (
            <Button variant="outline" className="h-10 text-destructive" onClick={() => setVoidOpen(true)}>
              <XCircle className="h-4 w-4" />
              {tVoid("button")}
            </Button>
          )}
        </div>
      </div>

      {canManage && isDraft && heldLines.length > 0 && (
        <p className="text-sm text-amber-700">{tApprove("disabledHeld", { n: heldLines.length })}</p>
      )}

      <Card className="p-4 space-y-2">
        <h2 className="font-semibold">{tDetail("summaryTitle")}</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="flex justify-between gap-4 text-sm">
            <span className="text-muted-foreground">{tDetail("store")}</span>
            <span className="text-right">{report.storeName}</span>
          </div>
          <div className="flex justify-between gap-4 text-sm">
            <span className="text-muted-foreground">{tDetail("method")}</span>
            <span className="text-right">{t(`method.${report.method}`)}</span>
          </div>
          <div className="flex justify-between gap-4 text-sm">
            <span className="text-muted-foreground">{tDetail("period")}</span>
            <span className="text-right">
              {report.periodStart
                ? t("periodRange", {
                    start: formatDateOnlyJakarta(report.periodStart),
                    end: formatDateOnlyJakarta(report.periodEnd),
                  })
                : t("periodFirst", { end: formatDateOnlyJakarta(report.periodEnd) })}
            </span>
          </div>
          <div className="flex justify-between gap-4 text-sm">
            <span className="text-muted-foreground">{tDetail("closingStocktake")}</span>
            <span className="text-right">
              <Link href={`/backoffice/store-stocktakes/${report.closingStocktakeId}`} className="text-primary hover:underline font-mono">
                {report.closingStocktakeDocNo || tDetail("none")}
              </Link>
            </span>
          </div>
          <div className="flex justify-between gap-4 text-sm">
            <span className="text-muted-foreground">{tDetail("previousReport")}</span>
            <span className="text-right">
              {report.previousId ? (
                <Link href={`/backoffice/konsi-sell-through/${report.previousId}`} className="text-primary hover:underline font-mono">
                  {report.previousDocNo || tDetail("none")}
                </Link>
              ) : (
                tDetail("none")
              )}
            </span>
          </div>
          <div className="flex justify-between gap-4 text-sm">
            <span className="text-muted-foreground">{tDetail("createdBy")}</span>
            <span className="text-right">{`${report.createdByLabel} · ${formatDateTime(report.createdAt, locale)}`}</span>
          </div>
          {report.approvedByLabel && report.approvedAt && (
            <div className="flex justify-between gap-4 text-sm">
              <span className="text-muted-foreground">{tDetail("approvedBy")}</span>
              <span className="text-right">{`${report.approvedByLabel} · ${formatDateTime(report.approvedAt, locale)}`}</span>
            </div>
          )}
          {report.cancelledByLabel && report.cancelledAt && (
            <div className="flex justify-between gap-4 text-sm">
              <span className="text-muted-foreground">{tDetail("cancelledBy")}</span>
              <span className="text-right">{`${report.cancelledByLabel} · ${formatDateTime(report.cancelledAt, locale)}`}</span>
            </div>
          )}
          {report.voidedByLabel && report.voidedAt && (
            <div className="flex justify-between gap-4 text-sm">
              <span className="text-muted-foreground">{tDetail("voidedBy")}</span>
              <span className="text-right">{`${report.voidedByLabel} · ${formatDateTime(report.voidedAt, locale)}`}</span>
            </div>
          )}
        </div>
        {report.status === "CANCELLED" && report.cancelReason && (
          <p className="text-sm text-muted-foreground">
            {tDetail("cancelReason")}: {report.cancelReason}
          </p>
        )}
        {report.status === "VOIDED" && (
          <div className="space-y-1">
            {report.voidReason && (
              <p className="text-sm text-muted-foreground">
                {tDetail("voidReason")}: {report.voidReason}
              </p>
            )}
            <Link href={`/backoffice/store-stocktakes/${report.closingStocktakeId}`} className="text-sm text-primary hover:underline">
              {tVoid("createCorrected")}
            </Link>
          </div>
        )}
      </Card>

      {(report.status === "APPROVED" || report.status === "VOIDED") && (
        <SellThroughInvoiceCard report={report} canPrint={canPrint} canManage={canManage} describeError={errorMessage} />
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            {tDetail("linesTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!isDraft && <p className="mb-3 text-sm text-muted-foreground">{tDetail("readOnlyNote")}</p>}
          <p className="mb-3 text-xs text-muted-foreground">{tDetail("closingVsCountedNote")}</p>
          {lateLineCount > 0 && (
            <p className="mb-3 text-sm text-amber-700 dark:text-amber-500">
              {tDetail("lateMovementsNote", { n: lateLineCount, docNo: report.previousDocNo ?? "" })}
            </p>
          )}
          <TooltipProvider>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tDetail("colProduct")}</TableHead>
                    <TableHead className="text-right">{tDetail("colOpening")}</TableHead>
                    <TableHead className="text-right">{tDetail("colIn")}</TableHead>
                    <TableHead className="text-right">{tDetail("colOut")}</TableHead>
                    {isSpgPos && <TableHead className="text-right">{tDetail("colPosSold")}</TableHead>}
                    <TableHead className="text-right">{tDetail("colGap")}</TableHead>
                    <TableHead className="text-right">{tDetail("colClosing")}</TableHead>
                    <TableHead className="text-right">{tDetail("colCounted")}</TableHead>
                    <TableHead className="text-right">{tDetail("colBilled")}</TableHead>
                    <TableHead className="text-right">{tDetail("colUnitPrice")}</TableHead>
                    <TableHead className="text-right">{tDetail("colLineTotal")}</TableHead>
                    <TableHead className="text-right">{tDetail("colShrinkage")}</TableHead>
                    {isSpgPos && (
                      <TableHead className={canEditResolution ? "min-w-[260px]" : "min-w-[180px]"}>{tDetail("colResolution")}</TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.lines.map((line) => {
                    const arms = resolutionArmsFor(line.gapQty);
                    const resolution = effectiveResolution(line);
                    const reason = effectiveReason(line);
                    const reasonRequired = resolution !== "" && resolutionNeedsReason(resolution);
                    const canSave = resolution !== "" && (!reasonRequired || reason.trim() !== "");
                    const suggested = isSuggested(line);
                    const saving = savingLineId === line.id;

                    return (
                      <TableRow key={line.id}>
                        <TableCell>
                          <p className="font-medium">{line.productName}</p>
                          {(line.variantLabel || line.variantSku) && (
                            <p className="text-xs text-muted-foreground font-mono">{line.variantLabel ?? line.variantSku}</p>
                          )}
                          {isDraft && line.held && (
                            <Badge variant="outline" className="mt-1 border-amber-600 text-amber-700">
                              {tDetail("heldBadge")}
                            </Badge>
                          )}
                          {line.hasLateMovements && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  className="mt-1 ml-1 inline-flex rounded-md"
                                  aria-label={tDetail("lateBadgeHint", { docNo: report.previousDocNo ?? "" })}
                                >
                                  <Badge variant="secondary">{tDetail("lateBadge")}</Badge>
                                </button>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs">
                                {tDetail("lateBadgeHint", { docNo: report.previousDocNo ?? "" })}
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{line.openingQty}</TableCell>
                        <TableCell className="text-right tabular-nums">{line.inQty}</TableCell>
                        <TableCell className="text-right tabular-nums">{line.outQty}</TableCell>
                        {isSpgPos && <TableCell className="text-right tabular-nums">{line.posSoldQty}</TableCell>}
                        <TableCell
                          className={
                            isSpgPos && line.gapQty !== 0
                              ? "text-right tabular-nums text-amber-700 font-medium"
                              : "text-right tabular-nums"
                          }
                        >
                          {line.gapQty > 0 ? `+${line.gapQty}` : line.gapQty}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{line.closingQty}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {line.countedQty === null ? <span className="text-muted-foreground">{tDetail("notCounted")}</span> : line.countedQty}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <span className="inline-flex items-center gap-1 justify-end">
                            {line.billedQty}
                            {line.negativeSold && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground" aria-label={tDetail("negativeSoldWarning")} />
                                </TooltipTrigger>
                                <TooltipContent className="max-w-xs">{tDetail("negativeSoldWarning")}</TooltipContent>
                              </Tooltip>
                            )}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums whitespace-nowrap">
                          {line.unitPrice === null ? <span className="text-muted-foreground">—</span> : formatRupiahExact(line.unitPrice)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums whitespace-nowrap">
                          {line.unitPrice === null || line.lineTotal === null
                            ? <span className="text-muted-foreground">—</span>
                            : formatRupiahExact(line.lineTotal)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{line.shrinkageQty}</TableCell>
                        {isSpgPos && !canEditResolution && (
                          <TableCell>
                            {arms.length === 0 ? (
                              <span className="text-muted-foreground">{tDetail("none")}</span>
                            ) : line.resolution ? (
                              <div className="space-y-0.5">
                                <p>{t(`resolution.${line.resolution}`)}</p>
                                {line.resolutionReason && (
                                  <p className="max-w-xs truncate text-xs text-muted-foreground" title={line.resolutionReason}>
                                    {line.resolutionReason}
                                  </p>
                                )}
                              </div>
                            ) : (
                              <div className="space-y-0.5">
                                <p className="text-muted-foreground">{tDetail("unresolved")}</p>
                                {line.suggestedResolution && (
                                  <p className="text-xs text-muted-foreground">
                                    {tDetail("suggestedLabel", { resolution: t(`resolution.${line.suggestedResolution}`) })}
                                  </p>
                                )}
                              </div>
                            )}
                          </TableCell>
                        )}
                        {canEditResolution && (
                          <TableCell>
                            {arms.length === 0 ? (
                              <span className="text-muted-foreground">{tDetail("none")}</span>
                            ) : (
                              <div className="space-y-1.5">
                                <div className="flex items-center gap-2">
                                  <Select
                                    value={resolution || "__none__"}
                                    disabled={saving}
                                    onValueChange={(v) => updateResolution(line.id, v === "__none__" ? "" : (v as SellThroughResolutionValue))}
                                  >
                                    <SelectTrigger className="h-10 w-44">
                                      <SelectValue placeholder={tDetail("resolutionPlaceholder")} />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="__none__">{tDetail("resolutionPlaceholder")}</SelectItem>
                                      {arms.map((arm) => (
                                        <SelectItem key={arm} value={arm}>
                                          {t(`resolution.${arm}`)}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  {suggested && <Badge variant="outline">{tDetail("suggestedBadge")}</Badge>}
                                </div>
                                {reasonRequired && (
                                  <Input
                                    aria-label={tDetail("resolutionReasonPlaceholder")}
                                    placeholder={tDetail("resolutionReasonPlaceholder")}
                                    className="h-10"
                                    disabled={saving}
                                    maxLength={REASON_MAX_LENGTH}
                                    value={reason}
                                    onChange={(e) => updateReason(line.id, e.target.value)}
                                  />
                                )}
                                <Button
                                  size="sm"
                                  className="h-10"
                                  disabled={!canSave || saving}
                                  onClick={() => saveLine(line)}
                                >
                                  {saving ? tDetail("saving") : tDetail("saveResolution")}
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
                {report.total !== null && (
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={totalLabelSpan} className="text-right font-medium">
                        {tDetail("total")}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums whitespace-nowrap">
                        {formatRupiahExact(report.total)}
                      </TableCell>
                      <TableCell colSpan={isSpgPos ? 2 : 1} />
                    </TableRow>
                  </TableFooter>
                )}
              </Table>
            </div>
          </TooltipProvider>
        </CardContent>
      </Card>

      {canManage && isDraft && (
        <SellThroughApproveDialog
          open={approveOpen}
          onOpenChange={setApproveOpen}
          report={report}
          salesmanCandidates={salesmanCandidates}
          onApproved={() => {
            setApproveOpen(false);
            router.refresh();
          }}
          describeError={errorMessage}
        />
      )}

      <AlertDialog open={cancelOpen} onOpenChange={(open) => !cancelling && setCancelOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tCancel("confirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{tCancel("confirmDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1">
            <Label htmlFor="sell-through-cancel-reason" className="text-xs text-muted-foreground">
              {tCancel("reasonLabel")}
            </Label>
            <Textarea
              id="sell-through-cancel-reason"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder={tCancel("reasonPlaceholder")}
              disabled={cancelling}
              maxLength={REASON_MAX_LENGTH}
              rows={3}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelling}>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={cancelling || !cancelReason.trim()}
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

      <SellThroughVoidDialog report={report} open={voidOpen} onOpenChange={setVoidOpen} describeError={errorMessage} />
    </div>
  );
}
