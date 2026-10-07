"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TanggalInput } from "@/components/ui/tanggal-input";
import { catatAngkaAction } from "@/app/actions/kreatif-konten";
import { bacaBilanganBulat } from "@/lib/creative/angka-masuk";
import { angkaTitik, type AngkaKonten } from "@/lib/creative/angka-konten";
import { KOLOM_ANGKA, type KolomAngka } from "@/lib/creative/konten-kol";
import { hariIniWib } from "@/lib/tanggal-isian";
import { useKabarKonten } from "./kabar-konten";

const KOSONG: Record<KolomAngka, string> = { views: "", likes: "", comments: "", shares: "", saves: "" };

/**
 * Catat angka dengan tanggal, sumber, dan catatan (mis. angka H+7 yang baru
 * sempat diisi hari ini). Tetap baris baru; kotak kosong memakai angka
 * terakhir.
 */
export function DialogCatatAngka({
  kontenId,
  tayangHari,
  terakhir,
  buka,
  onBuka,
}: {
  kontenId: string;
  tayangHari: string | null;
  terakhir: AngkaKonten | null;
  buka: boolean;
  onBuka: (buka: boolean) => void;
}) {
  const t = useTranslations("kreatifRuang.kontenKol");
  const router = useRouter();
  const kabar = useKabarKonten();
  const [hariIni] = useState(() => hariIniWib());
  const [tanggal, setTanggal] = useState(hariIni);
  const [isian, setIsian] = useState(KOSONG);
  const [sumber, setSumber] = useState("");
  const [catatan, setCatatan] = useState("");
  const [pending, start] = useTransition();

  const tutup = (o: boolean) => {
    if (!o) {
      setIsian(KOSONG);
      setSumber("");
      setCatatan("");
      setTanggal(hariIni);
    }
    onBuka(o);
  };

  const simpan = () => {
    const nilai = {} as Record<KolomAngka, number>;
    for (const k of KOLOM_ANGKA) {
      const s = isian[k].trim();
      if (!s) {
        nilai[k] = terakhir?.[k] ?? 0;
        continue;
      }
      const n = bacaBilanganBulat(s);
      if (n === null) {
        toast.error(t("angka.tidakTerbaca", { kolom: t(`kolom.${k}`) }));
        return;
      }
      nilai[k] = n;
    }
    start(async () => {
      const r = await catatAngkaAction({
        kontenId,
        ...nilai,
        recordedAt: tanggal || null,
        source: sumber.trim() || null,
        note: catatan.trim() || null,
      });
      if (r.ok) {
        kabar.sukses("kontenKol.ok.angka", r.maju);
        tutup(false);
        router.refresh();
      } else {
        kabar.gagal(r.kode);
      }
    });
  };

  return (
    <Dialog open={buka} onOpenChange={tutup}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("angka.dialogJudul")}</DialogTitle>
          <DialogDescription>{t("angka.dialogKet")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="angka-tanggal">{t("kolom.tanggal")}</Label>
            <TanggalInput id="angka-tanggal" value={tanggal} min={tayangHari ?? undefined} max={hariIni} required onChange={(e) => setTanggal(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {KOLOM_ANGKA.map((k) => (
              <div key={k} className="space-y-1.5">
                <Label htmlFor={`angka-${k}`} className="text-xs">
                  {t(`kolom.${k}`)}
                </Label>
                <Input
                  id={`angka-${k}`}
                  value={isian[k]}
                  inputMode="decimal"
                  className="text-right tabular-nums"
                  placeholder={terakhir ? angkaTitik(terakhir[k]) : "0"}
                  onChange={(e) => setIsian((s) => ({ ...s, [k]: e.target.value }))}
                />
              </div>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="angka-sumber">{t("angka.sumber")}</Label>
              <Input id="angka-sumber" value={sumber} maxLength={191} placeholder={t("angka.sumberContoh")} onChange={(e) => setSumber(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="angka-catatan">{t("angka.catatan")}</Label>
              <Input id="angka-catatan" value={catatan} maxLength={2000} onChange={(e) => setCatatan(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => tutup(false)} disabled={pending}>
            {t("batal")}
          </Button>
          <Button onClick={simpan} disabled={pending || KOLOM_ANGKA.every((k) => !isian[k].trim()) || !tanggal}>
            {t("angka.simpan")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
