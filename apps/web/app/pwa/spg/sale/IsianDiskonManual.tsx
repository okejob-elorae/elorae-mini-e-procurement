"use client";

import { useTranslations } from "next-intl";
import { Percent, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AturanDiskonManualSpg } from "@/lib/spg/pengaturan";
import type { IsianDiskon } from "./keranjang";

/**
 * Diskon dari SPG untuk satu nota. Hanya dirender kalau kantor menyalakannya
 * (Pengaturan → SPG); batas persennya dihitung dari nilai nota SESUDAH promo,
 * dan alasannya tercatat di nota. Galat mesin promo (melewati batas dst.)
 * tampil tepat di bawah isian angkanya.
 */
export function IsianDiskonManual({
  aturan,
  isian,
  onUbah,
  galat,
  disabled,
}: {
  aturan: AturanDiskonManualSpg;
  isian: IsianDiskon | null;
  onUbah: (isian: IsianDiskon | null) => void;
  /** Teks galat untuk isian angka, atau null. */
  galat: string | null;
  disabled: boolean;
}) {
  const t = useTranslations("pwa.spgJual.diskon");

  if (!isian) {
    return (
      <div className="space-y-1">
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={disabled}
          onClick={() => onUbah({ jenis: "PERSEN", nilai: "", alasan: "" })}
        >
          <Percent className="h-4 w-4" aria-hidden />
          {t("give")}
        </Button>
        <p className="text-center text-xs text-muted-foreground">{t("limit", { max: aturan.maksPersen })}</p>
      </div>
    );
  }

  const ubah = (bagian: Partial<IsianDiskon>) => onUbah({ ...isian, ...bagian });

  return (
    <section className="space-y-3 rounded-lg border p-3" aria-labelledby="spg-diskon-judul">
      <div className="flex items-center justify-between gap-2">
        <h3 id="spg-diskon-judul" className="text-sm font-semibold">
          {t("title")}
        </h3>
        <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => onUbah(null)}>
          <X className="h-4 w-4" aria-hidden />
          {t("remove")}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2" role="group" aria-label={t("kindLabel")}>
        {(["PERSEN", "RUPIAH"] as const).map((jenis) => (
          <Button
            key={jenis}
            type="button"
            variant={isian.jenis === jenis ? "default" : "outline"}
            aria-pressed={isian.jenis === jenis}
            disabled={disabled}
            onClick={() => ubah({ jenis, nilai: "" })}
          >
            {jenis === "PERSEN" ? t("kindPercent") : t("kindRupiah")}
          </Button>
        ))}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="spg-diskon-nilai">{isian.jenis === "PERSEN" ? t("valuePercent") : t("valueRupiah")}</Label>
        <Input
          id="spg-diskon-nilai"
          inputMode={isian.jenis === "PERSEN" ? "decimal" : "numeric"}
          autoComplete="off"
          maxLength={20}
          value={isian.nilai}
          disabled={disabled}
          aria-invalid={galat ? true : undefined}
          aria-describedby="spg-diskon-bantuan"
          onChange={(e) => ubah({ nilai: e.target.value })}
          placeholder={isian.jenis === "PERSEN" ? "5" : "10.000"}
        />
        {galat ? (
          <p id="spg-diskon-bantuan" className="text-xs text-destructive" aria-live="polite">
            {galat}
          </p>
        ) : (
          <p id="spg-diskon-bantuan" className="text-xs text-muted-foreground">
            {t("limit", { max: aturan.maksPersen })}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="spg-diskon-alasan">{aturan.alasanWajib ? t("reasonRequired") : t("reasonOptional")}</Label>
        <Input
          id="spg-diskon-alasan"
          autoComplete="off"
          maxLength={200}
          value={isian.alasan}
          disabled={disabled}
          onChange={(e) => ubah({ alasan: e.target.value })}
          placeholder={t("reasonPlaceholder")}
        />
      </div>
    </section>
  );
}
