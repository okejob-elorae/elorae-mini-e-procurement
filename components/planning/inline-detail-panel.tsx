'use client';

import type { ComboboxOption, PlanCategoryDetail } from './types';
import { MonthlyCards } from './monthly-cards';
import { StageList } from './stage-list';

export type InlineDetailPanelProps = {
  category: PlanCategoryDetail;
  supplierOptions: ComboboxOption[];
  disabled?: boolean;
  canCreateWo?: boolean;
  allowWoWhenLocked?: boolean;
  onSaveMonth: (month: number, targetQty: number) => Promise<void>;
  onResetMonth: (month: number) => Promise<void>;
  onResetAllMonths: () => Promise<void>;
  onAddStage: (data: {
    name: string;
    targetQty: number;
    targetMonth?: number;
    supplierId?: string;
  }) => Promise<void>;
  onUpdateStage: (
    stageId: string,
    data: Partial<{
      name: string;
      targetQty: number;
      targetMonth: number | null;
      supplierId: string | null;
    }>
  ) => Promise<void>;
  onDeleteStage: (stageId: string) => Promise<void>;
  onCreateWo: (stageId: string) => Promise<void>;
};

export function InlineDetailPanel({
  category,
  supplierOptions,
  disabled,
  canCreateWo,
  allowWoWhenLocked,
  onSaveMonth,
  onResetMonth,
  onResetAllMonths,
  onAddStage,
  onUpdateStage,
  onDeleteStage,
  onCreateWo,
}: InlineDetailPanelProps) {
  return (
    <div className="col-span-full border-l-4 border-primary/30 bg-muted/30 p-4 lg:grid lg:grid-cols-2 lg:gap-6">
      <MonthlyCards
        category={category}
        disabled={disabled}
        onSaveMonth={onSaveMonth}
        onResetMonth={onResetMonth}
        onResetAll={onResetAllMonths}
      />
      <StageList
        category={category}
        supplierOptions={supplierOptions}
        disabled={disabled}
        canCreateWo={canCreateWo}
        allowWoWhenLocked={allowWoWhenLocked}
        onAddStage={onAddStage}
        onUpdateStage={onUpdateStage}
        onDeleteStage={onDeleteStage}
        onCreateWo={onCreateWo}
      />
    </div>
  );
}
