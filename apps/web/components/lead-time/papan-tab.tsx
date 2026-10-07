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
  sisipkanProsesPemasokAction,
  type SupplierChainCard,
} from "@/app/actions/lead-time";
import { HantuSeret } from "@/components/gerak/HantuSeret";
import { useSeretUrut } from "@/components/gerak/useSeretUrut";
import { Input } from "@/components/ui/input";
import { celahDiam, indeksTujuan, pindahkan } from "@/lib/gerak/seret-urut";
import { CentangPemasokDialog } from "./centang-pemasok-dialog";
import { ProcessPicker, type PickerTemplate } from "./process-picker";
import { bolehLepasPapan, pemasokDariDaftar, type DataSeretPapan } from "./seret-papan";
import { SupplierChainCardView, type SopOption } from "./supplier-chain-card";

type Props = { canManage: boolean };

export function PapanTab({ canManage }: Props) {
  const t = useTranslations("leadTime.papan");
  const tc = useTranslations("leadTime.common");
  const [templates, setTemplates] = useState<PickerTemplate[]>([]);
  const [cards, setCards] = useState<SupplierChainCard[]>([]);
  const [sopOptions, setSopOptions] = useState<SopOption[]>([]);
  const [pickerSearch, setPickerSearch] = useState("");
  const [supplierSearch, setSupplierSearch] = useState("");
  const [selected, setSelected] = useState<PickerTemplate | null>(null);
  const [centangUntuk, setCentangUntuk] = useState<PickerTemplate | null>(null);
  const tServer = useTranslations("leadTime.server");

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
      toast.error(err instanceof Error ? err.message : tc("loadFailed"));
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
      toast.error(result.error ?? tc("failed"));
      return;
    }
    toast.success(tc("saved"));
    void reload();
  }

  async function onRemove(stepId: string, name: string, supplierName: string) {
    if (!confirm(t("removeConfirm", { name, supplier: supplierName }))) return;
    const result = await removeSupplierProcessStep(stepId);
    if (!result.success) {
      toast.error(result.error ?? tc("failed"));
      return;
    }
    void reload();
  }

  async function onReorder(supplierId: string, orderedStepIds: string[]) {
    // Tampilkan urutan baru seketika; muat ulang sesudah server menjawab.
    setCards((lama) =>
      lama.map((c) =>
        c.supplierId === supplierId
          ? {
              ...c,
              steps: orderedStepIds
                .map((id) => c.steps.find((s) => s.id === id))
                .filter((s): s is SupplierChainCard["steps"][number] => !!s),
            }
          : c
      )
    );
    const result = await reorderSupplierChain({ supplierId, orderedStepIds });
    if (!result.success) {
      toast.error(result.error ?? tc("failed"));
      return;
    }
    void reload();
  }

  async function onSisipkan(supplierId: string, template: PickerTemplate, celah: number) {
    const hasil = await sisipkanProsesPemasokAction({
      supplierId,
      processTemplateId: template.id,
      celah,
    }).catch(() => ({ ok: false as const, code: "GAGAL" as const }));
    if (!hasil.ok) {
      toast.error(tServer.has(`err${hasil.code}`) ? tServer(`err${hasil.code}`) : tServer("errGAGAL"));
      return;
    }
    toast.success(tc("saved"));
    void reload();
  }

  // Seret-lepas: proses dari palet ke kartu mana pun, langkah di dalam kartunya sendiri.
  const seret = useSeretUrut<DataSeretPapan>({
    nonaktif: !canManage,
    bolehLepas: bolehLepasPapan,
    onLepas: (data, { daftar, celah }) => {
      const supplierId = pemasokDariDaftar(daftar);
      if (!supplierId) return;
      if (data.jenis === "proses") {
        void onSisipkan(supplierId, data.template, celah);
        return;
      }
      const kartu = cards.find((c) => c.supplierId === supplierId);
      const ids = kartu?.steps.map((s) => s.id) ?? [];
      const dari = ids.indexOf(data.stepId);
      if (dari < 0 || celahDiam(dari, celah)) return;
      void onReorder(supplierId, pindahkan(ids, dari, indeksTujuan(dari, celah)));
    },
  });

  const dataSeret = seret.sesi?.data ?? null;
  const sasaranSeret = seret.sesi?.sasaran ?? null;
  const kartuSasaran = sasaranSeret
    ? cards.find((c) => c.supplierId === pemasokDariDaftar(sasaranSeret.daftar)) ?? null
    : null;
  const keteranganSeret = (() => {
    if (!dataSeret || !sasaranSeret || !kartuSasaran) return null;
    if (dataSeret.jenis === "proses") {
      return t("seretKe", {
        posisi: Math.min(sasaranSeret.celah, kartuSasaran.steps.length) + 1,
        pemasok: kartuSasaran.name,
      });
    }
    const dari = kartuSasaran.steps.findIndex((s) => s.id === dataSeret.stepId);
    if (dari < 0 || celahDiam(dari, sasaranSeret.celah)) return t("seretTetap");
    return t("seretPosisi", {
      posisi: indeksTujuan(dari, sasaranSeret.celah) + 1,
      jumlah: kartuSasaran.steps.length,
    });
  })();

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
      toast.error(result.error ?? tc("failed"));
      return;
    }
    toast.success(tc("saved"));
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
        pegangan={canManage ? seret.pegangan : undefined}
        dibawaId={dataSeret?.jenis === "proses" ? dataSeret.template.id : null}
        onCentang={canManage && selected ? () => setCentangUntuk(selected) : undefined}
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
              seret={canManage ? { sesi: seret.sesi, pegangan: seret.pegangan } : undefined}
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
      <HantuSeret
        sesi={seret.sesi}
        label={dataSeret ? (dataSeret.jenis === "proses" ? dataSeret.template.name : dataSeret.nama) : ""}
        keterangan={keteranganSeret}
      />
      {canManage ? (
        <CentangPemasokDialog
          template={centangUntuk}
          cards={cards}
          onOpenChange={(buka) => !buka && setCentangUntuk(null)}
          onApplied={() => void reload()}
        />
      ) : null}
    </div>
  );
}
