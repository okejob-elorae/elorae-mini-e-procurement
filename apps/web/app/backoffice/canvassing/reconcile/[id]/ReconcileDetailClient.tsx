"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeft, Printer } from "lucide-react";
import type { VanReconcileDetail } from "@/lib/canvassing/reconcile-queries";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { logPrint } from "@/app/actions/audit";
import { buildVanReconcilePrintHtml } from "@/lib/print/van-reconcile-html";

type Props = {
  reconcile: VanReconcileDetail;
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function printHtml(html: string, title: string) {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("style", "position:absolute;width:0;height:0;border:0;visibility:hidden;");
  iframe.setAttribute("title", title);
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow?.document;
  if (doc) {
    doc.open(); doc.write(html); doc.close();
    setTimeout(() => iframe.contentWindow?.print(), 350);
  }
  setTimeout(() => document.body.removeChild(iframe), 500);
}

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

export function ReconcileDetailClient({ reconcile }: Props) {
  const t = useTranslations("canvassing");

  const handlePrint = async () => {
    await logPrint("VanReconcile", reconcile.id);
    const html = buildVanReconcilePrintHtml({
      docNo: reconcile.docNo,
      createdAt: reconcile.createdAtIso,
      canvasserName: reconcile.canvasserLabel,
      reconciledByName: reconcile.reconciledByLabel,
      note: reconcile.note,
      totalReturnedQty: reconcile.totalReturnedQty,
      totalVarianceQty: reconcile.totalVarianceQty,
      lines: reconcile.lines.map((line) => ({
        productName: line.productName,
        variantSku: line.variantSku,
        expectedQty: line.expectedQty,
        countedQty: line.countedQty,
        varianceQty: line.varianceQty,
      })),
      labels: {
        title: t("print.reconcileTitle"),
        doc: t("print.docLabel"),
        canvasser: t("print.canvasserLabel"),
        reconciledBy: t("print.reconciledByLabel"),
        date: t("print.dateLabel"),
        product: t("print.colProduct"),
        expected: t("print.colExpected"),
        counted: t("print.colCounted"),
        variance: t("print.colVariance"),
        totalReturned: t("print.totalReturned"),
        totalVariance: t("print.totalVariance"),
        reason: t("print.reasonLabel"),
        canvasserSign: t("print.canvasserSign"),
        adminSign: t("print.adminSign"),
        issuedBy: t("print.issuedBy"),
      },
    });
    printHtml(html, t("print.reconcileButton"));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/backoffice/canvassing">
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t("pageTitle")}
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold font-mono">{reconcile.docNo}</h1>
        <Button variant="outline" size="sm" className="ml-auto" onClick={handlePrint}>
          <Printer className="h-4 w-4 mr-2" />
          {t("print.reconcileButton")}
        </Button>
      </div>

      <Card className="p-4 space-y-2">
        <h2 className="font-semibold">{t("reconcileSectionTitle")}</h2>
        <Field label={t("colCanvasser")} value={reconcile.canvasserLabel} />
        <Field label={t("colReconciledBy")} value={reconcile.reconciledByLabel} />
        <Field label={t("colDate")} value={formatDateTime(reconcile.createdAtIso)} />
        <Field label={t("note")} value={reconcile.note} />
        <div className="pt-2 border-t space-y-1">
          <div className="flex justify-between text-sm font-semibold">
            <span>{t("reconcileTotalCounted")}</span>
            <span className="tabular-nums">{reconcile.totalReturnedQty}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">{t("reconcileTotalVariance")}</span>
            <span className="tabular-nums">{reconcile.totalVarianceQty}</span>
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("colItem")}</TableHead>
                <TableHead>{t("colVariant")}</TableHead>
                <TableHead className="text-right">{t("colExpected")}</TableHead>
                <TableHead className="text-right">{t("colCounted")}</TableHead>
                <TableHead className="text-right">{t("colVariance")}</TableHead>
                <TableHead className="text-right">{t("colUnitCost")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reconcile.lines.map((line, i) => (
                <TableRow key={i}>
                  <TableCell>{line.productName}</TableCell>
                  <TableCell className="font-mono text-sm">{line.variantSku || "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{line.expectedQty}</TableCell>
                  <TableCell className="text-right tabular-nums">{line.countedQty}</TableCell>
                  <TableCell className="text-right tabular-nums">{line.varianceQty}</TableCell>
                  <TableCell className="text-right tabular-nums">{line.unitCost.toLocaleString("id-ID")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
