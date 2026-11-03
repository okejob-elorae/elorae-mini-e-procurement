"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CalendarCheck, Loader2 } from "lucide-react";
import { bukaLagiJadwalBulanAction, setujuiJadwalBulanAction, tolakJadwalBulanAction } from "@/app/actions/spg-komisi-jadwal";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { dinamis } from "@/lib/i18n/dinamis";
import type { BarisJadwalBulanKantor } from "@/lib/spg/jadwal-bulan-queries";

const NADA: Record<string, StatusTone> = { DRAF: "inactive", DIAJUKAN: "waiting", DISETUJUI: "settled", DITOLAK: "attention" };

const hariLabel = (hari: readonly string[]) =>
  hari
    .map((d) => new Date(`${d}T00:00:00+07:00`).toLocaleDateString("id-ID", { day: "numeric", month: "short", timeZone: "Asia/Jakarta" }))
    .join(", ");

/**
 * Jadwal kerja bulanan SPG (P7c) — dasar gaji pokoknya. Penyetuju melihat hari kosong, hari libur
 * yang dikerjakan, check-in di luar radius, dan hari yang berubah sejak disetujui sebelum memutuskan.
 * Tombol = `spg_schedules:approve`, sama dengan aksinya.
 */
export function JadwalBulanKantorCard({
  baris,
  bolehSetujui,
  label,
}: {
  baris: BarisJadwalBulanKantor[];
  bolehSetujui: boolean;
  label: (b: string) => string;
}) {
  const t = useTranslations("komisiSpg.jadwal");
  const td = dinamis(useTranslations("komisiSpg.jadwal"));
  const router = useRouter();
  const [sibuk, mulai] = useTransition();
  const [dialog, setDialog] = useState<{ jenis: "TOLAK" | "BUKA"; b: BarisJadwalBulanKantor } | null>(null);
  const [alasan, setAlasan] = useState("");

  const jalankan = (kerja: () => Promise<{ ok: boolean; code?: string }>, pesan: string) =>
    mulai(async () => {
      try {
        const r = await kerja();
        if (!r.ok) {
          toast.error(td(`err.${r.code}`));
          if (r.code === "STATUS_BERUBAH" || r.code === "JADWAL_BERUBAH") router.refresh();
          return;
        }
        toast.success(pesan);
        setDialog(null);
        setAlasan("");
        router.refresh();
      } catch {
        toast.error(td("err.GAGAL"));
      }
    });

  return (
    <Card id="jadwal">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarCheck className="h-5 w-5" aria-hidden />
          {t("judul")}
        </CardTitle>
        <CardDescription>{t("isi")}</CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("kolom.spg")}</TableHead>
                <TableHead>{t("kolom.bulan")}</TableHead>
                <TableHead className="text-right">{t("kolom.hariKerja")}</TableHead>
                <TableHead>{t("kolom.perhatian")}</TableHead>
                <TableHead>{t("kolom.status")}</TableHead>
                {bolehSetujui ? <TableHead className="text-right">{t("kolom.aksi")}</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {baris.map((b) => (
                <TableRow key={`${b.userId}:${b.bulan}`}>
                  <TableCell className="min-w-[10rem] whitespace-normal">
                    <span className="font-medium">{b.nama}</span>
                    <span className="block text-xs text-muted-foreground">{b.namaToko}</span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{label(b.bulan)}</TableCell>
                  <TableCell className="text-right tabular-nums">{b.hariKerja}</TableCell>
                  <TableCell className="min-w-[14rem] whitespace-normal text-xs">
                    {b.hariKosong.length > 0 ? <span className="block text-amber-800 dark:text-amber-300">{t("kosong", { hari: hariLabel(b.hariKosong) })}</span> : null}
                    {b.liburDenganCheckin.length > 0 ? <span className="block">{t("liburMasuk", { hari: hariLabel(b.liburDenganCheckin) })}</span> : null}
                    {b.luarRadius.length > 0 ? <span className="block text-amber-800 dark:text-amber-300">{t("luarRadius", { hari: hariLabel(b.luarRadius) })}</span> : null}
                    {b.berubahSejakDisetujui.length > 0 ? (
                      <span className="block">{t("berubah", { hari: hariLabel(b.berubahSejakDisetujui) })}</span>
                    ) : null}
                    {b.hariKosong.length + b.liburDenganCheckin.length + b.luarRadius.length + b.berubahSejakDisetujui.length === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <StatusPill tone={NADA[b.status] ?? "inactive"}>{td(`status.${b.status}`)}</StatusPill>
                  </TableCell>
                  {bolehSetujui ? (
                    <TableCell className="text-right">
                      <span className="inline-flex flex-wrap justify-end gap-2">
                        {b.status === "DIAJUKAN" ? (
                          <>
                            <Button
                              size="sm"
                              disabled={sibuk}
                              onClick={() => jalankan(() => setujuiJadwalBulanAction({ userId: b.userId, bulan: b.bulan, versi: b.versi }), t("okSetuju"))}
                            >
                              {t("setujui")}
                            </Button>
                            <Button size="sm" variant="outline" disabled={sibuk} onClick={() => setDialog({ jenis: "TOLAK", b })}>
                              {t("tolak")}
                            </Button>
                          </>
                        ) : b.status === "DISETUJUI" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={sibuk || b.sudahDibayar}
                            title={b.sudahDibayar ? t("sudahDibayar") : undefined}
                            onClick={() => setDialog({ jenis: "BUKA", b })}
                          >
                            {t("bukaLagi")}
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">{t("menungguSpg")}</span>
                        )}
                      </span>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      <Dialog open={dialog !== null} onOpenChange={(o) => !o && !sibuk && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog?.jenis === "BUKA" ? t("bukaJudul", { nama: dialog.b.nama }) : t("tolakJudul", { nama: dialog?.b.nama ?? "" })}</DialogTitle>
            <DialogDescription>{dialog?.jenis === "BUKA" ? t("bukaIsi") : t("tolakIsi")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="jadwal-alasan">{t("alasan")}</Label>
            <Textarea id="jadwal-alasan" rows={3} maxLength={300} value={alasan} onChange={(e) => setAlasan(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={sibuk} onClick={() => setDialog(null)}>
              {t("batal")}
            </Button>
            <Button
              disabled={sibuk || !alasan.trim() || dialog === null}
              onClick={() => {
                const d = dialog;
                if (!d) return;
                const isi = { userId: d.b.userId, bulan: d.b.bulan, versi: d.b.versi, alasan };
                jalankan(
                  () => (d.jenis === "BUKA" ? bukaLagiJadwalBulanAction(isi) : tolakJadwalBulanAction(isi)),
                  d.jenis === "BUKA" ? t("okBuka") : t("okTolak"),
                );
              }}
            >
              {sibuk ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {dialog?.jenis === "BUKA" ? t("bukaLagi") : t("tolak")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
