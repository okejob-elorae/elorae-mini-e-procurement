"use client";

import { Fragment, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Search } from "lucide-react";
import { toast } from "sonner";
import {
  addSupplierProcessStep,
  applyChainTemplateToSupplier,
  getAllSupplierChains,
  getChainTemplates,
  getProcessTemplates,
  hitungPemasokTersembunyiPapanAction,
  removeSupplierProcessStep,
  reorderSupplierChain,
  sisipkanProsesPemasokAction,
  type SupplierChainCard,
} from "@/app/actions/lead-time";
import {
  bagianPemasokTersembunyi,
  formatAngka,
  lepasMembuangPengaturan,
  totalTersembunyi,
  type PemasokTersembunyi,
} from "@/app/backoffice/lead-time/papan-aturan";
import { HantuSeret } from "@/components/gerak/HantuSeret";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useSeretUrut } from "@/components/gerak/useSeretUrut";
import { Input } from "@/components/ui/input";
import { celahDiam, indeksTujuan, pindahkan } from "@/lib/gerak/seret-urut";
import { CentangPemasokDialog } from "./centang-pemasok-dialog";
import { ProcessPicker, type PickerTemplate } from "./process-picker";
import { bolehLepasPapan, pemasokDariDaftar, type DataSeretPapan } from "./seret-papan";
import { SupplierChainCardView, type SopOption } from "./supplier-chain-card";

type Props = { canManage: boolean };

type LangkahPapan = SupplierChainCard["steps"][number];

type TerapkanSop = {
  supplierId: string;
  supplierName: string;
  chainTemplateId: string;
  mode: "REPLACE" | "APPEND";
  sopName: string;
  stepCount: number;
  /** Langkah di rantai pemasok sekarang — REPLACE menghapus semuanya. */
  langkahSekarang: number;
};

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
  const [lepas, setLepas] = useState<{ step: LangkahPapan; supplierName: string } | null>(null);
  const [terapkan, setTerapkan] = useState<TerapkanSop | null>(null);
  const [tersembunyi, setTersembunyi] = useState<{ jumlah: PemasokTersembunyi; bolehBukaPemasok: boolean } | null>(
    null,
  );
  const [sibuk, mulai] = useTransition();
  const tServer = useTranslations("leadTime.server");
  const locale = useLocale();

  async function reload() {
    // Catatan pemasok yang tidak tampil: terpisah, supaya gagalnya tidak mengosongkan papan.
    hitungPemasokTersembunyiPapanAction()
      .then((h) => setTersembunyi(h.ok ? { jumlah: h.jumlah, bolehBukaPemasok: h.bolehBukaPemasok } : null))
      .catch(() => setTersembunyi(null));
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

  const lepasLangkah = (stepId: string) =>
    mulai(async () => {
      const result = await removeSupplierProcessStep(stepId).catch(() => ({ success: false, error: undefined }));
      if (!result.success) {
        toast.error(result.error ?? tc("failed"));
        return;
      }
      toast.success(tc("saved"));
      setLepas(null);
      void reload();
    });

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

  const terapkanSop = (a: TerapkanSop) =>
    mulai(async () => {
      const result = await applyChainTemplateToSupplier({
        supplierId: a.supplierId,
        chainTemplateId: a.chainTemplateId,
        mode: a.mode,
      }).catch(() => ({ success: false, error: undefined }));
      if (!result.success) {
        toast.error(result.error ?? tc("failed"));
        return;
      }
      toast.success(tc("saved"));
      setTerapkan(null);
      void reload();
    });

  const lepasHapusPengaturan = lepas ? lepasMembuangPengaturan(lepas.step) : false;
  const gantiMenghapus = terapkan?.mode === "REPLACE" && terapkan.langkahSekarang > 0;
  const bagianTersembunyi = tersembunyi ? bagianPemasokTersembunyi(tersembunyi.jumlah) : [];

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
        onCentang={
          canManage
            ? () => {
                if (selected) setCentangUntuk(selected);
              }
            : undefined
        }
      />
      <div className="flex-1 space-y-3 min-w-0">
        <div className="relative max-w-sm">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder={t("searchSupplierV2")}
            value={supplierSearch}
            onChange={(e) => setSupplierSearch(e.target.value)}
          />
        </div>
        {tersembunyi && bagianTersembunyi.length > 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("tersembunyi.awal", { n: formatAngka(totalTersembunyi(tersembunyi.jumlah), locale) })}{" "}
            {bagianTersembunyi.map((b, i) => {
              const teks = t(`tersembunyi.${b.jenis}`, { n: formatAngka(b.jumlah, locale) });
              return (
                <Fragment key={b.jenis}>
                  {i > 0 ? ", " : null}
                  {tersembunyi.bolehBukaPemasok ? (
                    <Link href={b.href} className="text-tautan underline-offset-4 hover:underline">
                      {teks}
                    </Link>
                  ) : (
                    teks
                  )}
                </Fragment>
              );
            })}
            .
          </p>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
          {filteredCards.map((card) => (
            <SupplierChainCardView
              key={card.supplierId}
              card={card}
              canManage={canManage}
              assignMode={Boolean(selected) && canManage}
              sopOptions={sopOptions}
              onAssignClick={() => void onAssign(card.supplierId)}
              onRemove={(step) => setLepas({ step, supplierName: card.name })}
              onReorder={(ids) => void onReorder(card.supplierId, ids)}
              seret={canManage ? { sesi: seret.sesi, pegangan: seret.pegangan } : undefined}
              onUpdated={() => void reload()}
              onApplySop={(chainTemplateId, mode, sopName, stepCount) =>
                setTerapkan({
                  supplierId: card.supplierId,
                  supplierName: card.name,
                  chainTemplateId,
                  mode,
                  sopName,
                  stepCount,
                  langkahSekarang: card.steps.length,
                })
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
      <AlertDialog open={lepas !== null} onOpenChange={(buka) => !buka && !sibuk && setLepas(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("lepas.judul", {
                name: lepas?.step.processTemplate.name ?? "",
                supplier: lepas?.supplierName ?? "",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("lepas.isi")}
              {lepasHapusPengaturan ? ` ${t("lepas.isiPengaturan")}` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sibuk}>{t("cancelV2")}</AlertDialogCancel>
            <AlertDialogAction
              variant={lepasHapusPengaturan ? "destructive" : "default"}
              disabled={sibuk}
              onClick={(e) => {
                e.preventDefault();
                if (lepas) lepasLangkah(lepas.step.id);
              }}
            >
              {sibuk ? tc("menyimpan") : lepasHapusPengaturan ? t("lepas.yaHapus") : t("lepas.ya")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={terapkan !== null} onOpenChange={(buka) => !buka && !sibuk && setTerapkan(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {terapkan?.mode === "REPLACE"
                ? t("terapkan.judulGanti", { supplier: terapkan.supplierName })
                : t("terapkan.judulTambah", { supplier: terapkan?.supplierName ?? "", name: terapkan?.sopName ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {terapkan?.mode === "REPLACE"
                ? gantiMenghapus
                  ? t("terapkan.isiGanti", {
                      supplier: terapkan.supplierName,
                      lama: formatAngka(terapkan.langkahSekarang, locale),
                      n: formatAngka(terapkan.stepCount, locale),
                      name: terapkan.sopName,
                    })
                  : t("terapkan.isiGantiKosong", {
                      supplier: terapkan.supplierName,
                      n: formatAngka(terapkan.stepCount, locale),
                      name: terapkan.sopName,
                    })
                : t("terapkan.isiTambah", { n: formatAngka(terapkan?.stepCount ?? 0, locale) })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sibuk}>{t("cancelV2")}</AlertDialogCancel>
            <AlertDialogAction
              variant={gantiMenghapus ? "destructive" : "default"}
              disabled={sibuk}
              onClick={(e) => {
                e.preventDefault();
                if (terapkan) terapkanSop(terapkan);
              }}
            >
              {sibuk ? tc("menyimpan") : terapkan?.mode === "REPLACE" ? t("terapkan.yaGanti") : t("terapkan.yaTambah")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
