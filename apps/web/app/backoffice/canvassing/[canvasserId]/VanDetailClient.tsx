"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeft, ClipboardCheck, Clock, Package, Truck } from "lucide-react";
import type { VanStockRow, VanLoadRow, LoadableInventoryRow } from "@/lib/canvassing/queries";
import type { VanReconcileRow, VanReconcileListRow } from "@/lib/canvassing/reconcile-queries";
import { logPrint } from "@/app/actions/audit";
import { getVanLoadPrintData } from "@/app/actions/van-load-print";
import { buildVanLoadPrintHtml } from "@/lib/print/van-load-html";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LoadVanForm, type ItemOption } from "./LoadVanForm";
import { ReconcileVanForm } from "./ReconcileVanForm";

type Props = {
  canvasserId: string;
  canvasserName: string;
  vanStock: VanStockRow[];
  loads: VanLoadRow[];
  itemOptions: ItemOption[];
  loadableInventory: LoadableInventoryRow[];
  reconcileRows: VanReconcileRow[];
  reconciles: VanReconcileListRow[];
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString([], {
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

export function VanDetailClient({ canvasserId, canvasserName, vanStock, loads, itemOptions, loadableInventory, reconcileRows, reconciles }: Props) {
  const t = useTranslations("canvassing");
  const router = useRouter();

  async function handlePrintLoad(loadId: string) {
    const data = await getVanLoadPrintData(loadId);
    if (!data) {
      toast.error(t("errForbidden"));
      return;
    }
    await logPrint("VanLoad", loadId);
    const html = buildVanLoadPrintHtml({
      docNo: data.docNo,
      createdAt: data.createdAtIso,
      canvasserName: data.canvasserLabel,
      loadedByName: data.loadedByLabel,
      lines: data.lines,
      labels: {
        title: t("print.vanLoadTitle"),
        doc: t("print.docLabel"),
        canvasser: t("print.canvasserLabel"),
        loadedBy: t("print.loadedByLabel"),
        date: t("print.dateLabel"),
        no: t("print.colNo"),
        product: t("print.colProduct"),
        qty: t("print.colQty"),
        adminSign: t("print.adminSign"),
        canvasserSign: t("print.canvasserSign"),
        issuedBy: t("print.issuedBy"),
      },
    });
    printHtml(html, t("print.vanLoadTitle"));
  }

  return (
    <div className="space-y-6">
      <div className="-ml-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/backoffice/canvassing">
            <ArrowLeft className="h-4 w-4" />
            {t("pageTitle")}
          </Link>
        </Button>
      </div>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">{canvasserName}</h1>
        <p className="text-muted-foreground">{t("detailSubtitle")}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6 min-w-0">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Truck className="h-4 w-4" />
                {t("vanStockCardTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {vanStock.length === 0 ? (
                <div className="text-center py-8">
                  <Truck className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground">{t("emptyVanStock")}</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("colItem")}</TableHead>
                        <TableHead>{t("colVariant")}</TableHead>
                        <TableHead className="text-right">{t("colQty")}</TableHead>
                        <TableHead className="text-right">{t("colAvgCost")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {vanStock.map((row) => (
                        <TableRow key={`${row.itemId}::${row.variantSku ?? ""}`}>
                          <TableCell className="font-medium">
                            <div>{row.productName}</div>
                            <div className="text-xs text-muted-foreground font-mono">{row.sku}</div>
                          </TableCell>
                          <TableCell>{row.variantLabel ?? row.variantSku ?? "—"}</TableCell>
                          <TableCell className="text-right tabular-nums">{row.qty}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {row.avgCost.toLocaleString("id-ID")}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock className="h-4 w-4" />
                {t("loadHistoryCardTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loads.length === 0 ? (
                <div className="text-center py-8">
                  <Clock className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground">{t("emptyLoads")}</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("colDocNo")}</TableHead>
                        <TableHead>{t("colLoadedBy")}</TableHead>
                        <TableHead>{t("colDate")}</TableHead>
                        <TableHead className="text-right">{t("colLines")}</TableHead>
                        <TableHead className="text-right">{t("print.vanLoadButton")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {loads.map((load) => (
                        <TableRow key={load.id}>
                          <TableCell className="font-mono text-xs">{load.docNo}</TableCell>
                          <TableCell>{load.loadedByLabel}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {formatDateTime(load.createdAtIso)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{load.lineCount}</TableCell>
                          <TableCell className="text-right">
                            <Button variant="ghost" size="sm" onClick={() => handlePrintLoad(load.id)}>
                              {t("print.vanLoadButton")}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ClipboardCheck className="h-4 w-4" />
                {t("reconcileHistoryCardTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {reconciles.length === 0 ? (
                <div className="text-center py-8">
                  <ClipboardCheck className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground">{t("emptyReconciles")}</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("colDocNo")}</TableHead>
                        <TableHead>{t("colDate")}</TableHead>
                        <TableHead>{t("colReconciledBy")}</TableHead>
                        <TableHead className="text-right">{t("colTotalReturned")}</TableHead>
                        <TableHead className="text-right">{t("colVariance")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {reconciles.map((rec) => (
                        <TableRow
                          key={rec.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => router.push(`/backoffice/canvassing/reconcile/${rec.id}`)}
                        >
                          <TableCell className="font-mono text-xs">{rec.docNo}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {formatDateTime(rec.createdAtIso)}
                          </TableCell>
                          <TableCell>{rec.reconciledByLabel}</TableCell>
                          <TableCell className="text-right tabular-nums">{rec.totalReturnedQty}</TableCell>
                          <TableCell className="text-right tabular-nums">{rec.totalVarianceQty}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Package className="h-4 w-4" />
                {t("loadFormTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <LoadVanForm canvasserId={canvasserId} itemOptions={itemOptions} loadableInventory={loadableInventory} />
            </CardContent>
          </Card>

          {reconcileRows.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ClipboardCheck className="h-4 w-4" />
                  {t("reconcileSectionTitle")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ReconcileVanForm canvasserId={canvasserId} rows={reconcileRows} />
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
