"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, PackageCheck } from "lucide-react";
import { simpanMinimumPesanan } from "@/app/actions/settings/salesman-minimum";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { bacaAturanMinimum, MIN_PESANAN_BAWAAN, MIN_PESANAN_MAKS } from "@/lib/field-sales/minimum-pesanan";

const angkaSaja = (s: string) => s.replace(/\D/g, "");

/**
 * Minimum pesan PUTUS bertingkat. Kolom kosong = bawaan: pesanan pertama 6,
 * pesan ulang mengikuti pesanan pertama — jadi tidak ada yang berubah sampai
 * pemilik mengisinya. `Item.minOrderQty` (master barang) tetap menimpa keduanya.
 *
 * Menerima nilai MENTAH `SystemSetting` (`putus.minOrderQty`,
 * `putus.minOrderQtyReorder`) dan membacanya dengan pembaca yang sama dengan
 * server, supaya yang tampil di sini = yang dinilai saat pesanan dibuat.
 */
export function MinimumPesananCard({
  bolehUbah,
  nilaiPertama,
  nilaiUlang,
}: {
  bolehUbah: boolean;
  nilaiPertama: string | null;
  nilaiUlang: string | null;
}) {
  const t = useTranslations("minimumPesanan");
  const tSalesman = useTranslations("settings.salesman");
  const tToasts = useTranslations("toasts");
  const router = useRouter();
  const [sibuk, mulai] = useTransition();

  const aturan = bacaAturanMinimum(nilaiPertama, nilaiUlang);
  const [pertama, setPertama] = useState(aturan.pertamaDiatur ? String(aturan.pertama) : "");
  const [ulang, setUlang] = useState(aturan.ulangDiatur ? String(aturan.ulang) : "");

  const keAngka = (s: string): number | null => (s === "" ? null : Number(s));
  const sah = (s: string) => s === "" || (Number(s) >= 1 && Number(s) <= MIN_PESANAN_MAKS);
  const berubah =
    keAngka(pertama) !== (aturan.pertamaDiatur ? aturan.pertama : null) ||
    keAngka(ulang) !== (aturan.ulangDiatur ? aturan.ulang : null);
  // Yang akan berlaku bila disimpan — dipakai untuk kalimat ringkasan di bawah isian.
  const berlakuPertama = keAngka(pertama) ?? MIN_PESANAN_BAWAAN;
  const berlakuUlang = keAngka(ulang) ?? berlakuPertama;

  const simpan = () =>
    mulai(async () => {
      const r = await simpanMinimumPesanan({ pertama: keAngka(pertama), ulang: keAngka(ulang) });
      if (!r.ok) {
        toast.error(r.code === "INVALID" ? tSalesman("errInvalid") : tSalesman("errForbidden"));
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
          <PackageCheck className="h-5 w-5" aria-hidden />
          {t("judul")}
        </CardTitle>
        <CardDescription>{t("penjelasan")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="min-pertama">{t("pertama")}</Label>
            <div className="flex items-center gap-2">
              <Input
                id="min-pertama"
                type="text"
                inputMode="numeric"
                className="w-24 tabular-nums"
                value={pertama}
                placeholder={String(MIN_PESANAN_BAWAAN)}
                onChange={(e) => setPertama(angkaSaja(e.target.value).slice(0, 4))}
                disabled={nonaktif}
                aria-invalid={!sah(pertama)}
              />
              <span className="text-sm text-muted-foreground">{t("pcsPerBarang")}</span>
            </div>
            <p className="text-xs text-muted-foreground">{t("pertamaIsi", { bawaan: MIN_PESANAN_BAWAAN })}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="min-ulang">{t("ulang")}</Label>
            <div className="flex items-center gap-2">
              <Input
                id="min-ulang"
                type="text"
                inputMode="numeric"
                className="w-24 tabular-nums"
                value={ulang}
                placeholder={String(berlakuPertama)}
                onChange={(e) => setUlang(angkaSaja(e.target.value).slice(0, 4))}
                disabled={nonaktif}
                aria-invalid={!sah(ulang)}
              />
              <span className="text-sm text-muted-foreground">{t("pcsPerBarang")}</span>
            </div>
            <p className="text-xs text-muted-foreground">{t("ulangIsi")}</p>
          </div>
        </div>

        <p className="text-sm text-muted-foreground">{t("ringkasan", { pertama: berlakuPertama, ulang: berlakuUlang })}</p>
        <p className="text-xs text-muted-foreground">{t("barangSendiri")}</p>

        <div className="flex justify-end">
          <Button onClick={simpan} disabled={nonaktif || !berubah || !sah(pertama) || !sah(ulang)}>
            {sibuk ? <Loader2 className="h-4 w-4 animate-spin" /> : t("simpan")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
