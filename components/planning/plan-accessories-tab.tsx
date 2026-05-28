'use client';

import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { AllocationTable, type AllocationRow } from './allocation-table';
import type { ComboboxOption, PlanCategoryDetail, PlanYearDetail } from './types';
import { collectLeafCategories, formatPlanNumber } from './types';

type PlanAccessoriesTabProps = {
  detail: PlanYearDetail;
  accessoryOptions: ComboboxOption[];
  disabled?: boolean;
  onRefresh: () => Promise<void>;
  onSave: (
    categoryId: string,
    plans: Array<{ itemId: string; qtyPerPcs: number; notes?: string }>
  ) => Promise<void>;
  onSuggestBom: (categoryId: string) => Promise<
    Array<{ itemId: string; itemName: string; qtyPerPcs: number }>
  >;
};

export function PlanAccessoriesTab({
  detail,
  accessoryOptions,
  disabled,
  onRefresh,
  onSave,
  onSuggestBom,
}: PlanAccessoriesTabProps) {
  const leaves = collectLeafCategories(detail.categories);

  return (
    <div className="space-y-8">
      {leaves.map((category) => (
        <AccessorySection
          key={category.id}
          category={category}
          accessoryOptions={accessoryOptions}
          disabled={disabled}
          onSuggest={onSuggestBom}
          onSave={(rows) =>
            onSave(
              category.id,
              rows
                .filter((r) => r.primary)
                .map((r) => ({
                  itemId: r.primary,
                  qtyPerPcs: Number(r.qty || 0),
                  notes: r.notes,
                }))
            ).then(onRefresh)
          }
        />
      ))}
    </div>
  );
}

function AccessorySection({
  category,
  accessoryOptions,
  disabled,
  onSuggest,
  onSave,
}: {
  category: PlanCategoryDetail;
  accessoryOptions: ComboboxOption[];
  disabled?: boolean;
  onSuggest: PlanAccessoriesTabProps['onSuggestBom'];
  onSave: (rows: AllocationRow[]) => Promise<void>;
}) {
  const [rows, setRows] = useState<AllocationRow[]>(
    category.accessoryPlans.map((row) => ({
      key: row.id,
      primary: row.itemId,
      qty: String(row.qtyPerPcs),
      notes: row.notes ?? '',
    }))
  );
  const t = useTranslations('planning.actions');

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-medium">
        {category.code} — {category.name}
        <span className="ml-2 text-xs font-normal text-muted-foreground">
          target {formatPlanNumber(category.effectiveTarget)}
        </span>
      </h3>
      {!disabled && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={async () => {
            const suggested = await onSuggest(category.id);
            setRows(
              suggested.map((s, i) => ({
                key: `suggest-${i}`,
                primary: s.itemId,
                qty: String(s.qtyPerPcs),
              }))
            );
          }}
        >
          <Sparkles className="mr-1 h-3 w-3" />
          {t('suggestBom')}
        </Button>
      )}
      <AllocationTable
        rows={rows.length ? rows : [{ key: 'new', primary: '', qty: '' }]}
        primaryLabel="Item aksesoris"
        qtyLabel="Qty / pcs"
        primaryOptions={accessoryOptions}
        disabled={disabled}
        onChange={setRows}
        onSave={() => onSave(rows)}
      />
    </section>
  );
}
