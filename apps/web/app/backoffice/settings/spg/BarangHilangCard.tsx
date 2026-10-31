"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, PackageX } from "lucide-react";
import { simpanBarangHilangSpg } from "@/app/actions/settings/spg-barang-hilang";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { dinamis } from "@/lib/i18n/dinamis";
import { DASAR_NILAI } from "@/lib/spg/hilang";
import type { AturanBarangHilang, DasarNilaiHilang } from "@/lib/spg/pengaturan";
import { cn } from "@/lib/utils";

/**
 * Barang hilang (keputusan pemilik 2026-10-03): dasar nilai per potong (bawaan
 * harga toko terima), batas potongan dari satu pembayaran gaji/komisi (sisanya
 * dicicil), apakah opname toko konsinyasi yang kurang otomatis membuka
 * catatan. Keputusan siapa yang menanggung tiap kejadian — dan keringanan
 * diskon pegawai, yang persennya diketik setiap kali — dibuat di SPG → Barang
 * hilang.
 */
export function BarangHilangCard({ bolehUbah, nilai }: { bolehUbah: boolean; nilai: AturanBarangHilang }) {
  const t = useTranslations("pengaturanBarangHilang");
  const td = dinamis(t);
  const router = useRouter();
  const [sibuk, mulai] = useTransition();
  const [dasar, setDasar] = useState<DasarNilaiHilang>(nilai.dasarNilai);
  const [persen, setPersen] = useState(String(nilai.maksPotongPersen));
  const [dariOpname, setDariOpname] = useState(nilai.dariOpname);

  const persenBulat = (v: string) => (v.trim() === "" ? NaN : Number(v));
  const sahPersen = (n: number) => Number.isInteger(n) && n >= 0 && n <= 100;
  const angkaPersen = persenBulat(persen);
  const persenSah = sahPersen(angkaPersen);
  const nonaktif = !bolehUbah || sibuk;
  const berubah =
    dasar !== nilai.dasarNilai ||
    angkaPersen !== nilai.maksPotongPersen ||
    dariOpname !== nilai.dariOpname;

  const simpan = () =>
    mulai(async () => {
      const r = await simpanBarangHilangSpg({ dasarNilai: dasar, maksPotongPersen: angkaPersen, dariOpname });
      if (!r.ok) {
        toast.error(td(`err.${r.code}`));
        return;
      }
      toast.success(t("tersimpan"));
      router.refresh();
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PackageX className="h-5 w-5" aria-hidden />
          {t("judul")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label id="hilang-dasar">{t("dasarLabel")}</Label>
          <div role="radiogroup" aria-labelledby="hilang-dasar" className="grid gap-2 sm:grid-cols-2">
            {DASAR_NILAI.map((d) => (
              <Button
                key={d}
                type="button"
                role="radio"
                aria-checked={dasar === d}
                variant="outline"
                disabled={nonaktif}
                onClick={() => setDasar(d)}
                className={cn(
                  "h-auto flex-col items-start gap-1 whitespace-normal py-3 text-left",
                  dasar === d && "border-primary bg-primary/5 ring-1 ring-primary",
                )}
              >
                <span className="font-semibold">{td(`dasar.${d}`)}</span>
                <span className="text-xs font-normal text-muted-foreground">{td(`dasarIsi.${d}`)}</span>
              </Button>
            ))}
          </div>
          {dasar === "HARGA_TERIMA" ? <p className="text-xs text-muted-foreground">{t("dasarCadangan")}</p> : null}
          <p className="text-xs text-muted-foreground">{t("dasarCatatan")}</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="hilang-persen">{t("persenLabel")}</Label>
          <div className="flex items-center gap-2">
            <Input
              id="hilang-persen"
              inputMode="numeric"
              value={persen}
              onChange={(e) => setPersen(e.target.value.replace(/[^\d]/g, "").slice(0, 3))}
              disabled={nonaktif}
              className="w-24"
              aria-invalid={!persenSah}
            />
            <span className="text-sm text-muted-foreground">%</span>
          </div>
          <p className={cn("text-xs", persenSah ? "text-muted-foreground" : "text-destructive")}>
            {persenSah ? t("persenIsi", { persen: angkaPersen }) : t("persenSalah")}
          </p>
        </div>

        <div className="flex items-start justify-between gap-4 rounded-md border p-3">
          <div className="space-y-0.5">
            <Label htmlFor="hilang-opname" className="cursor-pointer">
              {t("opnameLabel")}
            </Label>
            <p className="text-xs text-muted-foreground">{t("opnameIsi")}</p>
          </div>
          <Switch id="hilang-opname" checked={dariOpname} onCheckedChange={setDariOpname} disabled={nonaktif} />
        </div>

        {!bolehUbah ? <p className="text-xs text-muted-foreground">{t("tanpaIzin")}</p> : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button asChild variant="ghost">
            <Link href="/backoffice/barang-hilang">{t("bukaDaftar")}</Link>
          </Button>
          <Button onClick={simpan} disabled={nonaktif || !berubah || !persenSah}>
            {sibuk ? <Loader2 className="h-4 w-4 animate-spin" /> : t("simpan")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
