"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import type { ComboboxOption, PlanCategoryDetail, PlanStageDetail } from "./types";
import { formatPlanNumber } from "./types";

type StageListProps = {
  category: PlanCategoryDetail;
  supplierOptions: ComboboxOption[];
  disabled?: boolean;
  canCreateWo?: boolean;
  allowWoWhenLocked?: boolean;
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
      fabricNotes: string | null;
      colorNotes: string | null;
    }>
  ) => Promise<void>;
  onDeleteStage: (stageId: string) => Promise<void>;
  onCreateWo: (stageId: string) => Promise<void>;
};

export function StageList({
  category,
  supplierOptions,
  disabled,
  canCreateWo,
  allowWoWhenLocked,
  onAddStage,
  onUpdateStage,
  onDeleteStage,
  onCreateWo,
}: StageListProps) {
  const t = useTranslations("planning.stages");
  const [newStage, setNewStage] = useState({ name: "", targetQty: "", targetMonth: "" });

  const woDisabled = disabled && !allowWoWhenLocked;

  const handleAdd = async () => {
    if (!newStage.name || !newStage.targetQty) return;
    await onAddStage({
      name: newStage.name,
      targetQty: Number(newStage.targetQty),
      targetMonth: newStage.targetMonth ? Number(newStage.targetMonth) : undefined,
    });
    setNewStage({ name: "", targetQty: "", targetMonth: "" });
  };

  return (
    <div className="space-y-3 border-t pt-3">
      <div className="font-medium">{t("title")}</div>
      <p className="text-xs text-muted-foreground">{t("quickAddNote")}</p>

      {category.stages.map((stage) => (
        <StageRow
          key={stage.id}
          stage={stage}
          supplierOptions={supplierOptions}
          disabled={disabled}
          woDisabled={woDisabled}
          canCreateWo={canCreateWo}
          onUpdateStage={onUpdateStage}
          onDeleteStage={onDeleteStage}
          onCreateWo={onCreateWo}
        />
      ))}

      {!disabled && (
        <div className="flex flex-col gap-2 rounded-md border border-dashed p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Input
              className="min-w-0"
              placeholder={t("namePlaceholder")}
              value={newStage.name}
              onChange={(e) => setNewStage((s) => ({ ...s, name: e.target.value }))}
            />
            <Input
              className="min-w-0"
              type="number"
              placeholder={t("qtyPlaceholder")}
              value={newStage.targetQty}
              onChange={(e) => setNewStage((s) => ({ ...s, targetQty: e.target.value }))}
            />
            <Input
              className="min-w-0"
              type="number"
              min={1}
              max={12}
              placeholder={t("monthPlaceholder")}
              value={newStage.targetMonth}
              onChange={(e) => setNewStage((s) => ({ ...s, targetMonth: e.target.value }))}
            />
          </div>
          <Button type="button" className="w-full sm:w-fit" onClick={handleAdd}>
            <Plus className="h-4 w-4" />
            {t("addNew")}
          </Button>
        </div>
      )}
    </div>
  );
}

function StageRow({
  stage,
  supplierOptions,
  disabled,
  woDisabled,
  canCreateWo,
  onUpdateStage,
  onDeleteStage,
  onCreateWo,
}: {
  stage: PlanStageDetail;
  supplierOptions: ComboboxOption[];
  disabled?: boolean;
  woDisabled?: boolean;
  canCreateWo?: boolean;
  onUpdateStage: StageListProps["onUpdateStage"];
  onDeleteStage: (id: string) => Promise<void>;
  onCreateWo: (id: string) => Promise<void>;
}) {
  const t = useTranslations("planning.stages");
  const ta = useTranslations("planning.actions");

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Input
          className="min-w-0"
          defaultValue={stage.name}
          disabled={disabled}
          onBlur={(e) => {
            if (e.target.value !== stage.name) {
              void onUpdateStage(stage.id, { name: e.target.value });
            }
          }}
        />
        <Input
          className="min-w-0"
          type="number"
          defaultValue={stage.targetQty}
          disabled={disabled}
          onBlur={(e) => {
            const val = Number(e.target.value);
            if (Number.isFinite(val) && val !== stage.targetQty) {
              void onUpdateStage(stage.id, { targetQty: val });
            }
          }}
        />
        <SearchableCombobox
          className="min-w-0 sm:col-span-2"
          options={[{ value: "", label: "—" }, ...supplierOptions]}
          value={stage.supplierId || ""}
          onValueChange={(value) => void onUpdateStage(stage.id, { supplierId: value || null })}
          placeholder={t("noVendor")}
          disabled={disabled}
        />
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {stage.workOrderId ? (
            <Link href={`/backoffice/work-orders/${stage.workOrderId}`}>
              <Badge variant="outline" className="max-w-full truncate">
                {stage.workOrderDocNumber ?? stage.workOrderId.slice(0, 8)}
                {stage.workOrderStatus ? ` · ${stage.workOrderStatus}` : ""}
              </Badge>
            </Link>
          ) : (
            <Badge variant="secondary">—</Badge>
          )}
          <Badge variant={stage.planCmtAllocationId ? "default" : "secondary"}>
            {stage.planCmtAllocationId ? t("autoStage") : t("manualStage")}
          </Badge>
          <span className="text-sm text-muted-foreground">
            {formatPlanNumber(stage.targetQty)}
          </span>
        </div>
        <div className="flex flex-wrap gap-1">
          <Button
            type="button"
            size="sm"
            className="flex-1 sm:flex-none"
            onClick={() => onCreateWo(stage.id)}
            disabled={!canCreateWo || woDisabled}
          >
            {stage.workOrderId && stage.workOrderStatus === "CANCELLED"
              ? t("createNewWO")
              : t("createWO")}
          </Button>
          {!disabled && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="flex-1 sm:flex-none"
              onClick={() => onDeleteStage(stage.id)}
            >
              {ta("delete")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
