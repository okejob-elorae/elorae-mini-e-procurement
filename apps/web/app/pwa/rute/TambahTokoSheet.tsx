"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { titikSah } from "@/lib/salesman/rute";
import type { TokoRute } from "@/lib/salesman/rute-queries";

/**
 * Pilih toko untuk ditambahkan ke rute — hanya dari "toko saya" yang belum ada
 * di rute. Lembar tetap terbuka setelah menambah, supaya beberapa toko bisa
 * ditambahkan sekaligus.
 */
export function TambahTokoSheet({
  open,
  onOpenChange,
  calon,
  onTambah,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  calon: TokoRute[];
  onTambah: (id: string) => void;
}) {
  const t = useTranslations("pwa.rute");
  const [q, setQ] = useState("");

  const tersaring = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return calon;
    return calon.filter((c) => c.nama.toLowerCase().includes(n) || (c.alamat ?? "").toLowerCase().includes(n));
  }, [calon, q]);

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) setQ("");
        onOpenChange(next);
      }}
    >
      <SheetContent side="bottom" className="flex max-h-[85vh] flex-col gap-0 p-0">
        <SheetHeader className="border-b pb-3">
          <SheetTitle>{t("sheetTitle")}</SheetTitle>
          <SheetDescription>{t("sheetDescription")}</SheetDescription>
        </SheetHeader>

        {calon.length > 0 ? (
          <div className="px-4 pt-3">
            <Input placeholder={t("sheetSearch")} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        ) : null}

        <div className="flex-1 overflow-y-auto p-4">
          {calon.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("sheetEmpty")}</p>
          ) : tersaring.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("sheetNoMatch")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {tersaring.map((c) => (
                <li key={c.id} className="flex items-center gap-3 rounded-lg border p-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{c.nama}</p>
                    {c.alamat ? <p className="truncate text-xs text-muted-foreground">{c.alamat}</p> : null}
                    {c.alasan || !titikSah(c.lat, c.lng) ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {c.alasan ? <Badge variant="secondary">{t("sheetInPlan")}</Badge> : null}
                        {!titikSah(c.lat, c.lng) ? <Badge variant="outline">{t("sheetNoLocation")}</Badge> : null}
                      </div>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => onTambah(c.id)}
                    aria-label={t("sheetAddAria", { name: c.nama })}
                  >
                    <Plus className="h-4 w-4" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <SheetFooter className="border-t pt-3">
          <Button type="button" className="w-full" onClick={() => onOpenChange(false)}>
            {t("sheetDone")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
