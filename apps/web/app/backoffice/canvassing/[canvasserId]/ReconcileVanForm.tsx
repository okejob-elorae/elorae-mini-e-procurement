"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import type { VanReconcileRow } from "@/lib/canvassing/reconcile-queries";
import { recordVanReconcileAction } from "@/app/actions/van-reconcile";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Props = {
  canvasserId: string;
  rows: VanReconcileRow[];
};

type CountRow = VanReconcileRow & { countedQty: number };

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function ReconcileVanForm({ canvasserId, rows }: Props) {
  const t = useTranslations("canvassing");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [counts, setCounts] = useState<CountRow[]>(() => rows.map((r) => ({ ...r, countedQty: r.expectedQty })));
  const [note, setNote] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);

  function updateCounted(key: string, value: number) {
    setCounts((prev) => prev.map((r) => (`${r.itemId}::${r.variantSku ?? ""}` === key ? { ...r, countedQty: Math.max(0, value) } : r)));
  }

  const variances = useMemo(
    () => counts.map((r) => round2(r.expectedQty - r.countedQty)),
    [counts],
  );
  const hasVariance = variances.some((v) => v !== 0);
  const totalCounted = useMemo(() => round2(counts.reduce((sum, r) => sum + r.countedQty, 0)), [counts]);
  const totalVariance = useMemo(() => round2(variances.reduce((sum, v) => sum + v, 0)), [variances]);

  const reasonMissing = hasVariance && note.trim() === "";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setReasonError(null);

    if (reasonMissing) {
      setReasonError(t("reconcileErrVarianceNeedsReason"));
      return;
    }

    startTransition(async () => {
      try {
        const result = await recordVanReconcileAction({
          canvasserId,
          counts: counts.map((r) => ({ itemId: r.itemId, variantSku: r.variantSku, countedQty: r.countedQty })),
          note: note.trim() || undefined,
        });
        if (result.ok) {
          toast.success(t("reconcileSuccess", { docNo: result.docNo, variance: result.totalVarianceQty }));
          router.refresh();
          return;
        }
        if (result.reason === "VARIANCE_NEEDS_REASON") {
          setReasonError(t("reconcileErrVarianceNeedsReason"));
        } else if (result.reason === "EMPTY_VAN") {
          toast.error(t("reconcileErrEmptyVan"));
        } else if (result.reason === "COUNT_MISMATCH") {
          toast.error(t("reconcileErrCountMismatch"));
        } else if (result.reason === "FORBIDDEN") {
          toast.error(t("errForbidden"));
        } else {
          toast.error(t("errValidation"));
        }
      } catch {
        toast.error(t("errGeneric"));
      }
    });
  }

  if (rows.length === 0) return null;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("colItem")}</TableHead>
              <TableHead className="text-right">{t("colExpected")}</TableHead>
              <TableHead className="text-right">{t("colCounted")}</TableHead>
              <TableHead className="text-right">{t("colVariance")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {counts.map((row, idx) => {
              const key = `${row.itemId}::${row.variantSku ?? ""}`;
              const variance = variances[idx];
              return (
                <TableRow key={key}>
                  <TableCell className="font-medium">
                    <div>{row.productName}</div>
                    <div className="text-xs text-muted-foreground font-mono">{row.sku}</div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{row.expectedQty}</TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      disabled={pending}
                      value={row.countedQty}
                      onChange={(e) => updateCounted(key, parseFloat(e.target.value) || 0)}
                      className="ml-auto w-24 text-right"
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge
                      variant={variance !== 0 ? undefined : "secondary"}
                      className={variance !== 0 ? "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200" : undefined}
                    >
                      {variance}
                    </Badge>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {hasVariance && (
        <div className="space-y-1.5">
          <Label htmlFor="reconcile-reason" className="text-xs">{t("reconcileReasonLabel")}</Label>
          <Textarea
            id="reconcile-reason"
            rows={2}
            maxLength={500}
            disabled={pending}
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              if (reasonError) setReasonError(null);
            }}
            placeholder={t("reconcileReasonPlaceholder")}
            aria-invalid={reasonError ? true : undefined}
          />
          {reasonError && <p className="text-xs text-destructive">{reasonError}</p>}
        </div>
      )}

      <div className="rounded-md border p-3 space-y-1 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">{t("reconcileTotalCounted")}</span>
          <span className="tabular-nums font-medium">{totalCounted}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">{t("reconcileTotalVariance")}</span>
          <span className="tabular-nums font-medium">{totalVariance}</span>
        </div>
      </div>

      <Button type="submit" disabled={pending || reasonMissing} className="w-full">
        {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {pending ? t("reconcileSubmitting") : t("reconcileSubmit")}
      </Button>
    </form>
  );
}
