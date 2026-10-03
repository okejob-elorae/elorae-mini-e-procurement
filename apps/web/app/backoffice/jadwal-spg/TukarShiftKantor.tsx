"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeftRight, Check, History, Loader2, X } from "lucide-react";
import { setujuiTukarShiftAction, tolakTukarShiftAction, type HasilTukarAksi } from "@/app/actions/spg-shift";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatDisplayDate } from "@/lib/date-only";
import { dinamis } from "@/lib/i18n/dinamis";
import { MAKS_ALASAN_TUKAR, type StatusTukar } from "@/lib/spg/shift";
import type { BarisTukarKantor, SelRingkas } from "@/lib/spg/shift-queries";

export const NADA_TUKAR: Record<StatusTukar, StatusTone> = {
  MENUNGGU_REKAN: "waiting",
  MENUNGGU_KANTOR: "waiting",
  DISETUJUI: "settled",
  DITOLAK_REKAN: "inactive",
  DITOLAK: "attention",
  DIBATALKAN: "inactive",
};

type Keputusan = { baris: BarisTukarKantor; setuju: boolean };

/**
 * Tab "Tukar shift" kantor: ajuan yang sudah disetujui rekan menunggu
 * keputusan (semua toko), lalu riwayat. Menyetujui menukar isi sel kedua orang
 * di setiap hari yang terlibat; jadwal diperiksa ulang di server — yang sudah
 * berubah sejak diajukan ditolak dengan alasannya.
 */
export function TukarShiftKantor({
  data,
  bolehUbah,
}: {
  data: { menunggu: BarisTukarKantor[]; riwayat: BarisTukarKantor[]; menungguRekan: number };
  bolehUbah: boolean;
}) {
  const t = useTranslations("jadwalSpg");
  const td = dinamis(t);
  const locale = useLocale();
  const router = useRouter();
  const [keputusan, setKeputusan] = useState<Keputusan | null>(null);
  const [catatan, setCatatan] = useState("");
  const [sibuk, mulai] = useTransition();

  const tanggal = (day: string) => formatDisplayDate(new Date(`${day}T00:00:00+07:00`), locale);
  const teksSel = (s: SelRingkas | null) =>
    !s ? t("kosong") : s.kind === "LIBUR" ? t("libur") : `${s.label} ${s.mulai ?? ""}–${s.selesai ?? ""}`;
  // Sesudah disetujui: isi sel bertukar; sel kosong dianggap libur.
  const sesudah = (s: SelRingkas | null) => (s ? teksSel(s) : t("libur"));

  const buka = (baris: BarisTukarKantor, setuju: boolean) => {
    setCatatan("");
    setKeputusan({ baris, setuju });
  };

  const teksGalat = (r: Extract<HasilTukarAksi, { ok: false }>) => td(`errTukar.${r.code}`);

  const putuskan = () => {
    const k = keputusan;
    if (!k) return;
    mulai(async () => {
      const r = k.setuju
        ? await setujuiTukarShiftAction({ swapId: k.baris.id, catatan })
        : await tolakTukarShiftAction({ swapId: k.baris.id, catatan });
      if (!r.ok) {
        toast.error(teksGalat(r));
        return;
      }
      toast.success(k.setuju ? t("tukarDisetujui") : t("tukarDitolak"));
      setKeputusan(null);
      router.refresh();
    });
  };

  const hari = (b: BarisTukarKantor, rinci: boolean) => (
    <ul className="space-y-1.5">
      {b.sel.map((s) => (
        <li key={s.day} className="text-sm">
          <span className="font-medium">{tanggal(s.day)}</span>
          {rinci ? (
            <span className="block text-xs text-muted-foreground">
              {b.pengaju}: {teksSel(s.pengaju)} → {sesudah(s.rekan)}
              <br />
              {b.rekan}: {teksSel(s.rekan)} → {sesudah(s.pengaju)}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );

  const catatanSah = catatan.trim().length <= MAKS_ALASAN_TUKAR && (keputusan?.setuju || catatan.trim().length > 0);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ArrowLeftRight className="h-5 w-5" aria-hidden />
            {t("menungguJudul", { count: data.menunggu.length })}
          </CardTitle>
          {data.menungguRekan > 0 ? <p className="text-sm text-muted-foreground">{t("menungguRekanInfo", { count: data.menungguRekan })}</p> : null}
        </CardHeader>
        <CardContent className={data.menunggu.length === 0 ? undefined : "px-0"}>
          {data.menunggu.length === 0 ? (
            <EmptyState icon={ArrowLeftRight} title={t("menungguKosongJudul")} description={t("menungguKosongIsi")} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("kolomTukar.toko")}</TableHead>
                    <TableHead>{t("kolomTukar.orang")}</TableHead>
                    <TableHead className="min-w-[260px]">{t("kolomTukar.hari")}</TableHead>
                    <TableHead className="min-w-[180px]">{t("kolomTukar.alasan")}</TableHead>
                    <TableHead>{t("kolomTukar.diajukan")}</TableHead>
                    {bolehUbah ? <TableHead className="text-right">{t("kolomTukar.aksi")}</TableHead> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.menunggu.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell className="whitespace-normal">{b.toko}</TableCell>
                      <TableCell className="whitespace-normal">
                        <p className="font-medium">{b.pengaju}</p>
                        <p className="text-xs text-muted-foreground">{t("denganRekan", { nama: b.rekan })}</p>
                      </TableCell>
                      <TableCell className="whitespace-normal">{hari(b, true)}</TableCell>
                      <TableCell className="whitespace-normal text-sm">{b.alasan ?? "—"}</TableCell>
                      <TableCell className="text-sm">
                        {b.diajukan}
                        {b.rekanMenjawab ? <span className="block text-xs text-muted-foreground">{t("rekanSetujuPada", { waktu: b.rekanMenjawab })}</span> : null}
                      </TableCell>
                      {bolehUbah ? (
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button size="sm" variant="outline" onClick={() => buka(b, false)} disabled={sibuk}>
                              <X className="mr-1 h-4 w-4" aria-hidden />
                              {t("tolak")}
                            </Button>
                            <Button size="sm" onClick={() => buka(b, true)} disabled={sibuk}>
                              <Check className="mr-1 h-4 w-4" aria-hidden />
                              {t("setujui")}
                            </Button>
                          </div>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" aria-hidden />
            {t("riwayatJudul")}
          </CardTitle>
        </CardHeader>
        <CardContent className={data.riwayat.length === 0 ? undefined : "px-0"}>
          {data.riwayat.length === 0 ? (
            <EmptyState icon={History} title={t("riwayatKosongJudul")} description={t("riwayatKosongIsi")} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("kolomTukar.toko")}</TableHead>
                    <TableHead>{t("kolomTukar.orang")}</TableHead>
                    <TableHead>{t("kolomTukar.hari")}</TableHead>
                    <TableHead>{t("kolomTukar.status")}</TableHead>
                    <TableHead className="min-w-[180px]">{t("kolomTukar.catatan")}</TableHead>
                    <TableHead>{t("kolomTukar.diputuskan")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.riwayat.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell className="whitespace-normal">{b.toko}</TableCell>
                      <TableCell className="whitespace-normal">
                        <p className="font-medium">{b.pengaju}</p>
                        <p className="text-xs text-muted-foreground">{t("denganRekan", { nama: b.rekan })}</p>
                      </TableCell>
                      <TableCell className="whitespace-normal">{hari(b, false)}</TableCell>
                      <TableCell>
                        <StatusPill tone={NADA_TUKAR[b.status]}>{td(`statusTukar.${b.status}`)}</StatusPill>
                      </TableCell>
                      <TableCell className="whitespace-normal text-sm">{b.catatan ?? b.alasan ?? "—"}</TableCell>
                      <TableCell className="text-sm">
                        {b.diputuskan ?? b.diajukan}
                        {b.diputuskanOleh ? <span className="block text-xs text-muted-foreground">{b.diputuskanOleh}</span> : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={keputusan !== null} onOpenChange={(o) => !o && !sibuk && setKeputusan(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{keputusan?.setuju ? t("setujuiJudul") : t("tolakJudul")}</DialogTitle>
            <DialogDescription>
              {keputusan ? t("keputusanIsi", { pengaju: keputusan.baris.pengaju, rekan: keputusan.baris.rekan, toko: keputusan.baris.toko }) : null}
            </DialogDescription>
          </DialogHeader>
          {keputusan ? (
            <div className="space-y-4">
              {keputusan.setuju ? (
                <div className="rounded-md border p-3">
                  <p className="mb-2 text-sm font-medium">{t("sesudahDisetujui")}</p>
                  {hari(keputusan.baris, true)}
                </div>
              ) : null}
              <div className="space-y-2">
                <Label htmlFor="catatan-tukar">{keputusan.setuju ? t("catatanOpsional") : t("catatanWajib")}</Label>
                <Textarea
                  id="catatan-tukar"
                  value={catatan}
                  onChange={(e) => setCatatan(e.target.value.slice(0, MAKS_ALASAN_TUKAR))}
                  rows={3}
                  disabled={sibuk}
                />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setKeputusan(null)} disabled={sibuk}>
              {t("batal")}
            </Button>
            <Button variant={keputusan?.setuju ? "default" : "destructive"} onClick={putuskan} disabled={sibuk || !catatanSah}>
              {sibuk ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {keputusan?.setuju ? t("setujui") : t("tolak")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
