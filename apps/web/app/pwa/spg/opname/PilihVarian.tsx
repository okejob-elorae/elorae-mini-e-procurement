"use client";

import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { BarisPilihan } from "../stok/barang-pilihan";

/**
 * Pilih ukuran/varian untuk barang yang dipindai lewat SKU induk atau dipilih
 * dari pencarian. Setiap ketukan = +1 pada varian itu, dan lembarnya TETAP
 * terbuka: satu artikel biasanya dihitung semua ukurannya sekaligus. Hitungan
 * tiap varian terlihat di barisnya, jadi ketukan ganda langsung ketahuan.
 */
export function PilihVarian({
  terbuka,
  varian,
  hitungan,
  onTambah,
  onTutup,
}: {
  terbuka: boolean;
  varian: BarisPilihan[];
  hitungan: Map<string, string>;
  onTambah: (b: BarisPilihan) => void;
  onTutup: () => void;
}) {
  const t = useTranslations("pwa.spgOpname.variant");

  return (
    <Sheet open={terbuka} onOpenChange={(o) => (o ? undefined : onTutup())}>
      <SheetContent side="bottom" className="flex max-h-[85vh] flex-col gap-0 p-0">
        <SheetHeader className="border-b pb-3">
          <SheetTitle>{t("title")}</SheetTitle>
          <SheetDescription>{varian[0]?.nama ?? ""}</SheetDescription>
        </SheetHeader>
        <ul className="min-h-0 flex-1 divide-y overflow-y-auto">
          {varian.map((v) => {
            const n = hitungan.get(v.kunci);
            return (
              <li key={v.kunci}>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => onTambah(v)}
                  aria-label={t("add", { name: v.varian ?? v.kode })}
                  className="h-auto min-h-14 w-full justify-start gap-3 rounded-none px-4 py-2 text-left whitespace-normal"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium leading-tight">{v.varian ?? v.kode}</span>
                    <span className="block truncate text-xs font-normal text-muted-foreground">
                      {v.kode} · {t("system", { qty: v.stok })}
                    </span>
                  </span>
                  {n !== undefined && n !== "" ? (
                    <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold tabular-nums text-primary">
                      {t("counted", { count: n })}
                    </span>
                  ) : null}
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground" aria-hidden>
                    <Plus className="h-4 w-4" />
                  </span>
                </Button>
              </li>
            );
          })}
        </ul>
        <SheetFooter className="border-t pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Button type="button" onClick={onTutup} className="w-full">
            {t("done")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
