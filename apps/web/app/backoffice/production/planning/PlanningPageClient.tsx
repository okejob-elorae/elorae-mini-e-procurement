"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { ItemType } from "@/lib/constants/enums";
import { PERMISSIONS, hasPermission } from "@/lib/rbac";
import { getItemCategories } from "@/app/actions/item-categories";
import { getItemsByType } from "@/app/actions/items";
import { getSuppliersForSelect } from "@/app/actions/suppliers";
import {
  activatePlanYear,
  createPlanCategory,
  createPlanStage,
  createPlanYear,
  createWorkOrderFromStage,
  deletePlanCategory,
  deletePlanStage,
  downloadPlanTemplate,
  generateWorkOrdersFromPlan,
  getPlanDashboard,
  getPlanYear,
  getPlanYears,
  importPlanFromExcel,
  reopenPlanYear,
  resetMonthlyOverride,
  resetMonthlyToAuto,
  setMonthlyOverride,
  setPlanYearLock,
  suggestAccessoryFromBom,
  updatePlanCategory,
  updatePlanStage,
  upsertAccessoryPlans,
  upsertMonthlyCmtAllocations,
  upsertMonthlyColorAllocations,
} from "@/app/actions/planning";
import { PlanningPageShell, PlanningTabPanel } from "@/components/planning/planning-page-shell";
import { PlanGridTab } from "@/components/planning/plan-grid-tab";
import { PlanDashboardTab } from "@/components/planning/plan-dashboard-tab";
import { PlanDetailsTab } from "@/components/planning/plan-details-tab";
import { PlanColorsTab } from "@/components/planning/plan-colors-tab";
import { PlanCmtTab } from "@/components/planning/plan-cmt-tab";
import { PlanAccessoriesTab } from "@/components/planning/plan-accessories-tab";
import type { ComboboxOption, PlanDashboardData, PlanYearDetail } from "@/components/planning/types";

export function PlanningPageClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { data: session } = useSession();
  const activeTab = searchParams.get("tab") || "grid";

  const isAdmin = session?.user?.role === "ADMIN";
  const canManage = hasPermission(
    session?.user?.permissions || [],
    PERMISSIONS.PRODUCTION_PLANNING_MANAGE
  );
  const canCreateWorkOrder = hasPermission(
    session?.user?.permissions || [],
    PERMISSIONS.WORK_ORDERS_CREATE
  );

  const [years, setYears] = useState<
    Array<{ id: string; year: number; isLocked: boolean; status: "DRAFT" | "ACTIVE" }>
  >([]);
  const [selectedYearId, setSelectedYearId] = useState("");
  const [detail, setDetail] = useState<PlanYearDetail | null>(null);
  const [dashboard, setDashboard] = useState<PlanDashboardData | null>(null);
  const [newYear, setNewYear] = useState(String(new Date().getFullYear()));
  const [itemOptions, setItemOptions] = useState<ComboboxOption[]>([]);
  const [itemCategoryOptions, setItemCategoryOptions] = useState<ComboboxOption[]>([]);
  const [accessoryOptions, setAccessoryOptions] = useState<ComboboxOption[]>([]);
  const [supplierOptions, setSupplierOptions] = useState<ComboboxOption[]>([]);
  const [tailorOptions, setTailorOptions] = useState<ComboboxOption[]>([]);

  const refreshAll = async (preferredYearId?: string) => {
    const planYears = await getPlanYears();
    setYears(
      planYears.map((y) => ({
        id: y.id,
        year: y.year,
        isLocked: y.isLocked,
        status: y.status as "DRAFT" | "ACTIVE",
      }))
    );
    const nextYearId = preferredYearId || selectedYearId || planYears[0]?.id || "";
    setSelectedYearId(nextYearId);
    if (!nextYearId) {
      setDetail(null);
      setDashboard(null);
      return;
    }
    const [yearDetail, dashboardData] = await Promise.all([
      getPlanYear(nextYearId),
      getPlanDashboard(nextYearId),
    ]);
    setDetail(yearDetail as PlanYearDetail);
    setDashboard(dashboardData as PlanDashboardData);
  };

  useEffect(() => {
    refreshAll().catch((err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Failed to load planning");
    });
    Promise.all([
      getItemsByType(ItemType.FINISHED_GOOD),
      getItemsByType(ItemType.ACCESSORIES),
      getItemCategories(true),
      getSuppliersForSelect({ approvedOnly: true }),
      getSuppliersForSelect({ approvedOnly: true, typeId: "st-tailor" }),
    ]).then(([fgRows, accRows, categories, suppliers, tailors]) => {
      setItemOptions(
        (fgRows as Array<{ id: string; sku: string; nameId: string }>).map((row) => ({
          value: row.id,
          label: `${row.nameId} (${row.sku})`,
        }))
      );
      setItemCategoryOptions(
        (categories as Array<{ id: string; code: string | null; name: string }>).map((row) => ({
          value: row.id,
          label: row.code ? `${row.code} — ${row.name}` : row.name,
        }))
      );
      setAccessoryOptions(
        (accRows as Array<{ id: string; sku: string; nameId: string }>).map((row) => ({
          value: row.id,
          label: `${row.nameId} (${row.sku})`,
        }))
      );
      const mapSupplier = (row: { id: string; code: string; name: string }) => ({
        value: row.id,
        label: `${row.name} (${row.code})`,
      });
      setSupplierOptions((suppliers as Array<{ id: string; code: string; name: string }>).map(mapSupplier));
      setTailorOptions((tailors as Array<{ id: string; code: string; name: string }>).map(mapSupplier));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once
  }, []);

  useEffect(() => {
    if (!selectedYearId) return;
    refreshAll(selectedYearId).catch((err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Failed to load plan year");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedYearId]);

  const setTab = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", value);
    router.replace(`/backoffice/production/planning?${params.toString()}`);
  };

  const disabled = !canManage || detail?.status !== "DRAFT" || (detail?.isLocked ?? false);

  const workOrderLabels = useMemo(() => {
    const map = new Map<string, string>();
    if (!detail) return map;
    const visit = (nodes: PlanYearDetail["categories"]) => {
      for (const node of nodes) {
        for (const stage of node.stages) {
          if (stage.workOrderId && stage.workOrderDocNumber) {
            map.set(stage.workOrderId, stage.workOrderDocNumber);
          }
        }
        for (const cmt of node.cmtAllocations) {
          if (cmt.workOrderId) {
            const stageWo = node.stages.find((s) => s.workOrderId === cmt.workOrderId);
            if (stageWo?.workOrderDocNumber) map.set(cmt.workOrderId, stageWo.workOrderDocNumber);
          }
        }
        if (node.children.length) visit(node.children);
      }
    };
    visit(detail.categories);
    return map;
  }, [detail]);

  const handleCreateWo = async (stageId: string) => {
    try {
      await createWorkOrderFromStage(stageId);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to create WO");
    }
  };

  return (
    <PlanningPageShell
      activeTab={activeTab}
      onTabChange={setTab}
      years={years}
      selectedYearId={selectedYearId}
      onYearChange={setSelectedYearId}
      createdByName={detail?.createdBy.name}
      planStatus={detail?.status}
      isLocked={detail?.isLocked}
      isAdmin={isAdmin}
      canManage={canManage}
      newYear={newYear}
      onNewYearChange={setNewYear}
      onCreateYear={async () => {
        if (!canManage) return;
        const year = Number(newYear);
        if (!Number.isInteger(year)) {
          toast.error("Invalid year");
          return;
        }
        try {
          const created = await createPlanYear({ year });
          await refreshAll(created.id);
          setNewYear(String(year + 1));
          toast.success("Plan year created");
        } catch (err: unknown) {
          toast.error(err instanceof Error ? err.message : "Failed to create year");
        }
      }}
      onToggleLock={async () => {
        if (!detail || !isAdmin) return;
        await setPlanYearLock(detail.id, !detail.isLocked);
        await refreshAll(detail.id);
      }}
      onActivatePlan={async () => {
        if (!detail || !canManage) return;
        try {
          await activatePlanYear(detail.id);
          await refreshAll(detail.id);
          toast.success("Plan activated");
        } catch (err: unknown) {
          toast.error(err instanceof Error ? err.message : "Activation failed");
        }
      }}
      onReopenPlan={async () => {
        if (!detail || !canManage) return;
        try {
          await reopenPlanYear(detail.id);
          await refreshAll(detail.id);
          toast.success("Plan reopened to draft");
        } catch (err: unknown) {
          toast.error(err instanceof Error ? err.message : "Reopen failed");
        }
      }}
      onDownloadTemplate={async () => {
        try {
          const { base64, filename } = await downloadPlanTemplate();
          const link = document.createElement("a");
          link.href = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${base64}`;
          link.download = filename;
          link.click();
        } catch (err: unknown) {
          toast.error(err instanceof Error ? err.message : "Download failed");
        }
      }}
      onImportExcel={async (file) => {
        if (!detail) return;
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        for (let i = 0; i < bytes.length; i += 1) {
          binary += String.fromCharCode(bytes[i]!);
        }
        const base64 = btoa(binary);
        try {
          const result = await importPlanFromExcel(detail.id, base64);
          await refreshAll(detail.id);
          toast.success(
            `Import: ${result.created} created, ${result.updated} updated, ${result.errors.length} errors`
          );
        } catch (err: unknown) {
          toast.error(err instanceof Error ? err.message : "Import failed");
        }
      }}
    >
      <PlanningTabPanel value="grid">
        {detail && (
          <PlanGridTab
            detail={detail}
            disabled={disabled}
            canManage={canManage}
            canCreateWo={canCreateWorkOrder}
            itemOptions={itemOptions}
            itemCategoryOptions={itemCategoryOptions}
            supplierOptions={tailorOptions.length ? tailorOptions : supplierOptions}
            onRefresh={() => refreshAll(detail.id)}
            onCreateParent={async (data) => {
              await createPlanCategory({
                planYearId: detail.id,
                itemCategoryId: data.itemCategoryId,
                targetQty: data.targetQty,
              });
            }}
            onCreateChild={async (parentId, data) => {
              await createPlanCategory({
                planYearId: detail.id,
                parentId,
                code: data.code,
                name: data.name,
                parentSharePercent: data.share,
              });
            }}
            onUpdateTarget={async (id, qty) => {
              await updatePlanCategory(id, { targetQty: qty });
            }}
            onUpdateShare={async (id, share) => {
              await updatePlanCategory(id, { parentSharePercent: share });
            }}
            onUpdateItem={async (id, itemId) => {
              await updatePlanCategory(id, { itemId });
            }}
            onDeleteCategory={async (id) => {
              await deletePlanCategory(id);
            }}
            onSaveMonth={async (id, month, qty) => {
              await setMonthlyOverride({ planCategoryId: id, month, targetQty: qty });
            }}
            onResetMonth={async (id, month) => {
              await resetMonthlyOverride(id, month);
            }}
            onResetAllMonths={async (id) => {
              await resetMonthlyToAuto(id);
            }}
            onAddStage={async (id, data) => {
              await createPlanStage({ planCategoryId: id, ...data });
            }}
            onUpdateStage={async (id, data) => {
              await updatePlanStage(id, data);
            }}
            onDeleteStage={async (id) => {
              await deletePlanStage(id);
            }}
            onCreateWo={handleCreateWo}
          />
        )}
      </PlanningTabPanel>

      <PlanningTabPanel value="dashboard">
        {dashboard && <PlanDashboardTab dashboard={dashboard} />}
      </PlanningTabPanel>

      <PlanningTabPanel value="rincian">
        {detail && (
          <PlanDetailsTab
            detail={detail}
            supplierOptions={tailorOptions}
            disabled={disabled}
            canCreateWo={canCreateWorkOrder}
            onRefresh={() => refreshAll(detail.id)}
            onAddStage={async (id, data) => {
              await createPlanStage({ planCategoryId: id, ...data });
            }}
            onUpdateStage={async (id, data) => {
              await updatePlanStage(id, data);
            }}
            onDeleteStage={(id) => deletePlanStage(id)}
            onCreateWo={handleCreateWo}
          />
        )}
      </PlanningTabPanel>

      <PlanningTabPanel value="warna">
        {detail && (
          <PlanColorsTab
            detail={detail}
            disabled={disabled}
            onRefresh={() => refreshAll(detail.id)}
            onSave={async (categoryId, month, allocations) => {
              await upsertMonthlyColorAllocations(categoryId, month, allocations);
              toast.success("Color allocations saved");
            }}
          />
        )}
      </PlanningTabPanel>

      <PlanningTabPanel value="jahitan">
        {detail && (
          <PlanCmtTab
            detail={detail}
            tailorOptions={tailorOptions}
            disabled={disabled}
            canGenerateWo={canCreateWorkOrder}
            workOrderLabels={workOrderLabels}
            onRefresh={() => refreshAll(detail.id)}
            onSave={async (categoryId, month, variantSku, allocations) => {
              await upsertMonthlyCmtAllocations(categoryId, month, variantSku, allocations);
              toast.success("CMT allocations saved");
            }}
            onGenerateWorkOrders={async (filters) => {
              const result = await generateWorkOrdersFromPlan(detail.id, filters);
              toast.success(
                `WO generation: ${result.created} created, ${result.skipped} skipped, ${result.errors} errors`
              );
              return result;
            }}
          />
        )}
      </PlanningTabPanel>

      <PlanningTabPanel value="aksesoris">
        {detail && (
          <PlanAccessoriesTab
            detail={detail}
            accessoryOptions={accessoryOptions}
            disabled={disabled}
            onRefresh={() => refreshAll(detail.id)}
            onSave={async (categoryId, plans) => {
              await upsertAccessoryPlans(categoryId, plans);
            }}
            onSuggestBom={(categoryId) => suggestAccessoryFromBom(categoryId)}
          />
        )}
      </PlanningTabPanel>
    </PlanningPageShell>
  );
}
