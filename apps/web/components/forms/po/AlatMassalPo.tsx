"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Split } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { InputAngka } from "./InputAngka";

/**
 * Isi massal di formulir PO: qty semua baris, harga semua baris, dan — untuk
 * PO tahap — bagi rata kebutuhan ke baris bahan yang sudah ada.
 */
export function AlatMassalPo({
  onQtySemua,
  onHargaSemua,
  onBagiRata,
}: {
  onQtySemua: (qty: number) => void;
  onHargaSemua: (harga: number) => void;
  onBagiRata?: () => void;
}) {
  const t = useTranslations("purchaseOrders.rincian");
  const [qty, setQty] = useState(0);
  const [harga, setHarga] = useState(0);

  return (
    <div className="flex flex-wrap items-end gap-x-6 gap-y-3 rounded-md border border-dashed p-3">
      <div className="space-y-1">
        <Label htmlFor="massal-qty">{t("isiQtySemua")}</Label>
        <div className="flex gap-2">
          <InputAngka id="massal-qty" nilai={qty} onUbah={setQty} className="w-28" />
          <Button type="button" variant="outline" size="sm" className="h-9" disabled={!(qty > 0)} onClick={() => onQtySemua(qty)}>
            {t("terapkan")}
          </Button>
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="massal-harga">{t("isiHargaSemua")}</Label>
        <div className="flex gap-2">
          <InputAngka id="massal-harga" nilai={harga} onUbah={setHarga} className="w-32" />
          <Button type="button" variant="outline" size="sm" className="h-9" disabled={!(harga >= 0)} onClick={() => onHargaSemua(harga)}>
            {t("terapkan")}
          </Button>
        </div>
      </div>
      {onBagiRata ? (
        <Button type="button" variant="outline" size="sm" className="h-9" onClick={onBagiRata}>
          <Split className="mr-2 h-4 w-4" />
          {t("bagiRata")}
        </Button>
      ) : null}
    </div>
  );
}
