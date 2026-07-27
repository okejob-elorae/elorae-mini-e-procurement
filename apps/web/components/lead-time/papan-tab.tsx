"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import { toast } from "sonner";
import {
  addSupplierProcessStep,
  applyChainTemplateToSupplier,
  getAllSupplierChains,
  getChainTemplates,
  getProcessTemplates,
  removeSupplierProcessStep,
  reorderSupplierChain,
  type SupplierChainCard,
} from "@/app/actions/lead-time";
import { Input } from "@/components/ui/input";
import { ProcessPicker, type PickerTemplate } from "./process-picker";
import { SupplierChainCardView, type SopOption } from "./supplier-chain-card";

type Props = { canManage: boolean };

export function PapanTab({ canManage }: Props) {
  const t = useTranslations("leadTime.papan");
  const [templates, setTemplates] = useState<PickerTemplate[]>([]);
  const [cards, setCards] = useState<SupplierChainCard[]>([]);
  const [sopOptions, setSopOptions] = useState<SopOption[]>([]);
  const [pickerSearch, setPickerSearch] = useState("");
  const [supplierSearch, setSupplierSearch] = useState("");
  const [selected, setSelected] = useState<PickerTemplate | null>(null);

  async function reload() {
    try {
      const [tmpls, chainCards, sops] = await Promise.all([
        getProcessTemplates(false),
        getAllSupplierChains(),
        getChainTemplates(false),
      ]);
      setTemplates(
        tmpls.map((x) => ({
          id: x.id,
          name: x.name,
          leadTimeType: x.leadTimeType,
          days: x.days,
          rateQty: x.rateQty,
          isApproval: x.isApproval,
        }))
      );
      setCards(chainCards);
      setSopOptions(
        sops.map((s) => ({
          id: s.id,
          name: s.name,
          stepCount: s.steps.length,
        }))
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load");
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  const filteredTemplates = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter((x) => x.name.toLowerCase().includes(q));
  }, [templates, pickerSearch]);

  const filteredCards = useMemo(() => {
    const q = supplierSearch.trim().toLowerCase();
    if (!q) return cards;
    return cards.filter(
      (c) =>
        c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)
    );
  }, [cards, supplierSearch]);

  async function onAssign(supplierId: string) {
    if (!selected || !canManage) return;
    const result = await addSupplierProcessStep({
      supplierId,
      processTemplateId: selected.id,
    });
    if (!result.success) {
      toast.error(result.error ?? "Failed");
      return;
    }
    toast.success("OK");
    void reload();
  }

  async function onRemove(stepId: string, name: string, supplierName: string) {
    if (!confirm(t("removeConfirm", { name, supplier: supplierName }))) return;
    const result = await removeSupplierProcessStep(stepId);
    if (!result.success) {
      toast.error(result.error ?? "Failed");
      return;
    }
    void reload();
  }

  async function onReorder(supplierId: string, orderedStepIds: string[]) {
    const result = await reorderSupplierChain({ supplierId, orderedStepIds });
    if (!result.success) {
      toast.error(result.error ?? "Failed");
      return;
    }
    void reload();
  }

  async function onApplySop(
    supplierId: string,
    supplierName: string,
    chainTemplateId: string,
    mode: "REPLACE" | "APPEND",
    sopName: string,
    stepCount: number
  ) {
    const msg =
      mode === "REPLACE"
        ? t("applyConfirm", {
            supplier: supplierName,
            name: sopName,
            n: stepCount,
          })
        : t("applyAppendConfirm", {
            supplier: supplierName,
            name: sopName,
            n: stepCount,
          });
    if (!confirm(msg)) return;
    const result = await applyChainTemplateToSupplier({
      supplierId,
      chainTemplateId,
      mode,
    });
    if (!result.success) {
      toast.error(result.error ?? "Failed");
      return;
    }
    toast.success("OK");
    void reload();
  }

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <ProcessPicker
        templates={filteredTemplates}
        search={pickerSearch}
        onSearchChange={setPickerSearch}
        selectedId={canManage ? selected?.id ?? null : null}
        onSelect={(tmpl) => setSelected(canManage ? tmpl : null)}
      />
      <div className="flex-1 space-y-3 min-w-0">
        <div className="relative max-w-sm">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder={t("searchSupplier")}
            value={supplierSearch}
            onChange={(e) => setSupplierSearch(e.target.value)}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
          {filteredCards.map((card) => (
            <SupplierChainCardView
              key={card.supplierId}
              card={card}
              canManage={canManage}
              assignMode={Boolean(selected) && canManage}
              sopOptions={sopOptions}
              onAssignClick={() => void onAssign(card.supplierId)}
              onRemove={(stepId, name) =>
                void onRemove(stepId, name, card.name)
              }
              onReorder={(ids) => void onReorder(card.supplierId, ids)}
              onUpdated={() => void reload()}
              onApplySop={(chainTemplateId, mode, sopName, stepCount) =>
                void onApplySop(
                  card.supplierId,
                  card.name,
                  chainTemplateId,
                  mode,
                  sopName,
                  stepCount
                )
              }
            />
          ))}
        </div>
      </div>
    </div>
  );
}
