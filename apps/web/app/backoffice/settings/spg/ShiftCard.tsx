"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Clock, Loader2, Plus, Trash2 } from "lucide-react";
import { simpanAturanShiftAction } from "@/app/actions/settings/spg-shift";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { JamInput } from "@/components/ui/tanggal-input";
import { dinamis } from "@/lib/i18n/dinamis";
import type { AturanShift, JenisShift } from "@/lib/spg/pengaturan";
import { MAKS_JENIS_SHIFT, MAKS_TOLERANSI_MENIT, periksaAturanShift } from "@/lib/spg/shift";

/**
 * Pengaturan → SPG → Shift: daftar jenis shift (kode, label, jam mulai dan
 * selesai) dan toleransi terlambat. Diperiksa dengan aturan yang sama dengan
 * server (`periksaAturanShift`). Jadwal yang sudah tersusun menyimpan jamnya
 * sendiri, jadi mengubah di sini tidak menggeser jadwal yang sudah ada.
 */
export function ShiftCard({ bolehUbah, nilai }: { bolehUbah: boolean; nilai: AturanShift }) {
  const t = useTranslations("jadwalSpg.pengaturan");
  const td = dinamis(t);
  const tToasts = useTranslations("toasts");
  const router = useRouter();
  const [sibuk, mulai] = useTransition();
  const [daftar, setDaftar] = useState<JenisShift[]>(nilai.daftar);
  const [toleransi, setToleransi] = useState(String(nilai.toleransiTerlambatMenit));

  const isi = { daftar, toleransiTerlambatMenit: /^\d+$/.test(toleransi) ? Number(toleransi) : NaN };
  const periksa = periksaAturanShift(isi);
  const berubah = JSON.stringify(periksa.ok ? periksa.nilai : isi) !== JSON.stringify(nilai);
  const nonaktif = !bolehUbah || sibuk;

  const ubah = (i: number, x: Partial<JenisShift>) => setDaftar((d) => d.map((s, j) => (j === i ? { ...s, ...x } : s)));
  const tambah = () => setDaftar((d) => [...d, { kode: "", label: "", mulai: "", selesai: "" }]);
  const hapus = (i: number) => setDaftar((d) => d.filter((_, j) => j !== i));

  const galat = periksa.ok ? null : td(`err.${periksa.kode}`, { baris: (periksa.indeks ?? 0) + 1, maks: MAKS_TOLERANSI_MENIT, jumlah: MAKS_JENIS_SHIFT });

  const simpan = () =>
    mulai(async () => {
      const r = await simpanAturanShiftAction(isi);
      if (!r.ok) {
        toast.error(r.code === "TANPA_AKSES" ? t("errTanpaAkses") : r.code === "GAGAL" ? t("errGagal") : td(`err.${r.code}`, { baris: (r.indeks ?? 0) + 1, maks: MAKS_TOLERANSI_MENIT, jumlah: MAKS_JENIS_SHIFT }));
        return;
      }
      toast.success(tToasts("saved"));
      router.refresh();
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5" aria-hidden />
          {t("judul")}
        </CardTitle>
        <CardDescription>{t("penjelasan")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          {daftar.map((s, i) => (
            <div key={i} className="grid gap-3 rounded-md border p-3 md:grid-cols-[8rem_minmax(0,1fr)_auto_auto_auto] md:items-end">
              <div className="space-y-1">
                <Label htmlFor={`shift-kode-${i}`}>{t("kode")}</Label>
                <Input
                  id={`shift-kode-${i}`}
                  value={s.kode}
                  onChange={(e) => ubah(i, { kode: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "").slice(0, 20) })}
                  disabled={nonaktif}
                  className="font-mono uppercase"
                  placeholder="PAGI"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`shift-label-${i}`}>{t("label")}</Label>
                <Input
                  id={`shift-label-${i}`}
                  value={s.label}
                  onChange={(e) => ubah(i, { label: e.target.value.slice(0, 40) })}
                  disabled={nonaktif}
                  placeholder={t("labelContoh")}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`shift-mulai-${i}`}>{t("mulai")}</Label>
                <JamInput id={`shift-mulai-${i}`} value={s.mulai} onChange={(e) => ubah(i, { mulai: e.target.value })} disabled={nonaktif} />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`shift-selesai-${i}`}>{t("selesai")}</Label>
                <JamInput id={`shift-selesai-${i}`} value={s.selesai} onChange={(e) => ubah(i, { selesai: e.target.value })} disabled={nonaktif} />
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="text-destructive"
                onClick={() => hapus(i)}
                disabled={nonaktif || daftar.length <= 1}
                aria-label={t("hapus", { label: s.label || s.kode || String(i + 1) })}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button variant="outline" onClick={tambah} disabled={nonaktif || daftar.length >= MAKS_JENIS_SHIFT}>
            <Plus className="mr-2 h-4 w-4" aria-hidden />
            {t("tambah")}
          </Button>
        </div>

        <div className="space-y-2">
          <Label htmlFor="shift-toleransi">{t("toleransi")}</Label>
          <Input
            id="shift-toleransi"
            value={toleransi}
            onChange={(e) => setToleransi(e.target.value.replace(/\D/g, "").slice(0, 3))}
            inputMode="numeric"
            disabled={nonaktif}
            className="w-24 tabular-nums"
          />
          <p className="text-xs text-muted-foreground">{t("toleransiIsi")}</p>
        </div>

        <p className="text-xs text-muted-foreground">{t("catatanJadwal")}</p>
        {galat ? <p className="text-sm text-destructive">{galat}</p> : null}
        {!bolehUbah ? <p className="text-sm text-muted-foreground">{t("hanyaLihat")}</p> : null}

        <div className="flex justify-end">
          <Button onClick={simpan} disabled={nonaktif || !berubah || !periksa.ok}>
            {sibuk ? <Loader2 className="h-4 w-4 animate-spin" /> : t("simpan")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
