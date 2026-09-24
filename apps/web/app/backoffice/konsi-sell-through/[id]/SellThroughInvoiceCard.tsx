"use client";

import { useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, Printer, Receipt, RefreshCw } from "lucide-react";
import type { SellThroughDetail } from "@/lib/konsi-sell-through/queries";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { buildKonsiSellThroughNotaHtml } from "@/lib/print/konsi-sell-through-nota-html";
import { printHtmlInIframe } from "@/lib/print/print-html-in-iframe";
import {
  getSellThroughNotaAction,
  recordSellThroughNotaPrinted,
  retrySellThroughJournalsAction,
  type SellThroughActionFailure,
} from "@/app/actions/konsi-sell-through";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatRupiahExact } from "./display";

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right">{children}</span>
    </div>
  );
}

export function SellThroughInvoiceCard({
  report,
  canPrint,
  canManage,
  describeError,
}: {
  report: SellThroughDetail;
  canPrint: boolean;
  canManage: boolean;
  describeError: (result: SellThroughActionFailure) => string;
}) {
  const t = useTranslations("konsiSellThrough");
  const tInvoice = useTranslations("konsiSellThrough.invoice");
  const tNota = useTranslations("konsiSellThrough.nota");
  const router = useRouter();
  const [retrying, startRetryTransition] = useTransition();
  const [printing, startPrintTransition] = useTransition();

  function callRetry(): void {
    startRetryTransition(async () => {
      try {
        const result = await retrySellThroughJournalsAction(report.id);
        if (result.ok) {
          if (result.stillPending.length === 0) toast.success(tInvoice("retryDone"));
          else toast.warning(tInvoice("retryStillPending", { n: result.stillPending.length }));
        } else {
          toast.error(describeError(result));
        }
        router.refresh();
      } catch {
        toast.error(t("err.UNEXPECTED"));
      }
    });
  }

  function callPrint(): void {
    startPrintTransition(async () => {
      try {
        const result = await getSellThroughNotaAction(report.id);
        if (!result.ok) {
          toast.error(describeError(result));
          return;
        }
        const html = buildKonsiSellThroughNotaHtml({
          ...result.nota,
          labels: {
            title: tNota("title"),
            doc: tNota("doc"),
            store: tNota("store"),
            npwp: tNota("npwp"),
            period: tNota("period"),
            periodFirst: tNota("periodFirst"),
            date: tNota("date"),
            dueDate: tNota("dueDate"),
            salesman: tNota("salesman"),
            no: tNota("no"),
            product: tNota("product"),
            qty: tNota("qty"),
            price: tNota("price"),
            lineTotal: tNota("lineTotal"),
            grandTotal: tNota("grandTotal"),
            issuedBy: tNota("issuedBy"),
            regards: tNota("regards"),
            receivedBy: tNota("receivedBy"),
          },
        });
        printHtmlInIframe(html, result.nota.docNo);
        /* Best-effort stamp + finance ping; it never throws and must never hold up the print. */
        void recordSellThroughNotaPrinted(report.id);
      } catch {
        toast.error(t("err.UNEXPECTED"));
      }
    });
  }

  const journalBanner = report.journalPending && (
    <div className="flex flex-col gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 sm:flex-row sm:items-center sm:justify-between">
      <p className="flex min-w-0 items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{tInvoice("journalPending")}</span>
      </p>
      {canManage && (
        <Button variant="outline" className="h-10 shrink-0" disabled={retrying} onClick={callRetry}>
          <RefreshCw className={retrying ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          {retrying ? tInvoice("retrying") : tInvoice("retryJournals")}
        </Button>
      )}
    </div>
  );

  if (report.baseline) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            <Receipt className="h-5 w-5" />
            {tInvoice("title")}
            <Badge variant="outline">{tInvoice("baselineBadge")}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{tInvoice("baselineNote")}</p>
          {report.baselineReason && (
            <div className="space-y-0.5 text-sm">
              <p className="text-muted-foreground">{tInvoice("baselineReason")}</p>
              <p className="whitespace-pre-line break-words">{report.baselineReason}</p>
            </div>
          )}
          <div className="space-y-1">
            <InfoRow label={tInvoice("unrelievedCost")}>
              <span className="font-medium tabular-nums">
                {report.unrelievedCost === null ? "—" : formatRupiahExact(report.unrelievedCost)}
              </span>
            </InfoRow>
            <p className="text-xs text-muted-foreground">{tInvoice("unrelievedCostHint")}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const total = report.total ?? 0;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <Receipt className="h-5 w-5" />
          {tInvoice("title")}
        </CardTitle>
        {canPrint && total > 0 && (
          <Button variant="outline" className="h-10" disabled={printing} onClick={callPrint}>
            <Printer className="h-4 w-4" />
            {printing ? tInvoice("printing") : tInvoice("printNota")}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {journalBanner}
        <div className="grid gap-2 sm:grid-cols-2">
          <InfoRow label={t("colDocNo")}>
            <span className="font-mono">{report.docNo}</span>
          </InfoRow>
          <InfoRow label={tInvoice("invoiceDate")}>
            {report.invoiceDate ? formatDateOnlyJakarta(report.invoiceDate) : "—"}
          </InfoRow>
          <InfoRow label={tInvoice("dueDate")}>
            {report.dueDate ? formatDateOnlyJakarta(report.dueDate) : "—"}
          </InfoRow>
          <InfoRow label={tInvoice("salesman")}>{report.salesmanLabel ?? "—"}</InfoRow>
          <InfoRow label={tInvoice("total")}>
            <span className="font-semibold tabular-nums">{formatRupiahExact(total)}</span>
          </InfoRow>
        </div>
        {total === 0 && <p className="text-sm text-muted-foreground">{tInvoice("nothingBilled")}</p>}
        {(report.receivableId || report.taxInvoiceId) && (
          <div className="flex flex-wrap gap-2">
            {report.receivableId && (
              <Button variant="outline" className="h-10" asChild>
                <Link href={`/backoffice/finance/piutang/${report.receivableId}`}>{tInvoice("viewReceivable")}</Link>
              </Button>
            )}
            {report.taxInvoiceId && (
              <Button variant="outline" className="h-10" asChild>
                <Link href={`/backoffice/finance/faktur-pajak?q=${encodeURIComponent(report.docNo)}`}>
                  {tInvoice("viewFaktur")}
                </Link>
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
