"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowRight, Loader2 } from "lucide-react";
import { pindahkanTokoAction, pratinjauPindahAction } from "./actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { LingkupPindah } from "@/lib/stores/penanggung-jawab";

// Radix Select tidak menerima nilai kosong; tiga penanda ini menggantikannya.
const SEMUA = "__SEMUA__";
const TANPA = "TANPA";
const KOSONGKAN = "__KOSONGKAN__";

type Area = { id: string; code: string; name: string; isActive: boolean };
type Sales = { id: string; nama: string };

/**
 * Rotasi massal: pindahkan toko satu area, atau semua toko seorang sales, ke
 * sales lain. Jumlah toko yang AKAN berpindah dihitung server dan ditampilkan
 * sebelum tombolnya bisa ditekan.
 */
export function PindahTokoDialog({
  open,
  onOpenChange,
  areas,
  salesmen,
  awalArea,
  awalDari,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  areas: Area[];
  salesmen: Sales[];
  awalArea?: string;
  awalDari?: string;
}) {
  const t = useTranslations("stores.move");
  const router = useRouter();
  const [area, setArea] = useState(awalArea || SEMUA);
  const [dari, setDari] = useState(awalDari || SEMUA);
  const [ke, setKe] = useState("");
  const [pratinjau, setPratinjau] = useState<{ dalamLingkup: number; akanPindah: number } | null>(null);
  const [sibuk, mulai] = useTransition();

  const lingkup: LingkupPindah = {
    ...(area !== SEMUA ? { groupId: area } : {}),
    ...(dari !== SEMUA ? { dari } : {}),
  };
  const lingkupAda = area !== SEMUA || dari !== SEMUA;
  const keSalesmanId = ke === KOSONGKAN ? null : ke;

  // Pratinjau dihitung ulang setiap pilihan berubah. Hasil lama dibuang dulu
  // supaya tombol tidak pernah menampilkan angka milik pilihan sebelumnya.
  useEffect(() => {
    if (!open || !lingkupAda || !ke) return;
    let batal = false;
    void pratinjauPindahAction({ lingkup, keSalesmanId }).then((r) => {
      if (!batal) setPratinjau(r.ok && r.data ? r.data : null);
    });
    return () => {
      batal = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `lingkup` dirakit ulang tiap render dari area/dari.
  }, [open, area, dari, ke]);

  const gantiPilihan = (setter: (v: string) => void) => (v: string) => {
    setPratinjau(null);
    setter(v);
  };

  const pindahkan = () =>
    mulai(async () => {
      const r = await pindahkanTokoAction({ lingkup, keSalesmanId });
      if (!r.ok) {
        toast.error(t("err"));
        return;
      }
      toast.success(t("done", { count: r.data?.jumlah ?? 0 }));
      onOpenChange(false);
      router.refresh();
    });

  const namaKe = ke === KOSONGKAN ? t("toNobody") : salesmen.find((s) => s.id === ke)?.nama ?? "";

  return (
    <Dialog open={open} onOpenChange={(o) => !sibuk && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("desc")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="pindah-area">{t("area")}</Label>
              <Select value={area} onValueChange={gantiPilihan(setArea)}>
                <SelectTrigger id="pindah-area" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SEMUA}>{t("anyArea")}</SelectItem>
                  {areas.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.code} — {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pindah-dari">{t("from")}</Label>
              <Select value={dari} onValueChange={gantiPilihan(setDari)}>
                <SelectTrigger id="pindah-dari" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SEMUA}>{t("anyHolder")}</SelectItem>
                  <SelectItem value={TANPA}>{t("noHolder")}</SelectItem>
                  {salesmen.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.nama}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="pindah-ke">{t("to")}</Label>
            <Select value={ke} onValueChange={gantiPilihan(setKe)}>
              <SelectTrigger id="pindah-ke" className="w-full">
                <SelectValue placeholder={t("toPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {salesmen.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.nama}
                  </SelectItem>
                ))}
                <SelectItem value={KOSONGKAN}>{t("toNobody")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <p className="min-h-5 text-sm text-muted-foreground" aria-live="polite">
            {!lingkupAda
              ? t("needScope")
              : !ke
                ? t("needTarget")
                : pratinjau === null
                  ? t("counting")
                  : pratinjau.dalamLingkup === 0
                    ? t("previewNone")
                    : t("preview", { total: pratinjau.dalamLingkup, move: pratinjau.akanPindah, name: namaKe })}
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={sibuk}>
            {t("cancel")}
          </Button>
          <Button onClick={pindahkan} disabled={sibuk || !pratinjau || pratinjau.akanPindah === 0}>
            {sibuk ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            {t("submit", { count: pratinjau?.akanPindah ?? 0 })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
