"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Plus, Search, Store } from "lucide-react";
import type { StoreListItem } from "@/lib/stores/queries";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { Pager } from "@/components/Pager";

type Props = {
  stores: StoreListItem[];
  totalCount: number;
  search: string;
  showInactive: boolean;
  page: number;
  pageSize: number;
};

export function StoreListClient({
  stores,
  totalCount,
  search,
  showInactive,
  page,
  pageSize,
}: Props) {
  const t = useTranslations("stores");
  const tList = useTranslations("stores.list");
  const tTable = useTranslations("stores.list.table");
  const tBadge = useTranslations("stores.badge");
  const router = useRouter();
  const sp = useSearchParams();
  const [, startTransition] = useTransition();
  const [searchInput, setSearchInput] = useState(search);

  useEffect(() => {
    const handle = setTimeout(() => {
      if (searchInput !== search) pushParam("search", searchInput);
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  function pushParam(key: string, value: string | undefined) {
    const params = new URLSearchParams(sp.toString());
    if (!value) params.delete(key);
    else params.set(key, value);
    params.delete("page");
    startTransition(() => router.push(`/backoffice/stores?${params.toString()}`));
  }

  function toggleShowInactive(next: boolean) {
    const params = new URLSearchParams(sp.toString());
    if (next) params.set("showInactive", "1");
    else params.delete("showInactive");
    params.delete("page");
    startTransition(() => router.push(`/backoffice/stores?${params.toString()}`));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground">{tList("subtitle")}</p>
        </div>
        <Button asChild>
          <Link href="/backoffice/stores/new">
            <Plus className="mr-2 h-4 w-4" />
            {t("new")}
          </Link>
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 sm:items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={tList("searchPlaceholder")}
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="show-inactive"
            checked={showInactive}
            onCheckedChange={(checked) => toggleShowInactive(checked === true)}
          />
          <Label htmlFor="show-inactive" className="text-sm font-normal cursor-pointer">
            {tList("showInactive")}
          </Label>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Store className="h-5 w-5" />
            {tList("cardTitle")}
            <span className="text-sm font-normal text-muted-foreground ml-2">
              ({tList("count", { count: totalCount })})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {stores.length === 0 ? (
            <div className="text-center py-12">
              <Store className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">
                {search || showInactive ? tList("noSearchResults") : tList("empty")}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tTable("code")}</TableHead>
                    <TableHead>{tTable("name")}</TableHead>
                    <TableHead>{tTable("terms")}</TableHead>
                    <TableHead className="text-right">{tTable("tempo")}</TableHead>
                    <TableHead className="text-right">{tTable("margin")}</TableHead>
                    <TableHead>{tTable("address")}</TableHead>
                    <TableHead>{tTable("status")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stores.map(s => (
                    <TableRow key={s.id}>
                      <TableCell className="font-mono text-xs">
                        <Link
                          href={`/backoffice/stores/${s.id}`}
                          className="hover:underline"
                        >
                          {s.code}
                        </Link>
                      </TableCell>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell>
                        <Badge variant={s.termsType === "PUTUS" ? "outline" : "secondary"}>
                          {s.termsType === "PUTUS" ? tBadge("putus") : tBadge("konsi")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{s.paymentTempo}d</TableCell>
                      <TableCell className="text-right tabular-nums">{s.marginPercent ?? "—"}</TableCell>
                      <TableCell className="truncate max-w-[220px] text-muted-foreground" title={s.address}>
                        {s.address}
                      </TableCell>
                      <TableCell>
                        <Badge variant={s.isActive ? "default" : "outline"}>
                          {s.isActive ? tTable("active") : tBadge("inactive")}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Pager
        page={page}
        pageSize={pageSize}
        total={totalCount}
        onPageChange={(p) => {
          const params = new URLSearchParams(sp.toString());
          params.set("page", String(p));
          startTransition(() => router.push(`/backoffice/stores?${params.toString()}`));
        }}
        onPageSizeChange={(size) => {
          const params = new URLSearchParams(sp.toString());
          params.set("pageSize", String(size));
          params.delete("page");
          startTransition(() => router.push(`/backoffice/stores?${params.toString()}`));
        }}
      />
    </div>
  );
}
