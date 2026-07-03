"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { AllocationTable, type AllocationRow } from "./allocation-table";
import type { PlanYearDetail } from "./types";
import { collectLeafCategories, formatPlanNumber } from "./types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type PlanColorsTabProps = {
  detail: PlanYearDetail;
  disabled?: boolean;
  onRefresh: () => Promise<void>;
  onSave: (
    categoryId: string,
    month: number,
    allocations: Array<{
      variantSku: string;
      colorLabel?: string;
      allocatedQty: number;
      notes?: string;
    }>
  ) => Promise<void>;
};

export function PlanColorsTab({ detail, disabled, onRefresh, onSave }: PlanColorsTabProps) {
  const t = useTranslations("planning.colors");
  const tm = useTranslations("planning.months");
  const leaves = collectLeafCategories(detail.categories);

  return (
    <div className="space-y-8">
      {leaves.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("noLeafCategories")}</p>
      )}
      {leaves.map((category) => (
        <ColorSection
          key={`${category.id}-${category.colorAllocations.length}`}
          label={`${category.code} — ${category.name}`}
          category={category}
          disabled={disabled}
          monthLabel={(month) => tm(String(month))}
          onSave={(month, rows) =>
            onSave(
              category.id,
              month,
              rows
                .filter((r) => r.primary)
                .map((r) => ({
                  variantSku: r.primary,
                  colorLabel: r.secondary || undefined,
                  allocatedQty: Number(r.qty || 0),
                  notes: r.notes,
                }))
            ).then(() => onRefresh())
          }
        />
      ))}
    </div>
  );
}

function ColorSection({
  label,
  category,
  disabled,
  monthLabel,
  onSave,
}: {
  label: string;
  category: PlanYearDetail["categories"][number];
  disabled?: boolean;
  monthLabel: (month: number) => string;
  onSave: (
    month: number,
    rows: AllocationRow[]
  ) => Promise<void>;
}) {
  const t = useTranslations("planning.colors");
  const [month, setMonth] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const monthlyTarget =
    category.monthlyTargetsComputed.find((m) => m.month === month)?.targetQty ?? 0;

  const initialRows = useMemo(() => {
    return category.colorAllocations
      .filter((row) => row.month === month)
      .map((row) => ({
        key: row.id,
        primary: row.variantSku,
        secondary: row.colorLabel ?? "",
        qty: String(row.allocatedQty),
        notes: row.notes ?? "",
      }));
  }, [category.colorAllocations, month]);

  const [rows, setRows] = useState(initialRows);
  const variantOptions = category.itemVariants.map((v) => ({
    value: v.variantSku,
    label: v.label,
  }));

  useEffect(() => {
    setRows(initialRows);
    setError(null);
  }, [month, initialRows]);

  const rowSum = rows.reduce((sum, row) => sum + Number(row.qty || 0), 0);
  const mismatch = rowSum !== monthlyTarget;

  if (!category.itemId) {
    return (
      <section className="space-y-2 rounded-md border border-dashed p-4">
        <h3 className="text-sm font-medium">{label}</h3>
        <p className="text-sm text-muted-foreground">{t("linkItemFirst")}</p>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{label}</h3>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t("month")}</span>
          <Select
            value={String(month)}
            onValueChange={(value) => {
              setMonth(Number(value));
              setRows([]);
              setError(null);
            }}
          >
            <SelectTrigger className="w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <SelectItem key={m} value={String(m)}>
                  {monthLabel(m)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        {t("monthlyTarget", {
          target: formatPlanNumber(monthlyTarget),
          sum: formatPlanNumber(rowSum),
        })}
      </p>

      <AllocationTable
        key={`${category.id}-${month}-${initialRows.map((r) => r.key).join(",")}`}
        rows={
          rows.length
            ? rows
            : initialRows.length
              ? initialRows
              : [{ key: "new", primary: "", secondary: "", qty: "" }]
        }
        primaryLabel={t("variant")}
        secondaryLabel={t("colorLabel")}
        qtyLabel={t("qty")}
        primaryOptions={variantOptions}
        primaryPlaceholder={t("selectVariant")}
        disabled={disabled}
        warning={error ?? (mismatch ? t("mismatch", { target: monthlyTarget, sum: rowSum }) : null)}
        onChange={(nextRows) => setRows(nextRows as typeof rows)}
        onSave={async () => {
          try {
            setError(null);
            await onSave(month, rows.length ? rows : initialRows);
          } catch (err) {
            setError(err instanceof Error ? err.message : t("saveFailed"));
          }
        }}
        saveLabel={t("save")}
      />
    </section>
  );
}
