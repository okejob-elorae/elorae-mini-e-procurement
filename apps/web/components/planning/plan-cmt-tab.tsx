"use client";

import { useState } from "react";
import { AllocationTable, type AllocationRow } from "./allocation-table";
import type { ComboboxOption, PlanYearDetail } from "./types";
import { collectLeafCategories } from "./types";

type PlanCmtTabProps = {
  detail: PlanYearDetail;
  tailorOptions: ComboboxOption[];
  disabled?: boolean;
  onRefresh: () => Promise<void>;
  onSave: (
    categoryId: string,
    allocations: Array<{ supplierId: string; allocatedQty: number; notes?: string }>
  ) => Promise<{ warning?: string }>;
};

export function PlanCmtTab({
  detail,
  tailorOptions,
  disabled,
  onRefresh,
  onSave,
}: PlanCmtTabProps) {
  const leaves = collectLeafCategories(detail.categories);

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Pembagian jahitan tahunan (strategis) — berbeda dari supplier per tahap di Grid/Rincian.
      </p>
      <div className="space-y-8">
        {leaves.map((category) => (
          <CmtSection
            key={category.id}
            label={`${category.code} — ${category.name}`}
            initialRows={category.cmtAllocations.map((row) => ({
              key: row.id,
              primary: row.supplierId,
              qty: String(row.allocatedQty),
              notes: row.notes ?? "",
            }))}
            tailorOptions={tailorOptions}
            disabled={disabled}
            onSave={(rows) =>
              onSave(
                category.id,
                rows
                  .filter((r) => r.primary)
                  .map((r) => ({
                    supplierId: r.primary,
                    allocatedQty: Number(r.qty || 0),
                    notes: r.notes,
                  }))
              ).then((res) => {
                void onRefresh();
                return res;
              })
            }
          />
        ))}
      </div>
    </div>
  );
}

function CmtSection({
  label,
  initialRows,
  tailorOptions,
  disabled,
  onSave,
}: {
  label: string;
  initialRows: AllocationRow[];
  tailorOptions: ComboboxOption[];
  disabled?: boolean;
  onSave: (rows: AllocationRow[]) => Promise<{ warning?: string }>;
}) {
  const [rows, setRows] = useState(initialRows);
  const [warning, setWarning] = useState<string | null>(null);

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-medium">{label}</h3>
      <AllocationTable
        rows={rows.length ? rows : [{ key: "new", primary: "", qty: "" }]}
        primaryLabel="Vendor CMT"
        qtyLabel="Qty"
        primaryOptions={tailorOptions}
        disabled={disabled}
        onChange={setRows}
        warning={warning}
        onSave={async () => {
          const result = await onSave(rows);
          setWarning(result.warning ?? null);
        }}
      />
    </section>
  );
}
