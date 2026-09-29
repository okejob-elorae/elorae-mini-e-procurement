"use client";

import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RETURN_STATUS_BADGE } from "@/lib/sales-returns/badges";
import { formatDateTime } from "@/lib/sales-orders/format";
import type { SalesReturnStatus } from "@/lib/constants/enums";

export type SalesOrderReturnSummaryRow = {
  id: string;
  jubelioReturnNo: string | null;
  jubelioReturnId: number;
  status: SalesReturnStatus;
  receivedAt: Date;
};

type Props = {
  returns: SalesOrderReturnSummaryRow[];
  unmatchedQty: number;
  canViewReturns: boolean;
};

export function ReturnsCard({ returns, unmatchedQty, canViewReturns }: Props) {
  const t = useTranslations("salesOrders.detail");
  const tr = useTranslations("salesReturns.list");
  const locale = useLocale();

  if (returns.length === 0) return null;

  return (
    <Card className="p-4 space-y-3">
      <h2 className="font-semibold">{t("section.returns")}</h2>
      <div className="space-y-2">
        {returns.map((ret) => {
          const badge = RETURN_STATUS_BADGE[ret.status];
          return (
            <div key={ret.id} className="flex items-center justify-between gap-2 text-sm">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-mono truncate">
                  {ret.jubelioReturnNo ?? `#${ret.jubelioReturnId}`}
                </span>
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs shrink-0 ${badge.tailwindClass}`}
                >
                  {tr(`status.${badge.labelKey}` as never)}
                </span>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-muted-foreground hidden sm:inline">
                  {formatDateTime(ret.receivedAt, locale)}
                </span>
                {canViewReturns && (
                  <Button variant="outline" size="sm" asChild className="h-10">
                    <Link href={`/backoffice/returns/${ret.id}`}>
                      {t("returns.viewLink")}
                    </Link>
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {unmatchedQty > 0 && (
        <div className="text-xs text-muted-foreground pt-2 border-t">
          {t("returns.unmatchedNote", { qty: unmatchedQty })}
        </div>
      )}
    </Card>
  );
}
