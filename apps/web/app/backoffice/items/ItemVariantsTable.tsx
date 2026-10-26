"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ChevronRight, Edit, Layers } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Pagination } from "@/components/ui/pagination";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ItemType } from "@/lib/constants/enums";
import { cn } from "@/lib/utils";
import type { ItemVariantGroup, ItemVariantListRow } from "@/lib/items/variant-rows";

type Props = {
  groups: ItemVariantGroup[];
  totalCount: number;
  page: number;
  pageSize: number;
  images: Record<string, string>;
  hasFilter: boolean;
  typeLabels: Record<ItemType, string>;
  typeColors: Record<ItemType, string>;
  onPageChange: (page: number) => void;
};

function formatNumber(n: number): string {
  return n.toLocaleString();
}

export function ItemVariantsTable({
  groups,
  totalCount,
  page,
  pageSize,
  images,
  hasFilter,
  typeLabels,
  typeColors,
  onPageChange,
}: Props) {
  const t = useTranslations("items");
  const locale = useLocale();
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const expandable = groups.filter((group) => !group.variantless);
  const allCollapsed = expandable.length > 0 && expandable.every((group) => collapsed.has(group.itemId));

  const toggle = (itemId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const toggleAll = () => {
    setCollapsed(allCollapsed ? new Set() : new Set(expandable.map((group) => group.itemId)));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Layers className="h-5 w-5" />
          {t("variantListTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {groups.length === 0 ? (
          <div className="text-center py-12">
            <Layers className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">
              {hasFilter ? t("noVariantsMatch") : t("noItemsFound")}
            </p>
          </div>
        ) : (
          <>
            {expandable.length > 0 ? (
              <div className="mb-2 flex justify-end">
                <Button type="button" variant="ghost" size="lg" onClick={toggleAll}>
                  {allCollapsed ? t("expandAll") : t("collapseAll")}
                </Button>
              </div>
            ) : null}
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12"></TableHead>
                    <TableHead className="w-12"></TableHead>
                    <TableHead>{t("variantSku")}</TableHead>
                    <TableHead>{t("name")}</TableHead>
                    <TableHead>{t("type")}</TableHead>
                    <TableHead>{t("uom")}</TableHead>
                    <TableHead className="text-right">{t("stock")}</TableHead>
                    <TableHead className="text-right">{t("available")}</TableHead>
                    <TableHead className="text-right">{t("avgCost")}</TableHead>
                    <TableHead className="text-right">{t("value")}</TableHead>
                    <TableHead className="text-right">{t("sellingPrice")}</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groups.map((group) => {
                    const isOpen = !group.variantless && !collapsed.has(group.itemId);
                    return (
                      <Fragment key={group.itemId}>
                        <GroupRow
                          group={group}
                          isOpen={isOpen}
                          imageUrl={images[`${group.itemId}|`]}
                          locale={locale}
                          typeLabel={typeLabels[group.type]}
                          typeColor={typeColors[group.type]}
                          onToggle={() => toggle(group.itemId)}
                        />
                        {isOpen
                          ? group.rows.map((row, index) => (
                              <VariantRow
                                key={row.key}
                                id={index === 0 ? `item-variants-${group.itemId}` : undefined}
                                row={row}
                                imageUrl={images[row.key]}
                              />
                            ))
                          : null}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        )}
        <Pagination
          page={page}
          totalPages={totalPages}
          onPageChange={onPageChange}
          totalCount={totalCount}
          pageSize={pageSize}
        />
      </CardContent>
    </Card>
  );
}

type GroupRowProps = {
  group: ItemVariantGroup;
  isOpen: boolean;
  imageUrl: string | undefined;
  locale: string;
  typeLabel: string;
  typeColor: string;
  onToggle: () => void;
};

function GroupRow({ group, isOpen, imageUrl, locale, typeLabel, typeColor, onToggle }: GroupRowProps) {
  const t = useTranslations("items");
  const name = locale === "en" ? group.nameEn : group.nameId;
  const { totals } = group;
  const availableClass = totals.available < 0 ? "font-medium text-red-600 dark:text-red-400" : undefined;
  const showPrice = group.type === "FINISHED_GOOD" && group.sellingPrice !== null;
  const expandable = !group.variantless;
  const detailKey = `item-variants-${group.itemId}`;

  return (
    <TableRow
      className={cn("bg-muted/40 font-medium hover:bg-muted/60", expandable && "cursor-pointer")}
      onClick={expandable ? onToggle : undefined}
    >
      <TableCell className="w-12 py-1">
        {expandable ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            aria-expanded={isOpen}
            aria-controls={detailKey}
            aria-label={t(isOpen ? "collapseProduct" : "expandProduct", { name })}
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
          >
            <ChevronRight className={cn("h-4 w-4 transition-transform", isOpen && "rotate-90")} />
          </Button>
        ) : (
          <div className="h-10 w-10" />
        )}
      </TableCell>
      <TableCell>
        {imageUrl ? (
          <img src={imageUrl} alt="" className="w-10 h-10 rounded object-cover" loading="lazy" />
        ) : (
          <div className="w-10 h-10 rounded bg-muted" />
        )}
      </TableCell>
      <TableCell colSpan={2} className="min-w-[240px]">
        <p className="truncate max-w-[320px]" title={name}>{name}</p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm text-muted-foreground">{group.sku}</span>
          {expandable ? (
            <Badge variant="outline">{t("variantCount", { count: group.variantCount })}</Badge>
          ) : null}
          {expandable && group.rows.length < group.variantCount ? (
            <span className="text-xs font-normal text-muted-foreground">
              {t("showingVariants", { shown: group.rows.length, total: group.variantCount })}
            </span>
          ) : null}
        </div>
      </TableCell>
      <TableCell>
        <Badge className={typeColor}>{typeLabel}</Badge>
      </TableCell>
      <TableCell>{group.uomCode}</TableCell>
      <TableCell className="text-right tabular-nums">{formatNumber(totals.qtyOnHand)}</TableCell>
      <TableCell className="text-right tabular-nums">
        <span className={availableClass}>{formatNumber(totals.available)}</span>
      </TableCell>
      <TableCell className="text-right tabular-nums">Rp {formatNumber(totals.avgCost)}</TableCell>
      <TableCell className="text-right tabular-nums">Rp {formatNumber(totals.totalValue)}</TableCell>
      <TableCell className="text-right tabular-nums">
        {showPrice ? `Rp ${formatNumber(group.sellingPrice ?? 0)}` : "—"}
      </TableCell>
      <TableCell>
        <Button variant="ghost" size="icon" asChild aria-label={t("editItem")}>
          <Link href={`/backoffice/items/${group.itemId}`} onClick={(e) => e.stopPropagation()}>
            <Edit className="h-4 w-4" />
          </Link>
        </Button>
      </TableCell>
    </TableRow>
  );
}

type VariantRowProps = {
  id: string | undefined;
  row: ItemVariantListRow;
  imageUrl: string | undefined;
};

function VariantRow({ id, row, imageUrl }: VariantRowProps) {
  const t = useTranslations("items");
  const availableClass = row.available < 0 ? "font-medium text-red-600 dark:text-red-400" : undefined;

  return (
    <TableRow id={id}>
      <TableCell className="w-12"></TableCell>
      <TableCell>
        {imageUrl ? (
          <img src={imageUrl} alt="" className="w-10 h-10 rounded object-cover" loading="lazy" />
        ) : (
          <div className="w-10 h-10 rounded bg-muted" />
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap pl-10">
        <span className="font-mono text-sm font-medium">{row.code}</span>
        {row.inCatalog ? null : (
          <Badge variant="outline" className="ml-2 border-amber-300 text-amber-700 dark:text-amber-400">
            {t("notInCatalog")}
          </Badge>
        )}
      </TableCell>
      <TableCell className="min-w-[200px]">
        <VariantAttributes row={row} />
      </TableCell>
      <TableCell></TableCell>
      <TableCell></TableCell>
      <TableCell className="text-right tabular-nums">{formatNumber(row.qtyOnHand)}</TableCell>
      <TableCell className="text-right tabular-nums">
        <span className={availableClass}>{formatNumber(row.available)}</span>
      </TableCell>
      <TableCell className="text-right tabular-nums">Rp {formatNumber(row.avgCost)}</TableCell>
      <TableCell className="text-right tabular-nums">Rp {formatNumber(row.totalValue)}</TableCell>
      <TableCell></TableCell>
      <TableCell>
        <Button variant="ghost" size="icon" asChild aria-label={t("editItem")}>
          <Link href={`/backoffice/items/${row.itemId}`}>
            <Edit className="h-4 w-4" />
          </Link>
        </Button>
      </TableCell>
    </TableRow>
  );
}

function VariantAttributes({ row }: { row: ItemVariantListRow }) {
  const t = useTranslations("items");

  if (row.variantSku === "") {
    return <p className="text-xs text-muted-foreground">{t("noVariantRow")}</p>;
  }
  if (row.attributes.length === 0 && row.barcode === null) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {row.attributes.map((attr) => (
        <span key={attr.key} className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-xs">
          {attr.key}: {attr.value}
        </span>
      ))}
      {row.barcode ? (
        <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-xs font-mono">
          {t("variantBarcode")}: {row.barcode}
        </span>
      ) : null}
    </div>
  );
}
