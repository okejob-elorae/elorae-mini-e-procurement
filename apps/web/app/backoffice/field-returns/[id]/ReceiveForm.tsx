"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { PackageCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import {
  correctReceiptAction,
  receiveAction,
  type FieldReturnActionResult,
} from "@/app/actions/field-returns";

export type ReceivableLine = {
  id: string;
  itemName: string;
  itemSku: string;
  variantSku: string;
  qty: number;
};

export type RecordedCount = { receivedQty: number; rejectedQty: number };

type Props = {
  returnId: string;
  lines: ReceivableLine[];
  /** `correct` re-submits a received retur's counts with a required reason, before approval. */
  mode?: "receive" | "correct";
  /** The counts already recorded, keyed by line id — seeds both inputs in `correct` mode. */
  initialCounts?: Record<string, RecordedCount>;
  /** Called after a successful submit, so the caller can close a `correct` form. */
  onDone?: () => void;
};

/** Mirrors `MAX_AUDIT_REASON_LENGTH` — the writer caps the stored reason at the same length. */
const REASON_MAX_LENGTH = 191;

/** Keys relative to `fieldReturnReceiving`, one set per mode. */
const COPY = {
  receive: {
    title: "receiveTitle",
    hint: "receiveHint",
    submit: "receiveSubmit",
    confirmTitle: "receiveConfirmTitle",
    confirmDescription: "receiveConfirmDescription",
    confirmAction: "receiveConfirmAction",
    success: "successReceived",
  },
  correct: {
    title: "correctTitle",
    hint: "correctHint",
    submit: "correctSubmit",
    confirmTitle: "correctConfirmTitle",
    confirmDescription: "correctConfirmDescription",
    confirmAction: "correctConfirmAction",
    success: "successCorrected",
  },
} as const;

type FieldReturnFailureCode = Exclude<FieldReturnActionResult, { ok: true }>["code"];

/**
 * Shared with ResolutionControls and the approve control on the detail page — every caller
 * already holds `useTranslations("fieldReturnReceiving")`, so this returns a key RELATIVE to
 * that namespace (`err.<code>`), not the fully-qualified path. Every `FieldReturnActionResult`
 * failure code maps to its own message so a missing translation renders raw rather than
 * silently falling back.
 */
export function fieldReturnErrorKey(code: FieldReturnFailureCode): string {
  return `err.${code}`;
}

/** Accepts only a bare non-negative integer string — `"0"` included, `""`/decimals/negatives rejected. */
function parseNonNegativeInt(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isSafeInteger(n) ? n : null;
}

function seedReceivedInputs(
  lines: ReceivableLine[],
  initialCounts: Record<string, RecordedCount> | undefined,
): Record<string, string> {
  if (!initialCounts) return {};
  return Object.fromEntries(
    lines.map((l) => [l.id, initialCounts[l.id] ? String(initialCounts[l.id].receivedQty) : ""]),
  );
}

function seedRejectedInputs(
  lines: ReceivableLine[],
  initialCounts: Record<string, RecordedCount> | undefined,
): Record<string, string> {
  return Object.fromEntries(
    lines.map((l) => [l.id, initialCounts?.[l.id] ? String(initialCounts[l.id].rejectedQty) : "0"]),
  );
}

/**
 * Two modes over one count table. `receive` is shown while the retur is
 * PENDING_WAREHOUSE_RECEIVING; `correct` while it is received but unapproved, seeded with the
 * recorded counts and requiring a reason. Both only for a field_returns:manage holder (decided
 * server-side, passed down — never decided here). Every input, including an all-zero line (the
 * lost-sack case), is a valid count: there is deliberately no positive-quantity guard anywhere in
 * this form.
 */
export function ReceiveForm({ returnId, lines, mode = "receive", initialCounts, onDone }: Props) {
  const t = useTranslations("fieldReturnReceiving");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const isCorrect = mode === "correct";
  const copy = COPY[mode];
  const [receivedInputs, setReceivedInputs] = useState<Record<string, string>>(() =>
    seedReceivedInputs(lines, initialCounts)
  );
  const [rejectedInputs, setRejectedInputs] = useState<Record<string, string>>(() =>
    seedRejectedInputs(lines, initialCounts)
  );
  const [reason, setReason] = useState("");
  const [reasonAttempted, setReasonAttempted] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const parsedLines = lines.map((line) => {
    const received = parseNonNegativeInt(receivedInputs[line.id] ?? "");
    const rejected = parseNonNegativeInt(rejectedInputs[line.id] ?? "");
    const sellable = received !== null && rejected !== null ? received - rejected : null;
    const rejectedTooHigh = received !== null && rejected !== null && rejected > received;
    const recorded = initialCounts?.[line.id];
    const receivedChanged = recorded !== undefined && received !== recorded.receivedQty;
    const changed = recorded === undefined || receivedChanged || rejected !== recorded.rejectedQty;
    return { line, received, rejected, sellable, rejectedTooHigh, recorded, receivedChanged, changed };
  });

  const countsValid = parsedLines.every(
    (p) => p.received !== null && p.rejected !== null && !p.rejectedTooHigh
  );
  /* A correction that changes nothing would only write an audit row — the button says so instead. */
  const hasChanges = !isCorrect || parsedLines.some((p) => p.changed);
  const canSubmit = countsValid && hasChanges;
  const reasonMissing = isCorrect && reason.trim() === "";

  function openConfirm(): void {
    if (reasonMissing) {
      setReasonAttempted(true);
      return;
    }
    setConfirmOpen(true);
  }

  function submit(): void {
    if (!canSubmit || reasonMissing) return;
    const counts = parsedLines.map((p) => ({
      lineId: p.line.id,
      receivedQty: p.received!,
      rejectedQty: p.rejected!,
      sellableQty: p.sellable!,
    }));
    startTransition(async () => {
      try {
        const result = isCorrect
          ? await correctReceiptAction({ returnId, counts, reason: reason.trim() })
          : await receiveAction({ returnId, counts });
        setConfirmOpen(false);
        if (result.ok) {
          toast.success(t(copy.success));
          onDone?.();
          router.refresh();
          return;
        }
        toast.error(t(fieldReturnErrorKey(result.code)));
      } catch {
        setConfirmOpen(false);
        toast.error(t(fieldReturnErrorKey("ERROR")));
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PackageCheck className="h-5 w-5" />
          {t(copy.title)}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{t(copy.hint)}</p>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("colProduct")}</TableHead>
                <TableHead>{t("colVariant")}</TableHead>
                <TableHead className="text-right">{t("colClaimed")}</TableHead>
                <TableHead className="text-right">{t("colReceived")}</TableHead>
                <TableHead className="text-right">{t("colRejected")}</TableHead>
                <TableHead className="text-right">{t("colSellable")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {parsedLines.map(({ line, sellable, rejectedTooHigh, recorded, receivedChanged }) => (
                <TableRow key={line.id}>
                  <TableCell>
                    <div>
                      <p className="font-medium">{line.itemName}</p>
                      <p className="text-xs text-muted-foreground font-mono">{line.itemSku}</p>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-sm">{line.variantSku || "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{line.qty}</TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={1}
                      aria-label={t("colReceived")}
                      className="h-10 w-24 text-right tabular-nums ml-auto"
                      disabled={isPending}
                      value={receivedInputs[line.id] ?? ""}
                      onChange={(e) =>
                        setReceivedInputs((prev) => ({ ...prev, [line.id]: e.target.value }))
                      }
                    />
                    {receivedChanged && recorded && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t("correctWas", { n: recorded.receivedQty })}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={1}
                      aria-label={t("colRejected")}
                      className="h-10 w-24 text-right tabular-nums ml-auto"
                      disabled={isPending}
                      value={rejectedInputs[line.id] ?? "0"}
                      onChange={(e) =>
                        setRejectedInputs((prev) => ({ ...prev, [line.id]: e.target.value }))
                      }
                    />
                    {rejectedTooHigh && (
                      <p className="mt-1 text-xs text-destructive">{t("rejectedExceedsReceived")}</p>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{sellable ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {isCorrect && (
          <div className="space-y-1">
            <Label htmlFor={`field-return-correct-reason-${returnId}`}>{t("correctReason")}</Label>
            <Textarea
              id={`field-return-correct-reason-${returnId}`}
              value={reason}
              maxLength={REASON_MAX_LENGTH}
              rows={3}
              disabled={isPending}
              aria-invalid={reasonAttempted && reasonMissing}
              onChange={(e) => setReason(e.target.value)}
            />
            {reasonAttempted && reasonMissing && (
              <p className="text-xs text-destructive">{t("correctReasonRequired")}</p>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {isCorrect && countsValid && !hasChanges && (
            <p className="mr-auto text-xs text-muted-foreground">{t("correctNoChange")}</p>
          )}
          {isCorrect && (
            <Button variant="outline" className="h-10" disabled={isPending} onClick={() => onDone?.()}>
              {tCommon("cancel")}
            </Button>
          )}
          <Button className="h-10" disabled={!canSubmit || isPending} onClick={openConfirm}>
            {t(copy.submit)}
          </Button>
        </div>
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={(open) => !isPending && setConfirmOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(copy.confirmTitle)}</AlertDialogTitle>
            <AlertDialogDescription>{t(copy.confirmDescription)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending}
              onClick={(e) => {
                /* Keep the dialog open so the pending label is visible; submit() closes it. */
                e.preventDefault();
                submit();
              }}
            >
              {isPending ? t("submitting") : t(copy.confirmAction)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
