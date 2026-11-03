"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import type { SellThroughDetail } from "@/lib/konsi-sell-through/queries";
import { cn } from "@/lib/utils";
import { approveSellThroughAction, type SellThroughActionFailure } from "@/app/actions/konsi-sell-through";
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

/*
 * RECORD freezes the report's sold figures and bills nothing; BASELINE (a store's first report
 * only) freezes them with a reason. INVOICE is no longer offered: since decision 2026-10-29 konsi
 * bills come from that month's consignment cycle, and the action refuses INVOICING_RETIRED.
 */
type ApproveMode = "RECORD" | "BASELINE";

/* Mirrors the writer's cap on a baseline reason, so the input stops where the writer would refuse. */
const REASON_MAX_LENGTH = 1000;

export function SellThroughApproveDialog({
  open,
  onOpenChange,
  report,
  onApproved,
  describeError,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  report: SellThroughDetail;
  onApproved: () => void;
  describeError: (result: SellThroughActionFailure) => string;
}) {
  const t = useTranslations("konsiSellThrough");
  const tApprove = useTranslations("konsiSellThrough.approve");
  const tCommon = useTranslations("common");

  const [mode, setMode] = useState<ApproveMode>("RECORD");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /* Only a store's first report may be a baseline; the writer refuses BASELINE_NOT_FIRST otherwise. */
  const canChooseBaseline = report.previousId === null;
  const effectiveMode: ApproveMode = canChooseBaseline ? mode : "RECORD";
  const reasonBlank = reason.trim() === "";
  const submitDisabled = pending || (effectiveMode === "BASELINE" && reasonBlank);

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
    const input =
      effectiveMode === "BASELINE"
        ? { id: report.id, mode: effectiveMode, reason: reason.trim() }
        : { id: report.id, mode: effectiveMode };
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
            {effectiveMode === "BASELINE" ? tApprove("baselineDescription") : tApprove("recordDescription")}
          </DialogDescription>
        </DialogHeader>

        {canChooseBaseline && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2" role="group" aria-label={tApprove("modeLabel")}>
              <Button
                type="button"
                variant="outline"
                aria-pressed={effectiveMode === "RECORD"}
                disabled={pending}
                onClick={() => chooseMode("RECORD")}
                className={cn("h-10 min-w-0", effectiveMode === "RECORD" && "border-primary bg-primary/10 text-primary")}
              >
                <span className="truncate">{tApprove("modeRecord")}</span>
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
        ) : null}

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
