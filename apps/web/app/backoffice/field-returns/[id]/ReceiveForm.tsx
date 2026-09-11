"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { PackageCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { receiveAction, type FieldReturnActionResult } from "@/app/actions/field-returns";

export type ReceivableLine = {
  id: string;
  itemName: string;
  itemSku: string;
  variantSku: string;
  qty: number;
};

type Props = {
  returnId: string;
  lines: ReceivableLine[];
};

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

function seedRejectedInputs(lines: ReceivableLine[]): Record<string, string> {
  return Object.fromEntries(lines.map((l) => [l.id, "0"]));
}

/**
 * Shown only when the retur is PENDING_WAREHOUSE_RECEIVING and the caller holds
 * field_returns:manage (decided server-side, passed down — never decided here). Every input,
 * including an all-zero line (the lost-sack case), is a valid count: there is deliberately no
 * positive-quantity guard anywhere in this form.
 */
export function ReceiveForm({ returnId, lines }: Props) {
  const t = useTranslations("fieldReturnReceiving");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [receivedInputs, setReceivedInputs] = useState<Record<string, string>>({});
  const [rejectedInputs, setRejectedInputs] = useState<Record<string, string>>(() =>
    seedRejectedInputs(lines)
  );
  const [confirmOpen, setConfirmOpen] = useState(false);

  const parsedLines = lines.map((line) => {
    const received = parseNonNegativeInt(receivedInputs[line.id] ?? "");
    const rejected = parseNonNegativeInt(rejectedInputs[line.id] ?? "");
    const sellable = received !== null && rejected !== null ? received - rejected : null;
    const rejectedTooHigh = received !== null && rejected !== null && rejected > received;
    return { line, received, rejected, sellable, rejectedTooHigh };
  });

  const canSubmit = parsedLines.every(
    (p) => p.received !== null && p.rejected !== null && !p.rejectedTooHigh
  );

  function submit(): void {
    if (!canSubmit) return;
    const counts = parsedLines.map((p) => ({
      lineId: p.line.id,
      receivedQty: p.received!,
      rejectedQty: p.rejected!,
      sellableQty: p.sellable!,
    }));
    startTransition(async () => {
      try {
        const result = await receiveAction({ returnId, counts });
        setConfirmOpen(false);
        if (result.ok) {
          toast.success(t("successReceived"));
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
          {t("receiveTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{t("receiveHint")}</p>
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
              {parsedLines.map(({ line, sellable, rejectedTooHigh }) => (
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
        <div className="flex justify-end">
          <Button className="h-10" disabled={!canSubmit || isPending} onClick={() => setConfirmOpen(true)}>
            {t("receiveSubmit")}
          </Button>
        </div>
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={(open) => !isPending && setConfirmOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("receiveConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("receiveConfirmDescription")}</AlertDialogDescription>
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
              {isPending ? t("submitting") : t("receiveConfirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
