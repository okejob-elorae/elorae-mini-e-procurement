"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  computePlannedQtyFromConsumption,
  getAvailableFabricRolls,
  getMaterialPlan,
  suggestFabricRollAllocation,
} from "@/app/actions/production";
import { getConsumptionRules } from "@/app/actions/items";
import { caraIsiAwalWo, type CaraIsiWo } from "@/lib/production/rencana-wo";

export interface ConsumptionRuleOption {
  materialId: string;
  materialName: string;
  uomCode: string;
}

export interface ConsumptionResult {
  plannedQty: number;
  remainder: number;
  actualConsumption: number;
  uomCode: string;
}

export interface MaterialPlanRow {
  itemId: string;
  itemName: string;
  uomCode: string;
  qtyRequired: number;
  wastePercent: number;
  plannedQty: number;
  availableStock: number;
  shortage: number;
}

export type RollPick = { rollRef: string; qty: number; notes?: string };
export type RollTersedia = { rollId: string; rollCode: string; rollRef: string; remainingLength: number };

/** Isian awal formulir ubah: angka WO draf yang sudah tersimpan. */
export type AwalRencanaBahan = {
  finishedGoodId: string;
  consumptionMaterialId: string | null;
  expectedConsumption: number | null;
  plannedQty: number;
};

const DEBOUNCE_MS = 1500;

/**
 * Keadaan kartu "Rencana bahan" untuk formulir perintah kerja BARU dan UBAH.
 *
 * Dulu kedua formulir menyalin logika ini masing-masing dan formulir ubah
 * tidak punya pilihan "ketik jumlah pcs". `awal` (formulir ubah) diterapkan
 * sekali, sesudah aturan konsumsi barang jadinya termuat; cara isinya ditebak
 * dari angka tersimpan (`caraIsiAwalWo`) supaya menyimpan ulang tanpa
 * perubahan tidak menggeser angkanya.
 */
export function usePakaiRencanaBahan(finishedGoodId: string, awal: AwalRencanaBahan | null) {
  const t = useTranslations("toasts");
  const tF = useTranslations("workOrders.form");

  // Setiap hasil muat disimpan bersama kuncinya (barang jadi, bahan, jumlah) lalu
  // dibaca hanya bila kuncinya masih berlaku: tidak ada setState sinkron di efek,
  // dan jawaban server yang terlambat untuk pilihan lama tidak pernah tampil.
  const [aturan, setAturan] = useState<{ fg: string; rules: ConsumptionRuleOption[] } | null>(null);
  const [bahan, setBahan] = useState<{ fg: string; id: string }>({ fg: "", id: "" });
  const [caraIsi, setCaraIsi] = useState<CaraIsiWo>("pcs");
  const [pcsInput, setPcsInput] = useState("");
  const [consumptionInput, setConsumptionInputState] = useState("");
  const [consumptionInputDebounced, setConsumptionInputDebounced] = useState("");
  const [hitung, setHitung] = useState<{ kunci: string; hasil: ConsumptionResult | null } | null>(null);
  const [rencana, setRencana] = useState<{ kunci: string; baris: MaterialPlanRow[] } | null>(null);
  const [rollMuat, setRollMuat] = useState<{ bahan: string; rolls: RollTersedia[] } | null>(null);
  const [rollBreakdown, setRollBreakdown] = useState<RollPick[]>([]);
  const [isSuggestingRolls, setIsSuggestingRolls] = useState(false);
  const [awalDipakai, setAwalDipakai] = useState(false);
  const caraDitebak = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Aturan konsumsi (BOM) barang jadi.
  useEffect(() => {
    if (!finishedGoodId) return;
    let batal = false;
    getConsumptionRules(finishedGoodId)
      .then((rules) => {
        if (batal) return;
        setAturan({
          fg: finishedGoodId,
          rules: rules.map((r: { materialId: string; material: { nameId: string; uom: { code: string } } }) => ({
            materialId: r.materialId,
            materialName: r.material.nameId,
            uomCode: r.material.uom.code,
          })),
        });
      })
      .catch(() => {
        if (batal) return;
        setAturan({ fg: finishedGoodId, rules: [] });
        toast.error(t("failedToLoadData"));
      });
    return () => {
      batal = true;
    };
  }, [finishedGoodId, t]);

  const aturanTermuat = finishedGoodId !== "" && aturan?.fg === finishedGoodId;
  const consumptionRules = aturanTermuat && aturan ? aturan.rules : [];
  // Bahan utama ikut barang jadinya: berganti barang jadi = belum ada bahan terpilih.
  const consumptionMaterialId = bahan.fg === finishedGoodId ? bahan.id : "";

  // Formulir ubah: pasang angka WO tersimpan sekali, begitu aturan barang jadinya termuat
  // (penyesuaian keadaan saat render, pola React untuk "reset saat props berubah").
  if (awal && !awalDipakai && aturanTermuat && finishedGoodId === awal.finishedGoodId) {
    setAwalDipakai(true);
    setPcsInput(awal.plannedQty > 0 ? String(awal.plannedQty) : "");
    if (awal.expectedConsumption != null) {
      setConsumptionInputState(String(awal.expectedConsumption));
      setConsumptionInputDebounced(String(awal.expectedConsumption));
    }
    const mat = awal.consumptionMaterialId ?? "";
    if (mat && consumptionRules.some((r) => r.materialId === mat)) setBahan({ fg: finishedGoodId, id: mat });
  }

  // Cara isi WO tersimpan ditebak dari angkanya (`caraIsiAwalWo`), sekali.
  useEffect(() => {
    if (!awal || !awalDipakai || caraDitebak.current) return;
    caraDitebak.current = true;
    const mat = awal.consumptionMaterialId ?? "";
    if (!mat || awal.expectedConsumption == null) return;
    computePlannedQtyFromConsumption(awal.finishedGoodId, mat, 1)
      .then((res) =>
        setCaraIsi(
          caraIsiAwalWo({
            plannedQty: awal.plannedQty,
            expectedConsumption: awal.expectedConsumption,
            konsumsiPerPcs: res.consumptionPerPiece,
          }),
        ),
      )
      .catch(() => setCaraIsi("bahan"));
  }, [awal, awalDipakai]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setConsumptionInputDebounced(consumptionInput);
      debounceRef.current = null;
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [consumptionInput]);

  const pcsDiketik = Math.floor(Number(pcsInput));
  const modePcs = caraIsi === "pcs";
  const jumlahDihitung = modePcs ? 1 : Number(consumptionInputDebounced);
  const kunciHitung =
    finishedGoodId &&
    consumptionMaterialId &&
    (modePcs ? pcsDiketik > 0 : consumptionInputDebounced !== "" && Number.isFinite(jumlahDihitung) && jumlahDihitung > 0)
      ? `${finishedGoodId}|${consumptionMaterialId}|${caraIsi}|${modePcs ? pcsDiketik : consumptionInputDebounced}`
      : null;

  useEffect(() => {
    if (!kunciHitung) return;
    let cancelled = false;
    computePlannedQtyFromConsumption(finishedGoodId, consumptionMaterialId, jumlahDihitung)
      .then((res) => {
        if (cancelled) return;
        // Mode pcs: jumlah pcs dari isian, kebutuhan bahan = pcs × konsumsi per pcs.
        setHitung({
          kunci: kunciHitung,
          hasil: modePcs
            ? {
                plannedQty: pcsDiketik,
                remainder: 0,
                actualConsumption: Math.round(pcsDiketik * res.consumptionPerPiece * 10000) / 10000,
                uomCode: res.uomCode,
              }
            : res,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setHitung({ kunci: kunciHitung, hasil: null });
        toast.error(t("failedToLoadMaterialPlan"));
      });
    return () => {
      cancelled = true;
    };
  }, [kunciHitung, finishedGoodId, consumptionMaterialId, jumlahDihitung, modePcs, pcsDiketik, t]);

  const consumptionResult = kunciHitung && hitung?.kunci === kunciHitung ? hitung.hasil : null;
  const isComputingConsumption = kunciHitung != null && hitung?.kunci !== kunciHitung;
  const plannedNum = consumptionResult?.plannedQty ?? 0;

  const kunciRencana = finishedGoodId && plannedNum > 0 ? `${finishedGoodId}|${plannedNum}` : null;
  useEffect(() => {
    if (!kunciRencana) return;
    let cancelled = false;
    getMaterialPlan(finishedGoodId, plannedNum)
      .then((plan) => {
        if (!cancelled) setRencana({ kunci: kunciRencana, baris: plan });
      })
      .catch(() => {
        if (cancelled) return;
        setRencana({ kunci: kunciRencana, baris: [] });
        toast.error(t("failedToLoadMaterialPlan"));
      });
    return () => {
      cancelled = true;
    };
  }, [kunciRencana, finishedGoodId, plannedNum, t]);
  const materialPlan = kunciRencana && rencana?.kunci === kunciRencana ? rencana.baris : [];
  const isLoadingPlan = kunciRencana != null && rencana?.kunci !== kunciRencana;

  useEffect(() => {
    if (!consumptionMaterialId) return;
    let cancelled = false;
    getAvailableFabricRolls(consumptionMaterialId)
      .then((rolls) => {
        if (!cancelled) setRollMuat({ bahan: consumptionMaterialId, rolls });
      })
      .catch(() => {
        if (!cancelled) setRollMuat({ bahan: consumptionMaterialId, rolls: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [consumptionMaterialId]);
  const availableRolls = consumptionMaterialId && rollMuat?.bahan === consumptionMaterialId ? rollMuat.rolls : [];

  const hasShortage = materialPlan.some((m) => m.shortage > 0);
  const rollSum = rollBreakdown.reduce((s, r) => s + r.qty, 0);
  /** Jumlah bahan (satuan konsumsi); total roll minimal sebesar ini (boleh lebih). */
  const materialPlannedQtyForRolls = consumptionResult?.actualConsumption ?? 0;
  const rollValid = rollBreakdown.length === 0 || rollSum >= materialPlannedQtyForRolls - 1e-6;

  /** Kebutuhan bahan yang disimpan di WO: pcs × konsumsi (mode pcs) atau jumlah bahan yang diketik. */
  const expectedConsumptionUntukSimpan =
    caraIsi === "pcs"
      ? consumptionResult?.actualConsumption || undefined
      : consumptionInput.trim()
        ? Number(consumptionInput)
        : undefined;

  const pilihBahanUtama = (v: string) => {
    setBahan({ fg: finishedGoodId, id: v });
    setConsumptionInputState("");
    setConsumptionInputDebounced("");
  };

  const tambahRoll = (roll: RollTersedia) => {
    setRollBreakdown((prev) => [...prev, { rollRef: roll.rollCode || roll.rollRef, qty: roll.remainingLength, notes: "" }]);
  };
  const ubahCatatanRoll = (i: number, notes: string) => {
    setRollBreakdown((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], notes };
      return next;
    });
  };
  const hapusRoll = (i: number) => {
    setRollBreakdown((prev) => prev.filter((_, idx) => idx !== i));
  };

  const sarankanRoll = async () => {
    if (!consumptionMaterialId || !consumptionResult?.actualConsumption) return;
    setIsSuggestingRolls(true);
    try {
      const suggestion = await suggestFabricRollAllocation(consumptionMaterialId, consumptionResult.actualConsumption);
      if (suggestion.selected.length === 0) {
        toast.error(tF("noRollsFound"));
        return;
      }
      setRollBreakdown(suggestion.selected.map((row) => ({ rollRef: row.rollCode ?? row.rollRef, qty: row.qty })));
      if (suggestion.unallocated > 0) {
        toast.error(tF("insufficientRolls", { qty: suggestion.unallocated.toLocaleString("id-ID", { maximumFractionDigits: 2 }) }));
      } else {
        toast.success(tF("suggestionApplied"));
      }
    } catch {
      toast.error(tF("suggestFailed"));
    } finally {
      setIsSuggestingRolls(false);
    }
  };

  return {
    consumptionRules,
    /** Aturan konsumsi barang jadi ini sudah selesai dimuat (kosong pun). */
    aturanTermuat,
    consumptionMaterialId,
    pilihBahanUtama,
    caraIsi,
    setCaraIsi,
    pcsInput,
    setPcsInput,
    pcsDiketik,
    consumptionInput,
    setConsumptionInput: setConsumptionInputState,
    consumptionResult,
    isComputingConsumption,
    plannedNum,
    materialPlan,
    isLoadingPlan,
    hasShortage,
    rollBreakdown,
    setRollBreakdown,
    availableRolls,
    tambahRoll,
    ubahCatatanRoll,
    hapusRoll,
    rollSum,
    materialPlannedQtyForRolls,
    rollValid,
    isSuggestingRolls,
    sarankanRoll,
    expectedConsumptionUntukSimpan,
  };
}

export type RencanaBahanWo = ReturnType<typeof usePakaiRencanaBahan>;
