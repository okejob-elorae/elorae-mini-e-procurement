"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Pencil, Plus } from "lucide-react";
import { simpanAreaAction } from "./actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { AreaToko } from "@/lib/stores/areas";

type Draf = { id: string | null; code: string; name: string; isActive: boolean };
const KOSONG: Draf = { id: null, code: "", name: "", isActive: true };

/**
 * Master area toko (JGU, JTT, …): tambah, ubah nama, nonaktifkan.
 *
 * Area tidak pernah dihapus — toko lama dan jejak rotasinya menunjuk ke sana.
 * Area nonaktif hilang dari pilihan formulir, tapi toko yang sudah memakainya
 * tetap menampilkannya.
 */
export function KelolaAreaDialog({
  open,
  onOpenChange,
  areas,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  areas: AreaToko[];
}) {
  const t = useTranslations("stores.areas");
  const router = useRouter();
  const [draf, setDraf] = useState<Draf>(KOSONG);
  const [sibuk, mulai] = useTransition();

  const simpan = () =>
    mulai(async () => {
      const r = await simpanAreaAction(draf);
      if (!r.ok) {
        toast.error(r.code === "code_unique" ? t("errCodeUnique") : t("errInvalid"));
        return;
      }
      toast.success(draf.id ? t("updated") : t("created"));
      setDraf(KOSONG);
      router.refresh();
    });

  const bisaSimpan = !sibuk && draf.code.trim() !== "" && draf.name.trim() !== "";

  return (
    <Dialog open={open} onOpenChange={(o) => !sibuk && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("desc")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 rounded-lg border p-3">
          <p className="text-sm font-medium">{draf.id ? t("editHeading") : t("newHeading")}</p>
          <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
            <div className="space-y-1.5">
              <Label htmlFor="area-kode">{t("code")}</Label>
              <Input
                id="area-kode"
                value={draf.code}
                maxLength={32}
                placeholder="JGU"
                className="uppercase"
                onChange={(e) => setDraf((d) => ({ ...d, code: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="area-nama">{t("name")}</Label>
              <Input
                id="area-nama"
                value={draf.name}
                maxLength={191}
                placeholder={t("namePlaceholder")}
                onChange={(e) => setDraf((d) => ({ ...d, name: e.target.value }))}
              />
            </div>
          </div>
          {draf.id ? (
            <div className="flex items-center gap-2">
              <Switch
                id="area-aktif"
                checked={draf.isActive}
                onCheckedChange={(v) => setDraf((d) => ({ ...d, isActive: v }))}
              />
              <Label htmlFor="area-aktif" className="font-normal">
                {t("active")}
              </Label>
            </div>
          ) : null}
          <div className="flex gap-2">
            <Button onClick={simpan} disabled={!bisaSimpan}>
              {sibuk ? <Loader2 className="h-4 w-4 animate-spin" /> : draf.id ? null : <Plus className="h-4 w-4" />}
              {draf.id ? t("save") : t("add")}
            </Button>
            {draf.id ? (
              <Button variant="ghost" onClick={() => setDraf(KOSONG)} disabled={sibuk}>
                {t("cancelEdit")}
              </Button>
            ) : null}
          </div>
        </div>

        {areas.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="max-h-72 divide-y overflow-y-auto rounded-md border">
            {areas.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-3 py-2">
                <span className="w-14 shrink-0 font-mono text-sm font-semibold">{a.code}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{a.name}</span>
                  <span className="block text-xs text-muted-foreground">{t("storeCount", { count: a.jumlahToko })}</span>
                </span>
                {!a.isActive ? <Badge variant="outline">{t("inactive")}</Badge> : null}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("editAria", { code: a.code })}
                  onClick={() => setDraf({ id: a.id, code: a.code, name: a.name, isActive: a.isActive })}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
