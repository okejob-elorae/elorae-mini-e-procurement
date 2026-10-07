"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { ModeJadwal } from "./ruang-kerja";

const SEMUA_MODE: ModeJadwal[] = ["MAJU", "MUNDUR"];

/** Susun maju dari tanggal mulai, atau mundur dari tenggat. */
export function PilihMode({ mode, onChange }: { mode: ModeJadwal; onChange: (mode: ModeJadwal) => void }) {
  const t = useTranslations("jadwalProduksi.ruang");
  return (
    <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("susun")}>
      {SEMUA_MODE.map((m) => (
        <Button
          key={m}
          type="button"
          role="radio"
          aria-checked={mode === m}
          variant={mode === m ? "default" : "outline"}
          className="h-auto whitespace-normal py-2"
          onClick={() => onChange(m)}
        >
          {m === "MAJU" ? t("modeMaju") : t("modeMundur")}
        </Button>
      ))}
    </div>
  );
}
