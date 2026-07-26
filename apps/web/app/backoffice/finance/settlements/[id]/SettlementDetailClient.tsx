"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useState, useTransition } from "react";
import { useTranslations, useLocale } from "next-intl";
import { toast } from "sonner";
import {
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Repeat,
  Loader2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  BookText,
  ExternalLink,
} from "lucide-react";
import type { SettlementDetail, SettlementDetailLine } from "@/lib/finance/settlement/queries";
import { matchSettlementAction, postSettlementJournalAction } from "@/app/actions/settlements";
import {
  getResyncSummary,
  triggerSettlementResyncAction,
  type ResyncSummary,
} from "@/app/actions/jubelio-salesorder-resync";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const RESYNC_POLL_INTERVAL_MS = 2000;

type Props = {
  settlement: SettlementDetail;
  canManage: boolean;
};

function formatRupiah(value: number): string {
  return `Rp ${Math.round(value).toLocaleString("id-ID")}`;
}

export function SettlementDetailClient({ settlement, canManage }: Props) {
  const t = useTranslations("financeSettlements");
  const locale = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isPosting, startPostTransition] = useTransition();
  const [isResyncing, startResyncTransition] = useTransition();
  const [resyncBatchId, setResyncBatchId] = useState<string | null>(null);
  const [resyncSummary, setResyncSummary] = useState<ResyncSummary | null>(null);
  const [resyncPollError, setResyncPollError] = useState(false);

  // The resync runs server-side in the queue regardless of the browser, but
  // batchId lives only in component state — so it's lost on navigation/refresh,
  // orphaning the progress panel. Persist it per settlement and re-attach the
  // poller on mount so the panel (and the "rematch" CTA) survive leaving the page.
  const resyncStorageKey = `elorae:resyncBatch:${settlement.id}`;
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(resyncStorageKey);
    if (stored) setResyncBatchId(stored);
  }, [resyncStorageKey]);

  const formatDate = (iso: string) =>
    new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric" }).format(
      new Date(iso),
    );

  const matchedLines = settlement.lines.filter((l) => l.matchStatus === "MATCHED");
  const unmatchedLines = settlement.lines.filter((l) => l.matchStatus !== "MATCHED");

  const PAGE_SIZE = 25;
  const [matchedPage, setMatchedPage] = useState(1);
  const [unmatchedPage, setUnmatchedPage] = useState(1);
  const pageSlice = <T,>(rows: T[], page: number) => rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const [expandedLineIds, setExpandedLineIds] = useState<Set<string>>(new Set());
  function toggleExpanded(lineId: string) {
    setExpandedLineIds((prev) => {
      const next = new Set(prev);
      if (next.has(lineId)) next.delete(lineId);
      else next.add(lineId);
      return next;
    });
  }

  const statusVariant: "default" | "secondary" =
    settlement.status === "MATCHED" || settlement.status === "RECONCILED" ? "default" : "secondary";
  const statusLabel =
    settlement.status === "RECONCILED"
      ? t("statusReconciled")
      : settlement.status === "MATCHED"
        ? t("statusMatched")
        : t("statusParsed");

  function handleMatch() {
    startTransition(async () => {
      try {
        const result = await matchSettlementAction(settlement.id);
        if (result.ok) {
          toast.success(
            t("matchToastSuccess", {
              matched: String(result.matched),
              unmatched: String(result.unmatched),
              profitPending: String(result.profitPending),
            }),
          );
          // Batch's purpose is served once its orders are rematched — clear the
          // persisted batch so the panel doesn't linger on later visits.
          if (typeof window !== "undefined") {
            window.localStorage.removeItem(resyncStorageKey);
          }
          setResyncBatchId(null);
          setResyncSummary(null);
          router.refresh();
        } else if (result.reason === "FORBIDDEN") {
          toast.error(t("matchToastForbidden"));
        } else {
          toast.error(t("matchToastNotFound"));
        }
      } catch {
        toast.error(t("errGeneric"));
      }
    });
  }

  const resyncInFlight = resyncSummary
    ? resyncSummary.pending + resyncSummary.resolving + resyncSummary.fetching
    : 0;
  const resyncTerminal = resyncSummary !== null && resyncSummary.total > 0 && resyncInFlight === 0;
  const resyncDoneCount = resyncSummary
    ? resyncSummary.done + resyncSummary.notFound + resyncSummary.dead + resyncSummary.skipped
    : 0;
  const resyncProgressPct =
    resyncSummary && resyncSummary.total > 0
      ? Math.round((resyncDoneCount / resyncSummary.total) * 100)
      : 0;

  useEffect(() => {
    if (!resyncBatchId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function poll() {
      const res = await getResyncSummary(resyncBatchId!);
      if (cancelled) return;
      if (!res.ok) {
        setResyncPollError(true);
        if (timer) clearInterval(timer);
        return;
      }
      setResyncPollError(false);
      setResyncSummary(res);
      const inFlight = res.pending + res.resolving + res.fetching;
      if (inFlight === 0 && timer) {
        clearInterval(timer);
      }
    }

    void poll();
    timer = setInterval(poll, RESYNC_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [resyncBatchId]);

  function handleResync() {
    startResyncTransition(async () => {
      try {
        const result = await triggerSettlementResyncAction(settlement.id);
        if (result.ok) {
          toast.success(t("resyncToastSuccess", { seeded: String(result.seeded) }));
          setResyncSummary(null);
          setResyncPollError(false);
          setResyncBatchId(result.batchId);
          if (typeof window !== "undefined") {
            window.localStorage.setItem(resyncStorageKey, result.batchId);
          }
        } else {
          switch (result.code) {
            case "FORBIDDEN":
              toast.error(t("resyncToastForbidden"));
              break;
            case "NOT_FOUND":
              toast.error(t("resyncToastNotFound"));
              break;
            case "NO_UNMATCHED_ORDERS":
              toast.error(t("resyncToastNoUnmatched"));
              break;
            default:
              toast.error(t("resyncToastApiError", { message: result.message ?? "" }));
          }
        }
      } catch {
        toast.error(t("errGeneric"));
      }
    });
  }

  function handlePostJournal() {
    startPostTransition(async () => {
      try {
        const result = await postSettlementJournalAction(settlement.id);
        if (result.ok) {
          toast.success(result.created ? t("postJournalToastSuccess") : t("postJournalToastAlready"));
          router.refresh();
        } else {
          switch (result.code) {
            case "CHECKSUM_BLOCKED":
              toast.error(t("journalErr.CHECKSUM_BLOCKED"));
              break;
            case "UNMAPPED_ROLE":
              toast.error(t("journalErr.UNMAPPED_ROLE", { role: result.role ?? "" }));
              break;
            case "UNBALANCED":
              toast.error(t("journalErr.UNBALANCED"));
              break;
            case "ALREADY_RECONCILED_DIFF":
              toast.error(t("journalErr.ALREADY_RECONCILED_DIFF"));
              break;
            case "FORBIDDEN":
              toast.error(t("journalErr.FORBIDDEN"));
              break;
            case "NOT_FOUND":
              toast.error(t("journalErr.NOT_FOUND"));
              break;
            default:
              toast.error(t("errGeneric"));
          }
        }
      } catch {
        toast.error(t("errGeneric"));
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/backoffice/finance/settlements">
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t("back")}
          </Link>
        </Button>
        <div>
          <h1 className="text-xl font-semibold">
            {settlement.marketplace} · {settlement.seller}
          </h1>
          <p className="text-sm text-muted-foreground">
            {formatDate(settlement.periodFromIso)} – {formatDate(settlement.periodToIso)}
          </p>
        </div>
        <Badge variant={statusVariant}>{statusLabel}</Badge>

        {canManage && (
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" disabled={isPending} onClick={handleMatch}>
              <RefreshCw className={`h-4 w-4 mr-2 ${isPending ? "animate-spin" : ""}`} />
              {isPending ? t("matchOrdersPending") : t("matchOrdersButton")}
            </Button>

            {unmatchedLines.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                disabled={isResyncing || (resyncBatchId !== null && !resyncTerminal)}
                onClick={handleResync}
              >
                <Repeat className={`h-4 w-4 mr-2 ${isResyncing ? "animate-spin" : ""}`} />
                {isResyncing
                  ? t("resyncButtonPending")
                  : t("resyncButton", { count: String(unmatchedLines.length) })}
              </Button>
            )}

            {settlement.journalId ? (
              <>
                <Badge variant="default" className="gap-1">
                  <BookText className="h-3.5 w-3.5" />
                  {t("journalPosted")}
                </Badge>
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/backoffice/finance/journals/${settlement.journalId}`}>
                    <ExternalLink className="h-4 w-4 mr-2" />
                    {t("viewJournal")}
                  </Link>
                </Button>
              </>
            ) : (
              <div className="flex flex-col items-end gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!settlement.checksumOk || isPosting}
                  onClick={handlePostJournal}
                >
                  <BookText className={`h-4 w-4 mr-2 ${isPosting ? "animate-pulse" : ""}`} />
                  {isPosting ? t("postJournalPending") : t("postJournal")}
                </Button>
                {!settlement.checksumOk && (
                  <span className="text-xs text-muted-foreground">{t("postJournalChecksumHint")}</span>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {settlement.checksumOk ? (
        <Card className="flex-row items-center gap-2 p-4 border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-green-700 dark:text-green-400" />
          <span className="text-sm font-medium text-green-700 dark:text-green-400">
            {t("checksumBannerOk")}
          </span>
        </Card>
      ) : (
        <Card className="flex-row items-center gap-2 p-4 border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30">
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-700 dark:text-amber-400" />
          <span className="text-sm font-medium text-amber-700 dark:text-amber-400">
            {t("checksumBannerVariance", { amount: formatRupiah(settlement.checksumVariance) })}
          </span>
        </Card>
      )}

      {resyncBatchId && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              {!resyncTerminal && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />}
              {t("resyncPanelTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {resyncPollError ? (
              <p className="text-sm text-amber-700 dark:text-amber-400">
                {t("resyncSummaryErrForbidden")}
              </p>
            ) : resyncSummary === null ? (
              <p className="text-sm text-muted-foreground">{t("resyncRunningHint")}</p>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Progress value={resyncProgressPct} />
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {t("resyncProgressLabel", {
                      completed: String(resyncDoneCount),
                      total: String(resyncSummary.total),
                    })}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
                  <ResyncStatTile label={t("resyncStatPending")} value={resyncSummary.pending} />
                  <ResyncStatTile label={t("resyncStatResolving")} value={resyncSummary.resolving} />
                  <ResyncStatTile label={t("resyncStatFetching")} value={resyncSummary.fetching} />
                  <ResyncStatTile label={t("resyncStatDone")} value={resyncSummary.done} tone="good" />
                  <ResyncStatTile label={t("resyncStatNotFound")} value={resyncSummary.notFound} tone="warn" />
                  <ResyncStatTile label={t("resyncStatDead")} value={resyncSummary.dead} tone="bad" />
                  <ResyncStatTile label={t("resyncStatSkipped")} value={resyncSummary.skipped} />
                </div>

                {!resyncTerminal && (
                  <p className="text-xs text-muted-foreground">{t("resyncRunningHint")}</p>
                )}

                {resyncTerminal && (
                  <div className="flex flex-col gap-2 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="space-y-1">
                      <p className="text-sm text-muted-foreground">{t("resyncDoneHint")}</p>
                      {resyncSummary.dead > 0 && (
                        <p className="text-xs text-red-700 dark:text-red-400">
                          {t("resyncDeadHint", { count: String(resyncSummary.dead) })}
                        </p>
                      )}
                    </div>
                    <Button size="sm" disabled={isPending} onClick={handleMatch}>
                      <RefreshCw className={`h-4 w-4 mr-2 ${isPending ? "animate-spin" : ""}`} />
                      {isPending ? t("matchOrdersPending") : t("resyncRematchButton")}
                    </Button>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        {/* Reconciling trio: matchedNetIncome - totalCogs === totalProfit exactly. */}
        <KpiTile label={t("kpiNetIncomeMatched")} value={formatRupiah(settlement.matchedNetIncome)} />
        <KpiTile label={t("kpiCogs")} value={formatRupiah(settlement.totalCogs)} />
        <KpiTile label={t("kpiProfit")} value={formatRupiah(settlement.totalProfit)} />
        {/* Separate — sums ALL lines regardless of match/cogs status, does not tie to the trio above. */}
        <KpiTile label={t("kpiGrossNetIncome")} value={formatRupiah(settlement.totalNetIncome)} />
        <KpiTile label={t("kpiMatchRate")} value={`${settlement.matchRatePct}%`} />
        <KpiTile label={t("kpiUnmatched")} value={String(settlement.unmatchedCount)} />
        <KpiTile label={t("kpiProfitPending")} value={String(settlement.profitPendingCount)} />
        <KpiTile
          label={t("kpiDiffer")}
          value={String(settlement.differCount)}
          tone={settlement.differCount > 0 ? "warn" : undefined}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("matchedLinesTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {matchedLines.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">{t("noMatchedLines")}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-9" />
                    <TableHead>{t("colOrderNo")}</TableHead>
                    <TableHead className="text-right">{t("colNetIncome")}</TableHead>
                    <TableHead className="text-right">{t("colCogs")}</TableHead>
                    <TableHead className="text-right">{t("colProfit")}</TableHead>
                    <TableHead className="text-right">{t("compare.netDelta")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageSlice(matchedLines, matchedPage).map((line) => {
                    const isExpanded = expandedLineIds.has(line.id);
                    return (
                      <Fragment key={line.id}>
                        <TableRow
                          className="cursor-pointer"
                          onClick={() => toggleExpanded(line.id)}
                        >
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              aria-label={isExpanded ? t("compare.collapseLabel") : t("compare.expandLabel")}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleExpanded(line.id);
                              }}
                            >
                              {isExpanded ? (
                                <ChevronUp className="h-4 w-4" />
                              ) : (
                                <ChevronDown className="h-4 w-4" />
                              )}
                            </Button>
                          </TableCell>
                          <TableCell className="font-mono text-sm">{line.orderNo}</TableCell>
                          <TableCell className="text-right">{formatRupiah(line.netIncome)}</TableCell>
                          <TableCell className="text-right">
                            {line.cogsSnapshot === null ? "—" : formatRupiah(line.cogsSnapshot)}
                          </TableCell>
                          <TableCell className="text-right">
                            {line.profit === null ? (
                              <Badge variant="secondary">{t("costPending")}</Badge>
                            ) : (
                              formatRupiah(line.profit)
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <ComparisonBadge line={line} t={t} />
                          </TableCell>
                        </TableRow>
                        {isExpanded && (
                          <TableRow>
                            <TableCell colSpan={6} className="bg-muted/30 p-0">
                              <FeeBreakdownPanel line={line} t={t} />
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
              <TablePager total={matchedLines.length} page={matchedPage} pageSize={PAGE_SIZE} onPage={setMatchedPage} t={t} />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("unmatchedLinesTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">{t("coverageNote")}</p>
          {unmatchedLines.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">{t("noUnmatchedLines")}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("colOrderNo")}</TableHead>
                    <TableHead className="text-right">{t("colNetIncome")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageSlice(unmatchedLines, unmatchedPage).map((line) => (
                    <TableRow key={line.id}>
                      <TableCell className="font-mono text-sm">{line.orderNo}</TableCell>
                      <TableCell className="text-right">{formatRupiah(line.netIncome)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <TablePager total={unmatchedLines.length} page={unmatchedPage} pageSize={PAGE_SIZE} onPage={setUnmatchedPage} t={t} />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TablePager({
  total,
  page,
  pageSize,
  onPage,
  t,
}: {
  total: number;
  page: number;
  pageSize: number;
  onPage: (p: number) => void;
  t: (key: string) => string;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div className="flex items-center justify-between gap-2 pt-3">
      <span className="text-xs text-muted-foreground tabular-nums">{`${from}–${to} / ${total}`}</span>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          aria-label={t("prevPage")}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-xs tabular-nums px-1">{`${page} / ${totalPages}`}</span>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
          aria-label={t("nextPage")}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function KpiTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warn";
}) {
  const toneClass = tone === "warn" ? "text-amber-700 dark:text-amber-400" : "";
  return (
    <Card className="gap-1 p-3">
      <p className="text-xs text-muted-foreground truncate">{label}</p>
      <p className={`text-lg font-semibold tabular-nums truncate ${toneClass}`}>{value}</p>
    </Card>
  );
}

type TFn = (key: string) => string;

function ComparisonBadge({ line, t }: { line: SettlementDetailLine; t: TFn }) {
  if (line.netDelta === null) {
    return <Badge variant="secondary">{t("compare.statusUnavailable")}</Badge>;
  }
  return line.matches ? (
    <Badge className="bg-green-600 text-white hover:bg-green-600/90 dark:bg-green-700">
      {t("compare.statusMatches")}
    </Badge>
  ) : (
    <Badge variant="destructive">{t("compare.statusDiffers")}</Badge>
  );
}

function FeeRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{formatRupiah(value)}</span>
    </div>
  );
}

function FeeBreakdownPanel({ line, t }: { line: SettlementDetailLine; t: TFn }) {
  return (
    <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2">
      <div className="space-y-1">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          {t("compare.excelTitle")}
        </h3>
        <FeeRow label={t("compare.hargaAsliProduk")} value={line.hargaAsliProduk} />
        <FeeRow label={t("compare.totalDiskonProduk")} value={line.totalDiskonProduk} />
        <FeeRow label={t("compare.biayaAdministrasi")} value={line.biayaAdministrasi} />
        <FeeRow label={t("compare.biayaLayanan")} value={line.biayaLayanan} />
        <FeeRow label={t("compare.biayaKomisiAms")} value={line.biayaKomisiAms} />
        <FeeRow label={t("compare.biayaProsesPesanan")} value={line.biayaProsesPesanan} />
        <div className="flex justify-between border-t pt-1 text-sm font-medium">
          <span>{t("compare.netIncomeExcel")}</span>
          <span className="tabular-nums">{formatRupiah(line.netIncome)}</span>
        </div>
      </div>
      <div className="space-y-1">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          {t("compare.jubelioTitle")}
        </h3>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">{t("compare.netIncomeJubelio")}</span>
          <span className="tabular-nums">
            {line.jubelioNet === null ? "—" : formatRupiah(line.jubelioNet)}
          </span>
        </div>
        <div className="flex justify-between border-t pt-1 text-sm font-medium">
          <span>{t("compare.netDelta")}</span>
          <span className="tabular-nums">
            {line.netDelta === null ? "—" : formatRupiah(line.netDelta)}
          </span>
        </div>
        {line.netDelta === null && (
          <p className="text-xs text-muted-foreground">{t("compare.statusUnavailable")}</p>
        )}
      </div>
    </div>
  );
}

function ResyncStatTile({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  const toneClass =
    tone === "good"
      ? "text-green-700 dark:text-green-400"
      : tone === "warn"
        ? "text-amber-700 dark:text-amber-400"
        : tone === "bad"
          ? "text-red-700 dark:text-red-400"
          : "";
  return (
    <Card className="gap-1 p-3">
      <p className="text-xs text-muted-foreground truncate">{label}</p>
      <p className={`text-lg font-semibold tabular-nums truncate ${toneClass}`}>{value}</p>
    </Card>
  );
}
