"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, CheckCircle2, ClipboardList, XCircle } from "lucide-react";
import type { SellThroughDetail, SellThroughLineDetail } from "@/lib/konsi-sell-through/queries";
import type { SellThroughResolutionValue } from "@/lib/konsi-sell-through/derive";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import {
  resolveSellThroughLineAction,
  approveSellThroughAction,
  cancelSellThroughAction,
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

const STATUS_BADGE_VARIANT: Record<SellThroughDetail["status"], "secondary" | "destructive" | "default"> = {
  DRAFT: "secondary",
  APPROVED: "default",
  CANCELLED: "destructive",
};

const SHORTFALL_ARMS: SellThroughResolutionValue[] = ["BILL", "SHRINKAGE"];
const SURPLUS_ARMS: SellThroughResolutionValue[] = ["BILL_POS", "REDUCE"];

function armsFor(gapQty: number): SellThroughResolutionValue[] {
  if (gapQty > 0) return SHORTFALL_ARMS;
  if (gapQty < 0) return SURPLUS_ARMS;
  return [];
}

function needsReason(resolution: SellThroughResolutionValue | ""): boolean {
  return resolution === "SHRINKAGE" || resolution === "REDUCE";
}

export function SellThroughDetailClient({
  report,
  canManage,
}: {
  report: SellThroughDetail;
  canManage: boolean;
}) {
  const t = useTranslations("konsiSellThrough");
  const tDetail = useTranslations("konsiSellThrough.detail");
  const tApprove = useTranslations("konsiSellThrough.approve");
  const tCancel = useTranslations("konsiSellThrough.cancel");
  const tCommon = useTranslations("common");
  const router = useRouter();

  const [resolutions, setResolutions] = useState<Record<string, SellThroughResolutionValue | "">>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [savingLineId, setSavingLineId] = useState<string | null>(null);
  const [, startSaveTransition] = useTransition();

  const [approveOpen, setApproveOpen] = useState(false);
  const [approving, startApproveTransition] = useTransition();

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, startCancelTransition] = useTransition();

  const isDraft = report.status === "DRAFT";
  const isSpgPos = report.method === "SPG_POS";
  const showResolutionColumn = isSpgPos && isDraft && canManage;
  const heldLines = report.lines.filter((l) => l.held);

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
    if (needsReason(resolution) && reason === "") return;

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
        toast.error(t(`err.${result.reason}`));
      } catch {
        setSavingLineId(null);
        toast.error(t("err.UNEXPECTED"));
      }
    });
  }

  function callApprove(): void {
    startApproveTransition(async () => {
      try {
        const result = await approveSellThroughAction(report.id);
        setApproveOpen(false);
        if (result.ok) {
          toast.success(tApprove("success"));
          router.refresh();
          return;
        }
        toast.error(t(`err.${result.reason}`));
      } catch {
        setApproveOpen(false);
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
        toast.error(t(`err.${result.reason}`));
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
          <Badge variant={STATUS_BADGE_VARIANT[report.status]}>{t(`status.${report.status}`)}</Badge>
        </div>
        <div className="flex items-center gap-2">
          {canManage && isDraft && (
            <Button variant="outline" className="h-10 text-destructive" disabled={cancelling} onClick={() => setCancelOpen(true)}>
              <XCircle className="h-4 w-4" />
              {tCancel("button")}
            </Button>
          )}
          {canManage && isDraft && (
            <Button className="h-10" disabled={approving || heldLines.length > 0} onClick={() => setApproveOpen(true)}>
              <CheckCircle2 className="h-4 w-4" />
              {tApprove("button")}
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
        </div>
        {report.status === "CANCELLED" && report.cancelReason && (
          <p className="text-sm text-muted-foreground">
            {tDetail("cancelReason")}: {report.cancelReason}
          </p>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            {tDetail("linesTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!isDraft && <p className="mb-3 text-sm text-muted-foreground">{tDetail("readOnlyNote")}</p>}
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
                    <TableHead className="text-right">{tDetail("colShrinkage")}</TableHead>
                    {showResolutionColumn && <TableHead className="min-w-[260px]">{tDetail("colResolution")}</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.lines.map((line) => {
                    const arms = armsFor(line.gapQty);
                    const resolution = effectiveResolution(line);
                    const reason = effectiveReason(line);
                    const reasonRequired = needsReason(resolution);
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
                        <TableCell className="text-right tabular-nums">{line.shrinkageQty}</TableCell>
                        {showResolutionColumn && (
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
              </Table>
            </div>
          </TooltipProvider>
        </CardContent>
      </Card>

      <AlertDialog open={approveOpen} onOpenChange={(open) => !approving && setApproveOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tApprove("confirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{tApprove("confirmDescription")}</AlertDialogDescription>
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
    </div>
  );
}
