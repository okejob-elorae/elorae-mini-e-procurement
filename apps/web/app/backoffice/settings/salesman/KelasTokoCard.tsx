"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowRight, Layers, Loader2 } from "lucide-react";
import { simpanAturanKelasToko } from "@/app/actions/settings/salesman-kelas";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  batasDariPersen,
  DAFTAR_KELAS,
  JARAK_HARI_MAKS,
  persenDariBatas,
  type AturanKelasToko,
  type KelasToko,
} from "@/lib/stores/kelas-toko";

const angkaSaja = (s: string) => s.replace(/\D/g, "");

/**
 * Kelas toko & jarak kunjungan: seberapa sering sales diingatkan mendatangi
 * toko kelas A, B, dan C, dan apakah toko yang belum diberi kelas memakai
 * kelas usulan otomatis. Kelas per toko diatur di master toko atau lewat
 * halaman usulan kelas.
 */
export function KelasTokoCard({
  bolehUbah,
  aturan,
  jumlah,
}: {
  bolehUbah: boolean;
  aturan: AturanKelasToko;
  /** Jumlah toko aktif per kelas; opsional — tanpa ini ringkasannya tidak tampil. */
  jumlah?: Record<KelasToko | "TANPA", number>;
}) {
  const t = useTranslations("kelasToko.pengaturan");
  const tToasts = useTranslations("toasts");
  const router = useRouter();
  const [sibuk, mulai] = useTransition();

  const persenAwal = persenDariBatas(aturan.otomatis);
  const [hari, setHari] = useState<Record<KelasToko, string>>({
    A: String(aturan.jarakHari.A),
    B: String(aturan.jarakHari.B),
    C: String(aturan.jarakHari.C),
  });
  const [aktif, setAktif] = useState(aturan.otomatis.aktif);
  const [persenA, setPersenA] = useState(String(persenAwal.A));
  const [persenB, setPersenB] = useState(String(persenAwal.B));

  const hariValid = DAFTAR_KELAS.every((k) => {
    const n = Number(hari[k]);
    return hari[k] !== "" && Number.isInteger(n) && n >= 1 && n <= JARAK_HARI_MAKS;
  });
  const pA = Number(persenA);
  const pB = Number(persenB);
  // A dan B masing-masing minimal 1%, dan C harus tetap punya bagian.
  const persenValid = persenA !== "" && persenB !== "" && pA >= 1 && pB >= 1 && pA + pB <= 99;
  const persenC = persenValid ? 100 - pA - pB : null;

  const berubah =
    DAFTAR_KELAS.some((k) => Number(hari[k]) !== aturan.jarakHari[k]) ||
    aktif !== aturan.otomatis.aktif ||
    pA !== persenAwal.A ||
    pB !== persenAwal.B;

  const simpan = () =>
    mulai(async () => {
      const batas = batasDariPersen(pA, pB);
      const r = await simpanAturanKelasToko({
        jarakHari: { A: Number(hari.A), B: Number(hari.B), C: Number(hari.C) },
        otomatis: { aktif, batasA: batas.batasA, batasB: batas.batasB },
      });
      if (!r.ok) {
        toast.error(r.code === "INVALID" ? t("errInvalid") : t("errForbidden"));
        return;
      }
      toast.success(tToasts("saved"));
      router.refresh();
    });

  const nonaktif = !bolehUbah || sibuk;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Layers className="h-5 w-5" />
          {t("judul")}
        </CardTitle>
        <CardDescription>{t("penjelasan")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-3">
          {DAFTAR_KELAS.map((k) => (
            <div key={k} className="space-y-1.5">
              <Label htmlFor={`kelas-hari-${k}`}>{t("hariLabel", { kelas: k })}</Label>
              <div className="relative">
                <Input
                  id={`kelas-hari-${k}`}
                  type="text"
                  inputMode="numeric"
                  className="pr-12 tabular-nums"
                  value={hari[k]}
                  onChange={(e) => setHari((prev) => ({ ...prev, [k]: angkaSaja(e.target.value).slice(0, 3) }))}
                  disabled={nonaktif}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  {t("satuanHari")}
                </span>
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t("hariIsi", { max: JARAK_HARI_MAKS })}</p>

        <div className="space-y-4 rounded-lg border p-3">
          <div className="flex items-start gap-3">
            <Switch id="kelas-otomatis" checked={aktif} onCheckedChange={setAktif} disabled={nonaktif} />
            <div className="space-y-0.5">
              <Label htmlFor="kelas-otomatis" className="cursor-pointer">
                {t("otomatis")}
              </Label>
              <p className="text-xs text-muted-foreground">{t("otomatisIsi")}</p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="kelas-persen-a">{t("persenA")}</Label>
              <div className="relative">
                <Input
                  id="kelas-persen-a"
                  type="text"
                  inputMode="numeric"
                  className="pr-8 tabular-nums"
                  value={persenA}
                  onChange={(e) => setPersenA(angkaSaja(e.target.value).slice(0, 2))}
                  disabled={nonaktif}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  %
                </span>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="kelas-persen-b">{t("persenB")}</Label>
              <div className="relative">
                <Input
                  id="kelas-persen-b"
                  type="text"
                  inputMode="numeric"
                  className="pr-8 tabular-nums"
                  value={persenB}
                  onChange={(e) => setPersenB(angkaSaja(e.target.value).slice(0, 2))}
                  disabled={nonaktif}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  %
                </span>
              </div>
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-medium">{t("persenC")}</p>
              <p className="flex h-9 items-center text-sm tabular-nums text-muted-foreground">
                {persenC === null ? t("persenTidakSah") : t("persenCIsi", { pct: persenC })}
              </p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t("persenIsi")}</p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {jumlah
              ? t("ringkasan", { a: jumlah.A, b: jumlah.B, c: jumlah.C, tanpa: jumlah.TANPA })
              : t("ringkasanTanpaAngka")}{" "}
            <Link href="/backoffice/stores/kelas" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
              {t("bukaUsulan")}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </p>
          <Button onClick={simpan} disabled={nonaktif || !berubah || !hariValid || !persenValid}>
            {sibuk ? <Loader2 className="h-4 w-4 animate-spin" /> : t("simpan")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
