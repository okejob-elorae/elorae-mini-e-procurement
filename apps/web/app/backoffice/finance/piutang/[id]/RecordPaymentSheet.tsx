"use client";

import { useLayoutEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Wallet } from "lucide-react";
import { roundCents } from "@elorae/db/pricing";
import { recordPaymentAction } from "@/app/actions/payments";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

export type AllocationCandidate = {
  id: string;
  docNo: string;
  dueDate: Date;
  outstandingAmount: number;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storeId: string;
  storeName: string;
  receivableId: string;
  candidates: AllocationCandidate[];
  onRecorded: () => void;
};

type ProofState =
  | { status: "idle"; file: File | null }
  | { status: "uploading"; file: File }
  | { status: "uploaded"; file: File; url: string; key: string }
  | { status: "error"; file: File };

/**
 * Amounts are Decimal(15,2). Rounding half-up to 2dp here mirrors the writer's own normalisation
 * exactly (`roundCents` in `payment-writer.ts`), so what the running total shows is what the
 * writer will actually compare — never a display value that later gets silently reinterpreted at
 * a different precision.
 */
function roundedAmount(raw: string): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? roundCents(parsed) : 0;
}

function formatRupiahExact(value: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function RecordPaymentSheet({
  open,
  onOpenChange,
  storeId,
  storeName,
  receivableId,
  candidates,
  onRecorded,
}: Props) {
  const t = useTranslations("piutang");
  const tPayments = useTranslations("payments");
  const tCommon = useTranslations("common");
  const [isPending, startTransition] = useTransition();

  const [paidAt, setPaidAt] = useState("");
  const [method, setMethod] = useState<"CASH" | "TRANSFER">("CASH");
  const [amountInput, setAmountInput] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [allocationInputs, setAllocationInputs] = useState<Record<string, string>>({});
  const [proof, setProof] = useState<ProofState>({ status: "idle", file: null });
  const [idempotencyKey, setIdempotencyKey] = useState("");

  /**
   * Seeded once per open, not on every parent render — a re-render while the operator is mid-type
   * (e.g. the store's other data revalidating in the background) must not wipe what they already
   * entered. The current receivable's row is pre-filled to its full outstanding, matching the
   * primary-action affordance the sheet was opened from.
   *
   * `useLayoutEffect`, not `useEffect`: the seed has to land before the browser paints the frame
   * where the sheet becomes visible, or the operator sees a flash of the previous (usually empty,
   * on first-ever open) state — including `amountRequired`/`paidAtRequired` in red — before it
   * fills in a moment later.
   */
  useLayoutEffect(() => {
    if (!open) return;
    const seeded: Record<string, string> = {};
    for (const c of candidates) {
      seeded[c.id] = c.id === receivableId ? c.outstandingAmount.toFixed(2) : "";
    }
    setAllocationInputs(seeded);
    const current = candidates.find((c) => c.id === receivableId);
    setAmountInput(current ? current.outstandingAmount.toFixed(2) : "");
    setPaidAt(formatDateOnlyJakarta(new Date()));
    setMethod("CASH");
    setReference("");
    setNote("");
    setProof({ status: "idle", file: null });
    setIdempotencyKey(crypto.randomUUID());
    /* eslint-disable-next-line react-hooks/exhaustive-deps -- seed once per open */
  }, [open]);

  const parsedAmount = roundedAmount(amountInput);
  /**
   * `negative`/`overAllocated` are computed per row so the table can point at the exact row
   * responsible, rather than leaving the operator to hunt for it across every row once the
   * writer's own guard rejects the request. `overAllocated` uses the same 0.005 slack as
   * `mismatch` below — both sides are already rounded to 2dp, so a real over-allocation is always
   * at least a full cent past the outstanding balance.
   */
  const allocationRows = candidates.map((c) => {
    const amount = roundedAmount(allocationInputs[c.id] ?? "");
    return {
      ...c,
      amount,
      negative: amount < 0,
      overAllocated: amount > c.outstandingAmount + 0.005,
    };
  });
  /**
   * The payload only ever carries positive amounts (`recordPaymentAction`'s allocations array),
   * so the displayed running total is summed from that same filtered set — never from every row —
   * or a negative "netting off" entry could make the panel read "matched" for a payload the
   * writer will reject as `ALLOCATION_MISMATCH`, with nothing on screen pointing at the row that
   * caused it.
   */
  const activeAllocations = allocationRows
    .filter((r) => r.amount > 0)
    .map((r) => ({ receivableId: r.id, amount: r.amount }));
  const allocatedTotal = roundCents(activeAllocations.reduce((sum, a) => sum + a.amount, 0));
  const mismatch = Math.abs(allocatedTotal - parsedAmount) > 0.005;
  const totalCandidateOutstanding = roundCents(candidates.reduce((sum, c) => sum + c.outstandingAmount, 0));
  const amountExceedsCapacity = parsedAmount > totalCandidateOutstanding + 0.005;

  const amountValid = parsedAmount > 0;
  const paidAtValid = /^\d{4}-\d{2}-\d{2}$/.test(paidAt);
  const hasAllocations = activeAllocations.length > 0;
  const hasInvalidRow = allocationRows.some((r) => r.negative || r.overAllocated);
  const proofBusy = proof.status === "uploading";
  const canSubmit =
    amountValid && paidAtValid && hasAllocations && !mismatch && !hasInvalidRow && !proofBusy && !isPending;

  function setAllocation(candidateId: string, raw: string): void {
    setAllocationInputs((prev) => ({ ...prev, [candidateId]: raw }));
  }

  function allocateFull(candidate: AllocationCandidate): void {
    setAllocation(candidate.id, candidate.outstandingAmount.toFixed(2));
  }

  /**
   * Oldest-due-first, independent of whatever order `candidates` arrived in — the caller sorts
   * for display, but this helper's own contract should not silently depend on that.
   */
  function fillFromOldest(): void {
    const ordered = [...candidates].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
    let remaining = parsedAmount;
    const next: Record<string, string> = {};
    for (const c of ordered) {
      const alloc = remaining > 0 ? roundCents(Math.min(remaining, c.outstandingAmount)) : 0;
      next[c.id] = alloc > 0 ? alloc.toFixed(2) : "0.00";
      remaining = roundCents(Math.max(0, remaining - alloc));
    }
    setAllocationInputs(next);
  }

  function handleFileChange(file: File | null): void {
    setProof({ status: "idle", file });
  }

  async function uploadProof(): Promise<void> {
    if (proof.status === "uploading" || proof.status === "uploaded" || !proof.file) return;
    const file = proof.file;
    setProof({ status: "uploading", file });
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload/payment-proof", { method: "POST", body: formData });
      if (!res.ok) throw new Error("upload failed");
      const data = (await res.json()) as { url: string; key: string };
      setProof({ status: "uploaded", file, url: data.url, key: data.key });
    } catch {
      setProof({ status: "error", file });
      toast.error(t("paymentSheet.proofUploadError"));
    }
  }

  function submit(): void {
    if (!canSubmit) return;
    startTransition(async () => {
      try {
        const result = await recordPaymentAction({
          storeId,
          paidAt,
          method,
          amount: parsedAmount,
          allocations: activeAllocations,
          reference: reference.trim() || undefined,
          note: note.trim() || undefined,
          proofUrl: proof.status === "uploaded" ? proof.url : undefined,
          proofR2Key: proof.status === "uploaded" ? proof.key : undefined,
          idempotencyKey,
        });
        if (result.ok) {
          toast.success(t("paymentSheet.successToast", { docNo: result.docNo ?? "" }));
          /* Rotate before closing so a reopen can never replay the payment that just succeeded. */
          setIdempotencyKey(crypto.randomUUID());
          onRecorded();
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
          <SheetTitle>{t("recordPaymentAction")}</SheetTitle>
          <SheetDescription>{t("paymentSheet.description", { store: storeName })}</SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="payment-paid-at">{t("paymentSheet.paidAtLabel")}</Label>
              <Input
                id="payment-paid-at"
                type="date"
                className="h-10"
                value={paidAt}
                disabled={isPending}
                onChange={(e) => setPaidAt(e.target.value)}
                aria-invalid={!paidAtValid}
              />
              {!paidAtValid && (
                <p className="text-xs text-destructive">{t("paymentSheet.paidAtRequired")}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="payment-method">{t("paymentSheet.methodLabel")}</Label>
              <Select value={method} onValueChange={(v) => setMethod(v as "CASH" | "TRANSFER")} disabled={isPending}>
                <SelectTrigger id="payment-method" className="h-10 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CASH">{t("methodCash")}</SelectItem>
                  <SelectItem value="TRANSFER">{t("methodTransfer")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="payment-amount">{t("paymentSheet.amountLabel")}</Label>
            <Input
              id="payment-amount"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              className="h-10"
              value={amountInput}
              disabled={isPending}
              onChange={(e) => setAmountInput(e.target.value)}
              onBlur={() => setAmountInput(parsedAmount > 0 ? parsedAmount.toFixed(2) : "")}
              aria-invalid={!amountValid}
            />
            {!amountValid && (
              <p className="text-xs text-destructive">{t("paymentSheet.amountRequired")}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="payment-reference">{t("paymentSheet.referenceLabel")}</Label>
            <Input
              id="payment-reference"
              className="h-10"
              maxLength={100}
              value={reference}
              disabled={isPending}
              onChange={(e) => setReference(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="payment-note">{t("paymentSheet.noteLabel")}</Label>
            <Textarea
              id="payment-note"
              rows={2}
              maxLength={500}
              value={note}
              disabled={isPending}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="payment-proof">{t("paymentSheet.proofLabel")}</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id="payment-proof"
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                className="h-10 flex-1"
                disabled={isPending || proofBusy}
                onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
              />
              <Button
                type="button"
                variant="outline"
                className="h-10"
                disabled={!proof.file || proof.status === "uploading" || proof.status === "uploaded" || isPending}
                onClick={uploadProof}
              >
                {proofBusy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {proofBusy ? t("paymentSheet.proofUploading") : t("paymentSheet.proofUploadButton")}
              </Button>
            </div>
            {proof.status === "uploaded" && (
              <p className="text-xs text-muted-foreground">
                {t("paymentSheet.proofUploaded", { name: proof.file.name })}
              </p>
            )}
            {proof.status === "idle" && proof.file && (
              <p className="text-xs text-muted-foreground">{t("paymentSheet.proofNotUploadedHint")}</p>
            )}
            {proof.status === "error" && (
              <p className="text-xs text-destructive">{t("paymentSheet.proofUploadError")}</p>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">{t("paymentSheet.allocationTitle")}</h3>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-10"
                disabled={isPending || candidates.length === 0 || parsedAmount <= 0}
                onClick={fillFromOldest}
              >
                {t("paymentSheet.fillFromOldest")}
              </Button>
            </div>

            {candidates.length === 0 ? (
              <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                {t("paymentSheet.allocationEmpty")}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("colDocNo")}</TableHead>
                      <TableHead>{t("colDueDate")}</TableHead>
                      <TableHead className="text-right">{t("colOutstanding")}</TableHead>
                      <TableHead className="text-right">{t("paymentSheet.colAllocation")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allocationRows.map((row) => (
                      <TableRow key={row.id} className={cn(row.id === receivableId && "bg-muted/40")}>
                        <TableCell className="max-w-[120px] truncate whitespace-nowrap font-mono text-xs">
                          {row.docNo}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{formatDateOnlyJakarta(row.dueDate)}</TableCell>
                        <TableCell className="text-right tabular-nums whitespace-nowrap">
                          {formatRupiahExact(row.outstandingAmount)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex flex-col items-end gap-1">
                            <div className="flex items-center justify-end gap-1.5">
                              <Input
                                type="number"
                                inputMode="decimal"
                                step="0.01"
                                min="0"
                                className="h-10 w-28 text-right"
                                disabled={isPending}
                                value={allocationInputs[row.id] ?? ""}
                                onChange={(e) => setAllocation(row.id, e.target.value)}
                                onBlur={() => setAllocation(row.id, row.amount !== 0 ? row.amount.toFixed(2) : "")}
                                aria-invalid={row.negative || row.overAllocated}
                              />
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-10"
                                disabled={isPending}
                                onClick={() => allocateFull(row)}
                              >
                                {t("paymentSheet.allocateFull")}
                              </Button>
                            </div>
                            {row.negative && (
                              <p className="text-xs text-destructive">{t("paymentSheet.negativeAmount")}</p>
                            )}
                            {!row.negative && row.overAllocated && (
                              <p className="text-xs text-destructive">{t("paymentSheet.overAllocated")}</p>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            <div className="flex items-center justify-between rounded-md border p-3 text-sm">
              <span className="text-muted-foreground">{t("paymentSheet.runningTotalLabel")}</span>
              <span className={cn("font-medium tabular-nums", mismatch && "text-destructive")}>
                {formatRupiahExact(allocatedTotal)} / {formatRupiahExact(parsedAmount)}
              </span>
            </div>
            {mismatch && amountExceedsCapacity && (
              <p className="text-xs text-destructive">
                {t("paymentSheet.amountExceedsOutstanding", {
                  total: formatRupiahExact(totalCandidateOutstanding),
                })}
              </p>
            )}
            {mismatch && !amountExceedsCapacity && (
              <p className="text-xs text-destructive">
                {t("paymentSheet.mismatchError", {
                  allocated: formatRupiahExact(allocatedTotal),
                  amount: formatRupiahExact(parsedAmount),
                })}
              </p>
            )}
            {candidates.length > 0 && !hasAllocations && (
              <p className="text-xs text-destructive">{t("paymentSheet.noAllocations")}</p>
            )}
          </div>
        </div>

        <SheetFooter className="flex-row gap-2 border-t pt-3">
          <Button
            type="button"
            variant="outline"
            className="h-11 flex-1"
            disabled={isPending}
            onClick={() => onOpenChange(false)}
          >
            {tCommon("cancel")}
          </Button>
          <Button type="button" className="h-11 flex-1" disabled={!canSubmit} onClick={submit}>
            {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isPending ? t("paymentSheet.submitting") : t("recordPaymentAction")}
            {!isPending && <Wallet className="h-4 w-4 ml-2" />}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
