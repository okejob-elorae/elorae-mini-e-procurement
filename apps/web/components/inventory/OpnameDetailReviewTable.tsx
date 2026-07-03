"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import {
  filterOpnameLines,
  searchOpnameLines,
  sortLinesForReview,
  type OpnameLineFilter,
  type OpnameLineRow,
} from "@/lib/inventory/opname-detail-utils";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;

function formatQty(value: number | null): string {
  if (value == null) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatVariance(value: number | null): string {
  if (value == null) return "—";
  if (value === 0) return "0";
  return value > 0 ? `+${formatQty(value)}` : formatQty(value);
}

type OpnameDetailReviewTableProps = {
  lines: OpnameLineRow[];
  isFabric: boolean;
};

export function OpnameDetailReviewTable({ lines, isFabric }: OpnameDetailReviewTableProps) {
  const t = useTranslations("stockOpname");
  const [filter, setFilter] = useState<OpnameLineFilter>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const sorted = sortLinesForReview(lines);
    const byFilter = filterOpnameLines(sorted, filter);
    return searchOpnameLines(byFilter, search);
  }, [filter, lines, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageLines = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const onFilterChange = (value: OpnameLineFilter) => {
    setFilter(value);
    setPage(1);
  };

  const onSearchChange = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  return (
    <Card>
      <CardHeader className="space-y-4">
        <CardTitle>{t("reviewLines")}</CardTitle>
        <div className="flex flex-col sm:flex-row gap-3">
          <Select value={filter} onValueChange={(v) => onFilterChange(v as OpnameLineFilter)}>
            <SelectTrigger className="w-full sm:w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("filterAll")}</SelectItem>
              <SelectItem value="variance">{t("filterVariance")}</SelectItem>
              <SelectItem value="pending">{t("filterPending")}</SelectItem>
              <SelectItem value="counted">{t("filterCounted")}</SelectItem>
            </SelectContent>
          </Select>
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={isFabric ? t("searchRollPlaceholder") : t("searchSkuPlaceholder")}
              className="pl-9"
            />
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          {t("showingLines", { shown: pageLines.length, total: filtered.length })}
        </p>
      </CardHeader>
      <CardContent>
        {filtered.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">{t("noLinesMatch")}</p>
        ) : (
          <>
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{isFabric ? t("roll") : t("item")}</TableHead>
                    <TableHead className="text-right">{t("snapshot")}</TableHead>
                    <TableHead className="text-right">{t("counted")}</TableHead>
                    <TableHead className="text-right">{t("variance")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageLines.map((line) => (
                    <TableRow key={line.id}>
                      <TableCell>
                        <div className="font-medium leading-snug">{line.label}</div>
                        {line.sublabel ? (
                          <div className="text-muted-foreground text-xs mt-0.5 font-mono">
                            {line.sublabel}
                          </div>
                        ) : null}
                        {line.hadDriftWarning ? (
                          <Badge variant="outline" className="mt-1 text-amber-700 border-amber-300">
                            <AlertTriangle className="h-3 w-3 mr-1" />
                            {t("driftFlag")}
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatQty(line.snapshot)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatQty(line.counted)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right tabular-nums font-medium",
                          line.variance != null && line.variance > 0 && "text-emerald-600",
                          line.variance != null && line.variance < 0 && "text-red-600",
                        )}
                      >
                        {formatVariance(line.variance)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {totalPages > 1 ? (
              <div className="flex items-center justify-between mt-4">
                <p className="text-sm text-muted-foreground">
                  {t("pageOf", { page: safePage, total: totalPages })}
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={safePage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={safePage >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
