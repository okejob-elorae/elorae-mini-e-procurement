"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Camera, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { perkecil } from "@/lib/foto/perkecil";

/** Foto yang dipilih di HP dan BELUM diunggah: berkas yang sudah diperkecil + pratinjau lokal (blob:). */
export type FotoTunda = { berkas: Blob; nama: string; url: string };

/**
 * Pemilih satu foto retur pembeli yang TIDAK mengunggah apa pun: fotonya
 * diperkecil dan disimpan sebagai berkas di memori, lalu diunggah ke R2 saat
 * laporannya dikirim (atau saat antrean HP menyinkron) — kunci R2-nya baru ada
 * dari kunci formulir laporan itu. Pola yang sama dengan bukti terima kiriman.
 */
export function FotoReturTunda({
  id,
  label,
  petunjuk,
  nilai,
  onChange,
  disabled = false,
}: {
  id: string;
  label: string;
  petunjuk?: string;
  nilai: FotoTunda | null;
  onChange: (nilai: FotoTunda | null) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("foto");
  const input = useRef<HTMLInputElement>(null);
  const [memproses, setMemproses] = useState(false);

  // Pratinjau lokal dilepas saat diganti atau layar ditutup.
  useEffect(() => () => {
    if (nilai) URL.revokeObjectURL(nilai.url);
  }, [nilai]);

  const pilih = async (file: File) => {
    setMemproses(true);
    try {
      const kecil = await perkecil(file);
      onChange({ berkas: kecil, nama: file.name.replace(/\.[^.]+$/, "") + ".jpg", url: URL.createObjectURL(kecil) });
    } finally {
      setMemproses(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>
        {label}
        <span className="ml-1 text-destructive">*</span>
      </Label>
      {nilai ? (
        <div className="relative overflow-hidden rounded-lg border">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={nilai.url} alt={label} className="max-h-64 w-full object-contain" />
          <Button
            type="button"
            size="icon"
            variant="secondary"
            className="absolute right-2 top-2"
            aria-label={t("remove")}
            disabled={disabled}
            onClick={() => onChange(null)}
          >
            <X className="h-4 w-4" />
          </Button>
          <p className="border-t px-3 py-2 text-xs text-muted-foreground">{t("akanDiunggah")}</p>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          className="h-auto w-full border-dashed py-6 text-muted-foreground"
          disabled={disabled || memproses}
          onClick={() => input.current?.click()}
        >
          {memproses ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Camera className="h-4 w-4" aria-hidden />}
          {t("pick")}
        </Button>
      )}
      {petunjuk ? <p className="text-xs text-muted-foreground">{petunjuk}</p> : null}
      <input
        id={id}
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void pilih(f);
        }}
      />
    </div>
  );
}
