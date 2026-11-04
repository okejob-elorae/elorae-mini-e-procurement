"use client";

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { aturProsesBanyakPemasokAction, type SupplierChainCard } from "@/app/actions/lead-time";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { PickerTemplate } from "./process-picker";

/*
 * "Centang pemasok…" (Papan Pemasok): satu proses dari palet, semua pemasok
 * dengan kotak centang — tercentang = sudah punya proses itu. Terapkan
 * memasang proses di akhir rantai pemasok yang baru dicentang dan melepasnya
 * dari yang centangnya dilepas (dikonfirmasi dulu, menyebut namanya).
 *
 * Yang dikirim ke server adalah SELISIH terhadap keadaan yang ditampilkan saat
 * dialog dibuka, jadi perubahan orang lain pada pemasok yang tidak disentuh
 * tidak tertimpa.
 */

type Props = {
  template: PickerTemplate | null;
  cards: SupplierChainCard[];
  onOpenChange: (open: boolean) => void;
  onApplied: () => void;
};

export function CentangPemasokDialog({ template, cards, onOpenChange, onApplied }: Props) {
  return (
    <Dialog open={!!template} onOpenChange={onOpenChange}>
      {template ? (
        <IsiDialog
          key={template.id}
          template={template}
          cards={cards}
          onClose={() => onOpenChange(false)}
          onApplied={onApplied}
        />
      ) : null}
    </Dialog>
  );
}

function IsiDialog({
  template,
  cards,
  onClose,
  onApplied,
}: {
  template: PickerTemplate;
  cards: SupplierChainCard[];
  onClose: () => void;
  onApplied: () => void;
}) {
  const t = useTranslations("leadTime.papan.centang");
  const tServer = useTranslations("leadTime.server");
  // Keadaan awal dipotret saat dialog dibuka; selisih dihitung terhadapnya.
  const [awal] = useState<ReadonlySet<string>>(
    () => new Set(cards.filter((c) => c.steps.some((s) => s.processTemplate.id === template.id)).map((c) => c.supplierId)),
  );
  const [centang, setCentang] = useState<Set<string>>(() => new Set(awal));
  const [cari, setCari] = useState("");
  const [konfirmasi, setKonfirmasi] = useState(false);
  const [sibuk, mulai] = useTransition();

  const tampil = useMemo(() => {
    const q = cari.trim().toLowerCase();
    if (!q) return cards;
    return cards.filter((c) => c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q));
  }, [cards, cari]);

  const tambah = cards.filter((c) => centang.has(c.supplierId) && !awal.has(c.supplierId));
  const lepas = cards.filter((c) => !centang.has(c.supplierId) && awal.has(c.supplierId));
  const adaPerubahan = tambah.length + lepas.length > 0;
  const langkahDilepas = (c: SupplierChainCard) => c.steps.filter((s) => s.processTemplate.id === template.id).length;

  const ubah = (id: string, nyala: boolean) =>
    setCentang((lama) => {
      const baru = new Set(lama);
      if (nyala) baru.add(id);
      else baru.delete(id);
      return baru;
    });
  const ubahSemuaTampil = (nyala: boolean) =>
    setCentang((lama) => {
      const baru = new Set(lama);
      for (const c of tampil) {
        if (nyala) baru.add(c.supplierId);
        else baru.delete(c.supplierId);
      }
      return baru;
    });

  const terapkan = () =>
    mulai(async () => {
      const hasil = await aturProsesBanyakPemasokAction({
        processTemplateId: template.id,
        tambah: tambah.map((c) => c.supplierId),
        lepas: lepas.map((c) => c.supplierId),
      }).catch(() => ({ ok: false as const, code: "GAGAL" as const }));
      if (!hasil.ok) {
        toast.error(tServer.has(`err${hasil.code}`) ? tServer(`err${hasil.code}`) : tServer("errGAGAL"));
        return;
      }
      toast.success(
        hasil.ditambah.length + hasil.dilepas.length === 0
          ? t("tanpaPerubahan")
          : t("berhasil", { tambah: hasil.ditambah.length, lepas: hasil.dilepas.length }),
      );
      setKonfirmasi(false);
      onApplied();
      onClose();
    });

  const semuaTampilTercentang = tampil.length > 0 && tampil.every((c) => centang.has(c.supplierId));

  return (
    <>
      <DialogContent className="flex max-h-[90vh] max-w-lg flex-col">
        <DialogHeader>
          <DialogTitle>{t("judul", { proses: template.name })}</DialogTitle>
          <DialogDescription>{t("keterangan")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" placeholder={t("cari")} value={cari} onChange={(e) => setCari(e.target.value)} />
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={tampil.length === 0}
            onClick={() => ubahSemuaTampil(!semuaTampilTercentang)}
          >
            {semuaTampilTercentang ? t("kosongkan") : t("pilihSemua")}
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto rounded-md border">
          {tampil.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">{t("kosong")}</p>
          ) : (
            <ul className="divide-y">
              {tampil.map((c) => {
                const id = `centang-pemasok-${c.supplierId}`;
                const berubah = centang.has(c.supplierId) !== awal.has(c.supplierId);
                return (
                  <li key={c.supplierId} className={berubah ? "bg-amber-500/10" : undefined}>
                    <label htmlFor={id} className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                      <Checkbox
                        id={id}
                        checked={centang.has(c.supplierId)}
                        onCheckedChange={(v) => ubah(c.supplierId, v === true)}
                        disabled={sibuk}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">{c.code}</span>
                        <span className="text-muted-foreground"> · {c.name}</span>
                      </span>
                      {berubah ? (
                        <span className="shrink-0 text-xs font-medium text-amber-700 dark:text-amber-400">
                          {centang.has(c.supplierId) ? t("akanDipasang") : t("akanDilepas")}
                        </span>
                      ) : null}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <DialogFooter className="items-center gap-2 sm:justify-between">
          <span className="text-sm text-muted-foreground" aria-live="polite">
            {t("ringkasan", { tambah: tambah.length, lepas: lepas.length })}
          </span>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={sibuk}>
              {t("batal")}
            </Button>
            <Button
              type="button"
              disabled={!adaPerubahan || sibuk}
              onClick={() => (lepas.length > 0 ? setKonfirmasi(true) : terapkan())}
            >
              {t("terapkan")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={konfirmasi} onOpenChange={(buka) => !sibuk && setKonfirmasi(buka)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("lepasJudul", { proses: template.name, n: lepas.length })}</AlertDialogTitle>
            <AlertDialogDescription>{t("lepasIsi", { proses: template.name })}</AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="max-h-48 list-disc space-y-0.5 overflow-y-auto pl-5 text-sm">
            {lepas.map((c) => (
              <li key={c.supplierId}>
                {c.code} · {c.name}
                {langkahDilepas(c) > 1 ? (
                  <span className="text-muted-foreground"> ({t("langkahN", { n: langkahDilepas(c) })})</span>
                ) : null}
              </li>
            ))}
          </ul>
          {tambah.length > 0 ? (
            <p className="text-sm text-muted-foreground">{t("jugaDipasang", { n: tambah.length })}</p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sibuk}>{t("batal")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={sibuk}
              onClick={(e) => {
                e.preventDefault();
                terapkan();
              }}
            >
              {t("lepasYa")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
