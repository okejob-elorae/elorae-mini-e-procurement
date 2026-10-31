"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowRight, CalendarCheck, Loader2 } from "lucide-react";
import { simpanPengaturanAbsensi } from "@/app/actions/settings/salesman-biaya";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { jamSah, kuotaCutiSah, type PengaturanAbsensi } from "@/lib/salesman/absensi";
import { KUOTA_CUTI_MAKS } from "@/lib/salesman/izin";
import { JamInput } from "@/components/ui/tanggal-input";

/**
 * Absensi harian salesman — BAWAAN MATI. Saat menyala, beranda HP salesman
 * menampilkan kartu "Absen masuk" (swafoto + GPS) dan "Absen pulang".
 * Terlambat dinilai terhadap jam masuk di sini saat dibaca, jadi menggeser
 * jamnya ikut menilai ulang riwayat.
 *
 * Kuota cuti tahunan (hari kerja) berlaku untuk ajuan cuti dari HP, dan
 * berlaku walau absensi dimatikan — izin/sakit/cuti tetap bisa diajukan.
 */
export function AbsensiCard({ bolehUbah, pengaturan }: { bolehUbah: boolean; pengaturan: PengaturanAbsensi }) {
  const t = useTranslations("absensi.pengaturan");
  const router = useRouter();
  const [sibuk, mulai] = useTransition();
  const [aktif, setAktif] = useState(pengaturan.aktif);
  const [selfieWajib, setSelfieWajib] = useState(pengaturan.selfieWajib);
  const [jam, setJam] = useState(pengaturan.jamMasukPaling);
  const [kuota, setKuota] = useState(String(pengaturan.kuotaCutiTahunan));
  const kuotaAngka = kuota.trim() === "" ? Number.NaN : Number(kuota);

  const berubah =
    aktif !== pengaturan.aktif ||
    selfieWajib !== pengaturan.selfieWajib ||
    jam !== pengaturan.jamMasukPaling ||
    kuotaAngka !== pengaturan.kuotaCutiTahunan;
  const nonaktif = !bolehUbah || sibuk;

  const simpan = () =>
    mulai(async () => {
      const r = await simpanPengaturanAbsensi({ aktif, selfieWajib, jamMasukPaling: jam, kuotaCutiTahunan: kuotaAngka });
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
          <CalendarCheck className="h-5 w-5" />
          {t("judul")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
          <div className="space-y-1">
            <Label htmlFor="absensi-aktif" className="text-sm font-medium">
              {t("aktif")}
            </Label>
            <p className="text-sm text-muted-foreground">{aktif ? t("aktifNyala") : t("aktifMati")}</p>
          </div>
          <Switch id="absensi-aktif" checked={aktif} onCheckedChange={setAktif} disabled={nonaktif} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="absensi-jam">{t("jamMasuk")}</Label>
            <JamInput
              id="absensi-jam"
              className="w-36 tabular-nums"
              value={jam}
              onChange={(e) => setJam(e.target.value.slice(0, 5))}
              disabled={nonaktif}
              aria-invalid={!jamSah(jam)}
            />
            <p className="text-xs text-muted-foreground">{t("jamMasukIsi")}</p>
          </div>
          <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
            <div className="space-y-1">
              <Label htmlFor="absensi-selfie" className="text-sm font-medium">
                {t("selfieWajib")}
              </Label>
              <p className="text-sm text-muted-foreground">{t("selfieWajibIsi")}</p>
            </div>
            <Switch id="absensi-selfie" checked={selfieWajib} onCheckedChange={setSelfieWajib} disabled={nonaktif} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="absensi-kuota-cuti">{t("kuotaCuti")}</Label>
            <Input
              id="absensi-kuota-cuti"
              type="number"
              inputMode="numeric"
              min={0}
              max={KUOTA_CUTI_MAKS}
              step={1}
              className="w-28 tabular-nums"
              value={kuota}
              onChange={(e) => setKuota(e.target.value.replace(/[^\d]/g, "").slice(0, 3))}
              disabled={nonaktif}
              aria-invalid={!kuotaCutiSah(kuotaAngka)}
            />
            <p className="text-xs text-muted-foreground">{t("kuotaCutiIsi")}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="flex flex-wrap gap-x-4 gap-y-1">
            <Link href="/backoffice/absensi" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
              {t("bukaDaftar")}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
            <Link href="/backoffice/izin" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
              {t("bukaIzin")}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </span>
          <Button onClick={simpan} disabled={nonaktif || !berubah || !jamSah(jam) || !kuotaCutiSah(kuotaAngka)}>
            {sibuk ? <Loader2 className="h-4 w-4 animate-spin" /> : t("simpan")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
