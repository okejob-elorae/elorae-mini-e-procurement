"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AlasanSimpanWo, CaraIsiWo } from "@/lib/production/rencana-wo";
import type { RencanaBahanWo as KeadaanRencanaBahan } from "./pakai-rencana-bahan";

/** Angka Indonesia ("99,91"), bukan format peramban. */
const fmt = (n: number, maks = 2) => n.toLocaleString("id-ID", { maximumFractionDigits: maks });

/**
 * Isi kartu "Rencana bahan" — SATU komponen untuk formulir perintah kerja baru
 * dan formulir ubah, termasuk pilihan cara isi (ketik jumlah pcs atau hitung
 * dari bahan utama). Keadaannya dari `usePakaiRencanaBahan`.
 */
export function RencanaBahanWo({ r }: { r: KeadaanRencanaBahan }) {
  const tWO = useTranslations("workOrders");
  const tF = useTranslations("workOrders.form");
  const tR = useTranslations("workOrders.formulir");
  const [addRollValue, setAddRollValue] = useState("");

  if (!r.aturanTermuat) {
    return <p className="text-sm text-muted-foreground">{tF("loadingPlan")}</p>;
  }
  if (r.consumptionRules.length === 0) {
    return <p className="text-sm text-muted-foreground">{tWO("defineBomFirst")}</p>;
  }

  const uomBahan = r.consumptionRules.find((x) => x.materialId === r.consumptionMaterialId)?.uomCode ?? "";
  const hasil = r.consumptionResult;
  const satuanHasil = hasil ? ` ${hasil.uomCode}` : "";

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="wo-cara-isi">{tF("caraIsiLabel")}</Label>
        <Select value={r.caraIsi} onValueChange={(v) => r.setCaraIsi(v as CaraIsiWo)}>
          <SelectTrigger id="wo-cara-isi" className="w-full sm:w-[280px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pcs">{tF("caraIsiPcs")}</SelectItem>
            <SelectItem value="bahan">{tF("caraIsiBahan")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>{tWO("materialConsumptionDriver")}</Label>
          <SearchableCombobox
            options={r.consumptionRules.map((x) => ({ value: x.materialId, label: `${x.materialName} (${x.uomCode})` }))}
            value={r.consumptionMaterialId}
            onValueChange={r.pilihBahanUtama}
            placeholder={tR("pilihBahanUtama")}
          />
        </div>
        {r.caraIsi === "pcs" ? (
          <div className="space-y-2">
            <Label htmlFor="wo-jumlah-pcs">{tF("jumlahPcsLabel")}</Label>
            <Input
              id="wo-jumlah-pcs"
              type="number"
              min={1}
              step={1}
              value={r.pcsInput}
              onChange={(e) => r.setPcsInput(e.target.value)}
              placeholder="pcs"
            />
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="wo-jumlah-bahan">{tWO("consumption")}</Label>
            <div className="relative">
              <Input
                id="wo-jumlah-bahan"
                type="number"
                min={0}
                step="any"
                value={r.consumptionInput}
                onChange={(e) => r.setConsumptionInput(e.target.value)}
                placeholder={uomBahan}
                disabled={!r.consumptionMaterialId}
                className={r.isComputingConsumption ? "pr-9" : ""}
              />
              {r.isComputingConsumption && (
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden>
                  <Loader2 className="h-4 w-4 animate-spin" />
                </span>
              )}
            </div>
          </div>
        )}
        {(r.isComputingConsumption || hasil) && (
          <div className="space-y-1 text-sm sm:col-span-2">
            <p className="flex items-center gap-2">
              <span className="font-medium">{tWO("plannedQtyCalculated")}:</span>
              {r.isComputingConsumption ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
                  <span className="text-muted-foreground">{tF("calculating")}</span>
                </>
              ) : (
                <span className="tabular-nums">{fmt(r.plannedNum)} pcs</span>
              )}
            </p>
            {hasil && (
              <>
                <p className="tabular-nums text-muted-foreground">
                  {tWO("actualConsumption")}: {fmt(hasil.actualConsumption, 4)} {hasil.uomCode}
                </p>
                {r.caraIsi === "bahan" && (
                  <p className="tabular-nums text-muted-foreground">
                    {tWO("remainder")}: {fmt(hasil.remainder, 4)} {hasil.uomCode}
                  </p>
                )}
              </>
            )}
          </div>
        )}
        {r.caraIsi === "bahan" && hasil && !r.isComputingConsumption && hasil.plannedQty === 0 && (
          <p className="text-sm text-destructive sm:col-span-2">{tR("bahanKurangSatuPcs")}</p>
        )}
      </div>

      {r.plannedNum > 0 && (
        <>
          {r.isLoadingPlan ? (
            <div className="py-8 text-center text-muted-foreground">{tF("loadingPlan")}</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tWO("material")}</TableHead>
                    <TableHead className="text-right">
                      {tWO("kebutuhanTotalRencana")} {tF("wasteSuffix")}
                    </TableHead>
                    <TableHead className="text-right">{tF("colAvailable")}</TableHead>
                    <TableHead className="text-right">{tF("colShortage")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.materialPlan.map((m) => (
                    <TableRow key={m.itemId} className={m.shortage > 0 ? "bg-destructive/10" : undefined}>
                      <TableCell className="whitespace-normal font-medium">{m.itemName}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmt(m.plannedQty)} {m.uomCode} ({fmt(m.wastePercent)}%)
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmt(m.availableStock)} {m.uomCode}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {m.shortage > 0 ? (
                          <span className="font-medium text-destructive">
                            -{fmt(m.shortage)} {m.uomCode}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {r.hasShortage && <p className="text-sm text-destructive">{tR("stokKurang")}</p>}

          <div className="space-y-2 border-t pt-4">
            <Label>{tR("alokasiRoll")}</Label>
            <p className="text-xs text-muted-foreground">
              {hasil
                ? tR("rollMinimal", { kebutuhan: `${fmt(r.materialPlannedQtyForRolls, 4)}${satuanHasil}` })
                : tF("rollHintNew")}
            </p>
            {r.rollBreakdown.length > 0 && (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{tWO("detail.colRollRef")}</TableHead>
                      <TableHead className="text-right">{tF("colWholeRollQty")}</TableHead>
                      <TableHead>{tWO("notes")}</TableHead>
                      <TableHead className="w-12">
                        <span className="sr-only">{tWO("detail.colActions")}</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {r.rollBreakdown.map((row, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">{row.rollRef}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmt(Number(row.qty))}</TableCell>
                        <TableCell>
                          <Input
                            value={row.notes ?? ""}
                            onChange={(e) => r.ubahCatatanRoll(i, e.target.value)}
                            placeholder={tF("optional")}
                            aria-label={tR("catatanRoll", { ref: row.rollRef })}
                            className="h-8"
                          />
                        </TableCell>
                        <TableCell>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => r.hapusRoll(i)}
                            aria-label={tF("removeRoll", { ref: row.rollRef })}
                            title={tF("removeRoll", { ref: row.rollRef })}
                          >
                            ×
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <SearchableCombobox
                options={r.availableRolls
                  .filter((x) => !r.rollBreakdown.some((b) => b.rollRef === x.rollCode || b.rollRef === x.rollRef))
                  .map((x) => ({
                    value: x.rollId,
                    label: tF("rollRemaining", { code: x.rollCode, qty: fmt(x.remainingLength) }),
                  }))}
                value={addRollValue}
                onValueChange={(value) => {
                  const roll = r.availableRolls.find((x) => x.rollId === value);
                  if (roll) {
                    r.tambahRoll(roll);
                    setAddRollValue("");
                  }
                }}
                placeholder={tF("addRollPlaceholder")}
                emptyMessage={tF("noMoreRolls")}
                triggerClassName="w-[280px]"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void r.sarankanRoll()}
                disabled={!r.consumptionMaterialId || r.isSuggestingRolls}
              >
                {r.isSuggestingRolls ? tF("suggesting") : tF("suggestBestFit")}
              </Button>
            </div>
            {r.rollBreakdown.length > 0 && (
              <p className="text-sm">
                {tF(r.rollValid ? "allocatedOver" : "allocatedShort", {
                  total: `${fmt(r.rollSum)}${satuanHasil}`,
                  diff: fmt(Math.abs(r.rollSum - r.materialPlannedQtyForRolls)),
                })}
              </p>
            )}
            {r.rollBreakdown.length > 0 && !r.rollValid && (
              <p className="text-sm text-destructive">
                {tR("rollKurang", {
                  roll: `${fmt(r.rollSum, 4)}${satuanHasil}`,
                  kebutuhan: hasil ? `${fmt(r.materialPlannedQtyForRolls, 4)}${satuanHasil}` : "—",
                })}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Kenapa tombol simpan perintah kerja masih mati, ditulis tepat di bawah
 * tombolnya (kekurangan pertama menurut urutan isian, `alasanSimpanWo`).
 */
export function KeteranganSimpanWo({ alasan }: { alasan: AlasanSimpanWo | null }) {
  const t = useTranslations("workOrders.formulir.alasan");
  if (!alasan) return null;
  return (
    <p className="text-sm text-muted-foreground" aria-live="polite">
      {t(alasan)}
    </p>
  );
}
