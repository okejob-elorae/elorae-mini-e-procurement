"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useTranslations, useLocale } from "next-intl";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2, AlertTriangle, RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";
import type { SettlementDetail } from "@/lib/finance/settlement/queries";
import { matchSettlementAction } from "@/app/actions/settlements";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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

  const statusVariant: "default" | "secondary" =
    settlement.status === "MATCHED" ? "default" : "secondary";
  const statusLabel = settlement.status === "MATCHED" ? t("statusMatched") : t("statusParsed");

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
          <div className="ml-auto">
            <Button size="sm" disabled={isPending} onClick={handleMatch}>
              <RefreshCw className={`h-4 w-4 mr-2 ${isPending ? "animate-spin" : ""}`} />
              {isPending ? t("matchOrdersPending") : t("matchOrdersButton")}
            </Button>
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
                    <TableHead>{t("colOrderNo")}</TableHead>
                    <TableHead className="text-right">{t("colNetIncome")}</TableHead>
                    <TableHead className="text-right">{t("colCogs")}</TableHead>
                    <TableHead className="text-right">{t("colProfit")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageSlice(matchedLines, matchedPage).map((line) => (
                    <TableRow key={line.id}>
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
                    </TableRow>
                  ))}
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

function KpiTile({ label, value }: { label: string; value: string }) {
  return (
    <Card className="gap-1 p-3">
      <p className="text-xs text-muted-foreground truncate">{label}</p>
      <p className="text-lg font-semibold tabular-nums truncate">{value}</p>
    </Card>
  );
}
