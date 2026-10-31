"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, SlidersHorizontal } from "lucide-react";
import { simpanPengaturanPantauAction } from "@/app/actions/kreatif-pantau";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { JamInput } from "@/components/ui/tanggal-input";
import {
  BATAS_PANTAU,
  JAM_SEPANJANG_HARI,
  KUNCI_ANGKA_PANTAU,
  PANTAU_BAWAAN,
  sepanjangHari,
  validasiPantau,
  type PengaturanPantau,
  type SebabGalatPantau,
} from "@/lib/creative/pantau-aturan";
import { dinamis } from "@/lib/i18n/dinamis";
import { cn } from "@/lib/utils";

type KunciAngka = (typeof KUNCI_ANGKA_PANTAU)[number];

/** Satuan tampilan per kunci (`kreatifRuang.pantau.satuan.*`). */
const SATUAN: Record<KunciAngka, "pengecekan" | "detik" | "menit" | "hari" | "persen" | "kali"> = {
  kuotaHarian: "pengecekan",
  jedaMinDetik: "detik",
  jedaMaksDetik: "detik",
  istirahatSetiapMenit: "menit",
  istirahatMinMenit: "menit",
  istirahatMaksMenit: "menit",
  jedaOtomatisMenit: "menit",
  maksGagalBeruntun: "kali",
  hariAkunAktif: "hari",
  hariAkunLain: "hari",
  hariKontenBerkala: "hari",
  batasHariKonten: "hari",
  naikPengikutPersen: "persen",
  naikPengikutHari: "hari",
  turunErPersen: "persen",
};

const keTeks = (p: PengaturanPantau) => Object.fromEntries(KUNCI_ANGKA_PANTAU.map((k) => [k, String(p[k])])) as Record<KunciAngka, string>;

/**
 * Pengaturan `kreatif.pantau` (keputusan sementara P4–P6). Validasinya sama
 * dengan penyimpan (`validasiPantau`); isian yang salah ditandai, tidak
 * diganti diam-diam.
 */
export function KartuPengaturanPantau({ awal, bolehMengelola }: { awal: PengaturanPantau; bolehMengelola: boolean }) {
  const t = useTranslations("kreatifRuang");
  const td = dinamis(t);
  const [aktif, setAktif] = useState(awal.aktif);
  const [jamMulai, setJamMulai] = useState(awal.jamMulai);
  const [jamSelesai, setJamSelesai] = useState(awal.jamSelesai);
  // Jam terakhir sebelum "24 jam" dinyalakan, supaya mematikannya mengembalikan jam itu.
  const jamSebelumnya = useRef(sepanjangHari(awal) ? null : { jamMulai: awal.jamMulai, jamSelesai: awal.jamSelesai });
  const duaPuluhEmpat = sepanjangHari({ jamMulai, jamSelesai });
  const [nilai, setNilai] = useState(() => keTeks(awal));
  const [galat, setGalat] = useState<Map<string, SebabGalatPantau>>(new Map());
  const [menyimpan, mulai] = useTransition();

  const keAngka = (teks: string): number => (/^\s*-?\d+\s*$/.test(teks) ? Number(teks.trim()) : Number.NaN);
  const kirim = () => ({ aktif, jamMulai, jamSelesai, ...Object.fromEntries(KUNCI_ANGKA_PANTAU.map((k) => [k, keAngka(nilai[k])])) });

  const simpan = () => {
    const isi = kirim();
    const v = validasiPantau(isi);
    if (!v.ok) {
      setGalat(new Map(v.galat.map((g) => [g.kunci, g.sebab])));
      return;
    }
    setGalat(new Map());
    mulai(async () => {
      const r = await simpanPengaturanPantauAction(isi);
      if (r.ok) {
        toast.success(t("pantau.pengaturan.ok"));
        return;
      }
      if (r.kode === "TIDAK_VALID" && "galat" in r) setGalat(new Map(r.galat.map((g) => [g.kunci, g.sebab])));
      toast.error(td(`pantau.err.${r.kode}`));
    });
  };

  const setelDuaPuluhEmpat = (nyala: boolean) => {
    if (nyala) {
      if (!duaPuluhEmpat) jamSebelumnya.current = { jamMulai, jamSelesai };
      setJamMulai(JAM_SEPANJANG_HARI.jamMulai);
      setJamSelesai(JAM_SEPANJANG_HARI.jamSelesai);
    } else {
      const j = jamSebelumnya.current ?? { jamMulai: PANTAU_BAWAAN.jamMulai, jamSelesai: PANTAU_BAWAAN.jamSelesai };
      setJamMulai(j.jamMulai);
      setJamSelesai(j.jamSelesai);
    }
    setGalat((g) => {
      const baru = new Map(g);
      baru.delete("jamMulai");
      baru.delete("jamSelesai");
      return baru;
    });
  };

  const pesanGalat = (k: string, sebab: SebabGalatPantau) => {
    if (sebab === "URUTAN") return t("pantau.pengaturan.galatUrutan");
    if (sebab === "BUKAN_JAM") return t("pantau.pengaturan.galatJam");
    const b = BATAS_PANTAU[k as KunciAngka];
    return b ? t("pantau.pengaturan.galatBatas", { min: b.min, maks: b.maks }) : t("pantau.pengaturan.galatJam");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SlidersHorizontal className="h-5 w-5" aria-hidden />
          {t("pantau.pengaturan.judul")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            simpan();
          }}
        >
          <div className="flex items-center gap-3">
            <Switch id="pantau-aktif" checked={aktif} onCheckedChange={setAktif} disabled={!bolehMengelola} />
            <Label htmlFor="pantau-aktif">{t("pantau.pengaturan.kunci.aktif")}</Label>
          </div>

          <div className="flex items-center gap-3">
            <Switch id="pantau-24-jam" checked={duaPuluhEmpat} onCheckedChange={setelDuaPuluhEmpat} disabled={!bolehMengelola} />
            <Label htmlFor="pantau-24-jam">{t("pantau.pengaturan.sepanjangHari")}</Label>
          </div>

          {duaPuluhEmpat ? null : (
          <div className="flex flex-wrap gap-x-6 gap-y-4">
            {(
              [
                ["jamMulai", jamMulai, setJamMulai],
                ["jamSelesai", jamSelesai, setJamSelesai],
              ] as const
            ).map(([k, v, set]) => (
              <div key={k} className="space-y-1.5">
                <Label htmlFor={`pantau-${k}`}>{td(`pantau.pengaturan.kunci.${k}`)}</Label>
                <JamInput id={`pantau-${k}`} value={v} onChange={(e) => set(e.target.value)} disabled={!bolehMengelola} aria-invalid={galat.has(k)} />
                {galat.has(k) ? <p className="text-xs text-destructive">{pesanGalat(k, galat.get(k)!)}</p> : null}
              </div>
            ))}
          </div>
          )}

          <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
            {KUNCI_ANGKA_PANTAU.map((k) => {
              const b = BATAS_PANTAU[k];
              const salah = galat.get(k);
              return (
                <div key={k} className="space-y-1.5">
                  <Label htmlFor={`pantau-${k}`}>{td(`pantau.pengaturan.kunci.${k}`)}</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id={`pantau-${k}`}
                      type="number"
                      inputMode="numeric"
                      min={b.min}
                      max={b.maks}
                      step={1}
                      value={nilai[k]}
                      disabled={!bolehMengelola}
                      onChange={(e) => setNilai((x) => ({ ...x, [k]: e.target.value }))}
                      className="w-28 tabular-nums"
                      aria-invalid={Boolean(salah)}
                      aria-describedby={salah ? `pantau-${k}-galat` : undefined}
                    />
                    <span className="text-sm text-muted-foreground">{td(`pantau.satuan.${SATUAN[k]}`)}</span>
                  </div>
                  {salah ? (
                    <p id={`pantau-${k}-galat`} className={cn("text-xs text-destructive")}>
                      {pesanGalat(k, salah)}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>

          {bolehMengelola ? (
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={menyimpan}>
                {menyimpan ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                {t("pantau.pengaturan.simpan")}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={menyimpan}
                onClick={() => {
                  setAktif(PANTAU_BAWAAN.aktif);
                  setJamMulai(PANTAU_BAWAAN.jamMulai);
                  setJamSelesai(PANTAU_BAWAAN.jamSelesai);
                  setNilai(keTeks(PANTAU_BAWAAN));
                  setGalat(new Map());
                }}
              >
                {t("pantau.pengaturan.bawaan")}
              </Button>
            </div>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
