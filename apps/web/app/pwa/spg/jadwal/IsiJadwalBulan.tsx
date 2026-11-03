"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CalendarCheck, Loader2 } from "lucide-react";
import { ajukanJadwalBulanAction, simpanJadwalBulanSayaAction } from "@/app/actions/spg-komisi-jadwal";
import { KeteranganKirim } from "@/app/pwa/KeteranganKirim";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { dinamis } from "@/lib/i18n/dinamis";
import type { BulanJadwalHp, DataJadwalBulanHp } from "@/lib/spg/jadwal-bulan-queries";
import { cn } from "@/lib/utils";

const LIBUR = "__libur__";
const KOSONG = "__kosong__";

type Isi = { jenis: "KERJA"; kode: string } | { jenis: "LIBUR" } | null;

const keNilai = (i: Isi) => (i === null ? KOSONG : i.jenis === "LIBUR" ? LIBUR : i.kode);
const dariNilai = (v: string): Isi => (v === KOSONG ? null : v === LIBUR ? { jenis: "LIBUR" } : { jenis: "KERJA", kode: v });

const NADA: Record<string, string> = {
  DRAF: "bg-muted text-muted-foreground",
  DIAJUKAN: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  DISETUJUI: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  DITOLAK: "bg-destructive/10 text-destructive",
};

/**
 * Jadwal kerja BULANAN SPG (P7c) — dasar gaji pokoknya. SPG mengisi setiap hari masa kerjanya
 * (shift atau libur) untuk bulan ini dan bulan depan, lalu mengajukannya ke kantor. Mengubah
 * jadwal yang sudah disetujui membuatnya kembali menunggu persetujuan. Tanpa breakpoint layar
 * (aturan PWA): satu kolom selebar HP.
 */
export function IsiJadwalBulan({ data }: { data: DataJadwalBulanHp }) {
  const t = useTranslations("jadwalSpg.bulanan");
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <CalendarCheck className="h-4 w-4" aria-hidden />
        {t("judul")}
      </h2>
      <p className="text-sm text-muted-foreground">{t("isi")}</p>
      {data.bulan.map((b) => (
        <SatuBulan key={b.bulan} bulan={b} shift={data.shift} />
      ))}
    </section>
  );
}

function SatuBulan({ bulan, shift }: { bulan: BulanJadwalHp; shift: DataJadwalBulanHp["shift"] }) {
  const t = useTranslations("jadwalSpg.bulanan");
  const td = dinamis(useTranslations("jadwalSpg.bulanan"));
  // Pesan galat jadwal bulanan satu tempat dengan layar kantor (kode yang sama dari penulis yang sama).
  const te = dinamis(useTranslations("komisiSpg.jadwal.err"));
  const router = useRouter();
  const [sibuk, mulai] = useTransition();
  const awal = useMemo(() => new Map(bulan.hari.map((h) => [h.day, keNilai(h.isi)])), [bulan.hari]);
  const [isian, setIsian] = useState<Map<string, string>>(() => new Map(awal));

  const berubah = [...isian.entries()].filter(([d, v]) => awal.get(d) !== v);
  const bolehUbah = (h: BulanJadwalHp["hari"][number]) => !h.lewat && !h.diLuarMasa;
  const kosong = bulan.hari.filter((h) => !h.diLuarMasa && (isian.get(h.day) ?? KOSONG) === KOSONG);
  const sudahDiajukan = bulan.status === "DIAJUKAN";
  const alasanBelumAjukan =
    berubah.length > 0 ? t("simpanDulu") : kosong.length > 0 ? t("masihKosong", { n: kosong.length }) : sudahDiajukan ? t("sudahDiajukan") : bulan.status === "DISETUJUI" ? t("sudahDisetujui") : null;

  const jalankan = (kerja: () => Promise<{ ok: boolean; code?: string; hari?: string[] }>, pesan: string) =>
    mulai(async () => {
      try {
        const r = await kerja();
        if (!r.ok) {
          toast.error(te(r.code ?? "GAGAL"));
          if (r.code === "STATUS_BERUBAH" || r.code === "JADWAL_BERUBAH") router.refresh();
          return;
        }
        toast.success(pesan);
        router.refresh();
      } catch {
        toast.error(te("GAGAL"));
      }
    });

  return (
    <Card className="py-0">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="font-medium">{bulan.label}</p>
          <Badge variant="outline" className={cn("border-transparent", NADA[bulan.status ?? "DRAF"])}>
            {td(`status.${bulan.status ?? "DRAF"}`)}
          </Badge>
        </div>
        {bulan.status === "DITOLAK" && bulan.alasanTolak ? <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{t("ditolak", { alasan: bulan.alasanTolak })}</p> : null}
        {bulan.status === "DISETUJUI" ? <p className="text-xs text-muted-foreground">{t("ubahKembaliMenunggu")}</p> : null}

        <ul className="space-y-2">
          {bulan.hari
            .filter((h) => !h.diLuarMasa)
            .map((h) => (
              <li key={h.day} className="space-y-1">
                <span className={cn("block text-sm", h.lewat && "text-muted-foreground")}>{h.label}</span>
                <Select
                  value={isian.get(h.day) ?? KOSONG}
                  disabled={!bolehUbah(h) || sibuk}
                  onValueChange={(v) => setIsian((m) => new Map(m).set(h.day, v))}
                >
                  <SelectTrigger aria-label={h.label} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={KOSONG}>{t("belumDiisi")}</SelectItem>
                    {shift.map((s) => (
                      <SelectItem key={s.kode} value={s.kode}>
                        {t("shift", { label: s.label, mulai: s.mulai, selesai: s.selesai })}
                      </SelectItem>
                    ))}
                    <SelectItem value={LIBUR}>{t("libur")}</SelectItem>
                  </SelectContent>
                </Select>
              </li>
            ))}
        </ul>

        <div className="space-y-2">
          <Button
            className="w-full"
            variant="outline"
            disabled={sibuk || berubah.length === 0}
            onClick={() =>
              jalankan(
                () => simpanJadwalBulanSayaAction({ bulan: bulan.bulan, isian: berubah.map(([day, v]) => ({ day, isi: dariNilai(v) })) }),
                t("okSimpan"),
              )
            }
          >
            {sibuk ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {t("simpan", { n: berubah.length })}
          </Button>
          <Button className="w-full" disabled={sibuk || alasanBelumAjukan !== null} onClick={() => jalankan(() => ajukanJadwalBulanAction({ bulan: bulan.bulan }), t("okAjukan"))}>
            {t("ajukan")}
          </Button>
          <KeteranganKirim teks={alasanBelumAjukan} />
        </div>
      </CardContent>
    </Card>
  );
}
