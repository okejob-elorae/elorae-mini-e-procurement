"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ITEM_IMPORT_COLUMNS,
  type ItemImportColumnKey,
  type ItemImportError,
  type ItemImportErrorCode,
  type ItemImportPreviewItem,
} from "@/lib/items/import/types";

/**
 * Exhaustive on purpose: a new error code without an entry here is a compile error. It does NOT
 * prove the locale files carry that key (the lookup is cast `as never`), so add the copy to both.
 */
const ERROR_KEY: Record<ItemImportErrorCode, `err.${ItemImportErrorCode}`> = {
  NOT_XLSX: "err.NOT_XLSX",
  FILE_TOO_LARGE: "err.FILE_TOO_LARGE",
  UNREADABLE_FILE: "err.UNREADABLE_FILE",
  MISSING_SHEET: "err.MISSING_SHEET",
  MISSING_HEADER: "err.MISSING_HEADER",
  EMPTY_FILE: "err.EMPTY_FILE",
  TOO_MANY_ROWS: "err.TOO_MANY_ROWS",
  INVALID_PAYLOAD: "err.INVALID_PAYLOAD",
  REQUIRED: "err.REQUIRED",
  INVALID_NUMBER: "err.INVALID_NUMBER",
  NEGATIVE_NUMBER: "err.NEGATIVE_NUMBER",
  UNKNOWN_UOM: "err.UNKNOWN_UOM",
  UNKNOWN_CATEGORY: "err.UNKNOWN_CATEGORY",
  AMBIGUOUS_CATEGORY: "err.AMBIGUOUS_CATEGORY",
  TOO_LONG: "err.TOO_LONG",
  DATE_CELL: "err.DATE_CELL",
  VARIANTLESS_BARCODE: "err.VARIANTLESS_BARCODE",
  INCONSISTENT_ARTIKEL: "err.INCONSISTENT_ARTIKEL",
  MIXED_VARIANTLESS: "err.MIXED_VARIANTLESS",
  DUPLICATE_VARIANT: "err.DUPLICATE_VARIANT",
  VARIANT_NEEDS_ATTRIBUTE: "err.VARIANT_NEEDS_ATTRIBUTE",
  INCONSISTENT_ATTRIBUTES: "err.INCONSISTENT_ATTRIBUTES",
  INCOMPLETE_VARIANT_GRID: "err.INCOMPLETE_VARIANT_GRID",
  ARTIKEL_EXISTS: "err.ARTIKEL_EXISTS",
  SKU_NAMESPACE_TAKEN: "err.SKU_NAMESPACE_TAKEN",
  VARIANT_SKU_TAKEN: "err.VARIANT_SKU_TAKEN",
  BARCODE_TAKEN: "err.BARCODE_TAKEN",
  DUPLICATE_IN_FILE: "err.DUPLICATE_IN_FILE",
  SKU_TAKEN: "err.SKU_TAKEN",
};

const COLUMN_HEADER = new Map<ItemImportColumnKey, string>(ITEM_IMPORT_COLUMNS.map((c) => [c.key, c.header]));

function hasRewrittenSku(item: ItemImportPreviewItem): boolean {
  return item.variants.some((v) => v.typedSku !== null && v.finalSku !== null && v.typedSku !== v.finalSku);
}

export function useImportErrorMessage(): (e: ItemImportError) => string {
  const t = useTranslations("itemImport");
  return (e) => {
    const detail = e.code === "DUPLICATE_IN_FILE" ? (e.detail ? ` (${e.detail})` : "") : e.detail ?? "";
    return t(ERROR_KEY[e.code] as never, { detail });
  };
}

export function ImportErrorTable({ errors }: { errors: ItemImportError[] }) {
  const t = useTranslations("itemImport");
  const message = useImportErrorMessage();
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-16">{t("colRow")}</TableHead>
            <TableHead className="w-36">{t("colColumn")}</TableHead>
            <TableHead>{t("colMessage")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {errors.map((e, i) => (
            <TableRow key={`${e.row ?? "file"}-${e.column ?? "none"}-${e.code}-${i}`}>
              <TableCell className="tabular-nums">{e.row ?? "—"}</TableCell>
              <TableCell>{e.column ? COLUMN_HEADER.get(e.column) : "—"}</TableCell>
              <TableCell>
                {e.artikel ? <span className="font-mono text-xs mr-2">{e.artikel}</span> : null}
                {message(e)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function ImportPreviewList({ items }: { items: ItemImportPreviewItem[] }) {
  const t = useTranslations("itemImport");
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("previewTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.map((item) => (
          <details key={item.artikel} className="rounded-md border">
            <summary className="flex min-h-10 cursor-pointer flex-wrap items-center gap-2 px-3 py-2">
              <span className="max-w-[45%] shrink-0 truncate font-mono text-sm font-medium" title={item.artikel}>
                {item.artikel}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm" title={item.nameId}>{item.nameId}</span>
              <Badge variant="secondary">
                {item.variantless ? t("variantless") : t("variantCount", { count: item.variants.length })}
              </Badge>
              {hasRewrittenSku(item) ? (
                <Badge variant="outline" className="border-amber-300 text-amber-800 dark:border-amber-800 dark:text-amber-300">
                  {t("skuRewritten")}
                </Badge>
              ) : null}
              {item.hasErrors ? (
                <Badge variant="destructive" className="gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  {t("hasErrors")}
                </Badge>
              ) : null}
            </summary>
            {item.variants.length > 0 ? (
              <div className="overflow-x-auto border-t">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">{t("colRow")}</TableHead>
                      <TableHead>Warna</TableHead>
                      <TableHead>Ukuran</TableHead>
                      <TableHead>Barcode</TableHead>
                      <TableHead>{t("colFinalSku")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {item.variants.map((v) => (
                      <TableRow key={v.row}>
                        <TableCell className="tabular-nums">{v.row}</TableCell>
                        <TableCell>{v.warna || "—"}</TableCell>
                        <TableCell>{v.ukuran || "—"}</TableCell>
                        <TableCell className="font-mono text-xs">{v.barcode ?? "—"}</TableCell>
                        <TableCell>
                          <span className="font-mono text-sm">{v.finalSku ?? "—"}</span>
                          <FinalSkuNote typed={v.typedSku} final={v.finalSku} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : null}
          </details>
        ))}
      </CardContent>
    </Card>
  );
}

function FinalSkuNote({ typed, final }: { typed: string | null; final: string | null }) {
  const t = useTranslations("itemImport");
  if (final === null) return null;
  if (typed === null) return <span className="ml-2 text-xs text-muted-foreground">{t("generated")}</span>;
  if (typed === final) return null;
  return (
    <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
      {t("rewritten", { typed })}
    </span>
  );
}
