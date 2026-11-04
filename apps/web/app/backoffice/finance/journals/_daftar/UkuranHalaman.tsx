"use client";

import { useTranslations } from "next-intl";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PILIHAN_UKURAN_HALAMAN } from "./ukuran-halaman";

/** Pilihan baris per halaman (`?per=`) untuk daftar Jurnal dan buku besar. */
export function UkuranHalaman({ nilai, onUbah }: { nilai: number; onUbah: (n: number) => void }) {
  const t = useTranslations("financeJournals.daftar");
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <span id="label-per-halaman">{t("barisPerHalaman")}</span>
      <Select value={String(nilai)} onValueChange={(v) => onUbah(Number(v))}>
        <SelectTrigger className="h-8 w-20" aria-labelledby="label-per-halaman">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PILIHAN_UKURAN_HALAMAN.map((n) => (
            <SelectItem key={n} value={String(n)}>
              {n}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
