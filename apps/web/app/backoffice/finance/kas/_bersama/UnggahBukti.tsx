"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ImageUp, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { unggahFoto } from "@/lib/foto/unggah";

/**
 * Bukti transfer/kuitansi (opsional) untuk voucher kas dan pembayaran pemasok.
 * Foto disimpan di basis data lewat `/api/foto` — sama dengan foto bukti
 * modul lain; nilainya `/api/foto/<id>` dan terdaftar di `KOLOM_FOTO`.
 */
export function UnggahBukti({ value, onChange, disabled }: { value: string | null; onChange: (url: string | null) => void; disabled?: boolean }) {
  const t = useTranslations("financeKas.bukti");
  const masukan = useRef<HTMLInputElement>(null);
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);

  const pilih = async (file: File | undefined) => {
    if (!file) return;
    setSibuk(true);
    setGalat(null);
    try {
      onChange(await unggahFoto(file));
    } catch {
      setGalat(t("gagal"));
    } finally {
      setSibuk(false);
      if (masukan.current) masukan.current.value = "";
    }
  };

  return (
    <div className="space-y-2">
      <input ref={masukan} type="file" accept="image/*" className="hidden" onChange={(e) => void pilih(e.target.files?.[0])} />
      {value ? (
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- foto dari /api/foto, ukuran kecil */}
          <img src={value} alt={t("alt")} className="h-16 w-16 rounded-md border object-cover" />
          <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => onChange(null)}>
            <X className="mr-1 h-4 w-4" />
            {t("hapus")}
          </Button>
        </div>
      ) : (
        <Button type="button" variant="outline" size="sm" disabled={disabled || sibuk} onClick={() => masukan.current?.click()}>
          {sibuk ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImageUp className="mr-2 h-4 w-4" />}
          {t("unggah")}
        </Button>
      )}
      {galat && <p className="text-xs text-destructive">{galat}</p>}
    </div>
  );
}
