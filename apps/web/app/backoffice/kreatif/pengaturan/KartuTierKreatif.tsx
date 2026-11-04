"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Layers, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { simpanAmbangTierAction } from "@/app/actions/kreatif-pengaturan";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { angkaTitik } from "@/lib/creative/angka-konten";
import { bacaBilanganBulat } from "@/lib/creative/angka-masuk";
import { SEMUA_TIER } from "@/lib/creative/aturan";
import { AMBANG_TIER_BAWAAN, DAFTAR_KUNCI_TIER, validasiAmbangTier, type AmbangTier, type GalatTier } from "@/lib/creative/tier";

type Kunci = keyof AmbangTier;

const keTeks = (a: AmbangTier) => Object.fromEntries(DAFTAR_KUNCI_TIER.map((k) => [k, angkaTitik(a[k])])) as Record<Kunci, string>;

/**
 * Batas tier KOL (Kreatif → Pengaturan). Empat batas bawah yang harus naik
 * berurutan; di bawah batas mikro = nano. Penjelasan tier ada di Bantuan; di
 * layar hanya rentang yang dihasilkan.
 */
export function KartuTierKreatif({ awal, bolehMengelola }: { awal: AmbangTier; bolehMengelola: boolean }) {
  const t = useTranslations("kreatifRuang.pengaturan.tier");
  const tc = useTranslations("creative");
  const router = useRouter();
  const [nilai, setNilai] = useState<Record<Kunci, string>>(() => keTeks(awal));
  const [galatServer, setGalatServer] = useState<GalatTier[]>([]);
  const [menyimpan, mulai] = useTransition();

  const angka = Object.fromEntries(DAFTAR_KUNCI_TIER.map((k) => [k, bacaBilanganBulat(nilai[k]) ?? Number.NaN])) as AmbangTier;
  const v = validasiAmbangTier(angka);
  const galat = new Map<Kunci, GalatTier["sebab"]>((v.ok ? galatServer : v.galat).map((g) => [g.kunci, g.sebab]));

  const simpan = () => {
    if (!v.ok) return;
    mulai(async () => {
      const r = await simpanAmbangTierAction(v.ambang);
      if (r.ok) {
        setGalatServer([]);
        setNilai(keTeks(r.ambang));
        toast.success(t("ok"));
        router.refresh();
        return;
      }
      if (r.kode === "TIDAK_VALID" && "galat" in r) setGalatServer(r.galat);
      toast.error(r.kode === "TANPA_AKSES" ? t("errAkses") : r.kode === "TIDAK_VALID" ? t("errTidakValid") : t("errGagal"));
    });
  };

  // Rentang yang dihasilkan (hanya bila keempat batas sah): nano < mikro ≤ … ≤ mega.
  const rentang = v.ok
    ? SEMUA_TIER.map((tier, i) => {
        if (i === 0) return { tier, teks: t("rentangBawah", { n: angkaTitik(v.ambang.mikro) }) };
        const k = DAFTAR_KUNCI_TIER[i - 1];
        const berikut = DAFTAR_KUNCI_TIER[i];
        return {
          tier,
          teks: berikut
            ? t("rentangAntara", { dari: angkaTitik(v.ambang[k]), sampai: angkaTitik(v.ambang[berikut] - 1) })
            : t("rentangAtas", { dari: angkaTitik(v.ambang[k]) }),
        };
      })
    : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Layers className="h-5 w-5" aria-hidden />
          {t("judul")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            simpan();
          }}
        >
          <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
            {DAFTAR_KUNCI_TIER.map((k, i) => {
              const sebab = galat.get(k);
              const sebelum = i > 0 ? DAFTAR_KUNCI_TIER[i - 1] : null;
              return (
                <div key={k} className="space-y-1.5">
                  <Label htmlFor={`tier-${k}`}>{t("mulai", { tier: tc(`tier_${k}`) })}</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id={`tier-${k}`}
                      inputMode="numeric"
                      value={nilai[k]}
                      disabled={!bolehMengelola}
                      onChange={(e) => {
                        setGalatServer([]);
                        setNilai((x) => ({ ...x, [k]: e.target.value }));
                      }}
                      className="w-32 tabular-nums"
                      aria-invalid={Boolean(sebab)}
                      aria-describedby={sebab ? `tier-${k}-galat` : undefined}
                    />
                    <span className="text-sm text-muted-foreground">{t("satuan")}</span>
                  </div>
                  {sebab ? (
                    <p id={`tier-${k}-galat`} className="text-xs text-destructive">
                      {sebab === "TIDAK_NAIK" && sebelum ? t("galatNaik", { tier: tc(`tier_${sebelum}`) }) : t("galatAngka")}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>

          {rentang ? (
            <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm" aria-label={t("rentang")}>
              {rentang.map((r) => (
                <div key={r.tier} className="flex gap-1.5">
                  <dt className="font-medium">{tc(`tier_${r.tier}`)}</dt>
                  <dd className="tabular-nums text-muted-foreground">{r.teks}</dd>
                </div>
              ))}
            </dl>
          ) : null}

          {bolehMengelola ? (
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={menyimpan || !v.ok}>
                {menyimpan ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                {t("simpan")}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={menyimpan}
                onClick={() => {
                  setGalatServer([]);
                  setNilai(keTeks(AMBANG_TIER_BAWAAN));
                }}
              >
                {t("bawaan")}
              </Button>
            </div>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
