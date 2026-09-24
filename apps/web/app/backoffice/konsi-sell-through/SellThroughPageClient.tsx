"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ClipboardList } from "lucide-react";
import type { SellThroughListItem, SellThroughStatusValue } from "@/lib/konsi-sell-through/queries";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
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

const ROUTE = "/backoffice/konsi-sell-through";
const ALL_STORES = "__all__";
const STATUS_OPTIONS: SellThroughStatusValue[] = ["DRAFT", "APPROVED", "CANCELLED"];

const STATUS_BADGE_VARIANT: Record<SellThroughStatusValue, "secondary" | "destructive" | "default"> = {
  DRAFT: "secondary",
  APPROVED: "default",
  CANCELLED: "destructive",
};

/* An APPROVED report is either invoiced or a baseline, and the list says which; the filter keeps the three real statuses. */
function statusKey(r: SellThroughListItem): SellThroughStatusValue | "APPROVED_BASELINE" | "APPROVED_INVOICED" {
  if (r.status !== "APPROVED") return r.status;
  return r.baseline ? "APPROVED_BASELINE" : "APPROVED_INVOICED";
}

type Props = {
  items: SellThroughListItem[];
  total: number;
  storeOptions: { id: string; name: string }[];
  storeId: string;
  status: SellThroughStatusValue | "";
  page: number;
  pageSize: number;
};

export function SellThroughPageClient(props: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const t = useTranslations("konsiSellThrough");
  const [isPending, startTransition] = useTransition();

  function pushParams(updates: Record<string, string | undefined>): void {
    const params = new URLSearchParams(sp.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (!value) params.delete(key);
      else params.set(key, value);
    }
    startTransition(() => router.push(`${ROUTE}?${params.toString()}`));
  }

  function reset(): void {
    startTransition(() => router.push(ROUTE));
  }

  function periodLabel(periodStart: Date | null, periodEnd: Date): string {
    const end = formatDateOnlyJakarta(periodEnd);
    return periodStart ? t("periodRange", { start: formatDateOnlyJakarta(periodStart), end }) : t("periodFirst", { end });
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
            <label className="text-xs text-muted-foreground mb-1 block">{t("colStore")}</label>
            <SearchableCombobox
              options={[
                { value: ALL_STORES, label: t("filterStore") },
                ...props.storeOptions.map((s) => ({ value: s.id, label: s.name })),
              ]}
              value={props.storeId || ALL_STORES}
              disabled={isPending}
              onValueChange={(v) => pushParams({ storeId: v === ALL_STORES ? undefined : v, page: undefined })}
              placeholder={t("filterStore")}
              searchPlaceholder={t("storeSearchPlaceholder")}
              emptyMessage={t("storeSearchEmpty")}
              triggerClassName="h-10 w-full"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">{t("colStatus")}</label>
            <Select
              value={props.status || "__all__"}
              disabled={isPending}
              onValueChange={(v) => pushParams({ status: v === "__all__" ? undefined : v, page: undefined })}
            >
              <SelectTrigger className="h-10 w-full">
                <SelectValue placeholder={t("filterStatus")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">{t("filterStatus")}</SelectItem>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(`status.${s}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col justify-end">
            <Button variant="outline" disabled={isPending} onClick={reset} className="h-10 w-full">
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
          {props.items.length === 0 ? (
            <div className="text-center py-12">
              <ClipboardList className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">
                {props.storeId || props.status ? t("emptyFiltered") : t("empty")}
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
                      <TableHead>{t("colMethod")}</TableHead>
                      <TableHead>{t("colPeriod")}</TableHead>
                      <TableHead>{t("colStatus")}</TableHead>
                      <TableHead className="text-right">{t("colHeld")}</TableHead>
                      <TableHead className="text-right">{t("colBilled")}</TableHead>
                      <TableHead>{t("colCreated")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {props.items.map((r) => (
                      <TableRow
                        key={r.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => startTransition(() => router.push(`${ROUTE}/${r.id}`))}
                      >
                        <TableCell className="font-mono text-sm">{r.docNo}</TableCell>
                        <TableCell className="max-w-[220px] truncate">{r.storeName}</TableCell>
                        <TableCell className="whitespace-nowrap">{t(`method.${r.method}`)}</TableCell>
                        <TableCell className="whitespace-nowrap">{periodLabel(r.periodStart, r.periodEnd)}</TableCell>
                        <TableCell>
                          <Badge variant={STATUS_BADGE_VARIANT[r.status]}>{t(`status.${statusKey(r)}`)}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {r.heldCount > 0 ? (
                            <Badge variant="outline" className="border-amber-500/40 text-amber-700">
                              {r.heldCount}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground tabular-nums">0</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{r.billedTotalQty}</TableCell>
                        <TableCell className="whitespace-nowrap">{formatDateOnlyJakarta(r.createdAt)}</TableCell>
                      </TableRow>
                    ))}
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
