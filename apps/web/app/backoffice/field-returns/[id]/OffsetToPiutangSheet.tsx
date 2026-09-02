"use client";

import { useLayoutEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Wallet } from "lucide-react";
import { roundCents } from "@elorae/db/pricing";
import { applyReturnOffsetAction } from "@/app/actions/payments";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AllocationCandidate } from "@/lib/finance/ar/queries";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnId: string;
  totalValue: number;
  candidates: AllocationCandidate[];
  suggestedAllocations: Array<{ receivableId: string; amount: number }>;
  onApplied: () => void;
};

function roundedAmount(raw: string): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? roundCents(parsed) : 0;
}

function formatRupiahExact(value: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency", currency: "IDR", minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Mirrors RecordPaymentSheet's allocation-table shape rather than reusing the component: the
 * amount here is FIXED at totalValue and not editable (the offset is all-or-nothing), and there
 * is no method picker, no proof upload, no reference field — three subtractive differences deep
 * enough into that component's ~400 lines that reusing it would mean conditionally stripping most
 * of its JSX. This is a fresh sibling instead, matching the repo's own preference for small,
 * focused files over one component branching on a mode prop.
 */
export function OffsetToPiutangSheet({
  open, onOpenChange, returnId, totalValue, candidates, suggestedAllocations, onApplied,
}: Props) {
  const t = useTranslations("fieldReturns");
  const tCommon = useTranslations("common");
  const tPayments = useTranslations("payments");
  const [isPending, startTransition] = useTransition();
  const [allocationInputs, setAllocationInputs] = useState<Record<string, string>>({});

  useLayoutEffect(() => {
    if (!open) return;
    const seeded: Record<string, string> = {};
    for (const c of candidates) {
      const suggestion = suggestedAllocations.find((s) => s.receivableId === c.id);
      seeded[c.id] = suggestion ? suggestion.amount.toFixed(2) : "";
    }
    setAllocationInputs(seeded);
    /* eslint-disable-next-line react-hooks/exhaustive-deps -- seed once per open */
  }, [open]);

  const allocationRows = candidates.map((c) => {
    const amount = roundedAmount(allocationInputs[c.id] ?? "");
    return { ...c, amount, negative: amount < 0, overAllocated: amount > c.outstandingAmount + 0.005 };
  });
  const activeAllocations = allocationRows
    .filter((r) => r.amount > 0)
    .map((r) => ({ receivableId: r.id, amount: r.amount }));
  const allocatedTotal = roundCents(activeAllocations.reduce((sum, a) => sum + a.amount, 0));
  const mismatch = Math.abs(allocatedTotal - totalValue) > 0.005;
  const totalCandidateOutstanding = roundCents(candidates.reduce((sum, c) => sum + c.outstandingAmount, 0));
  const insufficientOutstanding = totalCandidateOutstanding + 0.005 < totalValue;
  const hasInvalidRow = allocationRows.some((r) => r.negative || r.overAllocated);
  const canSubmit = !insufficientOutstanding && !mismatch && activeAllocations.length > 0 && !hasInvalidRow && !isPending;

  function setAllocation(candidateId: string, raw: string): void {
    setAllocationInputs((prev) => ({ ...prev, [candidateId]: raw }));
  }

  function allocateFull(candidate: AllocationCandidate): void {
    setAllocation(candidate.id, candidate.outstandingAmount.toFixed(2));
  }

  function submit(): void {
    if (!canSubmit) return;
    startTransition(async () => {
      try {
        const result = await applyReturnOffsetAction({ returnId, allocations: activeAllocations });
        if (result.ok) {
          toast.success(t("credit.offsetSuccessToast"));
          onApplied();
          return;
        }
        toast.error(tPayments(`err.${result.reason}`));
      } catch {
        toast.error(tPayments("err.ERROR"));
      }
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex h-full w-full flex-col gap-0 p-0 sm:max-w-2xl">
        <SheetHeader className="border-b pb-3">
          <SheetTitle>{t("credit.offsetSheetTitle")}</SheetTitle>
          <SheetDescription>
            {t("credit.offsetSheetDescription", { amount: formatRupiahExact(totalValue) })}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          {insufficientOutstanding ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {t("credit.insufficientOutstanding", {
                total: formatRupiahExact(totalCandidateOutstanding),
                needed: formatRupiahExact(totalValue),
              })}
            </div>
          ) : candidates.length === 0 ? (
            <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              {t("credit.noCandidates")}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("colDocNo")}</TableHead>
                    <TableHead>{t("credit.colDueDate")}</TableHead>
                    <TableHead className="text-right">{t("credit.colOutstanding")}</TableHead>
                    <TableHead className="text-right">{t("credit.colAllocation")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allocationRows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="max-w-[120px] truncate whitespace-nowrap font-mono text-xs">{row.docNo}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatDateOnlyJakarta(row.dueDate)}</TableCell>
                      <TableCell className="text-right tabular-nums whitespace-nowrap">
                        {formatRupiahExact(row.outstandingAmount)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-col items-end gap-1">
                          <div className="flex items-center justify-end gap-1.5">
                            <Input
                              type="number" inputMode="decimal" step="0.01" min="0"
                              className="h-10 w-28 text-right"
                              disabled={isPending}
                              value={allocationInputs[row.id] ?? ""}
                              onChange={(e) => setAllocation(row.id, e.target.value)}
                              onBlur={() => setAllocation(row.id, row.amount !== 0 ? row.amount.toFixed(2) : "")}
                              aria-invalid={row.negative || row.overAllocated}
                            />
                            <Button type="button" variant="outline" size="sm" className="h-10" disabled={isPending} onClick={() => allocateFull(row)}>
                              {t("credit.allocateFull")}
                            </Button>
                          </div>
                          {row.negative && <p className="text-xs text-destructive">{t("credit.negativeAmount")}</p>}
                          {!row.negative && row.overAllocated && <p className="text-xs text-destructive">{t("credit.overAllocated")}</p>}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {!insufficientOutstanding && (
            <div className="flex items-center justify-between rounded-md border p-3 text-sm">
              <span className="text-muted-foreground">{t("credit.runningTotalLabel")}</span>
              <span className={cn("font-medium tabular-nums", mismatch && "text-destructive")}>
                {formatRupiahExact(allocatedTotal)} / {formatRupiahExact(totalValue)}
              </span>
            </div>
          )}
        </div>

        <SheetFooter className="flex-row gap-2 border-t pt-3">
          <Button type="button" variant="outline" className="h-11 flex-1" disabled={isPending} onClick={() => onOpenChange(false)}>
            {tCommon("cancel")}
          </Button>
          <Button type="button" className="h-11 flex-1" disabled={!canSubmit} onClick={submit}>
            {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isPending ? t("credit.submitting") : t("credit.offsetAction")}
            {!isPending && <Wallet className="h-4 w-4 ml-2" />}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
