"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  aturanHargaSah,
  bacaAngkaOpsional,
  formatPersenSatuDesimal,
  pasanganAturan,
  type AturanHarga,
  type DasarAturanHarga,
} from "@/lib/items/rekomendasi-harga";

export type NilaiMarkupMargin = { dasar: DasarAturanHarga; teks: string };

/**
 * Dua kolom bertaut "Markup (%)" dan "Margin (%)" untuk SATU aturan rekomendasi harga (jawaban
 * pemilik P4, 2026-11-02: "2 cara atau 2 tampilan … 178% (markup) maka margin nya berapa"). Kolom
 * yang terakhir diketik menjadi dasarnya dan menyimpan teks ketikan; kolom lainnya menampilkan
 * hasil konversinya satu desimal (markup 178 → margin 64,0; margin 40 → markup 66,7). Mengetik di
 * kolom hasil memindahkan dasarnya ke kolom itu. Pasangan bawaan (Pengaturan Jubelio) tampil
 * sebagai petunjuk isian bila kosong. Dipakai formulir barang dan Pengaturan Jubelio.
 */
export function IsianMarkupMargin({
  idAwalan,
  nilai,
  onUbah,
  bawaan = null,
  disabled = false,
}: {
  idAwalan: string;
  nilai: NilaiMarkupMargin;
  onUbah: (n: NilaiMarkupMargin) => void;
  bawaan?: AturanHarga | null;
  disabled?: boolean;
}) {
  const t = useTranslations("itemForm");
  const angka = bacaAngkaOpsional(nilai.teks);
  const pasangan =
    angka != null && Number.isFinite(angka) && angka >= 0 ? pasanganAturan({ dasar: nilai.dasar, persen: angka }) : null;
  const pasanganBawaan = aturanHargaSah(bawaan) ? pasanganAturan(bawaan) : null;

  const angkaDari = (p: { markup: number | null; margin: number } | null, dasar: DasarAturanHarga) => {
    if (!p) return null;
    return dasar === "MARKUP" ? p.markup : p.margin;
  };

  const kolom = (dasar: DasarAturanHarga) => {
    const aktif = nilai.dasar === dasar;
    const id = `${idAwalan}-${dasar === "MARKUP" ? "markup" : "margin"}`;
    const hasil = aktif ? null : angkaDari(pasangan, dasar);
    const contoh = angkaDari(pasanganBawaan, dasar);
    return (
      <div className="space-y-1">
        <Label htmlFor={id}>{t(dasar === "MARKUP" ? "markup" : "margin")}</Label>
        <Input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          disabled={disabled}
          value={aktif ? nilai.teks : hasil == null ? "" : formatPersenSatuDesimal(hasil)}
          onFocus={(e) => {
            if (!aktif) e.currentTarget.select();
          }}
          onChange={(e) => onUbah({ dasar, teks: e.target.value })}
          placeholder={contoh != null ? t("placeholderBawaan", { nilai: `${formatPersenSatuDesimal(contoh)}%` }) : ""}
          aria-describedby={!aktif && hasil != null ? `${id}-asal` : undefined}
          className="max-w-[12rem] tabular-nums"
        />
        {!aktif && hasil != null ? (
          <p id={`${id}-asal`} className="text-xs text-muted-foreground">
            {t("dihitungDari", { dasar: nilai.dasar })}
          </p>
        ) : null}
      </div>
    );
  };

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {kolom("MARKUP")}
      {kolom("MARGIN")}
    </div>
  );
}
