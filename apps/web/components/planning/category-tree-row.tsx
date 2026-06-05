"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { ComboboxOption, PlanCategoryDetail } from "./types";
import { formatPlanNumber } from "./types";
import { InlineDetailPanel, type InlineDetailPanelProps } from "./inline-detail-panel";

type CategoryTreeRowProps = {
  category: PlanCategoryDetail;
  depth?: number;
  isParent: boolean;
  expanded: boolean;
  detailExpanded: boolean;
  onToggleExpand: () => void;
  onToggleDetail: () => void;
  disabled?: boolean;
  canCreateWo?: boolean;
  allowWoWhenLocked?: boolean;
  itemOptions: ComboboxOption[];
  supplierOptions: ComboboxOption[];
  onUpdateTarget?: (targetQty: number) => Promise<void>;
  onUpdateShare?: (share: number) => Promise<void>;
  onUpdateItem?: (itemId: string | null) => Promise<void>;
  onDelete?: () => Promise<void>;
  onAddChild?: (data: { code: string; name: string; share: number }) => Promise<void>;
  onSaveMonth: (month: number, targetQty: number) => Promise<void>;
  onResetMonth: (month: number) => Promise<void>;
  onResetAllMonths: () => Promise<void>;
  onAddStage: InlineDetailPanelProps["onAddStage"];
  onUpdateStage: InlineDetailPanelProps["onUpdateStage"];
  onDeleteStage: (stageId: string) => Promise<void>;
  onCreateWo: (stageId: string) => Promise<void>;
  renderChildren?: () => React.ReactNode;
};

export function CategoryTreeRow({
  category,
  depth = 0,
  isParent,
  expanded,
  detailExpanded,
  onToggleExpand,
  onToggleDetail,
  disabled,
  canCreateWo,
  allowWoWhenLocked,
  itemOptions,
  supplierOptions,
  onUpdateTarget,
  onUpdateShare,
  onUpdateItem,
  onDelete,
  onAddChild,
  onSaveMonth,
  onResetMonth,
  onResetAllMonths,
  onAddStage,
  onUpdateStage,
  onDeleteStage,
  onCreateWo,
  renderChildren,
}: CategoryTreeRowProps) {
  const t = useTranslations("planning");
  const tc = useTranslations("planning.categories");
  const tf = useTranslations("planning.fields");
  const [childDraft, setChildDraft] = useState({ code: "", name: "", share: "" });
  const [showAddChild, setShowAddChild] = useState(false);

  const isLeaf = category.children.length === 0;
  const canExpandDetail = isLeaf;
  const varianceClass =
    category.variance > 0
      ? "text-green-600"
      : category.variance < 0
        ? "text-red-600"
        : "";

  const planDisplay = isParent && category.children.length > 0
    ? formatPlanNumber(category.targetQty ?? 0)
    : formatPlanNumber(category.effectiveTarget);

  const fulfilledDisplay =
    category.actualQty > 0 ? formatPlanNumber(category.actualQty) : "—";
  const varianceDisplay =
    category.effectiveTarget > 0 || category.actualQty > 0
      ? formatPlanNumber(category.variance)
      : "—";

  const isMasterLinked = !category.parentId && !!category.itemCategoryId;

  return (
    <>
      <tr className="border-b hover:bg-muted/40">
        <td className="w-10 p-2 text-center">
          {(isParent || canExpandDetail) && (
            <button
              type="button"
              className="inline-flex"
              onClick={isParent ? onToggleExpand : onToggleDetail}
              aria-expanded={isParent ? expanded : detailExpanded}
            >
              {isParent ? (
                expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />
              ) : detailExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
          )}
        </td>
        <td
          className={`p-2 font-medium ${isMasterLinked ? "text-muted-foreground" : ""}`}
          style={{ paddingLeft: 8 + depth * 24 }}
        >
          {depth > 0 && <span className="text-muted-foreground mr-1">↳</span>}
          {category.code}
        </td>
        <td
          className={`p-2 max-w-[200px] truncate ${isMasterLinked ? "text-muted-foreground" : ""}`}
          title={isMasterLinked ? category.itemCategoryName ?? category.name : undefined}
        >
          {category.name}
        </td>
        <td className="p-2 text-right">
          {isParent && !isLeaf && onUpdateTarget ? (
            <Input
              type="number"
              className="h-8 text-right"
              defaultValue={category.targetQty ?? 0}
              disabled={disabled}
              onBlur={(e) => void onUpdateTarget(Number(e.target.value))}
            />
          ) : (
            <div>
              <div>{planDisplay}</div>
              {category.unallocatedPercent != null && category.unallocatedPercent > 0 && (
                <div className="text-xs text-muted-foreground">
                  {tc("unallocated", { percent: category.unallocatedPercent.toFixed(1) })}
                </div>
              )}
            </div>
          )}
        </td>
        <td className="p-2 text-right bg-green-50 dark:bg-green-950/30">
          {fulfilledDisplay}
        </td>
        <td className={`p-2 text-right ${varianceClass}`}>{varianceDisplay}</td>
        <td className="p-2 text-center">
          {!disabled && onDelete && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" size="icon" variant="ghost" className="h-8 w-8">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("actions.delete")}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {tc("deleteConfirm", { code: category.code })}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("actions.cancel")}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void onDelete()}>
                    {t("actions.delete")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </td>
      </tr>

      {isParent && expanded && renderChildren?.()}

      {isParent && expanded && !disabled && onAddChild && (
        <tr>
          <td colSpan={7} className="p-3 bg-muted/20">
            {showAddChild ? (
              <div className="grid gap-2 md:grid-cols-4">
                <Input
                  placeholder={tf("code")}
                  value={childDraft.code}
                  onChange={(e) => setChildDraft((s) => ({ ...s, code: e.target.value }))}
                />
                <Input
                  placeholder={tf("name")}
                  value={childDraft.name}
                  onChange={(e) => setChildDraft((s) => ({ ...s, name: e.target.value }))}
                />
                <Input
                  type="number"
                  placeholder={tf("sharePercent")}
                  value={childDraft.share}
                  onChange={(e) => setChildDraft((s) => ({ ...s, share: e.target.value }))}
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    onClick={async () => {
                      await onAddChild({
                        code: childDraft.code,
                        name: childDraft.name,
                        share: Number(childDraft.share),
                      });
                      setChildDraft({ code: "", name: "", share: "" });
                      setShowAddChild(false);
                    }}
                  >
                    {t("actions.add")}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setShowAddChild(false)}>
                    {t("actions.cancel")}
                  </Button>
                </div>
              </div>
            ) : (
              <Button type="button" variant="outline" size="sm" onClick={() => setShowAddChild(true)}>
                {tc("addChild", { parentCode: category.code })}
              </Button>
            )}
          </td>
        </tr>
      )}

      {isLeaf && depth > 0 && expanded && (
        <tr>
          <td colSpan={7} className="p-2">
            <div className="grid gap-2 md:grid-cols-12 pl-6">
              <div className="md:col-span-2">
                <Input
                  type="number"
                  defaultValue={category.parentSharePercent ?? 0}
                  disabled={disabled}
                  onBlur={(e) => void onUpdateShare?.(Number(e.target.value))}
                />
              </div>
              <div className="md:col-span-6">
                <SearchableCombobox
                  options={[{ value: "", label: tf("selectItem") }, ...itemOptions]}
                  value={category.itemId || ""}
                  onValueChange={(v) => void onUpdateItem?.(v || null)}
                  disabled={disabled}
                />
              </div>
            </div>
          </td>
        </tr>
      )}

      {canExpandDetail && detailExpanded && (
        <tr>
          <td colSpan={7} className="p-0">
            <InlineDetailPanel
              category={category}
              supplierOptions={supplierOptions}
              disabled={disabled}
              canCreateWo={canCreateWo}
              allowWoWhenLocked={allowWoWhenLocked}
              onSaveMonth={onSaveMonth}
              onResetMonth={onResetMonth}
              onResetAllMonths={onResetAllMonths}
              onAddStage={onAddStage}
              onUpdateStage={onUpdateStage}
              onDeleteStage={onDeleteStage}
              onCreateWo={onCreateWo}
            />
          </td>
        </tr>
      )}
    </>
  );
}
