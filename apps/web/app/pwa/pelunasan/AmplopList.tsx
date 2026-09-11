"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeft, CheckCircle2, Store, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import {
  STATUS_BADGE_VARIANT,
  STATUS_LABEL_KEY,
  type TaxInvoiceStatusValue,
} from "@/lib/tax-invoices/status-display";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export type AmplopReceivableItem = {
  receivableId: string;
  docNo: string;
  dueDateIso: string;
  outstandingAmount: number;
  daysOverdue: number;
  taxInvoiceStatus: TaxInvoiceStatusValue | null;
  pendingSubmittedAmount: number;
};

export type AmplopStoreItem = {
  storeId: string;
  storeName: string;
  rows: AmplopReceivableItem[];
  totalOutstanding: number;
  totalOverdue: number;
  availableCredit: number;
};

type Props = {
  stores: AmplopStoreItem[];
  totalOutstanding: number;
  totalOverdue: number;
  canSubmitSettlement: boolean;
};

function formatRupiah(value: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}

export function AmplopList({ stores, totalOutstanding, totalOverdue, canSubmitSettlement }: Props) {
  const t = useTranslations("pwa.amplop");
  const tFaktur = useTranslations("fakturPajakStatus");
  const tNav = useTranslations("pwa.nav");

  return (
    <div className="p-4 space-y-4">
      <header className="flex items-center gap-2 -ml-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/pwa">
            <ArrowLeft className="h-4 w-4" />
            {tNav("home")}
          </Link>
        </Button>
      </header>

      <div>
        <h1 className="text-2xl font-bold leading-tight">{t("title")}</h1>
        <p className="text-xs text-muted-foreground">{t("count", { count: stores.length })}</p>
      </div>

      {stores.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-6 text-center">
            <CheckCircle2 className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">{t("emptyTitle")}</p>
            <p className="text-xs text-muted-foreground">{t("emptyHint")}</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex gap-4 rounded-lg border bg-muted/30 p-3 text-sm">
            <div className="flex-1 min-w-0">
              <p className="truncate text-xs text-muted-foreground">{t("totalOutstandingLabel")}</p>
              <p className="truncate font-semibold tabular-nums">{formatRupiah(totalOutstanding)}</p>
            </div>
            <div className="flex-1 min-w-0 text-right">
              <p className="truncate text-xs text-muted-foreground">{t("totalOverdueLabel")}</p>
              <p
                className={cn(
                  "truncate font-semibold tabular-nums",
                  totalOverdue > 0 && "text-destructive",
                )}
              >
                {formatRupiah(totalOverdue)}
              </p>
            </div>
          </div>

          <ul className="space-y-3">
            {stores.map((store) => (
              <li key={store.storeId}>
                <Card>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="rounded-full bg-primary p-2 shrink-0">
                        <Store className="h-4 w-4 text-primary-foreground" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold leading-tight">{store.storeName}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <p className="text-muted-foreground">{t("storeOutstandingLabel")}</p>
                        <p className="font-medium tabular-nums">{formatRupiah(store.totalOutstanding)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-muted-foreground">{t("storeOverdueLabel")}</p>
                        <p
                          className={cn(
                            "font-medium tabular-nums",
                            store.totalOverdue > 0 && "text-destructive",
                          )}
                        >
                          {formatRupiah(store.totalOverdue)}
                        </p>
                      </div>
                    </div>

                    {store.availableCredit > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {t("availableCreditLabel")}:{" "}
                        <span className="font-medium text-foreground">
                          {formatRupiah(store.availableCredit)}
                        </span>
                      </p>
                    )}

                    <ul className="space-y-2 border-t pt-2">
                      {store.rows.map((row) => {
                        const overdue = row.daysOverdue > 0;
                        return (
                          <li key={row.receivableId} className="rounded-md border p-2 space-y-1.5">
                            <div className="flex items-center justify-between gap-2">
                              <p className="truncate text-sm font-medium">{row.docNo}</p>
                              <Badge
                                variant={overdue ? "destructive" : "secondary"}
                                className={cn(
                                  "shrink-0 text-[10px] px-1.5 py-0",
                                  !overdue && "text-muted-foreground",
                                )}
                              >
                                {overdue ? `${row.daysOverdue}d` : t("notYetDue")}
                              </Badge>
                            </div>

                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <div>
                                <p className="text-muted-foreground">{t("colDueDate")}</p>
                                <p className="tabular-nums">{formatDateOnlyJakarta(new Date(row.dueDateIso))}</p>
                              </div>
                              <div className="text-right">
                                <p className="text-muted-foreground">{t("colOutstanding")}</p>
                                <p className="font-medium tabular-nums">{formatRupiah(row.outstandingAmount)}</p>
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              {row.taxInvoiceStatus ? (
                                <Badge
                                  variant={STATUS_BADGE_VARIANT[row.taxInvoiceStatus]}
                                  className="text-[10px] px-1.5 py-0"
                                >
                                  {tFaktur(STATUS_LABEL_KEY[row.taxInvoiceStatus])}
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">
                                  {t("noFaktur")}
                                </Badge>
                              )}
                              {row.pendingSubmittedAmount > 0 && (
                                <span className="text-muted-foreground">
                                  {t("pendingSubmittedLabel")}: {formatRupiah(row.pendingSubmittedAmount)}
                                </span>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>

                    {canSubmitSettlement && (
                      <Button asChild className="w-full" size="lg">
                        <Link href={`/pwa/pelunasan/${store.storeId}`}>
                          <Wallet className="h-4 w-4" />
                          {t("settleButton")}
                        </Link>
                      </Button>
                    )}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
