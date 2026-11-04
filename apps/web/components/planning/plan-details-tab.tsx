"use client";

import { useTranslations } from "next-intl";
import type { ComboboxOption, PlanStageAddData, PlanStageUpdateData, PlanYearDetail } from "./types";
import { collectLeafCategories } from "./types";
import { StageList } from "./stage-list";

type PlanDetailsTabProps = {
  detail: PlanYearDetail;
  supplierOptions: ComboboxOption[];
  disabled?: boolean;
  canManage?: boolean;
  canCreateWo?: boolean;
  onRefresh: () => Promise<void>;
  onAddStage: (categoryId: string, data: PlanStageAddData) => Promise<boolean>;
  onUpdateStage: (stageId: string, data: PlanStageUpdateData) => Promise<boolean>;
  onDeleteStage: (stageId: string) => Promise<void>;
  onCreateWo: (stageId: string) => Promise<void>;
};

export function PlanDetailsTab({
  detail,
  supplierOptions,
  disabled,
  canManage,
  canCreateWo,
  onRefresh,
  onAddStage,
  onUpdateStage,
  onDeleteStage,
  onCreateWo,
}: PlanDetailsTabProps) {
  const t = useTranslations("planning.tabs");
  const ts = useTranslations("jadwalProduksi.plan");
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
              ({ts("jumlahTahap", { n: category.stages.length })})
            </span>
          </h3>
          <StageList
            category={category}
            supplierOptions={supplierOptions}
            disabled={disabled}
            canManage={canManage}
            canCreateWo={canCreateWo}
            allowWoWhenLocked
            onAddStage={(data) =>
              onAddStage(category.id, data).then(async (ok) => {
                if (ok) await onRefresh();
                return ok;
              })
            }
            onUpdateStage={(id, data) =>
              onUpdateStage(id, data).then(async (ok) => {
                if (ok) await onRefresh();
                return ok;
              })
            }
            onDeleteStage={(id) => onDeleteStage(id).then(onRefresh)}
            onCreateWo={onCreateWo}
          />
        </section>
      ))}
    </div>
  );
}
