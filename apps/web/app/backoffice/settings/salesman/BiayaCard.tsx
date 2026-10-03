"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowRight, Loader2, Receipt } from "lucide-react";
import { simpanPengaturanBiaya } from "@/app/actions/settings/salesman-biaya";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { BATAS_HARI_MAKS, type PengaturanBiaya } from "@/lib/salesman/biaya";

const angkaSaja = (s: string) => s.replace(/\D/g, "");

/**
 * Biaya perjalanan: boleh diajukan atau tidak, sampai berapa hari ke belakang,
 * dan apakah foto struk wajib. Keputusan atas klaim ada di layar Biaya
 * perjalanan, bukan di sini.
 */
export function BiayaCard({ bolehUbah, pengaturan }: { bolehUbah: boolean; pengaturan: PengaturanBiaya }) {
  const t = useTranslations("biayaPerjalanan.pengaturan");
  const router = useRouter();
  const [sibuk, mulai] = useTransition();
  const [aktif, setAktif] = useState(pengaturan.aktif);
  const [hari, setHari] = useState(String(pengaturan.batasHari));
  const [fotoWajib, setFotoWajib] = useState(pengaturan.fotoWajib);

  const hariAngka = Number(hari);
  const hariSah = /^\d+$/.test(hari) && hariAngka >= 1 && hariAngka <= BATAS_HARI_MAKS;
  const berubah = aktif !== pengaturan.aktif || fotoWajib !== pengaturan.fotoWajib || hariAngka !== pengaturan.batasHari;
  const nonaktif = !bolehUbah || sibuk;

  const simpan = () =>
    mulai(async () => {
      const r = await simpanPengaturanBiaya({ aktif, batasHari: hariAngka, fotoWajib });
      if (!r.ok) {
        toast.error(t(`err.${r.code}`));
        return;
      }
      toast.success(t("tersimpan"));
      router.refresh();
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Receipt className="h-5 w-5" />
          {t("judul")}
        </CardTitle>
        <CardDescription>{t("penjelasan")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
          <div className="space-y-1">
            <Label htmlFor="biaya-aktif" className="text-sm font-medium">
              {t("aktif")}
            </Label>
            <p className="text-sm text-muted-foreground">{aktif ? t("aktifNyala") : t("aktifMati")}</p>
          </div>
          <Switch id="biaya-aktif" checked={aktif} onCheckedChange={setAktif} disabled={nonaktif} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="biaya-batas-hari">{t("batasHari")}</Label>
            <Input
              id="biaya-batas-hari"
              type="text"
              inputMode="numeric"
              className="tabular-nums"
              value={hari}
              onChange={(e) => setHari(angkaSaja(e.target.value).slice(0, 3))}
              disabled={nonaktif}
              aria-invalid={!hariSah}
            />
            <p className="text-xs text-muted-foreground">{t("batasHariIsi", { maks: BATAS_HARI_MAKS })}</p>
          </div>
          <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
            <div className="space-y-1">
              <Label htmlFor="biaya-foto-wajib" className="text-sm font-medium">
                {t("fotoWajib")}
              </Label>
              <p className="text-sm text-muted-foreground">{t("fotoWajibIsi")}</p>
            </div>
            <Switch id="biaya-foto-wajib" checked={fotoWajib} onCheckedChange={setFotoWajib} disabled={nonaktif} />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/backoffice/biaya-perjalanan"
            className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            {t("bukaDaftar")}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
          <Button onClick={simpan} disabled={nonaktif || !berubah || !hariSah}>
            {sibuk ? <Loader2 className="h-4 w-4 animate-spin" /> : t("simpan")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
