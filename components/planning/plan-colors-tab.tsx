'use client';

import { useState } from 'react';
import { AllocationTable, type AllocationRow } from './allocation-table';
import type { PlanYearDetail } from './types';
import { collectLeafCategories } from './types';

type PlanColorsTabProps = {
  detail: PlanYearDetail;
  disabled?: boolean;
  onRefresh: () => Promise<void>;
  onSave: (
    categoryId: string,
    allocations: Array<{
      colorName: string;
      colorCode?: string;
      allocatedQty: number;
      notes?: string;
    }>
  ) => Promise<{ warning?: string }>;
};

export function PlanColorsTab({ detail, disabled, onRefresh, onSave }: PlanColorsTabProps) {
  const leaves = collectLeafCategories(detail.categories);

  return (
    <div className="space-y-8">
      {leaves.map((category) => (
        <ColorSection
          key={category.id}
          label={`${category.code} — ${category.name}`}
          initialRows={category.colorAllocations.map((row) => ({
            key: row.id,
            primary: row.colorName,
            secondary: row.colorCode ?? '',
            qty: String(row.allocatedQty),
            notes: row.notes ?? '',
          }))}
          disabled={disabled}
          onSave={(rows) =>
            onSave(
              category.id,
              rows.map((r) => ({
                colorName: r.primary,
                colorCode: r.secondary || undefined,
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
  );
}

function ColorSection({
  label,
  initialRows,
  disabled,
  onSave,
}: {
  label: string;
  initialRows: AllocationRow[];
  disabled?: boolean;
  onSave: (rows: AllocationRow[]) => Promise<{ warning?: string }>;
}) {
  const [rows, setRows] = useState(initialRows);
  const [warning, setWarning] = useState<string | null>(null);

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-medium">{label}</h3>
      <AllocationTable
        rows={rows.length ? rows : [{ key: 'new', primary: '', secondary: '', qty: '' }]}
        primaryLabel="Warna"
        secondaryLabel="Kode"
        qtyLabel="Qty"
        primaryPlaceholder="Nama warna (bebas)"
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
