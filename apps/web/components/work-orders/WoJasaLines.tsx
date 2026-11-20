"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type WoJasaLineForm = {
  sequence: number;
  supplierId: string;
  serviceTypeId: string;
  stepName: string;
  servicePrice: number;
  servicePpnIncluded: boolean;
  qty: number;
  notes?: string;
};

export type WoServiceTypeOption = { id: string; name: string; code: string };

export function emptyJasaLine(supplierId = ""): WoJasaLineForm {
  return {
    sequence: 1,
    supplierId,
    serviceTypeId: "",
    stepName: "",
    servicePrice: 0,
    servicePpnIncluded: false,
    qty: 0,
  };
}

/** Keep row-1 supplier in step with the materials destination when the user has not pointed it elsewhere. */
export function syncJasaWithVendor(
  steps: WoJasaLineForm[],
  prevVendorId: string,
  nextVendorId: string,
): WoJasaLineForm[] {
  if (!nextVendorId) return steps;
  if (steps.length === 0) return [{ ...emptyJasaLine(nextVendorId), sequence: 1 }];
  const first = steps[0];
  if (!first.supplierId || first.supplierId === prevVendorId) {
    return [{ ...first, supplierId: nextVendorId, sequence: 1 }, ...steps.slice(1).map((s, i) => ({ ...s, sequence: i + 2 }))];
  }
  return steps;
}

function kodeDariNama(nama: string): string {
  const base = nama.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 50);
  return base || "JASA";
}

type Props = {
  steps: WoJasaLineForm[];
  onChange: (steps: WoJasaLineForm[]) => void;
  suppliers: Array<{ id: string; name: string; code: string }>;
  serviceTypes: WoServiceTypeOption[];
  onServiceTypesChange?: (types: WoServiceTypeOption[]) => void;
  loadingSuppliers?: boolean;
  loadingTypes?: boolean;
};

export function WoJasaLines({
  steps,
  onChange,
  suppliers,
  serviceTypes,
  onServiceTypesChange,
  loadingSuppliers,
  loadingTypes,
}: Props) {
  const tF = useTranslations("workOrders.form");
  const tR = useTranslations("workOrders.formulir");
  const tJenis = useTranslations("serviceTypes");

  const patch = (index: number, part: Partial<WoJasaLineForm>) => {
    onChange(
      steps.map((s, i) => {
        if (i !== index) return s;
        const next = { ...s, ...part };
        if (part.serviceTypeId !== undefined) {
          const tipe = serviceTypes.find((t) => t.id === part.serviceTypeId);
          next.stepName = tipe?.name ?? "";
        }
        return next;
      }),
    );
  };

  const buatJenis = async (nama: string, index: number) => {
    if (!onServiceTypesChange) return;
    try {
      const { createServiceTypeAction } = await import("@/app/actions/service-types");
      let kode = kodeDariNama(nama);
      let hasil = await createServiceTypeAction({ name: nama.trim(), code: kode, isActive: true });
      if (!hasil.ok && hasil.code === "DUPLICATE_CODE") {
        kode = `${kode.slice(0, 44)}_${Math.random().toString(36).slice(2, 6).toUpperCase()}`.slice(0, 50);
        hasil = await createServiceTypeAction({ name: nama.trim(), code: kode, isActive: true });
      }
      if (!hasil.ok || !hasil.id) {
        toast.error(
          !hasil.ok && hasil.code === "DUPLICATE_CODE"
            ? tJenis("errDuplicate", { code: kode })
            : tJenis("saveFailed"),
        );
        return;
      }
      const baru: WoServiceTypeOption = { id: hasil.id, name: nama.trim(), code: kode };
      onServiceTypesChange([...serviceTypes.filter((t) => t.id !== baru.id), baru]);
      onChange(
        steps.map((s, i) =>
          i === index ? { ...s, serviceTypeId: baru.id, stepName: baru.name } : s,
        ),
      );
      toast.success(tJenis("createdToast"));
    } catch {
      toast.error(tJenis("saveFailed"));
    }
  };

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex items-center justify-between">
        <Label>{tR("labelJasa")}</Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            onChange([
              ...steps,
              { ...emptyJasaLine(), sequence: steps.length + 1 },
            ])
          }
        >
          {tF("addStep")}
        </Button>
      </div>
      {steps.map((step, index) => (
        <div key={index} className="grid gap-2 rounded border p-2 sm:grid-cols-5">
          <SearchableCombobox
            options={[
              { value: "__none__", label: tF("selectServiceType") },
              ...serviceTypes.map((t) => ({ value: t.id, label: t.name })),
            ]}
            value={step.serviceTypeId || "__none__"}
            onValueChange={(v) => patch(index, { serviceTypeId: v === "__none__" ? "" : v })}
            placeholder={tF("selectServiceType")}
            disabled={loadingTypes}
            onCreate={onServiceTypesChange ? (q) => buatJenis(q, index) : undefined}
            createLabel={(q) => tF("addServiceTypeNamed", { name: q })}
          />
          <SearchableCombobox
            options={[
              { value: "__none__", label: tF("selectSupplier") },
              ...suppliers.map((s) => ({ value: s.id, label: `${s.name} (${s.code})` })),
            ]}
            value={step.supplierId || "__none__"}
            onValueChange={(v) => patch(index, { supplierId: v === "__none__" ? "" : v })}
            placeholder={tF("selectSupplier")}
            disabled={loadingSuppliers}
          />
          <Input
            type="number"
            min={0}
            placeholder={tF("servicePricePlaceholder")}
            value={step.servicePrice || ""}
            onChange={(e) => patch(index, { servicePrice: Number(e.target.value) || 0 })}
          />
          <Select
            value={step.servicePpnIncluded ? "include" : "exclude"}
            onValueChange={(v) => patch(index, { servicePpnIncluded: v === "include" })}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="PPN" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="exclude">{tF("ppnExclude")}</SelectItem>
              <SelectItem value="include">{tF("ppnInclude")}</SelectItem>
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="ghost"
            disabled={steps.length <= 1}
            onClick={() =>
              onChange(
                steps
                  .filter((_, i) => i !== index)
                  .map((s, i) => ({ ...s, sequence: i + 1 })),
              )
            }
          >
            {tF("remove")}
          </Button>
        </div>
      ))}
    </div>
  );
}

export function jasaLinesValid(steps: WoJasaLineForm[]): boolean {
  return steps.length > 0 && steps.every((s) => !!s.supplierId && !!s.serviceTypeId);
}

export function toWriterSteps(steps: WoJasaLineForm[]) {
  return steps
    .filter((s) => s.supplierId && s.serviceTypeId)
    .map((step, idx) => ({
      sequence: idx + 1,
      supplierId: step.supplierId,
      serviceTypeId: step.serviceTypeId,
      stepName: step.stepName || undefined,
      servicePrice: Number(step.servicePrice || 0),
      servicePpnIncluded: step.servicePpnIncluded ?? false,
      qty: Number(step.qty || 0) || undefined,
      notes: step.notes?.trim() || undefined,
    }));
}
