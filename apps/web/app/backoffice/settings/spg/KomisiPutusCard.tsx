"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Coins, Loader2 } from "lucide-react";
import { simpanKomisiPutusSpg } from "@/app/actions/settings/spg-komisi";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { dinamis } from "@/lib/i18n/dinamis";
import type { AturanKomisiPutus, DasarKomisi } from "@/lib/spg/pengaturan";
import { cn } from "@/lib/utils";

const DASAR: DasarKomisi[] = ["BAGI_RATA", "PER_SPG"];

/**
 * Komisi SPG di toko PUTUS (keputusan pemilik 2026-10-03). Tarifnya tarif
 * komisi barang di master (`Item.commissionPerPcs`) × potong terjual bersih.
 * Kartu ini hanya menyalakan/mematikan dan memilih dasar pembagiannya; angka
 * per bulan ditetapkan di SPG → Komisi SPG.
 */
export function KomisiPutusCard({ bolehUbah, nilai }: { bolehUbah: boolean; nilai: AturanKomisiPutus }) {
  const t = useTranslations("pengaturanKomisiPutusSpg");
  const td = dinamis(t);
  const router = useRouter();
  const [sibuk, mulai] = useTransition();
  const [aktif, setAktif] = useState(nilai.aktif);
  const [dasar, setDasar] = useState<DasarKomisi>(nilai.dasar);

  const nonaktif = !bolehUbah || sibuk;
  const berubah = aktif !== nilai.aktif || dasar !== nilai.dasar;

  const simpan = () =>
    mulai(async () => {
      const r = await simpanKomisiPutusSpg({ aktif, dasar });
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
          <Coins className="h-5 w-5" aria-hidden />
          {t("judul")}
        </CardTitle>
        <CardDescription>{t("penjelasan")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-4 rounded-md border p-3">
          <div className="space-y-0.5">
            <Label htmlFor="komisi-putus-aktif" className="cursor-pointer">
              {t("aktif")}
            </Label>
            <p className="text-xs text-muted-foreground">{t("aktifIsi")}</p>
          </div>
          <Switch id="komisi-putus-aktif" checked={aktif} onCheckedChange={setAktif} disabled={nonaktif} />
        </div>

        <div className="space-y-2">
          <Label id="komisi-putus-dasar">{t("dasarLabel")}</Label>
          <div role="radiogroup" aria-labelledby="komisi-putus-dasar" className="grid gap-2 sm:grid-cols-2">
            {DASAR.map((d) => (
              <Button
                key={d}
                type="button"
                role="radio"
                aria-checked={dasar === d}
                variant="outline"
                disabled={nonaktif || !aktif}
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
        </div>

        <p className="text-xs text-muted-foreground">{t("catatan")}</p>
        {!bolehUbah ? <p className="text-xs text-muted-foreground">{t("tanpaIzin")}</p> : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button asChild variant="ghost">
            <Link href="/backoffice/komisi-spg">{t("bukaKomisi")}</Link>
          </Button>
          <Button onClick={simpan} disabled={nonaktif || !berubah}>
            {sibuk ? <Loader2 className="h-4 w-4 animate-spin" /> : t("simpan")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
