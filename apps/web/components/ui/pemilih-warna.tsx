"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { normalHex, PALET_PILIHAN } from "@/lib/tampilan/warna-pilihan";
import { cn } from "@/lib/utils";

/**
 * Satu kotak warna yang bisa diklik: pilihan cepat (24 warna), kode hex, atau "Otomatis".
 * `nilai` = warna pilihan ("#rrggbb") atau null (= otomatis); `bawaan` = nilai CSS yang tampil
 * saat otomatis (mis. "var(--viz-tema-kuat)"), supaya kotaknya selalu menunjukkan warna yang
 * sungguh dipakai.
 */
export function PemilihWarna({
  nilai,
  bawaan,
  label,
  onPilih,
  disabled,
  labelOtomatis,
}: {
  nilai: string | null;
  bawaan: string;
  /** Nama yang dibacakan pembaca layar, mis. "1–30 hari". */
  label: string;
  onPilih: (hex: string | null) => void;
  disabled?: boolean;
  /** Teks tombol otomatis; bawaan "Otomatis". */
  labelOtomatis?: string;
}) {
  const t = useTranslations("warnaPilihan");
  const [buka, setBuka] = useState(false);
  const [ketik, setKetik] = useState("");
  const [galat, setGalat] = useState(false);

  const pakaiKetikan = () => {
    const hex = normalHex(ketik);
    if (!hex) {
      setGalat(ketik.trim() !== "");
      return;
    }
    onPilih(hex);
    setBuka(false);
  };

  return (
    <Popover
      open={buka}
      onOpenChange={(o) => {
        setBuka(o);
        if (o) {
          setKetik(nilai ?? "");
          setGalat(false);
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={t("pilihWarna", { label })}
          className="inline-flex items-center gap-2 rounded-md border px-2 py-1 text-xs transition-colors hover:bg-muted/60 disabled:opacity-50"
        >
          <span className="h-5 w-8 rounded-sm border" style={{ background: nilai ?? bawaan }} aria-hidden />
          <span className="font-mono text-muted-foreground">{nilai ?? labelOtomatis ?? t("otomatis")}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-3" align="start">
        <div className="grid grid-cols-6 gap-1.5">
          {PALET_PILIHAN.map((hex) => {
            const aktif = nilai === hex;
            return (
              <button
                key={hex}
                type="button"
                aria-label={hex}
                aria-pressed={aktif}
                onClick={() => {
                  onPilih(hex);
                  setBuka(false);
                }}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-md border transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  aktif && "ring-2 ring-foreground ring-offset-1 ring-offset-background",
                )}
                style={{ background: hex }}
              >
                {aktif ? <Check className="h-4 w-4 text-white mix-blend-difference" aria-hidden /> : null}
              </button>
            );
          })}
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground" htmlFor={`hex-${label}`}>
            {t("kodeHex")}
          </label>
          <div className="flex gap-2">
            <Input
              id={`hex-${label}`}
              value={ketik}
              placeholder="#2563eb"
              maxLength={7}
              className="h-8 font-mono text-sm"
              aria-invalid={galat}
              onChange={(e) => {
                setKetik(e.target.value);
                setGalat(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  pakaiKetikan();
                }
              }}
            />
            <Button type="button" size="sm" variant="outline" className="h-8" onClick={pakaiKetikan}>
              {t("pakai")}
            </Button>
          </div>
          {galat ? <p className="text-xs text-destructive">{t("hexTidakSah")}</p> : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={() => {
            onPilih(null);
            setBuka(false);
          }}
        >
          <span className="h-4 w-6 rounded-sm border" style={{ background: bawaan }} aria-hidden />
          {labelOtomatis ?? t("otomatis")}
          {nilai === null ? <Check className="ml-auto h-4 w-4" aria-hidden /> : null}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
