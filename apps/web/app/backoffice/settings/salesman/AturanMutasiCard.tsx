"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeftRight, Loader2 } from "lucide-react";
import { simpanAturanMutasi } from "@/app/actions/spg-mutasi";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { dinamis } from "@/lib/i18n/dinamis";
import {
  ARAH_MUTASI,
  bacaAturanMutasi,
  HARI_PENGINGAT_MAKS,
  KEPUTUSAN_ARAH,
  melibatkanPutus,
  MODE_SALDO_MUTASI,
  type ArahMutasi,
  type AturanMutasi,
  type KeputusanArah,
  type ModeSaldoMutasi,
} from "@/lib/spg/mutasi-aturan";

/**
 * Mutasi antar toko oleh SPG (`SystemSetting["spg.mutasi"]`): boleh tidaknya,
 * arah mana yang ditolak/perlu persetujuan/langsung, saldo, toko tanpa SPG,
 * dan kapan kiriman dianggap macet. Menerima nilai MENTAH dan membacanya
 * dengan pembaca yang sama dengan server.
 *
 * Arah yang melibatkan toko PUTUS tidak bisa `LANGSUNG`: barang toko putus
 * milik toko itu, jadi kantor selalu menyetujui lebih dulu.
 */
export function AturanMutasiCard({ bolehUbah, nilai }: { bolehUbah: boolean; nilai: string | null }) {
  const t = useTranslations("spgMutasi.pengaturan");
  const td = dinamis(t);
  const tSalesman = useTranslations("settings.salesman");
  const tToasts = useTranslations("toasts");
  const router = useRouter();
  const [sibuk, mulai] = useTransition();

  const awal = bacaAturanMutasi(nilai);
  const [aturan, setAturan] = useState<AturanMutasi>(awal);
  const [hari, setHari] = useState(String(awal.hariPengingat));

  const hariAngka = Number(hari);
  const hariSah = /^\d+$/.test(hari) && hariAngka >= 1 && hariAngka <= HARI_PENGINGAT_MAKS;
  const berubah = JSON.stringify({ ...aturan, hariPengingat: hariAngka }) !== JSON.stringify(awal);
  const nonaktif = !bolehUbah || sibuk;

  const ubahArah = (arah: ArahMutasi, k: KeputusanArah) => setAturan((a) => ({ ...a, aturan: { ...a.aturan, [arah]: k } }));

  const simpan = () =>
    mulai(async () => {
      const r = await simpanAturanMutasi({ ...aturan, hariPengingat: hariAngka });
      if (!r.ok) {
        toast.error(r.code === "INVALID" ? tSalesman("errInvalid") : tSalesman("errForbidden"));
        return;
      }
      toast.success(tToasts("saved"));
      router.refresh();
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ArrowLeftRight className="h-5 w-5" aria-hidden />
          {t("judul")}
        </CardTitle>
        <CardDescription>{t("penjelasan")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-4 rounded-md border p-3">
          <div className="space-y-0.5">
            <Label htmlFor="mutasi-aktif" className="cursor-pointer">
              {t("aktif")}
            </Label>
            <p className="text-xs text-muted-foreground">{t("aktifIsi")}</p>
          </div>
          <Switch id="mutasi-aktif" checked={aturan.aktif} onCheckedChange={(v) => setAturan((a) => ({ ...a, aktif: v }))} disabled={nonaktif} />
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">{t("arahJudul")}</p>
          <div className="divide-y rounded-md border">
            {ARAH_MUTASI.map((arah) => (
              <div key={arah} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-sm">{td(`arah.${arah}`)}</span>
                <Select value={aturan.aturan[arah]} onValueChange={(v) => ubahArah(arah, v as KeputusanArah)} disabled={nonaktif || !aturan.aktif}>
                  <SelectTrigger className="w-full sm:w-56" aria-label={td(`arah.${arah}`)}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {KEPUTUSAN_ARAH.map((k) => (
                      <SelectItem key={k} value={k} disabled={k === "LANGSUNG" && melibatkanPutus(arah)}>
                        {td(`keputusan.${k}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{t("arahCatatan")}</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="mutasi-saldo">{t("saldo")}</Label>
          <Select value={aturan.saldo} onValueChange={(v) => setAturan((a) => ({ ...a, saldo: v as ModeSaldoMutasi }))} disabled={nonaktif || !aturan.aktif}>
            <SelectTrigger id="mutasi-saldo" className="w-full sm:w-72">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODE_SALDO_MUTASI.map((m) => (
                <SelectItem key={m} value={m}>
                  {td(`saldoMode.${m}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{t("saldoIsi")}</p>
        </div>

        <div className="flex items-start justify-between gap-4 rounded-md border p-3">
          <div className="space-y-0.5">
            <Label htmlFor="mutasi-tanpa-spg" className="cursor-pointer">
              {t("tujuanTanpaSpg")}
            </Label>
            <p className="text-xs text-muted-foreground">{t("tujuanTanpaSpgIsi")}</p>
          </div>
          <Switch
            id="mutasi-tanpa-spg"
            checked={aturan.tujuanTanpaSpg}
            onCheckedChange={(v) => setAturan((a) => ({ ...a, tujuanTanpaSpg: v }))}
            disabled={nonaktif || !aturan.aktif}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="mutasi-hari">{t("hariPengingat")}</Label>
          <Input
            id="mutasi-hari"
            value={hari}
            onChange={(e) => setHari(e.target.value.replace(/\D/g, "").slice(0, 2))}
            inputMode="numeric"
            aria-invalid={!hariSah || undefined}
            disabled={nonaktif}
            className="w-24 tabular-nums"
          />
          <p className={hariSah ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>
            {hariSah ? t("hariPengingatIsi") : t("hariSalah", { maks: HARI_PENGINGAT_MAKS })}
          </p>
        </div>

        <div className="flex justify-end">
          <Button onClick={simpan} disabled={nonaktif || !berubah || !hariSah}>
            {sibuk ? <Loader2 className="h-4 w-4 animate-spin" /> : t("simpan")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
