"use client";

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import type { SellThroughDetail } from "@/lib/konsi-sell-through/queries";
import { dueDateFor, isInvoiceDateAllowed } from "@/lib/konsi-sell-through/invoice-dates";
import { formatDateOnlyJakarta, parseDateOnly } from "@/lib/date-only";
import { cn } from "@/lib/utils";
import { approveSellThroughAction, type SellThroughActionFailure } from "@/app/actions/konsi-sell-through";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatRupiahExact, productNamesForKeys } from "./display";

type ApproveMode = "INVOICE" | "BASELINE";

/* Mirrors the writer's cap on a baseline reason, so the input stops where the writer would refuse. */
const REASON_MAX_LENGTH = 1000;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function SellThroughApproveDialog({
  open,
  onOpenChange,
  report,
  salesmanCandidates,
  onApproved,
  describeError,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  report: SellThroughDetail;
  salesmanCandidates: Array<{ id: string; name: string }>;
  onApproved: () => void;
  describeError: (result: SellThroughActionFailure) => string;
}) {
  const t = useTranslations("konsiSellThrough");
  const tApprove = useTranslations("konsiSellThrough.approve");
  const tCommon = useTranslations("common");

  const [now] = useState(() => new Date());
  const today = formatDateOnlyJakarta(now);
  const [mode, setMode] = useState<ApproveMode>("INVOICE");
  const [invoiceDate, setInvoiceDate] = useState(today);
  const [salesmanId, setSalesmanId] = useState(() => {
    const prefill = report.defaultSalesmanId;
    return prefill !== null && salesmanCandidates.some((c) => c.id === prefill) ? prefill : "";
  });
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const salesmanOptions = useMemo(
    () => salesmanCandidates.map((c) => ({ value: c.id, label: c.name })),
    [salesmanCandidates],
  );

  /* Only a store's first report may be a baseline; the writer refuses BASELINE_NOT_FIRST otherwise. */
  const canChooseBaseline = report.previousId === null;
  const effectiveMode: ApproveMode = canChooseBaseline ? mode : "INVOICE";
  const total = report.total ?? 0;
  const hasUnpriced = report.unpricedKeys.length > 0;
  const salesmanRequired = total > 0;
  const noCandidates = salesmanCandidates.length === 0;

  const minDate = formatDateOnlyJakarta(report.periodEnd);
  const parsedInvoiceDate = DATE_ONLY_PATTERN.test(invoiceDate) ? parseDateOnly(invoiceDate) : undefined;
  const dateValid = parsedInvoiceDate !== undefined && isInvoiceDateAllowed(parsedInvoiceDate, report.periodEnd, now);

  const reasonBlank = reason.trim() === "";
  const submitDisabled =
    pending ||
    (effectiveMode === "BASELINE"
      ? reasonBlank
      : hasUnpriced || !dateValid || (salesmanRequired && salesmanId === ""));

  function handleOpenChange(next: boolean): void {
    if (pending) return;
    if (!next) setError(null);
    onOpenChange(next);
  }

  function chooseMode(next: ApproveMode): void {
    setMode(next);
    setError(null);
  }

  function submit(): void {
    if (submitDisabled) return;
    setError(null);
    const input = effectiveMode === "BASELINE"
      ? { id: report.id, mode: effectiveMode, reason: reason.trim() }
      : { id: report.id, mode: effectiveMode, invoiceDate, salesmanId: salesmanId === "" ? null : salesmanId };
    startTransition(async () => {
      try {
        const result = await approveSellThroughAction(input);
        if (result.ok) {
          toast.success(tApprove(effectiveMode === "BASELINE" ? "successBaseline" : "success"));
          onApproved();
          return;
        }
        setError(describeError(result));
      } catch {
        setError(t("err.UNEXPECTED"));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{tApprove("title")}</DialogTitle>
          <DialogDescription>
            {effectiveMode === "BASELINE" ? tApprove("baselineDescription") : tApprove("confirmDescription")}
          </DialogDescription>
        </DialogHeader>

        {canChooseBaseline && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2" role="group" aria-label={tApprove("modeLabel")}>
              <Button
                type="button"
                variant="outline"
                aria-pressed={effectiveMode === "INVOICE"}
                disabled={pending}
                onClick={() => chooseMode("INVOICE")}
                className={cn("h-10 min-w-0", effectiveMode === "INVOICE" && "border-primary bg-primary/10 text-primary")}
              >
                <span className="truncate">{tApprove("modeInvoice")}</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                aria-pressed={effectiveMode === "BASELINE"}
                disabled={pending}
                onClick={() => chooseMode("BASELINE")}
                className={cn("h-10 min-w-0", effectiveMode === "BASELINE" && "border-primary bg-primary/10 text-primary")}
              >
                <span className="truncate">{tApprove("modeBaseline")}</span>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{tApprove("modeBaselineHint")}</p>
          </div>
        )}

        {effectiveMode === "BASELINE" ? (
          <div className="space-y-1">
            <Label htmlFor="sell-through-baseline-reason" className="text-xs text-muted-foreground">
              {tApprove("baselineReason")}
            </Label>
            <Textarea
              id="sell-through-baseline-reason"
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setError(null);
              }}
              placeholder={tApprove("baselineReasonPlaceholder")}
              disabled={pending}
              maxLength={REASON_MAX_LENGTH}
              rows={3}
              required
            />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="sell-through-invoice-date" className="text-xs text-muted-foreground">
                {tApprove("invoiceDate")}
              </Label>
              <Input
                id="sell-through-invoice-date"
                type="date"
                className="h-10"
                value={invoiceDate}
                min={minDate}
                max={today}
                disabled={pending}
                aria-invalid={!dateValid}
                onChange={(e) => {
                  setInvoiceDate(e.target.value);
                  setError(null);
                }}
              />
              {dateValid && parsedInvoiceDate ? (
                <p className="text-xs text-muted-foreground">
                  {tApprove("dueDate", {
                    date: formatDateOnlyJakarta(dueDateFor(parsedInvoiceDate, report.storePaymentTempo)),
                    n: report.storePaymentTempo,
                  })}
                </p>
              ) : (
                <p className="text-xs text-destructive">{tApprove("invoiceDateInvalid", { min: minDate, max: today })}</p>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor="sell-through-salesman" className="text-xs text-muted-foreground">
                {salesmanRequired ? tApprove("salesman") : `${tApprove("salesman")} ${tApprove("salesmanOptional")}`}
              </Label>
              <SearchableCombobox
                id="sell-through-salesman"
                options={salesmanOptions}
                value={salesmanId}
                disabled={pending || noCandidates}
                onValueChange={(v) => {
                  setSalesmanId(v);
                  setError(null);
                }}
                placeholder={tApprove("salesmanPlaceholder")}
                searchPlaceholder={tApprove("salesmanSearchPlaceholder")}
                emptyMessage={tApprove("salesmanEmpty")}
                triggerClassName="h-10 w-full"
              />
              {noCandidates ? (
                <p className={cn("text-xs", salesmanRequired ? "text-destructive" : "text-muted-foreground")}>
                  {tApprove("salesmanNoCandidates")}
                </p>
              ) : (
                salesmanRequired && salesmanId === "" && (
                  <p className="text-xs text-muted-foreground">{tApprove("salesmanRequiredHint")}</p>
                )
              )}
            </div>

            <div className="flex items-baseline justify-between gap-4 rounded-md border px-3 py-2">
              <span className="text-sm text-muted-foreground">{tApprove("total")}</span>
              <span className="text-base font-semibold tabular-nums">
                {report.total === null ? "—" : formatRupiahExact(report.total)}
              </span>
            </div>

            {hasUnpriced && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p className="min-w-0 break-words">
                  {tApprove("unpriced", {
                    products: productNamesForKeys(report.lines, report.unpricedKeys),
                    n: report.unpricedKeys.length,
                  })}
                </p>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" className="h-10" disabled={pending} onClick={() => handleOpenChange(false)}>
            {tCommon("cancel")}
          </Button>
          <Button type="button" className="h-10" disabled={submitDisabled} onClick={submit}>
            {pending
              ? tApprove("submitting")
              : effectiveMode === "BASELINE"
                ? tApprove("confirmBaselineAction")
                : tApprove("confirmAction")}
          </Button>
        </DialogFooter>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
