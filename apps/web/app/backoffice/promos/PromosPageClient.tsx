"use client";

import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Plus } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { useTranslations, useLocale } from "next-intl";
import type { PromoListItem } from "@/lib/promos/queries";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Pager } from "@/components/Pager";

type PromoTypeFilter = "ALL" | "PERCENT" | "FIXED" | "TIERED";
type ActiveFilter = "ALL" | "true" | "false";

const TYPE_KEY = { PERCENT: "typePercent", FIXED: "typeFixed", TIERED: "typeTiered" } as const;
const LEVEL_KEY = { LINE: "levelLine", ORDER: "levelOrder" } as const;

type Props = {
  promos: PromoListItem[];
  totalCount: number;
  search: string;
  type: PromoTypeFilter;
  active: ActiveFilter;
  page: number;
  pageSize: number;
};

export function PromosPageClient(props: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const t = useTranslations("promos");
  const locale = useLocale();
  const [, startTransition] = useTransition();

  const [searchInput, setSearchInput] = useState(props.search);

  useEffect(() => {
    const handle = setTimeout(() => {
      if (searchInput !== props.search) pushParam("search", searchInput);
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  function pushParam(key: string, value: string | undefined) {
    const params = new URLSearchParams(sp.toString());
    if (!value) params.delete(key);
    else params.set(key, value);
    params.delete("page");
    startTransition(() => router.push(`/backoffice/promos?${params.toString()}`));
  }

  function reset() {
    setSearchInput("");
    startTransition(() => router.push("/backoffice/promos"));
  }

  const formatDate = (date: Date | null) =>
    date
      ? new Intl.DateTimeFormat(locale, {
          day: "2-digit",
          month: "short",
          year: "numeric",
        }).format(date)
      : null;

  const formatWindow = (startsAt: Date | null, endsAt: Date | null) => {
    const start = formatDate(startsAt);
    const end = formatDate(endsAt);
    if (!start && !end) return "—";
    return `${start ?? "—"} – ${end ?? "—"}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t("pageTitle")}</h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Link href="/backoffice/promos/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            {t("new")}
          </Button>
        </Link>
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <label className="text-xs text-muted-foreground mb-1 block">{t("search")}</label>
            <Input
              placeholder={t("search")}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">{t("type")}</label>
            <Select value={props.type} onValueChange={(v) => pushParam("type", v === "ALL" ? undefined : v)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("type")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t("typeAll")}</SelectItem>
                <SelectItem value="PERCENT">{t("typePercent")}</SelectItem>
                <SelectItem value="FIXED">{t("typeFixed")}</SelectItem>
                <SelectItem value="TIERED">{t("typeTiered")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">{t("active")}</label>
            <Select value={props.active} onValueChange={(v) => pushParam("active", v === "ALL" ? undefined : v)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("active")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t("activeAll")}</SelectItem>
                <SelectItem value="true">{t("activeYes")}</SelectItem>
                <SelectItem value="false">{t("activeNo")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="mt-3 flex justify-end">
          <Button variant="outline" onClick={reset}>
            {t("reset")}
          </Button>
        </div>
      </Card>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("colName")}</TableHead>
              <TableHead>{t("colType")}</TableHead>
              <TableHead>{t("colLevel")}</TableHead>
              <TableHead>{t("colActive")}</TableHead>
              <TableHead>{t("colWindow")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {props.promos.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  {t("empty")}
                </TableCell>
              </TableRow>
            ) : (
              props.promos.map((p) => (
                <TableRow
                  key={p.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => startTransition(() => router.push(`/backoffice/promos/${p.id}`))}
                >
                  <TableCell className="max-w-[240px] truncate">{p.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {t(TYPE_KEY[p.type as keyof typeof TYPE_KEY] ?? "typePercent")}
                    </Badge>
                  </TableCell>
                  <TableCell>{t(LEVEL_KEY[p.level as keyof typeof LEVEL_KEY] ?? "levelLine")}</TableCell>
                  <TableCell>
                    <Badge variant={p.isActive ? "default" : "secondary"}>
                      {p.isActive ? t("activeYes") : t("activeNo")}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{formatWindow(p.startsAt, p.endsAt)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <Pager
        page={props.page}
        pageSize={props.pageSize}
        total={props.totalCount}
        onPageChange={(p) => {
          const params = new URLSearchParams(sp.toString());
          params.set("page", String(p));
          startTransition(() => router.push(`/backoffice/promos?${params.toString()}`));
        }}
        onPageSizeChange={(size) => {
          const params = new URLSearchParams(sp.toString());
          params.set("pageSize", String(size));
          params.delete("page");
          startTransition(() => router.push(`/backoffice/promos?${params.toString()}`));
        }}
      />
    </div>
  );
}
