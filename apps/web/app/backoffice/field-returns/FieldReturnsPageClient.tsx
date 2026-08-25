"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Search, Undo2 } from "lucide-react";
import type { FieldReturnRow, FieldReturnStatus } from "@/lib/field-sales/retur/queries";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Pager } from "@/components/Pager";

const ROUTE = "/backoffice/field-returns";

type Props = {
  rows: FieldReturnRow[];
  total: number;
  q: string;
  page: number;
  pageSize: number;
};

const STATUS_BADGE_VARIANT: Record<FieldReturnStatus, "secondary" | "destructive" | "default" | "outline"> = {
  PENDING_WAREHOUSE_RECEIVING: "secondary",
  MISMATCH_PENDING_RESOLUTION: "outline",
  PENDING_APPROVAL: "outline",
  APPROVED: "default",
  CANCELLED: "destructive",
};

/* The two "someone needs to act on this" states get the same amber highlight as the detail page. */
const STATUS_BADGE_CLASS: Record<FieldReturnStatus, string> = {
  PENDING_WAREHOUSE_RECEIVING: "",
  MISMATCH_PENDING_RESOLUTION: "border-amber-500/40 text-amber-700",
  PENDING_APPROVAL: "border-amber-500/40 text-amber-700",
  APPROVED: "",
  CANCELLED: "",
};

/** Same 2dp Rupiah formatting the detail page uses — money always renders id-ID grouped. */
function formatMoney2(n: number): string {
  return `Rp ${n.toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function FieldReturnsPageClient(props: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const t = useTranslations("fieldReturns");
  const [, startTransition] = useTransition();
  const [searchInput, setSearchInput] = useState(props.q);

  useEffect(() => {
    const handle = setTimeout(() => {
      if (searchInput !== props.q) pushParam("q", searchInput || undefined);
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  function pushParams(updates: Record<string, string | undefined>): void {
    const params = new URLSearchParams(sp.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (!value) params.delete(key);
      else params.set(key, value);
    }
    startTransition(() => router.push(`${ROUTE}?${params.toString()}`));
  }

  function pushParam(key: string, value: string | undefined): void {
    pushParams({ [key]: value, page: undefined });
  }

  function reset(): void {
    setSearchInput("");
    startTransition(() => router.push(ROUTE));
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{t("pageTitle")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-3">
            <label className="text-xs text-muted-foreground mb-1 block">{t("search")}</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t("searchPlaceholder")}
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
          <div className="flex flex-col justify-end">
            <Button variant="outline" onClick={reset} className="w-full">
              {t("reset")}
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Undo2 className="h-5 w-5" />
            {t("cardTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {props.rows.length === 0 ? (
            <div className="text-center py-12">
              <Undo2 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">{props.q ? t("emptyFiltered") : t("empty")}</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("colDocNo")}</TableHead>
                      <TableHead>{t("colStore")}</TableHead>
                      <TableHead>{t("colRaisedAt")}</TableHead>
                      <TableHead>{t("colTransport")}</TableHead>
                      <TableHead className="text-right">{t("colLineCount")}</TableHead>
                      <TableHead className="text-right">{t("colValue")}</TableHead>
                      <TableHead>{t("colStatus")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {props.rows.map((r) => {
                      /*
                       * Only APPROVED + PENDING is a genuine, permanent gap worth surfacing here —
                       * every not-yet-approved retur reads PENDING by default (valuationStatus is
                       * only stamped VALUED/PENDING at approval), so flagging it pre-approval would
                       * mark every open retur "incomplete" even when nothing is actually wrong yet.
                       */
                      const valuationIncomplete = r.status === "APPROVED" && r.valuationStatus === "PENDING";
                      return (
                        <TableRow
                          key={r.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => startTransition(() => router.push(`${ROUTE}/${r.id}`))}
                        >
                          <TableCell className="font-mono text-sm">{r.docNo}</TableCell>
                          <TableCell className="max-w-[220px] truncate">{r.storeName}</TableCell>
                          <TableCell className="whitespace-nowrap">{formatDateOnlyJakarta(r.createdAt)}</TableCell>
                          <TableCell>{t(`transport.${r.transport}`)}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.lineCount}</TableCell>
                          <TableCell className="text-right tabular-nums whitespace-nowrap">
                            {r.totalValue !== null ? (
                              formatMoney2(r.totalValue)
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                            {valuationIncomplete && (
                              <div className="mt-1">
                                <Badge variant="outline" className="border-amber-500/40 text-amber-700">
                                  {t("valuationIncomplete")}
                                </Badge>
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={STATUS_BADGE_VARIANT[r.status]}
                              className={STATUS_BADGE_CLASS[r.status]}
                            >
                              {t(`status.${r.status}`)}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <Pager
                page={props.page}
                pageSize={props.pageSize}
                total={props.total}
                onPageChange={(p) => pushParams({ page: String(p) })}
                onPageSizeChange={(size) => pushParams({ pageSize: String(size), page: undefined })}
                className="mt-4"
              />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
