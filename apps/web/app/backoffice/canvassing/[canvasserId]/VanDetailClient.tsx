"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeft, Clock, Package, Truck } from "lucide-react";
import type { VanStockRow, VanLoadRow } from "@/lib/canvassing/queries";
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

type Props = {
  canvasserId: string;
  canvasserName: string;
  vanStock: VanStockRow[];
  loads: VanLoadRow[];
  itemOptions: ItemOption[];
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

export function VanDetailClient({ canvasserId, canvasserName, vanStock, loads, itemOptions }: Props) {
  const t = useTranslations("canvassing");

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
                          <TableCell>{row.variantSku ?? "—"}</TableCell>
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
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="min-w-0">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Package className="h-4 w-4" />
                {t("loadFormTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <LoadVanForm canvasserId={canvasserId} itemOptions={itemOptions} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
