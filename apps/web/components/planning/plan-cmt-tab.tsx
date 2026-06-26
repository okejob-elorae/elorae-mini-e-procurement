"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { AllocationTable, type AllocationRow } from "./allocation-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ComboboxOption, PlanYearDetail } from "./types";
import { collectLeafCategories } from "./types";

type PlanCmtTabProps = {
  detail: PlanYearDetail;
  tailorOptions: ComboboxOption[];
  disabled?: boolean;
  canGenerateWo?: boolean;
  workOrderLabels?: Map<string, string>;
  onRefresh: () => Promise<void>;
  onSave: (
    categoryId: string,
    month: number,
    variantSku: string,
    allocations: Array<{ supplierId: string; allocatedQty: number; notes?: string }>
  ) => Promise<void>;
  onGenerateWorkOrders?: (filters?: { categoryId?: string; month?: number }) => Promise<{
    created: number;
    skipped: number;
    errors: number;
  }>;
};

export function PlanCmtTab({
  detail,
  tailorOptions,
  disabled,
  canGenerateWo,
  workOrderLabels,
  onRefresh,
  onSave,
  onGenerateWorkOrders,
}: PlanCmtTabProps) {
  const t = useTranslations("planning.cmt");
  const leaves = collectLeafCategories(detail.categories);
  const [genMonth, setGenMonth] = useState<string>("all");
  const [genCategory, setGenCategory] = useState<string>("all");
  const [genBusy, setGenBusy] = useState(false);

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">{t("subtitle")}</p>

      {canGenerateWo && detail.status === "ACTIVE" && onGenerateWorkOrders && (
        <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">{t("generateCategory")}</div>
            <Select value={genCategory} onValueChange={setGenCategory}>
              <SelectTrigger className="w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("allCategories")}</SelectItem>
                {leaves.map((leaf) => (
                  <SelectItem key={leaf.id} value={leaf.id}>
                    {leaf.code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">{t("generateMonth")}</div>
            <Select value={genMonth} onValueChange={setGenMonth}>
              <SelectTrigger className="w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("allMonths")}</SelectItem>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    M{m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            disabled={genBusy}
            onClick={async () => {
              setGenBusy(true);
              try {
                await onGenerateWorkOrders({
                  categoryId: genCategory === "all" ? undefined : genCategory,
                  month: genMonth === "all" ? undefined : Number(genMonth),
                });
                await onRefresh();
              } finally {
                setGenBusy(false);
              }
            }}
          >
            {t("generateWorkOrders")}
          </Button>
        </div>
      )}

      <div className="space-y-8">
        {leaves.map((category) => (
          <CmtCategorySections
            key={category.id}
            category={category}
            label={`${category.code} — ${category.name}`}
            tailorOptions={tailorOptions}
            workOrderLabels={workOrderLabels}
            disabled={disabled}
            onSave={onSave}
            onRefresh={onRefresh}
          />
        ))}
      </div>
    </div>
  );
}

function CmtCategorySections({
  category,
  label,
  tailorOptions,
  workOrderLabels,
  disabled,
  onSave,
  onRefresh,
}: {
  category: PlanYearDetail["categories"][number];
  label: string;
  tailorOptions: ComboboxOption[];
  workOrderLabels?: Map<string, string>;
  disabled?: boolean;
  onSave: PlanCmtTabProps["onSave"];
  onRefresh: () => Promise<void>;
}) {
  const t = useTranslations("planning.cmt");
  const tm = useTranslations("planning.months");

  const drilldowns = useMemo(() => {
    const keys = new Set<string>();
    for (const color of category.colorAllocations) {
      if (color.allocatedQty > 0) keys.add(`${color.month}:${color.variantSku}`);
    }
    for (const cmt of category.cmtAllocations) {
      keys.add(`${cmt.month}:${cmt.variantSku}`);
    }
    return [...keys]
      .map((key) => {
        const [monthStr, variantSku] = key.split(":");
        const month = Number(monthStr);
        const colorQty =
          category.colorAllocations.find(
            (row) => row.month === month && row.variantSku === variantSku
          )?.allocatedQty ?? 0;
        return { month, variantSku, colorQty };
      })
      .sort((a, b) => a.month - b.month || a.variantSku.localeCompare(b.variantSku));
  }, [category.colorAllocations, category.cmtAllocations]);

  if (drilldowns.length === 0) {
    return (
      <section className="space-y-2">
        <h3 className="text-sm font-medium">{label}</h3>
        <p className="text-sm text-muted-foreground">{t("noColorAllocations")}</p>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <h3 className="text-sm font-medium">{label}</h3>
      {drilldowns.map(({ month, variantSku, colorQty }) => (
        <CmtVariantSection
          key={`${category.id}-${month}-${variantSku}`}
          title={`${tm(String(month))} · ${variantSku}`}
          colorQty={colorQty}
          initialRows={category.cmtAllocations
            .filter((row) => row.month === month && row.variantSku === variantSku)
            .map((row) => ({
              key: row.id,
              primary: row.supplierId,
              qty: String(row.allocatedQty),
              notes: row.notes ?? "",
              workOrderId: row.workOrderId,
            }))}
          tailorOptions={tailorOptions}
          workOrderLabels={workOrderLabels}
          disabled={disabled}
          onSave={(rows) =>
            onSave(
              category.id,
              month,
              variantSku,
              rows
                .filter((r) => r.primary)
                .map((r) => ({
                  supplierId: r.primary,
                  allocatedQty: Number(r.qty || 0),
                  notes: r.notes,
                }))
            ).then(() => onRefresh())
          }
        />
      ))}
    </section>
  );
}

function CmtVariantSection({
  title,
  colorQty,
  initialRows,
  tailorOptions,
  workOrderLabels,
  disabled,
  onSave,
}: {
  title: string;
  colorQty: number;
  initialRows: Array<AllocationRow & { workOrderId?: string | null }>;
  tailorOptions: ComboboxOption[];
  workOrderLabels?: Map<string, string>;
  disabled?: boolean;
  onSave: (rows: AllocationRow[]) => Promise<void>;
}) {
  const t = useTranslations("planning.cmt");
  const [rows, setRows] = useState(initialRows);
  const [error, setError] = useState<string | null>(null);
  const rowSum = rows.reduce((sum, row) => sum + Number(row.qty || 0), 0);

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-medium">{title}</h4>
        <span className="text-xs text-muted-foreground">
          {t("colorQty", { qty: colorQty })}
        </span>
      </div>
      {initialRows.some((r) => r.workOrderId) && (
        <div className="flex flex-wrap gap-2">
          {initialRows
            .filter((r) => r.workOrderId)
            .map((r) => (
              <Link key={r.key} href={`/backoffice/work-orders/${r.workOrderId}`}>
                <Badge variant="outline">
                  {workOrderLabels?.get(r.workOrderId!) ?? r.workOrderId!.slice(0, 8)}
                </Badge>
              </Link>
            ))}
        </div>
      )}
      <AllocationTable
        rows={rows.length ? rows : [{ key: "new", primary: "", qty: "" }]}
        primaryLabel={t("vendor")}
        qtyLabel={t("qty")}
        primaryOptions={tailorOptions}
        disabled={disabled}
        warning={
          error ??
          (rowSum !== colorQty ? t("mismatch", { target: colorQty, sum: rowSum }) : null)
        }
        onChange={setRows}
        onSave={async () => {
          try {
            setError(null);
            await onSave(rows);
          } catch (err) {
            setError(err instanceof Error ? err.message : t("saveFailed"));
          }
        }}
        saveLabel={t("save")}
      />
    </div>
  );
}
