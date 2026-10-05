"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CalendarDays, Loader2 } from "lucide-react";
import { simpanHariKerjaSpg } from "@/app/actions/settings/salesman";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { dinamis } from "@/lib/i18n/dinamis";
import { HARI_KERJA_SPG_BAWAAN, HARI_TIDAK_KERJA } from "@/lib/salesman/izin";

/** Senin dulu, Minggu terakhir — urutan minggu kerja di Indonesia. */
const URUTAN = [1, 2, 3, 4, 5, 6, 0] as const;

const sama = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);

/**
 * Hari kerja SPG. Counter di toko buka akhir pekan, jadi bawaannya Senin–Minggu;
 * salesman tetap Senin–Sabtu. Hari yang dicentang di sini adalah hari yang
 * dihitung saat SPG mengajukan izin/sakit/cuti (jumlah hari dan kuota cuti) dan
 * di rekap absensinya. Tidak mengubah apa pun pada absen itu sendiri.
 */
export function HariKerjaSpgCard({ bolehUbah, hariKerja }: { bolehUbah: boolean; hariKerja: number[] }) {
  const t = useTranslations("pengaturanHariKerjaSpg");
  const td = dinamis(t);
  const router = useRouter();
  const [sibuk, mulai] = useTransition();
  const [pilih, setPilih] = useState<number[]>(hariKerja);

  const nonaktif = !bolehUbah || sibuk;
  const berubah = !sama(pilih, hariKerja);
  const kosong = pilih.length === 0;
  const salesmanKerja = URUTAN.filter((d) => !HARI_TIDAK_KERJA.includes(d));

  const ubah = (hari: number, nyala: boolean) =>
    setPilih((p) => (nyala ? [...new Set([...p, hari])] : p.filter((x) => x !== hari)));

  const simpan = () =>
    mulai(async () => {
      const r = await simpanHariKerjaSpg({ hariKerja: pilih });
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
          <CalendarDays className="h-5 w-5" />
          {t("judul")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t("hariKerjaSpg")}</legend>
          <div className="flex flex-wrap gap-2">
            {URUTAN.map((d) => (
              <Label
                key={d}
                htmlFor={`hari-kerja-spg-${d}`}
                className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm font-normal"
              >
                <Checkbox
                  id={`hari-kerja-spg-${d}`}
                  checked={pilih.includes(d)}
                  onCheckedChange={(v) => ubah(d, v === true)}
                  disabled={nonaktif}
                />
                {td(`hari.${d}`)}
              </Label>
            ))}
          </div>
          {kosong ? <p className="text-sm text-destructive">{t("minimalSatu")}</p> : null}
        </fieldset>

        <p className="text-sm text-muted-foreground">
          {t("salesmanTetap", { hari: salesmanKerja.map((d) => td(`hari.${d}`)).join(", ") })}
        </p>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            variant="ghost"
            onClick={() => setPilih([...HARI_KERJA_SPG_BAWAAN])}
            disabled={nonaktif || sama(pilih, HARI_KERJA_SPG_BAWAAN)}
          >
            {t("pakaiBawaan")}
          </Button>
          <Button onClick={simpan} disabled={nonaktif || !berubah || kosong}>
            {sibuk ? <Loader2 className="h-4 w-4 animate-spin" /> : t("simpan")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
