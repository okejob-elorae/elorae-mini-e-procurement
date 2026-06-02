"use client";

import { useTranslations } from "next-intl";
import type { ComboboxOption, PlanYearDetail } from "./types";
import { collectLeafCategories } from "./types";
import { StageList } from "./stage-list";

type PlanDetailsTabProps = {
  detail: PlanYearDetail;
  supplierOptions: ComboboxOption[];
  disabled?: boolean;
  canCreateWo?: boolean;
  onRefresh: () => Promise<void>;
  onAddStage: (
    categoryId: string,
    data: { name: string; targetQty: number; targetMonth?: number; supplierId?: string }
  ) => Promise<void>;
  onUpdateStage: (
    stageId: string,
    data: Partial<{
      name: string;
      targetQty: number;
      targetMonth: number | null;
      supplierId: string | null;
      fabricNotes: string | null;
      colorNotes: string | null;
    }>
  ) => Promise<void>;
  onDeleteStage: (stageId: string) => Promise<void>;
  onCreateWo: (stageId: string) => Promise<void>;
};

export function PlanDetailsTab({
  detail,
  supplierOptions,
  disabled,
  canCreateWo,
  onRefresh,
  onAddStage,
  onUpdateStage,
  onDeleteStage,
  onCreateWo,
}: PlanDetailsTabProps) {
  const t = useTranslations("planning.tabs");
  const leaves = collectLeafCategories(detail.categories);

  if (leaves.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("emptyNoLeafCategories")}</p>;
  }

  return (
    <div className="space-y-8">
      {leaves.map((category) => (
        <section key={category.id} className="space-y-3">
          <h3 className="text-sm font-medium">
            {category.code} — {category.name}
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              ({category.stages.length} stages)
            </span>
          </h3>
          <StageList
            category={category}
            supplierOptions={supplierOptions}
            disabled={disabled}
            canCreateWo={canCreateWo}
            allowWoWhenLocked
            onAddStage={(data) => onAddStage(category.id, data).then(onRefresh)}
            onUpdateStage={(id, data) => onUpdateStage(id, data).then(onRefresh)}
            onDeleteStage={(id) => onDeleteStage(id).then(onRefresh)}
            onCreateWo={onCreateWo}
          />
        </section>
      ))}
    </div>
  );
}
