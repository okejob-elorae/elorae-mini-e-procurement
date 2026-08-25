"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Search, ClipboardList } from "lucide-react";
import type { StoreStocktakeListRow, StoreStocktakeStatusValue } from "@/lib/stores/stocktake/queries";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Pager } from "@/components/Pager";
import { cn } from "@/lib/utils";

const ROUTE = "/backoffice/store-stocktakes";
const STATUS_OPTIONS: StoreStocktakeStatusValue[] = ["DRAFT", "PENDING_VERIFICATION", "APPROVED", "CANCELLED"];

const STATUS_BADGE_VARIANT: Record<StoreStocktakeStatusValue, "secondary" | "destructive" | "default" | "outline"> = {
  DRAFT: "secondary",
  PENDING_VERIFICATION: "outline",
  APPROVED: "default",
  CANCELLED: "destructive",
};

const STATUS_BADGE_CLASS: Record<StoreStocktakeStatusValue, string> = {
  DRAFT: "",
  PENDING_VERIFICATION: "border-amber-500/40 text-amber-700",
  APPROVED: "",
  CANCELLED: "",
};

type Props = {
  rows: StoreStocktakeListRow[];
  total: number;
  q: string;
  status: StoreStocktakeStatusValue | "";
  page: number;
  pageSize: number;
};

export function StoreStocktakesPageClient(props: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const t = useTranslations("storeStocktakes");
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
          <div className="lg:col-span-2">
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
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">{t("colStatus")}</label>
            <Select
              value={props.status || "__all__"}
              onValueChange={(v) => pushParam("status", v === "__all__" ? undefined : v)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("statusPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">{t("statusPlaceholder")}</SelectItem>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(`status.${s}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
            <ClipboardList className="h-5 w-5" />
            {t("cardTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {props.rows.length === 0 ? (
            <div className="text-center py-12">
              <ClipboardList className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">
                {props.q || props.status ? t("emptyFiltered") : t("empty")}
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("colDocNo")}</TableHead>
                      <TableHead>{t("colStore")}</TableHead>
                      <TableHead>{t("colCountedAt")}</TableHead>
                      <TableHead>{t("colStatus")}</TableHead>
                      <TableHead className="text-right">{t("colLines")}</TableHead>
                      <TableHead className="text-right">{t("colVariance")}</TableHead>
                      <TableHead>{t("colCoverage")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {props.rows.map((r) => {
                      const isFull = r.lineCount > 0 && r.countedLineCount === r.lineCount;
                      return (
                        <TableRow
                          key={r.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => startTransition(() => router.push(`${ROUTE}/${r.id}`))}
                        >
                          <TableCell className="font-mono text-sm">{r.docNo}</TableCell>
                          <TableCell className="max-w-[220px] truncate">{r.storeName}</TableCell>
                          <TableCell className="whitespace-nowrap">{formatDateOnlyJakarta(r.countedAt)}</TableCell>
                          <TableCell>
                            <Badge variant={STATUS_BADGE_VARIANT[r.status]} className={STATUS_BADGE_CLASS[r.status]}>
                              {t(`status.${r.status}`)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right tabular-nums whitespace-nowrap">
                            {r.countedLineCount} / {r.lineCount}
                          </TableCell>
                          <TableCell
                            className={cn(
                              "text-right tabular-nums",
                              r.netVarianceQty < 0 && "text-destructive",
                              r.netVarianceQty === 0 && "text-muted-foreground",
                            )}
                          >
                            {r.netVarianceQty > 0 ? `+${r.netVarianceQty}` : r.netVarianceQty}
                          </TableCell>
                          <TableCell>
                            <Badge variant={isFull ? "default" : "outline"}>
                              {isFull ? t("coverageFull") : t("coveragePartial")}
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
