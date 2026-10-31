"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MAKS_BARIS_WARNA, hitungWarna } from "@/lib/purchase-orders/rincian-warna";
import { InputAngka } from "./InputAngka";

/**
 * "Hitung warna" untuk satu baris bahan: total ÷ minimum per warna → N baris
 * bahan yang sama dengan qty rata (baris terakhir menyerap sisa pembulatan).
 * Warnanya dipilih sesudahnya di kolom Varian.
 */
export function HitungWarnaPopover({
  namaBahan,
  satuan,
  qtyAwal,
  onBuat,
}: {
  namaBahan: string;
  satuan: string;
  qtyAwal: number;
  onBuat: (baris: number[]) => void;
}) {
  const t = useTranslations("purchaseOrders.rincian");
  const locale = useLocale();
  const [buka, setBuka] = useState(false);
  const [total, setTotal] = useState(0);
  const [min, setMin] = useState(0);
  const hasil = hitungWarna(total, min);
  const angka = (n: number) =>
    new Intl.NumberFormat(locale.startsWith("en") ? "en-GB" : "id-ID", { maximumFractionDigits: 2 }).format(n);

  return (
    <Popover
      open={buka}
      onOpenChange={(b) => {
        setBuka(b);
        if (b) setTotal(qtyAwal);
      }}
    >
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label={t("hitungWarna")} title={t("hitungWarna")}>
          <Palette className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <p className="text-sm font-medium">{t("hitungWarnaJudul", { bahan: namaBahan })}</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="hw-total">{t("total", { satuan })}</Label>
            <InputAngka id="hw-total" nilai={total} onUbah={setTotal} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="hw-min">{t("minPerWarna")}</Label>
            <InputAngka id="hw-min" nilai={min} onUbah={setMin} />
          </div>
        </div>
        <p className="text-sm tabular-nums text-muted-foreground" aria-live="polite">
          {hasil.ok
            ? t("pratinjau", { n: hasil.jumlah, per: angka(hasil.per), total: angka(total), satuan })
            : hasil.sebab === "TERLALU_BANYAK"
              ? t("terlaluBanyak", { maks: MAKS_BARIS_WARNA })
              : t("isianTidakSah")}
        </p>
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            disabled={!hasil.ok}
            onClick={() => {
              if (!hasil.ok) return;
              onBuat(hasil.baris);
              setBuka(false);
            }}
          >
            {hasil.ok ? t("buatBaris", { n: hasil.jumlah }) : t("hitungWarna")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
