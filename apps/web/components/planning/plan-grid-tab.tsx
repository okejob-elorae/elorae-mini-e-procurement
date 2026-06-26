"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import type { ComboboxOption, PlanCategoryDetail, PlanYearDetail } from "./types";
import { formatPlanNumber } from "./types";
import { CategoryTreeRow } from "./category-tree-row";

type PlanGridTabProps = {
  detail: PlanYearDetail;
  disabled?: boolean;
  canManage?: boolean;
  canCreateWo?: boolean;
  itemOptions: ComboboxOption[];
  itemCategoryOptions: ComboboxOption[];
  supplierOptions: ComboboxOption[];
  onRefresh: () => Promise<void>;
  onCreateParent: (data: { itemCategoryId: string; targetQty: number }) => Promise<void>;
  onCreateChild: (
    parentId: string,
    data: { code: string; name: string; share: number }
  ) => Promise<void>;
  onUpdateTarget: (categoryId: string, targetQty: number) => Promise<void>;
  onUpdateShare: (categoryId: string, share: number) => Promise<void>;
  onUpdateItem: (categoryId: string, itemId: string | null) => Promise<void>;
  onDeleteCategory: (categoryId: string) => Promise<void>;
  onSaveMonth: (categoryId: string, month: number, targetQty: number) => Promise<void>;
  onResetMonth: (categoryId: string, month: number) => Promise<void>;
  onResetAllMonths: (categoryId: string) => Promise<void>;
  onAddStage: (
    categoryId: string,
    data: { name: string; targetQty: number; targetMonth?: number }
  ) => Promise<void>;
  onUpdateStage: (
    stageId: string,
    data: Partial<{ name: string; targetQty: number; supplierId: string | null }>
  ) => Promise<void>;
  onDeleteStage: (stageId: string) => Promise<void>;
  onCreateWo: (stageId: string) => Promise<void>;
};

export function PlanGridTab(props: PlanGridTabProps) {
  const {
    detail,
    disabled,
    canManage,
    canCreateWo,
    itemOptions,
    itemCategoryOptions,
    supplierOptions,
    onRefresh,
    onCreateParent,
    onCreateChild,
    onUpdateTarget,
    onUpdateShare,
    onUpdateItem,
    onDeleteCategory,
    onSaveMonth,
    onResetMonth,
    onResetAllMonths,
    onAddStage,
    onUpdateStage,
    onDeleteStage,
    onCreateWo,
  } = props;

  const t = useTranslations("planning");
  const tf = useTranslations("planning.fields");
  const ts = useTranslations("planning.search");

  const [search, setSearch] = useState("");
  const [expandedParents, setExpandedParents] = useState<Record<string, boolean>>({});
  const [expandedDetails, setExpandedDetails] = useState<Record<string, boolean>>({});
  const [newParent, setNewParent] = useState({ itemCategoryId: "", targetQty: "" });

  const usedItemCategoryIds = useMemo(
    () =>
      new Set(
        detail.categories
          .map((c) => c.itemCategoryId)
          .filter((id): id is string => !!id)
      ),
    [detail.categories]
  );

  const availableItemCategoryOptions = useMemo(
    () => itemCategoryOptions.filter((opt) => !usedItemCategoryIds.has(opt.value)),
    [itemCategoryOptions, usedItemCategoryIds]
  );

  const filteredCategories = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return detail.categories;
    return detail.categories
      .map((parent) => {
        const parentMatch =
          parent.code.toLowerCase().includes(q) ||
          parent.name.toLowerCase().includes(q) ||
          (parent.itemCategoryCode?.toLowerCase().includes(q) ?? false) ||
          (parent.itemCategoryName?.toLowerCase().includes(q) ?? false);
        const children = parent.children.filter(
          (c) => c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)
        );
        if (parentMatch || children.length > 0) {
          return { ...parent, children: parentMatch ? parent.children : children };
        }
        return null;
      })
      .filter((c): c is PlanCategoryDetail => c != null);
  }, [detail.categories, search]);

  const categoryHandlers = (category: PlanCategoryDetail) => ({
    onSaveMonth: (month: number, targetQty: number) =>
      onSaveMonth(category.id, month, targetQty).then(onRefresh),
    onResetMonth: (month: number) => onResetMonth(category.id, month).then(onRefresh),
    onResetAllMonths: () => onResetAllMonths(category.id).then(onRefresh),
    onAddStage: (data: { name: string; targetQty: number; targetMonth?: number }) =>
      onAddStage(category.id, data).then(onRefresh),
    onUpdateStage: (
      stageId: string,
      data: Partial<{ name: string; targetQty: number; supplierId: string | null }>
    ) => onUpdateStage(stageId, data).then(onRefresh),
    onDeleteStage: (stageId: string) => onDeleteStage(stageId).then(onRefresh),
    onCreateWo: (stageId: string) => onCreateWo(stageId),
  });

  const renderCategoryRow = (
    category: PlanCategoryDetail,
    opts: { depth: number; isParentRow: boolean; parentExpanded?: boolean }
  ) => (
    <CategoryTreeRow
      key={category.id}
      category={category}
      depth={opts.depth}
      isParent={opts.isParentRow}
      expanded={opts.parentExpanded ?? false}
      detailExpanded={expandedDetails[category.id] ?? false}
      onToggleExpand={() =>
        setExpandedParents((p) => ({ ...p, [category.id]: !p[category.id] }))
      }
      onToggleDetail={() =>
        setExpandedDetails((p) => ({ ...p, [category.id]: !p[category.id] }))
      }
      disabled={disabled}
      canCreateWo={canCreateWo}
      allowWoWhenLocked
      itemOptions={itemOptions}
      supplierOptions={supplierOptions}
      onUpdateTarget={
        opts.isParentRow
          ? (qty) => onUpdateTarget(category.id, qty).then(onRefresh)
          : undefined
      }
      onUpdateShare={
        !opts.isParentRow
          ? (share) => onUpdateShare(category.id, share).then(onRefresh)
          : undefined
      }
      onUpdateItem={(itemId) => onUpdateItem(category.id, itemId).then(onRefresh)}
      onDelete={() => onDeleteCategory(category.id).then(onRefresh)}
      onAddChild={
        opts.isParentRow
          ? (data) => onCreateChild(category.id, data).then(onRefresh)
          : undefined
      }
      {...categoryHandlers(category)}
      renderChildren={
        opts.isParentRow
          ? () =>
              category.children.map((child) =>
                renderCategoryRow(child, {
                  depth: 1,
                  isParentRow: false,
                  parentExpanded: opts.parentExpanded ?? false,
                })
              )
          : undefined
      }
    />
  );

  return (
    <div className="space-y-3">
      <Input
        className="max-w-md"
        placeholder={ts("placeholder")}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {canManage && !disabled && (
        <Card>
          <CardContent className="pt-4">
            <div className="grid gap-2 md:grid-cols-3">
              <SearchableCombobox
                options={availableItemCategoryOptions}
                value={newParent.itemCategoryId}
                onValueChange={(itemCategoryId) =>
                  setNewParent((s) => ({ ...s, itemCategoryId }))
                }
                placeholder={tf("selectItemCategory")}
                searchPlaceholder={tf("selectItemCategory")}
                emptyMessage={tf("selectItemCategory")}
              />
              <Input
                type="number"
                placeholder={tf("targetQty")}
                value={newParent.targetQty}
                onChange={(e) => setNewParent((s) => ({ ...s, targetQty: e.target.value }))}
              />
              <Button
                type="button"
                disabled={!newParent.itemCategoryId}
                onClick={async () => {
                  if (!newParent.itemCategoryId) return;
                  await onCreateParent({
                    itemCategoryId: newParent.itemCategoryId,
                    targetQty: Number(newParent.targetQty || 0),
                  });
                  setNewParent({ itemCategoryId: "", targetQty: "" });
                  await onRefresh();
                }}
              >
                {t("categories.addParent")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="w-10 p-2" />
              <th className="p-2 text-left">{tf("code")}</th>
              <th className="p-2 text-left">{tf("name")}</th>
              <th className="p-2 text-right">{tf("plan")}</th>
              <th className="p-2 text-right">{tf("fulfilled")}</th>
              <th className="p-2 text-right">{tf("variance")}</th>
              <th className="w-10 p-2" />
            </tr>
          </thead>
          <tbody>
            {filteredCategories.map((parent) => {
              const parentExpanded = expandedParents[parent.id] ?? false;
              return renderCategoryRow(parent, {
                depth: 0,
                isParentRow: true,
                parentExpanded,
              });
            })}
            <tr className="border-t bg-muted/30 font-semibold">
              <td className="p-2" />
              <td className="p-2">{tf("total")}</td>
              <td className="p-2">{tf("allTypes")}</td>
              <td className="p-2 text-right">{formatPlanNumber(detail.totals.totalPlan)}</td>
              <td className="p-2 text-right bg-green-50 dark:bg-green-950/30">
                {formatPlanNumber(detail.totals.totalActual)}
              </td>
              <td
                className={`p-2 text-right ${
                  detail.totals.totalVariance > 0
                    ? "text-green-600"
                    : detail.totals.totalVariance < 0
                      ? "text-red-600"
                      : ""
                }`}
              >
                {formatPlanNumber(detail.totals.totalVariance)}
              </td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
