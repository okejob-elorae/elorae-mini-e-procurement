"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";
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
