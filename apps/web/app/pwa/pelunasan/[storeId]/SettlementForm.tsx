"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2, Loader2, Plus, X } from "lucide-react";
import { roundCents } from "@elorae/db/pricing";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { computeSettlementTotals, computeVariance, type SettlementDeductionInput } from "@/lib/finance/ar-settlement/calc";
import {
  submitStoreSettlementAction,
  type SettlementActionReason,
  type StoreSettlementDeductionInput,
} from "@/app/actions/store-settlements";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export type SettlementInvoiceRow = {
  receivableId: string;
  docNo: string;
  dueDateIso: string;
  outstandingAmount: number;
  daysOverdue: number;
  pendingSubmittedAmount: number;
  reservedAmount: number;
};

export type SettlementOffsettableReturn = {
  fieldReturnId: string;
  docNo: string;
  remainingValue: number;
  reservedAmount: number;
};

type Props = {
  storeId: string;
  storeName: string;
  invoices: SettlementInvoiceRow[];
  offsettableReturns: SettlementOffsettableReturn[];
};

type ProofState =
  | { status: "idle"; file: File | null }
  | { status: "uploading"; file: File }
  | { status: "uploaded"; file: File; url: string; key: string }
  | { status: "error"; file: File };

type DeductionRow =
  | { id: string; kind: "RETUR_OFFSET"; fieldReturnId: string; amountInput: string }
  | { id: string; kind: "PROGRAM"; slot: string; amountInput: string; note: string; proof: ProofState }
  | { id: string; kind: "ADMIN_FEE"; slot: "adminfee"; percentInput: string; proof: ProofState };

const EPSILON = 1e-6;

/**
 * The reasons a real submit attempt can plausibly hit get their own copy. Everything else
 * `submitStoreSettlementAction` can return falls back to `errGeneric` — this is a `Partial`
 * map, not the exhaustive `Record<SettlementErrorCode, …>` this codebase's landmine index warns
 * about, so a code with no entry here fails safe onto the fallback instead of failing a build.
 */
const REASON_KEY: Partial<Record<SettlementActionReason, string>> = {
  UNAUTHENTICATED: "errUnauthenticated",
  FORBIDDEN: "errForbidden",
  NO_INVOICES: "errNoInvoices",
  INVALID_AMOUNT: "errInvalidAmount",
  INVALID_PERCENT: "errInvalidPercent",
  DUPLICATE_INVOICE: "errDuplicateInvoice",
  DUPLICATE_ADMIN_FEE: "errDuplicateAdminFee",
  MISSING_EVIDENCE: "errMissingEvidence",
  DRAFT_ID_CONFLICT: "errDraftIdConflict",
  NOT_OUTSTANDING: "errNotOutstanding",
  INVOICE_OVERCLAIMED: "errInvoiceOverclaimed",
  RETURN_NOT_APPROVED: "errReturnNotApproved",
  NOT_VALUED: "errNotValued",
  RETUR_OVERCLAIMED: "errReturOverclaimed",
  DEDUCTIONS_EXCEED_INVOICES: "errDeductionsExceedInvoices",
};

/**
 * Every input on this screen carries sen — `Decimal(15,2)` receivables and a documented
 * sub-rupiah `PARTIAL` residue make a fractional expected/actual figure reachable. The totals
 * panel and the variance line show this precision so a sub-rupiah mismatch is something the
 * salesman can actually see and clear, instead of a whole-rupiah figure that always looks
 * settled while the underlying amounts disagree by a few sen.
 */
function formatRupiahPrecise(value: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function toFiniteNumber(raw: string): number | null {
  if (raw.trim() === "") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseAmount(raw: string): number {
  const parsed = toFiniteNumber(raw);
  return parsed !== null ? roundCents(parsed) : 0;
}

function parsePercent(raw: string): number {
  return toFiniteNumber(raw) ?? 0;
}

/**
 * The headroom `submitSettlement` will actually honor for this invoice — `outstandingAmount`
 * alone is not it, since the writer additionally nets every OTHER PENDING settlement's own claim
 * before refusing with `INVOICE_OVERCLAIMED`. `reservedAmount` already carries that netted sum
 * from the props layer (`page.tsx`), so this is the one place both the default fill and the max
 * validity check must read from.
 */
function invoiceClaimable(inv: SettlementInvoiceRow): number {
  return Math.max(0, roundCents(inv.outstandingAmount - inv.reservedAmount));
}

/**
 * The retur-side twin of `invoiceClaimable` — `option.remainingValue` alone is not the headroom
 * the writer honors either, for the identical reason (netted against other PENDING settlements'
 * `RETUR_OFFSET` claims, via `reservedAmount`).
 */
function returClaimable(option: SettlementOffsettableReturn): number {
  return Math.max(0, roundCents(option.remainingValue - option.reservedAmount));
}

export function SettlementForm({ storeId, storeName, invoices, offsettableReturns }: Props) {
  const t = useTranslations("pwa.settlement");
  const [isPending, startTransition] = useTransition();

  /**
   * `draftId` prefixes every proof upload key AND is submitted as `submitSettlement`'s own
   * idempotency key — it is the only thing standing between a lost-response retry and a real
   * double submission. `useState`'s lazy initializer runs exactly once per mount; `useMemo` does
   * not carry that guarantee (React documents it as a performance hint the runtime may
   * re-invoke), so it is the wrong tool for a value this load-bearing. This route mounts a fresh
   * instance of this component every time a salesman opens a store's settlement screen, so
   * "reseeded when the form opens" falls out of that mount for free. It is never rotated after
   * that — this form is not reused for a second submission the way `SubmitCollectionSheet`'s
   * sheet is, so there is nothing later that a rotation would protect.
   */
  const [draftId] = useState(() => crypto.randomUUID());

  /**
   * Every invoice with headroom starts ticked — each one already carries a prefilled amount
   * below, so leaving those unchecked was a tap per nota at a counter and made "submit with
   * nothing selected" the easy path. An invoice with ZERO headroom (fully claimed by a
   * colleague's PENDING settlement) starts UNTICKED instead — ticking it would seed a `0.00`
   * amount that fails `invoiceAmountsValid` and blocks the whole form until the salesman works
   * out which row to untick. `useState`'s lazy initializer, not a plain `{}` computed once and
   * mutated later, matching how `invoiceAmountInputs` below is seeded.
   */
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(invoices.map((inv) => [inv.receivableId, invoiceClaimable(inv) > 0])),
  );
  /**
   * Defaults to `min(outstanding − pendingSubmittedAmount, invoiceClaimable(inv))`, not the full
   * outstanding — a PENDING collection submission moves no money (`outstandingAmount` stays
   * untouched until `verifyCollection` runs) and a PENDING settlement's own invoice claim reduces
   * `invoiceClaimable` (via `reservedAmount`, computed at the props layer). Prefilling past
   * either would let a salesman submit for money an unverified setoran or a colleague's pending
   * settlement already claims. The actual submit ceiling below reads from the SAME
   * `invoiceClaimable` figure, matching what the writer itself enforces.
   */
  const [invoiceAmountInputs, setInvoiceAmountInputs] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      invoices.map((inv) => [
        inv.receivableId,
        roundCents(Math.max(0, Math.min(inv.outstandingAmount - inv.pendingSubmittedAmount, invoiceClaimable(inv)))).toFixed(2),
      ]),
    ),
  );

  const [rows, setRows] = useState<DeductionRow[]>([]);
  /**
   * A ref, not `useState` — `addProgramRow` below reads and increments it directly inside the
   * event handler, which runs exactly once per tap. A prior version of this file derived the slot
   * inside `setNextProgramSlot`'s own state-updater function; StrictMode (on by default under the
   * App Router) double-invokes state updaters, so two taps handled back-to-back could commit two
   * PROGRAM rows sharing the same `program-N` slot — the same one-photo-satisfies-two-deductions
   * hazard the comment on `addProgramRow` exists to rule out. Nothing outside `addProgramRow`
   * reads this value, so it never needs to trigger a re-render.
   */
  const nextProgramSlotRef = useRef(0);

  const [actualAmountInput, setActualAmountInput] = useState("0.00");
  const [actualAmountTouched, setActualAmountTouched] = useState(false);
  const [note, setNote] = useState("");

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ docNo: string } | null>(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const selectedInvoiceRows = invoices.filter((inv) => selectedInvoiceIds[inv.receivableId] === true);
  const hasSelectedInvoice = selectedInvoiceRows.length > 0;
  const invoiceAmountsValid = selectedInvoiceRows.every((inv) => {
    const amt = parseAmount(invoiceAmountInputs[inv.receivableId] ?? "");
    return amt > 0 && amt <= invoiceClaimable(inv) + EPSILON;
  });

  const returRows = rows.filter((r): r is Extract<DeductionRow, { kind: "RETUR_OFFSET" }> => r.kind === "RETUR_OFFSET");
  /**
   * Gates the Add-retur button below. `returRows.length >= offsettableReturns.length` alone is
   * not it — with every offsettable retur already claimed by a PENDING settlement (headroom
   * zero), that count can still be under the option total, the button stays enabled, and a tap
   * appends a row with no valid amount that blocks submit until removed. This must agree with
   * what `addReturRow` itself can actually place a row on.
   */
  const usedReturnIds = new Set(returRows.map((row) => row.fieldReturnId));
  const canAddReturRow = offsettableReturns.some(
    (option) => !usedReturnIds.has(option.fieldReturnId) && returClaimable(option) > 0,
  );
  const returRowsValid = returRows.every((row) => {
    const option = offsettableReturns.find((o) => o.fieldReturnId === row.fieldReturnId);
    const amt = parseAmount(row.amountInput);
    return option !== undefined && amt > 0 && amt <= returClaimable(option) + EPSILON;
  });

  const programRows = rows.filter((r): r is Extract<DeductionRow, { kind: "PROGRAM" }> => r.kind === "PROGRAM");
  const programRowsValid = programRows.every((row) => parseAmount(row.amountInput) > 0 && row.proof.status === "uploaded");

  const adminFeeRows = rows.filter((r): r is Extract<DeductionRow, { kind: "ADMIN_FEE" }> => r.kind === "ADMIN_FEE");
  /**
   * `toFiniteNumber` directly, not `parsePercent` — a blank box must fail this check, and
   * `parsePercent` defaults a blank input to `0`, which would let an empty percent field pass as
   * a genuine (if pointless) 0% fee and write a `Decimal 0.00` deduction with evidence attached.
   */
  const adminFeeRowsValid = adminFeeRows.every((row) => {
    const pct = toFiniteNumber(row.percentInput);
    return pct !== null && pct >= 0 && pct <= 100 && row.proof.status === "uploaded";
  });

  const anyProofBusy = rows.some((r) => r.kind !== "RETUR_OFFSET" && r.proof.status === "uploading");

  /**
   * This preview MUST run through `computeSettlementTotals` — the exact pure function
   * `submitSettlement` recomputes server-side from its own trusted figures — never its own
   * arithmetic. A screen with independent math here recreates the preview-vs-writer mismatch
   * this codebase's landmine index already names twice.
   */
  const invoiceAmountValues = selectedInvoiceRows.map((inv) => parseAmount(invoiceAmountInputs[inv.receivableId] ?? ""));
  const deductionInputsForCalc: SettlementDeductionInput[] = rows.map((row) => {
    if (row.kind === "RETUR_OFFSET") return { type: "RETUR_OFFSET", amount: parseAmount(row.amountInput) };
    if (row.kind === "PROGRAM") return { type: "PROGRAM", amount: parseAmount(row.amountInput) };
    return { type: "ADMIN_FEE", percent: parsePercent(row.percentInput) };
  });
  const totals = computeSettlementTotals(invoiceAmountValues, deductionInputsForCalc);
  const deductionsExceedInvoices = totals.expected < -EPSILON;

  const rawActual = toFiniteNumber(actualAmountInput);
  const actualAmountValid = rawActual !== null && rawActual >= 0;
  const actualAmount = actualAmountValid && rawActual !== null ? roundCents(rawActual) : 0;
  const variance = computeVariance(totals.expected, actualAmount);

  useEffect(() => {
    if (actualAmountTouched) return;
    setActualAmountInput(totals.expected > 0 ? totals.expected.toFixed(2) : "0.00");
  }, [totals.expected, actualAmountTouched]);

  const canSubmit =
    hasSelectedInvoice &&
    invoiceAmountsValid &&
    returRowsValid &&
    programRowsValid &&
    adminFeeRowsValid &&
    actualAmountValid &&
    !deductionsExceedInvoices &&
    !anyProofBusy &&
    !isPending;

  function toggleInvoice(receivableId: string, checked: boolean): void {
    setSelectedInvoiceIds((prev) => ({ ...prev, [receivableId]: checked }));
  }

  /**
   * Excludes a zero-headroom option — the same predicate gap C3 closed on the Add-retur button
   * and `addReturRow`, one layer down: without it, this row's own `Select` would still OFFER a
   * fully-reserved retur, and picking it blanks the amount input and blocks submit until it is
   * changed back. The row's OWN current selection stays present even at zero headroom (checked
   * via `o.fieldReturnId === fieldReturnId` first, short-circuiting the claimable check) — a form
   * left open must not drop the row's own value out from under the salesman just because a
   * colleague's pending settlement has since claimed the rest of it.
   */
  function returOptionsForRow(rowId: string, fieldReturnId: string): SettlementOffsettableReturn[] {
    const usedByOthers = new Set(returRows.filter((r) => r.id !== rowId).map((r) => r.fieldReturnId));
    return offsettableReturns.filter(
      (o) => o.fieldReturnId === fieldReturnId || (!usedByOthers.has(o.fieldReturnId) && returClaimable(o) > 0),
    );
  }

  /**
   * `used` and `next` are derived from `prev` INSIDE the updater, not from the outer `returRows`
   * closure — two taps before a re-render would otherwise both read the same stale `returRows`
   * (missing the row the first tap is about to add) and both pick the SAME `next` retur, the same
   * render-closure staleness `addAdminFeeRow`'s guard exists to rule out below, just producing a
   * duplicate row instead of a `DUPLICATE_ADMIN_FEE` refusal.
   */
  function addReturRow(): void {
    setRows((prev) => {
      const used = new Set(
        prev
          .filter((r): r is Extract<DeductionRow, { kind: "RETUR_OFFSET" }> => r.kind === "RETUR_OFFSET")
          .map((r) => r.fieldReturnId),
      );
      const next = offsettableReturns.find((o) => !used.has(o.fieldReturnId) && returClaimable(o) > 0);
      if (!next) return prev;
      const claimable = returClaimable(next);
      return [
        ...prev,
        {
          id: crypto.randomUUID(),
          kind: "RETUR_OFFSET",
          fieldReturnId: next.fieldReturnId,
          amountInput: claimable > 0 ? claimable.toFixed(2) : "",
        },
      ];
    });
  }

  /**
   * The slot number is read from — and incremented on — the ref above, here in the event handler
   * itself, never inside a `setRows` updater. A handler runs once per tap, so this can never mint
   * the same `program-N` slot twice, and `setRows`'s own updater stays a pure function of `prev`.
   * The counter only ever increases and is never reset when a row is removed, so a slot index is
   * never reused for the life of this form.
   */
  function addProgramRow(): void {
    const slot = `program-${nextProgramSlotRef.current}`;
    nextProgramSlotRef.current += 1;
    setRows((prev) => [
      ...prev,
      { id: crypto.randomUUID(), kind: "PROGRAM", slot, amountInput: "", note: "", proof: { status: "idle", file: null } },
    ]);
  }

  /**
   * Guarded INSIDE the updater against an existing `ADMIN_FEE` row, not just by the button's
   * `disabled={adminFeeRows.length >= 1}` — that reads `adminFeeRows` from the render closure, and
   * functional updaters chain, so two taps before a re-render would otherwise both see zero
   * existing rows and both append one, failing submit with `DUPLICATE_ADMIN_FEE`.
   */
  function addAdminFeeRow(): void {
    setRows((prev) => {
      if (prev.some((r) => r.kind === "ADMIN_FEE")) return prev;
      return [
        ...prev,
        { id: crypto.randomUUID(), kind: "ADMIN_FEE", slot: "adminfee", percentInput: "", proof: { status: "idle", file: null } },
      ];
    });
  }

  function removeRow(id: string): void {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  function updateRow(id: string, next: DeductionRow): void {
    setRows((prev) => prev.map((r) => (r.id === id ? next : r)));
  }

  /**
   * Every uploaded key is bound to THIS draft's own prefix (`settlement-proofs/${draftId}/`)
   * and to a slot unique per row — a `program-N` counter that never reuses an index even after
   * a row is removed, and the fixed `adminfee` slot since at most one such row can ever exist.
   * That pairing is what stops one uploaded photo from satisfying two deductions at once; the
   * writer independently re-checks both the prefix and cross-deduction uniqueness, so this is
   * defense in depth, not the only guard.
   */
  async function uploadDeductionProof(rowId: string, slot: string, file: File): Promise<void> {
    setRows((prev) =>
      prev.map((r) => (r.id === rowId && r.kind !== "RETUR_OFFSET" ? { ...r, proof: { status: "uploading", file } } : r)),
    );
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("draftId", draftId);
      formData.append("slot", slot);
      const res = await fetch("/pwa/api/upload/settlement-proof", { method: "POST", body: formData });
      if (!res.ok) throw new Error("upload failed");
      const data = (await res.json()) as { url: string; key: string };
      setRows((prev) =>
        prev.map((r) =>
          r.id === rowId && r.kind !== "RETUR_OFFSET"
            ? { ...r, proof: { status: "uploaded", file, url: data.url, key: data.key } }
            : r,
        ),
      );
    } catch {
      setRows((prev) =>
        prev.map((r) => (r.id === rowId && r.kind !== "RETUR_OFFSET" ? { ...r, proof: { status: "error", file } } : r)),
      );
      toast.error(t("proofUploadError"));
    }
  }

  function useExpectedAmount(): void {
    setActualAmountTouched(false);
    setActualAmountInput(totals.expected > 0 ? totals.expected.toFixed(2) : "0.00");
  }

  function submit(): void {
    setSubmitAttempted(true);
    if (!canSubmit) return;
    setSubmitError(null);

    const deductions: StoreSettlementDeductionInput[] = rows.map((row) => {
      if (row.kind === "RETUR_OFFSET") {
        return { type: "RETUR_OFFSET", amount: parseAmount(row.amountInput), fieldReturnId: row.fieldReturnId };
      }
      const proofUrl = row.proof.status === "uploaded" ? row.proof.url : "";
      const proofR2Key = row.proof.status === "uploaded" ? row.proof.key : "";
      if (row.kind === "PROGRAM") {
        return {
          type: "PROGRAM",
          amount: parseAmount(row.amountInput),
          proofUrl,
          proofR2Key,
          note: row.note.trim() || undefined,
        };
      }
      return { type: "ADMIN_FEE", percent: parsePercent(row.percentInput), proofUrl, proofR2Key };
    });

    startTransition(async () => {
      try {
        const result = await submitStoreSettlementAction({
          draftId,
          storeId,
          invoices: selectedInvoiceRows.map((inv) => ({
            receivableId: inv.receivableId,
            amount: parseAmount(invoiceAmountInputs[inv.receivableId] ?? ""),
          })),
          deductions,
          actualAmount,
          note: note.trim() || undefined,
        });
        if (result.ok) {
          toast.success(t("submitSuccess"));
          /**
           * No `draftId` rotation here, unlike `SubmitCollectionSheet`'s sheet, which stays open
           * and reuses the same instance for a next submission. This screen never renders its
           * form again after success — `success` is never cleared — so there is nothing left
           * that could replay the old id. Rotating it here would only leave `rows` holding proof
           * keys under a prefix `draftId` no longer matches, which is why that rotation was
           * removed rather than kept "just in case".
           */
          setSuccess({ docNo: result.docNo });
          return;
        }
        const key = REASON_KEY[result.reason] ?? "errGeneric";
        setSubmitError(t(key));
        toast.error(t(key));
      } catch {
        setSubmitError(t("errGeneric"));
        toast.error(t("errGeneric"));
      }
    });
  }

  if (success) {
    return (
      <div className="p-4">
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
            <div className="rounded-full bg-primary p-3">
              <CheckCircle2 className="h-8 w-8 text-primary-foreground" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t("submitSuccess")}</p>
              <p className="mt-1 text-lg font-semibold">{storeName}</p>
              <p className="text-xs text-muted-foreground">{success.docNo}</p>
            </div>
          </CardContent>
        </Card>
        <div className="mt-4">
          <Button asChild className="w-full" size="lg">
            <Link href="/pwa/pelunasan">
              <ArrowLeft className="h-4 w-4" />
              {t("backToList")}
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4 pb-24">
      <header className="-ml-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/pwa/pelunasan">
            <ArrowLeft className="h-4 w-4" />
            {t("backToList")}
          </Link>
        </Button>
      </header>

      <div>
        <h1 className="text-2xl font-bold leading-tight">{storeName}</h1>
        <p className="text-xs text-muted-foreground">{t("subtitle")}</p>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{t("invoicesTitle")}</h2>
        {invoices.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 p-6 text-center">
              <p className="text-sm font-medium">{t("noInvoicesTitle")}</p>
              <p className="text-xs text-muted-foreground">{t("noInvoicesHint")}</p>
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-2">
            {invoices.map((inv) => {
              const checked = selectedInvoiceIds[inv.receivableId] === true;
              const amt = parseAmount(invoiceAmountInputs[inv.receivableId] ?? "");
              const invalid = checked && !(amt > 0 && amt <= invoiceClaimable(inv) + EPSILON);
              return (
                <li key={inv.receivableId} className="flex items-start gap-3 rounded-md border p-3">
                  <Checkbox
                    id={`invoice-${inv.receivableId}`}
                    checked={checked}
                    disabled={isPending}
                    className="mt-1"
                    onCheckedChange={(value) => toggleInvoice(inv.receivableId, value === true)}
                  />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor={`invoice-${inv.receivableId}`} className="truncate text-sm font-medium">
                        {inv.docNo}
                      </Label>
                      {inv.daysOverdue > 0 && (
                        <Badge variant="destructive" className="shrink-0 text-[10px] px-1.5 py-0">
                          {`${inv.daysOverdue}d`}
                        </Badge>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                      <p>
                        {t("colDueDate")}: {formatDateOnlyJakarta(new Date(inv.dueDateIso))}
                      </p>
                      <p className="text-right">
                        {t("colOutstanding")}: {formatRupiahPrecise(inv.outstandingAmount)}
                      </p>
                    </div>
                    {inv.pendingSubmittedAmount > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {t("pendingSubmittedLabel")}: {formatRupiahPrecise(inv.pendingSubmittedAmount)}
                      </p>
                    )}
                    {inv.reservedAmount > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {t("reservedByOtherSettlementLabel")}: {formatRupiahPrecise(inv.reservedAmount)}
                      </p>
                    )}
                    {checked && (
                      <div className="space-y-1">
                        <Label htmlFor={`invoice-amount-${inv.receivableId}`} className="sr-only">
                          {t("invoiceAmountLabel")}
                        </Label>
                        <Input
                          id={`invoice-amount-${inv.receivableId}`}
                          type="number"
                          inputMode="decimal"
                          step="0.01"
                          min="0"
                          className="h-10"
                          placeholder={t("invoiceAmountPlaceholder")}
                          disabled={isPending}
                          value={invoiceAmountInputs[inv.receivableId] ?? ""}
                          aria-invalid={invalid}
                          onChange={(e) => setInvoiceAmountInputs((prev) => ({ ...prev, [inv.receivableId]: e.target.value }))}
                        />
                      </div>
                    )}
                    {invalid && <p className="text-xs text-destructive">{t("invoiceAmountInvalid")}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {submitAttempted && !hasSelectedInvoice && invoices.length > 0 && (
          <p className="text-xs text-destructive">{t("errNoInvoices")}</p>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{t("returSectionTitle")}</h2>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8"
            disabled={isPending || !canAddReturRow}
            onClick={addReturRow}
          >
            <Plus className="h-3.5 w-3.5" />
            {t("addReturButton")}
          </Button>
        </div>
        {offsettableReturns.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("noReturCredit")}</p>
        ) : returRows.length === 0 && !canAddReturRow ? (
          /**
           * Distinct from `noReturCredit` above — this store DOES have offsettable returs, every
           * one of them is just fully claimed by another PENDING settlement right now. Without
           * this branch the section renders only the heading and a greyed-out button with no rows
           * and no explanation, the exact blank dead-end the house UI standard rules out.
           */
          <p className="text-xs text-muted-foreground">{t("returAllReserved")}</p>
        ) : (
          returRows.map((row) => {
            const options = returOptionsForRow(row.id, row.fieldReturnId);
            const option = offsettableReturns.find((o) => o.fieldReturnId === row.fieldReturnId);
            const amt = parseAmount(row.amountInput);
            const invalid = !option || !(amt > 0 && amt <= returClaimable(option) + EPSILON);
            return (
              <div key={row.id} className="space-y-2 rounded-md border p-3">
                <div className="flex items-center gap-2">
                  <Select
                    value={row.fieldReturnId}
                    disabled={isPending}
                    onValueChange={(value) => {
                      /**
                       * A changed retur must not keep the PREVIOUS retur's amount — that would
                       * silently claim the new retur for a figure that has nothing to do with
                       * its own remaining credit. Reset to the new option's own headroom.
                       */
                      const next = offsettableReturns.find((o) => o.fieldReturnId === value);
                      const nextClaimable = next ? returClaimable(next) : 0;
                      const nextAmount = nextClaimable > 0 ? nextClaimable.toFixed(2) : "";
                      updateRow(row.id, { ...row, fieldReturnId: value, amountInput: nextAmount });
                    }}
                  >
                    <SelectTrigger className="h-10 flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {options.map((opt) => (
                        <SelectItem key={opt.fieldReturnId} value={opt.fieldReturnId}>
                          {`${opt.docNo} — ${formatRupiahPrecise(returClaimable(opt))}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-10 w-10 shrink-0"
                    disabled={isPending}
                    aria-label={t("removeButton")}
                    onClick={() => removeRow(row.id)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <Input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  className="h-10"
                  placeholder={t("returAmountPlaceholder")}
                  disabled={isPending}
                  value={row.amountInput}
                  aria-invalid={invalid}
                  onChange={(e) => updateRow(row.id, { ...row, amountInput: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  {t("returClaimableLabel")}: {formatRupiahPrecise(option ? returClaimable(option) : 0)}
                </p>
                {option && option.reservedAmount > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {t("reservedByOtherSettlementLabel")}: {formatRupiahPrecise(option.reservedAmount)}
                  </p>
                )}
                {invalid && <p className="text-xs text-destructive">{t("returAmountInvalid")}</p>}
              </div>
            );
          })
        )}
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{t("programSectionTitle")}</h2>
          <Button type="button" variant="outline" size="sm" className="h-8" disabled={isPending} onClick={addProgramRow}>
            <Plus className="h-3.5 w-3.5" />
            {t("addProgramButton")}
          </Button>
        </div>
        {programRows.length === 0 && <p className="text-xs text-muted-foreground">{t("noProgramRows")}</p>}
        {programRows.map((row) => {
          /*
           * Narrowed into a const, not re-read as `row.proof` at each use. TypeScript keeps the
           * narrowing of a const VARIABLE inside a nested closure but discards the narrowing of a
           * property access, because it cannot prove `row.proof` is unchanged by the time an
           * onClick fires — so `row.proof.file` in the retry handler resolves to `File | null`
           * even under a `row.proof.status === "error"` guard, and fails to compile.
           */
          const proof = row.proof;
          const proofBusy = proof.status === "uploading";
          const proofReady = proof.status === "uploaded";
          const amountInvalid = !(parseAmount(row.amountInput) > 0);
          return (
            <div key={row.id} className="space-y-2 rounded-md border p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{t("programRowTitle")}</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 shrink-0"
                  disabled={isPending}
                  aria-label={t("removeButton")}
                  onClick={() => removeRow(row.id)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <Input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                className="h-10"
                placeholder={t("programAmountPlaceholder")}
                disabled={isPending}
                value={row.amountInput}
                aria-invalid={amountInvalid}
                onChange={(e) => updateRow(row.id, { ...row, amountInput: e.target.value })}
              />
              <Input
                className="h-10"
                placeholder={t("programNotePlaceholder")}
                disabled={isPending}
                value={row.note}
                onChange={(e) => updateRow(row.id, { ...row, note: e.target.value })}
              />
              <div className="space-y-1.5">
                <Label htmlFor={`program-proof-${row.id}`}>{t("proofLabel")}</Label>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    id={`program-proof-${row.id}`}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    capture="environment"
                    className="h-10 flex-1"
                    disabled={isPending || proofBusy}
                    onChange={(e) => {
                      const file = e.target.files?.[0] ?? null;
                      if (file) void uploadDeductionProof(row.id, row.slot, file);
                    }}
                  />
                  {proof.status === "error" && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-10"
                      disabled={isPending}
                      onClick={() => void uploadDeductionProof(row.id, row.slot, proof.file)}
                    >
                      {t("retryButton")}
                    </Button>
                  )}
                </div>
              </div>
              {proofBusy && (
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {t("proofUploading")}
                </p>
              )}
              {proofReady && <p className="text-xs text-emerald-600 dark:text-emerald-400">{t("proofUploaded")}</p>}
              {proof.status === "error" && <p className="text-xs text-destructive">{t("proofUploadError")}</p>}
              {proof.status === "idle" && submitAttempted && (
                <p className="text-xs text-destructive">{t("proofRequired")}</p>
              )}
            </div>
          );
        })}
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{t("adminFeeSectionTitle")}</h2>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8"
            disabled={isPending || adminFeeRows.length >= 1}
            onClick={addAdminFeeRow}
          >
            <Plus className="h-3.5 w-3.5" />
            {t("addAdminFeeButton")}
          </Button>
        </div>
        {adminFeeRows.length === 0 && <p className="text-xs text-muted-foreground">{t("noAdminFeeRows")}</p>}
        {adminFeeRows.map((row) => {
          /*
           * Narrowed into a const, not re-read as `row.proof` at each use. TypeScript keeps the
           * narrowing of a const VARIABLE inside a nested closure but discards the narrowing of a
           * property access, because it cannot prove `row.proof` is unchanged by the time an
           * onClick fires — so `row.proof.file` in the retry handler resolves to `File | null`
           * even under a `row.proof.status === "error"` guard, and fails to compile.
           */
          const proof = row.proof;
          const proofBusy = proof.status === "uploading";
          const proofReady = proof.status === "uploaded";
          const pct = toFiniteNumber(row.percentInput);
          const percentInvalid = pct === null || !(pct >= 0 && pct <= 100);
          return (
            <div key={row.id} className="space-y-2 rounded-md border p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{t("adminFeeRowTitle")}</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 shrink-0"
                  disabled={isPending}
                  aria-label={t("removeButton")}
                  onClick={() => removeRow(row.id)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  min="0"
                  max="100"
                  className="h-10"
                  placeholder={t("adminFeePercentPlaceholder")}
                  disabled={isPending}
                  value={row.percentInput}
                  aria-invalid={percentInvalid}
                  onChange={(e) => updateRow(row.id, { ...row, percentInput: e.target.value })}
                />
                <span className="shrink-0 text-sm text-muted-foreground">%</span>
              </div>
              {percentInvalid && <p className="text-xs text-destructive">{t("adminFeePercentInvalid")}</p>}
              <div className="space-y-1.5">
                <Label htmlFor={`adminfee-proof-${row.id}`}>{t("proofLabel")}</Label>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    id={`adminfee-proof-${row.id}`}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    capture="environment"
                    className="h-10 flex-1"
                    disabled={isPending || proofBusy}
                    onChange={(e) => {
                      const file = e.target.files?.[0] ?? null;
                      if (file) void uploadDeductionProof(row.id, row.slot, file);
                    }}
                  />
                  {proof.status === "error" && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-10"
                      disabled={isPending}
                      onClick={() => void uploadDeductionProof(row.id, row.slot, proof.file)}
                    >
                      {t("retryButton")}
                    </Button>
                  )}
                </div>
              </div>
              {proofBusy && (
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {t("proofUploading")}
                </p>
              )}
              {proofReady && <p className="text-xs text-emerald-600 dark:text-emerald-400">{t("proofUploaded")}</p>}
              {proof.status === "error" && <p className="text-xs text-destructive">{t("proofUploadError")}</p>}
              {proof.status === "idle" && submitAttempted && (
                <p className="text-xs text-destructive">{t("proofRequired")}</p>
              )}
            </div>
          );
        })}
      </section>

      <Card>
        <CardContent className="space-y-1.5 p-4 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t("totalsInvoice")}</span>
            <span className="tabular-nums font-medium">{formatRupiahPrecise(totals.invoiceTotal)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t("totalsRetur")}</span>
            <span className="tabular-nums">{`-${formatRupiahPrecise(totals.returTotal)}`}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t("totalsProgram")}</span>
            <span className="tabular-nums">{`-${formatRupiahPrecise(totals.programTotal)}`}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t("totalsAdminFee")}</span>
            <span className="tabular-nums">{`-${formatRupiahPrecise(totals.adminFee)}`}</span>
          </div>
          <div className="flex justify-between border-t pt-1.5">
            <span className="font-semibold">{t("totalsExpected")}</span>
            <span className="tabular-nums font-semibold">{formatRupiahPrecise(totals.expected)}</span>
          </div>
          {deductionsExceedInvoices && <p className="text-xs text-destructive">{t("deductionsExceedInvoices")}</p>}
        </CardContent>
      </Card>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="actual-amount">{t("actualAmountLabel")}</Label>
          <Button type="button" variant="outline" size="sm" className="h-8" disabled={isPending} onClick={useExpectedAmount}>
            {t("useExpectedButton")}
          </Button>
        </div>
        <Input
          id="actual-amount"
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          className="h-10"
          disabled={isPending}
          value={actualAmountInput}
          aria-invalid={!actualAmountValid}
          onChange={(e) => {
            setActualAmountTouched(true);
            setActualAmountInput(e.target.value);
          }}
        />
        {!actualAmountValid && <p className="text-xs text-destructive">{t("actualAmountRequired")}</p>}
        {actualAmountValid && (
          <p
            className={cn(
              "text-xs",
              Math.abs(variance) <= EPSILON
                ? "text-muted-foreground"
                : variance > 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-destructive",
            )}
          >
            {Math.abs(variance) <= EPSILON
              ? t("varianceZero")
              : variance > 0
                ? t("varianceOver", { amount: formatRupiahPrecise(variance) })
                : t("varianceUnder", { amount: formatRupiahPrecise(Math.abs(variance)) })}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="settlement-note">{t("noteLabel")}</Label>
        <Textarea
          id="settlement-note"
          rows={2}
          maxLength={500}
          disabled={isPending}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      {submitError && <p className="text-sm text-destructive">{submitError}</p>}

      <div className="sticky bottom-0 -mx-4 -mb-4 border-t bg-background px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        {/**
          * The button stays enabled even when the form is incomplete — `disabled={!canSubmit}`
          * would make `onClick` (and therefore `submit()`'s own `setSubmitAttempted(true)`) never
          * fire while anything is invalid, leaving every per-section "why is this blocked" message
          * below permanently dead. `submit()`'s own `if (!canSubmit) return;` still stops a real
          * request from going out; only `isPending` disables the tap itself, so a salesman standing
          * at a counter with an incomplete form gets pointed at what's missing instead of a grey
          * button with no explanation.
          */}
        <Button type="button" className="w-full" size="lg" disabled={isPending} onClick={submit}>
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {isPending ? t("submitting") : t("submitButton")}
        </Button>
      </div>
    </div>
  );
}
