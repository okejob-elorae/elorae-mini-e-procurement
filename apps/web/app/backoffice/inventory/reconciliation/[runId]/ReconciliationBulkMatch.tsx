"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
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
import { resolveReconciliationItems } from "@/app/actions/stock-reconciliation";
import {
  RECON_BULK_BATCH_MAX,
  chunkIds,
  idsForQuickSelect,
  summarizeBulkOutcomes,
  type ReconBulkOutcome,
  type ReconBulkSummary,
  type ReconQuickSelect,
  type ReconSelectableRow,
} from "@/lib/inventory/reconciliation-selection";

type BulkSummary = ReconBulkSummary & { notSent: number };

const QUICK_SELECTS: Array<{ rule: ReconQuickSelect; labelKey: "allFlagged" | "eloraeNegative" | "jubelioHigher" }> = [
  { rule: "ALL_FLAGGED", labelKey: "allFlagged" },
  { rule: "ELORAE_NEGATIVE", labelKey: "eloraeNegative" },
  { rule: "JUBELIO_HIGHER", labelKey: "jubelioHigher" },
];

/**
 * Bulk MATCH_JUBELIO over the selected FLAGGED rows of one run. The selection lives in the parent,
 * which renders the row checkboxes; this owns the quick-select buttons, the confirmation, and the
 * batch loop. Batches go one at a time, each at most `RECON_BULK_BATCH_MAX` ids, so Stop takes
 * effect between batches and a closed tab simply leaves the unsent rows FLAGGED.
 */
export function ReconciliationBulkMatch({
  rows,
  selectedIds,
  onSelectionChange,
  running,
  onRunningChange,
  onFinished,
}: {
  rows: ReconSelectableRow[];
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  running: boolean;
  onRunningChange: (running: boolean) => void;
  onFinished: () => Promise<void>;
}) {
  const t = useTranslations("stockReconciliation");
  const tCommon = useTranslations("common");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [stopRequested, setStopRequested] = useState(false);
  const [summary, setSummary] = useState<BulkSummary | null>(null);
  const stopRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      /* Leaving the page stops the loop before its next batch rather than writing in the background. */
      mountedRef.current = false;
      stopRef.current = true;
    };
  }, []);

  const quickSelectIds = useMemo(
    () => new Map(QUICK_SELECTS.map(({ rule }) => [rule, idsForQuickSelect(rows, rule)])),
    [rows],
  );

  const addToSelection = (ids: string[]) => {
    onSelectionChange([...new Set([...selectedIds, ...ids])]);
  };

  const requestStop = () => {
    stopRef.current = true;
    setStopRequested(true);
  };

  const runBulk = async () => {
    const ids = selectedIds;
    setConfirmOpen(false);
    setSummary(null);
    stopRef.current = false;
    setStopRequested(false);
    setProgress({ done: 0, total: ids.length });
    onRunningChange(true);

    const outcomes: ReconBulkOutcome[] = [];
    const notMatched: string[] = [];
    let sent = 0;
    for (const batch of chunkIds(ids, RECON_BULK_BATCH_MAX)) {
      if (stopRef.current) break;
      let res: Awaited<ReturnType<typeof resolveReconciliationItems>> | null = null;
      try {
        res = await resolveReconciliationItems({ resultIds: batch });
      } catch {
        res = null;
      }
      if (res && res.success) {
        for (const row of res.rows) {
          outcomes.push(row.success ? { success: true } : { success: false, reason: row.reason });
          if (!row.success) notMatched.push(row.resultId);
        }
      } else {
        /* The whole batch was refused or the call failed: every row in it is unmatched. */
        const reason = res && !res.success ? res.reason : "UNEXPECTED";
        for (const id of batch) {
          outcomes.push({ success: false, reason });
          notMatched.push(id);
        }
      }
      sent += batch.length;
      if (mountedRef.current) setProgress({ done: sent, total: ids.length });
    }

    if (!mountedRef.current) return;
    const notSent = ids.slice(sent);
    const result: BulkSummary = { ...summarizeBulkOutcomes(outcomes), notSent: notSent.length };
    setSummary(result);
    setProgress(null);
    setStopRequested(false);
    onRunningChange(false);
    onSelectionChange([...notMatched, ...notSent]);

    const unmatchedCount = notMatched.length + notSent.length;
    if (unmatchedCount === 0) {
      toast.success(t("bulk.toastAllMatched", { count: result.matched }));
    } else {
      toast.warning(t("bulk.toastPartial", { matched: result.matched, notMatched: unmatchedCount }));
    }
    await onFinished();
  };

  const percent = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const progressLabel = stopRequested
    ? t("bulk.stopping")
    : t("bulk.progress", { done: progress?.done ?? 0, total: progress?.total ?? 0 });
  const hasUnmatched = summary !== null && (summary.refused.length > 0 || summary.notSent > 0);

  return (
    <div className="mb-4 space-y-3">
      <div className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">{t("bulk.selectLabel")}</span>
          {QUICK_SELECTS.map(({ rule, labelKey }) => {
            const ids = quickSelectIds.get(rule) ?? [];
            return (
              <Button
                key={rule}
                size="sm"
                variant="outline"
                disabled={running || ids.length === 0}
                onClick={() => addToSelection(ids)}
              >
                {t(`bulk.${labelKey}`, { count: ids.length })}
              </Button>
            );
          })}
          {selectedIds.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              disabled={running}
              onClick={() => onSelectionChange([])}
            >
              {t("bulk.clear")}
            </Button>
          )}
        </div>
        <Button
          className="sm:shrink-0"
          disabled={running || selectedIds.length === 0}
          onClick={() => setConfirmOpen(true)}
        >
          {running && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t("bulk.matchSelected", { count: selectedIds.length })}
        </Button>
      </div>

      {progress && (
        <div className="space-y-2 rounded-md border p-3" role="status" aria-live="polite">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm">{progressLabel}</p>
            <Button
              size="sm"
              variant="outline"
              disabled={stopRequested}
              onClick={requestStop}
            >
              {t("bulk.stop")}
            </Button>
          </div>
          <Progress value={percent} />
        </div>
      )}

      {summary && !progress && (
        <div className="flex items-start justify-between gap-3 rounded-md border p-3" role="status">
          <div className="space-y-1 text-sm">
            <p className="font-medium">{t("bulk.summaryMatched", { count: summary.matched })}</p>
            {summary.refused.map(({ reason, count }) => {
              const reasonText = t(`err.${reason}`);
              return (
                <p key={reason} className="text-muted-foreground">
                  {t("bulk.summaryRefused", { count, reason: reasonText })}
                </p>
              );
            })}
            {summary.notSent > 0 && (
              <p className="text-muted-foreground">{t("bulk.summaryNotSent", { count: summary.notSent })}</p>
            )}
            {hasUnmatched && (
              <p className="text-muted-foreground">{t("bulk.summaryKeptSelected")}</p>
            )}
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSummary(null)}
          >
            {t("bulk.dismiss")}
          </Button>
        </div>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("bulk.confirmTitle", { count: selectedIds.length })}</AlertDialogTitle>
            <AlertDialogDescription>{t("bulk.confirmDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void runBulk()}>
              {t("bulk.confirmAction", { count: selectedIds.length })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
