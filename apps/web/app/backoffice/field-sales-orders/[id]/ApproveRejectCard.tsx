"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import type { FieldSalesOrderStatus, FieldSalesOrderType } from "@/lib/field-sales/queries";
import {
  approveFieldSalesOrderAction,
  rejectFieldSalesOrderAction,
  type ActionResult,
} from "@/app/actions/field-sales-orders";
import type { StagedAddition } from "./KonsiSuggestionsCard";

export type AppealedLine = {
  id: string;
  productName: string;
  variantLabel: string | null;
  variantSku: string;
  unitPrice: number;
  requestedUnitPrice: number;
  appealReason: string | null;
};

/**
 * Enough to name a line by (itemId, variantSku) — the writer's `ShortLine` on an
 * `INSUFFICIENT_STOCK` failure carries only that pair plus `available`, no name or SKU.
 */
export type LineRef = {
  itemId: string;
  variantSku: string;
  productName: string;
  variantLabel: string | null;
};

type Props = {
  orderId: string;
  status: FieldSalesOrderStatus;
  canApprove: boolean;
  orderType: FieldSalesOrderType;
  appealedLines: AppealedLine[];
  orderLines: LineRef[];
  stagedAdditions: StagedAddition[];
  onStagedAdditionsChange: (staged: StagedAddition[]) => void;
  creditCheck: { exposure: number; limit: number; overLimit: boolean } | null;
  creditHoldAtCreate: boolean;
};

function formatRupiah(value: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}

function lineDisplayName(ref: Pick<LineRef, "productName" | "variantLabel">): string {
  return ref.variantLabel ? `${ref.productName} (${ref.variantLabel})` : ref.productName;
}

export function ApproveRejectCard({
  orderId,
  status,
  canApprove,
  orderType,
  appealedLines,
  orderLines,
  stagedAdditions,
  onStagedAdditionsChange,
  creditCheck,
  creditHoldAtCreate,
}: Props) {
  const t = useTranslations("fieldSalesOrders");
  const tCommon = useTranslations("common");
  const [isPending, startTransition] = useTransition();
  const [approveDialogOpen, setApproveDialogOpen] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [finalPriceInputs, setFinalPriceInputs] = useState<Record<string, string>>({});
  const [creditReason, setCreditReason] = useState("");
  /**
   * Set from the WRITER's own live figures when a CREDIT_LIMIT_EXCEEDED refusal arrives —
   * authoritative, and the only way to recover when the page-load `creditCheck` preview is stale
   * (e.g. an appealed-line final price pushed the order over limit after the preview was
   * computed) or absent.
   */
  const [serverCreditRefusal, setServerCreditRefusal] = useState<{ exposure: number; limit: number } | null>(null);

  if (!canApprove || status !== "PENDING_APPROVAL") return null;

  const hasAppeals = appealedLines.length > 0;

  function openApproveDialog(): void {
    setFinalPriceInputs(
      Object.fromEntries(appealedLines.map((l) => [l.id, String(l.requestedUnitPrice)])),
    );
    setApproveDialogOpen(true);
  }

  const finalPricesValid = appealedLines.every((l) => {
    const raw = finalPriceInputs[l.id];
    if (raw === undefined || raw.trim() === "") return false;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0;
  });

  /**
   * A short line only ever refers to one of the order's own lines or one of this session's
   * staged additions — the writer never reserves against anything else — so both sources
   * together should always resolve a name. Falls back to the raw pair on the defensive path.
   */
  function shortLineNames(shortLines: Array<{ itemId: string; variantSku: string; available: number }>): string {
    return shortLines
      .map((s) => {
        const fromOrder = orderLines.find((l) => l.itemId === s.itemId && l.variantSku === s.variantSku);
        if (fromOrder) return lineDisplayName(fromOrder);
        const fromStaged = stagedAdditions.find((a) => a.itemId === s.itemId && a.variantSku === s.variantSku);
        if (fromStaged) return lineDisplayName({ productName: fromStaged.name, variantLabel: fromStaged.variantLabel });
        return s.variantSku ? `${s.itemId} (${s.variantSku})` : s.itemId;
      })
      .join(", ");
  }

  function handleResult(r: ActionResult, successMessage: string): void {
    if (r.ok) {
      toast.success(successMessage);
      setApproveDialogOpen(false);
      setRejectDialogOpen(false);
      setRejectReason("");
      setCreditReason("");
      setServerCreditRefusal(null);
      onStagedAdditionsChange([]);
    } else if (r.reason === "FORBIDDEN") {
      toast.error(t("errForbidden"));
    } else if (r.reason === "INVALID_TRANSITION") {
      toast.error(t("errAlreadyDecided"));
    } else if (r.reason === "INSUFFICIENT_STOCK") {
      const lines = r.shortLines && r.shortLines.length > 0 ? shortLineNames(r.shortLines) : "—";
      /* The remedy is to edit the suggestions panel this modal covers — get out of the way. */
      setApproveDialogOpen(false);
      toast.error(
        stagedAdditions.length > 0
          ? t("konsiSuggestions.errInsufficientStockWithAdditions", { lines })
          : t("konsiSuggestions.errInsufficientStockNoAdditions", { lines }),
      );
    } else if (r.reason === "INVALID_ADDED_LINE") {
      switch (r.addedLineCode) {
        case "UNKNOWN_ITEM":
          toast.error(t("konsiSuggestions.errInvalidAddedLineUnknownItem"));
          break;
        case "NO_INVENTORY":
          toast.error(t("konsiSuggestions.errInvalidAddedLineNoInventory"));
          break;
        case "BAD_QTY":
          toast.error(t("konsiSuggestions.errInvalidAddedLineBadQty"));
          break;
        case "DUPLICATE":
          toast.error(t("konsiSuggestions.errInvalidAddedLineDuplicate"));
          break;
        case "ALREADY_SENT":
          /* Same as the short-stock case: the staged row has to be removed, and it is behind
           * this modal. */
          setApproveDialogOpen(false);
          toast.error(t("konsiSuggestions.errInvalidAddedLineAlreadySent"));
          break;
        case "NOT_KONSI":
          toast.error(t("konsiSuggestions.errInvalidAddedLineNotKonsi"));
          break;
        case undefined:
          /* No code means the ACTION rejected the payload shape before the writer ever ran — a
           * client-side bug, not a stale suggestion list, so "reload the page" is the wrong hint. */
          toast.error(t("konsiSuggestions.errInvalidAddedLinePayload"));
          break;
        default:
          toast.error(t("konsiSuggestions.errInvalidAddedLineGeneric"));
      }
    } else if (r.reason === "INVALID_FINAL_PRICE") {
      toast.error(t("errInvalidFinalPrice"));
    } else if (r.reason === "CREDIT_LIMIT_EXCEEDED") {
      setServerCreditRefusal({ exposure: r.credit?.exposure.total ?? 0, limit: r.credit?.creditLimit ?? 0 });
      toast.error(t("creditLimitExceeded", { exposure: formatRupiah(r.credit?.exposure.total ?? 0), limit: formatRupiah(r.credit?.creditLimit ?? 0) }));
    } else {
      toast.error(t("errNotFound"));
    }
  }

  function callApprove(): void {
    if (!finalPricesValid) return;
    const finalPrices = hasAppeals
      ? appealedLines.map((l) => ({ lineId: l.id, finalUnitPrice: Number(finalPriceInputs[l.id]) }))
      : undefined;
    const addedLines =
      stagedAdditions.length > 0
        ? stagedAdditions.map(({ itemId, variantSku, qty }) => ({ itemId, variantSku, qty }))
        : undefined;
    startTransition(async () => {
      try {
        const r = await approveFieldSalesOrderAction(orderId, finalPrices, addedLines, creditReason.trim() || undefined);
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
        <Button disabled={isPending} onClick={openApproveDialog}>
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

      <AlertDialog
        open={approveDialogOpen}
        onOpenChange={(open) => {
          setApproveDialogOpen(open);
          if (!open) {
            setCreditReason("");
            setServerCreditRefusal(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("approve")}</AlertDialogTitle>
            <AlertDialogDescription>
              {orderType === "KONSI" ? t("approveConfirmKonsi") : t("approveConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {hasAppeals && (
            <div className="space-y-3 max-h-72 overflow-y-auto rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
              <p className="text-xs font-medium text-amber-700">{t("appealSetFinalPriceHint")}</p>
              {appealedLines.map((line) => (
                <div key={line.id} className="space-y-1.5 border-t border-amber-500/20 pt-2 first:border-t-0 first:pt-0">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {line.productName}
                    {line.variantLabel && (
                      <span className="font-normal text-muted-foreground">({line.variantLabel})</span>
                    )}
                    <Badge variant="outline" className="border-amber-500/40 text-amber-700">
                      {t("appealBadge")}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                    <span>
                      {t("appealStorePrice")}: <span className="tabular-nums">{formatRupiah(line.unitPrice)}</span>
                    </span>
                    <span>
                      {t("appealRequestedPrice")}: <span className="tabular-nums">{formatRupiah(line.requestedUnitPrice)}</span>
                    </span>
                  </div>
                  {line.appealReason && (
                    <p className="text-xs text-muted-foreground italic">
                      {t("appealReasonLabel")}: {line.appealReason}
                    </p>
                  )}
                  <div className="space-y-1">
                    <Label htmlFor={`final-price-${line.id}`} className="text-xs">
                      {t("appealFinalPriceLabel")}
                    </Label>
                    <Input
                      id={`final-price-${line.id}`}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      disabled={isPending}
                      value={finalPriceInputs[line.id] ?? ""}
                      onChange={(e) =>
                        setFinalPriceInputs((prev) => ({ ...prev, [line.id]: e.target.value }))
                      }
                      className="h-10"
                    />
                  </div>
                </div>
              ))}
              {!finalPricesValid && (
                <p className="text-xs text-destructive">{t("appealFinalPriceInvalid")}</p>
              )}
            </div>
          )}

          {stagedAdditions.length > 0 && (
            <p className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-700">
              {t("konsiSuggestions.approveSummary", { count: stagedAdditions.length })}
            </p>
          )}

          {(creditCheck?.overLimit || serverCreditRefusal) && (
            <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
              <p className="text-sm font-medium text-destructive">{t("creditOverLimitTitle")}</p>
              <p className="text-xs text-muted-foreground">
                {t("creditOverLimitDetail", {
                  exposure: formatRupiah(serverCreditRefusal?.exposure ?? creditCheck?.exposure ?? 0),
                  limit: formatRupiah(serverCreditRefusal?.limit ?? creditCheck?.limit ?? 0),
                })}
              </p>
              <div className="space-y-1">
                <Label htmlFor="credit-override-reason" className="text-xs">{t("creditOverrideReasonLabel")}</Label>
                <Textarea
                  id="credit-override-reason"
                  value={creditReason}
                  onChange={(e) => setCreditReason(e.target.value)}
                  disabled={isPending}
                  rows={2}
                />
              </div>
            </div>
          )}
          {!creditCheck?.overLimit && creditHoldAtCreate && (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700">
              {t("creditWasOverLimitNote")}
            </p>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending || (hasAppeals && !finalPricesValid) || ((!!creditCheck?.overLimit || !!serverCreditRefusal) && !creditReason.trim())}
              onClick={callApprove}
            >
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
            <AlertDialogDescription>
              {orderType === "KONSI" ? t("rejectConfirmKonsi") : t("rejectConfirm")}
            </AlertDialogDescription>
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
