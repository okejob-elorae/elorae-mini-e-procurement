"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { formatDistanceToNow } from "date-fns";
import {
  getExpectedPosition,
  getPositionDrift,
  type SnapshotStep,
} from "@/lib/leadtime/calculations";
import {
  shouldCollapseToCompletedSummary,
  shouldHideLiveStrip,
} from "@/lib/leadtime/strip-visibility";
import { confirmChainPosition, getProcessMetaByNames } from "@/app/actions/lead-time";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";

type DocType = "PO" | "WO";

type Props = {
  docType: DocType;
  docId: string;
  snapshot: SnapshotStep[];
  clockStart: Date;
  chainTotalDays: number;
  confirmedIndex: number | null;
  confirmedAt: Date | null;
  confirmedSource?: string | null;
  actualLeadDays: number | null;
  status: string;
  canConfirm: boolean;
  onUpdated?: () => void;
  /** @deprecated use docType+docId */
  poId?: string;
  /** @deprecated use clockStart */
  createdAt?: Date;
};

export function ChainPositionStrip({
  docType: docTypeProp,
  docId: docIdProp,
  snapshot,
  clockStart: clockStartProp,
  chainTotalDays,
  confirmedIndex,
  confirmedAt,
  confirmedSource,
  actualLeadDays,
  status,
  canConfirm,
  onUpdated,
  poId,
  createdAt,
}: Props) {
  const t = useTranslations("leadTime.po");
  const docType = docTypeProp ?? "PO";
  const docId = docIdProp ?? poId ?? "";
  const clockStart = clockStartProp ?? createdAt ?? new Date();

  const [approvalByName, setApprovalByName] = useState<Record<string, boolean>>(
    {}
  );
  const [sopByName, setSopByName] = useState<Record<string, string | null>>({});

  useEffect(() => {
    const names = snapshot.map((s) => s.name);
    if (names.length === 0) return;
    void getProcessMetaByNames(names).then((meta) => {
      setApprovalByName(meta.isApproval);
      setSopByName(meta.sopInstructions);
    });
  }, [snapshot]);

  if (shouldHideLiveStrip(docType, status)) {
    return null;
  }

  const completedBanner =
    actualLeadDays != null ? (
      <div
        className={`rounded-md border px-3 py-2 text-sm ${
          actualLeadDays <= chainTotalDays
            ? "border-green-500/40 bg-green-50 dark:bg-green-950/20"
            : "border-red-500/40 bg-red-50 dark:bg-red-950/20"
        }`}
      >
        {t("completedSummary", {
          actual: actualLeadDays,
          estimated: chainTotalDays,
        })}
      </div>
    ) : shouldCollapseToCompletedSummary(docType, status) ? (
      <div className="rounded-md border px-3 py-2 text-sm text-muted-foreground">
        {t("completedSummary", {
          actual: "—",
          estimated: chainTotalDays,
        })}
      </div>
    ) : null;

  if (shouldCollapseToCompletedSummary(docType, status)) {
    return completedBanner;
  }

  const expected = getExpectedPosition(snapshot, clockStart, new Date());
  const drift = getPositionDrift(expected, confirmedIndex);
  const parkedOnApproval =
    confirmedIndex != null &&
    Boolean(approvalByName[snapshot[confirmedIndex]?.name ?? ""]);

  async function confirm(stepIndex: number | null) {
    const result = await confirmChainPosition({
      docType,
      docId,
      stepIndex,
    });
    if (!result.success) {
      toast.error(result.error ?? "Failed");
      return;
    }
    toast.success("OK");
    onUpdated?.();
  }

  const expectedSop =
    expected.stepName != null ? sopByName[expected.stepName] : null;

  return (
    <div className="rounded-md border px-3 py-3 space-y-3">
      {completedBanner}
      <div className="text-sm font-medium">
        {expected.status === "PAST_DUE"
          ? t("stripOverdue", { days: expected.overdueDays })
          : t("stripTitle", {
              day: expected.elapsedDays + 1,
              total: chainTotalDays,
            })}
      </div>

      <div className="flex flex-wrap items-center gap-1 text-xs">
        {snapshot.map((step, i) => {
          const done =
            expected.status === "PAST_DUE" ||
            (expected.stepIndex != null && i < expected.stepIndex);
          const active =
            expected.status === "IN_PROGRESS" && expected.stepIndex === i;
          const isApproval = Boolean(approvalByName[step.name]);
          return (
            <div key={step.seq} className="flex items-center gap-1">
              {i > 0 && <span className="text-muted-foreground">──</span>}
              <span
                className={`rounded px-2 py-1 border ${
                  active
                    ? "border-primary bg-primary/10 font-semibold animate-pulse"
                    : done
                      ? "border-muted-foreground/30 bg-muted"
                      : "border-dashed text-muted-foreground"
                }`}
              >
                {done || active ? (done ? "✓ " : "● ") : ""}
                {isApproval ? "✋ " : ""}
                {step.name}
                <span className="ml-1 opacity-70">{step.computedDays}h</span>
              </span>
            </div>
          );
        })}
      </div>

      <div className="text-sm space-y-1">
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-muted-foreground">{t("expected")}: </span>
          {expected.status === "IN_PROGRESS" && expected.stepName
            ? `${expected.stepName} (${t("dayInStep", {
                day: expected.dayInStep ?? 0,
                total: snapshot[expected.stepIndex!]?.computedDays ?? 0,
              })})`
            : expected.status === "PAST_DUE"
              ? t("stripOverdue", { days: expected.overdueDays })
              : "—"}
          {expectedSop && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground text-xs underline-offset-2"
                    aria-label="SOP"
                  >
                    ⓘ
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs whitespace-pre-wrap">
                  {expectedSop}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {confirmedIndex != null && (
            <span>
              <span className="text-muted-foreground">{t("confirmed")}: </span>
              {snapshot[confirmedIndex]?.name ?? "—"}
              {confirmedAt
                ? ` · ${formatDistanceToNow(confirmedAt, { addSuffix: true })}`
                : ""}
              {confirmedSource === "AUTO" ? ` · ${t("autoSource")}` : ""}
              {parkedOnApproval ? ` · ${t("awaitingAccShort")}` : ""}
            </span>
          )}
          {canConfirm && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline">
                  {t("updatePosition")} ▾
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {snapshot.map((step, i) => {
                  const highlight =
                    parkedOnApproval &&
                    approvalByName[step.name] &&
                    i === confirmedIndex;
                  return (
                    <DropdownMenuItem
                      key={step.seq}
                      className={highlight ? "font-semibold" : undefined}
                      onClick={() => void confirm(i)}
                    >
                      {approvalByName[step.name] ? "✋ " : ""}
                      {step.name}
                    </DropdownMenuItem>
                  );
                })}
                <DropdownMenuItem onClick={() => void confirm(null)}>
                  {t("clearConfirmation")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {drift.isBehind && drift.lagSteps != null && (
          <p className="text-amber-700 dark:text-amber-400">
            ⚠ {t("behindWarning", { steps: drift.lagSteps })}
          </p>
        )}
        {drift.lagSteps != null && drift.lagSteps < 0 && (
          <p className="text-green-700 dark:text-green-400">{t("aheadNote")}</p>
        )}
      </div>
    </div>
  );
}
