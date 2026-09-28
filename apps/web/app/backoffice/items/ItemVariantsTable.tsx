"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Edit, Layers } from "lucide-react";
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
import type { ItemVariantListRow } from "@/lib/items/variant-rows";

type Props = {
  rows: ItemVariantListRow[];
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
  rows,
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Layers className="h-5 w-5" />
          {t("variantListTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="text-center py-12">
            <Layers className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">
              {hasFilter ? t("noVariantsMatch") : t("noItemsFound")}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
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
                {rows.map((row) => (
                  <VariantRow
                    key={row.key}
                    row={row}
                    imageUrl={images[row.key]}
                    locale={locale}
                    typeLabel={typeLabels[row.type]}
                    typeColor={typeColors[row.type]}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
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

type VariantRowProps = {
  row: ItemVariantListRow;
  imageUrl: string | undefined;
  locale: string;
  typeLabel: string;
  typeColor: string;
};

function VariantRow({ row, imageUrl, locale, typeLabel, typeColor }: VariantRowProps) {
  const t = useTranslations("items");
  const name = locale === "en" ? row.nameEn : row.nameId;
  const availableClass = row.available < 0 ? "font-medium text-red-600 dark:text-red-400" : undefined;
  const showPrice = row.type === "FINISHED_GOOD" && row.sellingPrice !== null;

  return (
    <TableRow>
      <TableCell>
        {imageUrl ? (
          <img src={imageUrl} alt="" className="w-10 h-10 rounded object-cover" loading="lazy" />
        ) : (
          <div className="w-10 h-10 rounded bg-muted" />
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <span className="font-mono text-sm font-medium">{row.code}</span>
        {row.inCatalog ? null : (
          <Badge variant="outline" className="ml-2 border-amber-300 text-amber-700 dark:text-amber-400">
            {t("notInCatalog")}
          </Badge>
        )}
      </TableCell>
      <TableCell className="min-w-[200px]">
        <p className="font-medium truncate max-w-[280px]" title={name}>{name}</p>
        <VariantAttributes row={row} />
      </TableCell>
      <TableCell>
        <Badge className={typeColor}>{typeLabel}</Badge>
      </TableCell>
      <TableCell>{row.uomCode}</TableCell>
      <TableCell className="text-right tabular-nums">{formatNumber(row.qtyOnHand)}</TableCell>
      <TableCell className="text-right tabular-nums">
        <span className={availableClass}>{formatNumber(row.available)}</span>
      </TableCell>
      <TableCell className="text-right tabular-nums">Rp {formatNumber(row.avgCost)}</TableCell>
      <TableCell className="text-right tabular-nums">Rp {formatNumber(row.totalValue)}</TableCell>
      <TableCell className="text-right tabular-nums">
        {showPrice ? `Rp ${formatNumber(row.sellingPrice ?? 0)}` : "—"}
      </TableCell>
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
