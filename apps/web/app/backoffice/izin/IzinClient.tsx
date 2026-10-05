"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CalendarOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { dinamis, type TerjemahDinamis } from "@/lib/i18n/dinamis";
import { JENIS_IZIN, STATUS_IZIN, type JenisIzin, type StatusIzin } from "@/lib/salesman/izin";
import type { BarisIzinKantor } from "@/lib/salesman/izin-queries";
import { cn } from "@/lib/utils";
import { IkonJenisIzin, nadaJenisIzin, nadaStatusIzin } from "@/app/pwa/absen/tampilan-izin";
import { TombolKeputusanIzin } from "./TombolKeputusanIzin";

const SEMUA = "__semua__";
const ALAMAT = "/backoffice/izin";

type Saring = { status: StatusIzin | null; jenis: JenisIzin | null; userId: string | null; bulan: string | null };

const labelStatus = (td: TerjemahDinamis, b: BarisIzinKantor) => (b.ditarikSendiri ? td("status.DITARIK") : td(`status.${b.status}`));

export function IzinClient({
  saring,
  pilihanBulan,
  orang,
  data,
  terpilih,
  idDiminta,
  bolehPutuskan,
  penggunaId,
}: {
  saring: Saring;
  pilihanBulan: { kunci: string; label: string }[];
  orang: { id: string; nama: string }[];
  data: { baris: BarisIzinKantor[]; perStatus: Record<StatusIzin, number>; terpotong: boolean };
  terpilih: BarisIzinKantor | null;
  idDiminta: string | null;
  bolehPutuskan: boolean;
  penggunaId: string;
}) {
  const t = useTranslations("izin");
  const td = dinamis(t);
  const router = useRouter();
  const [dibuka, setDibuka] = useState<BarisIzinKantor | null>(null);
  // Dari tautan lonceng (`?id=`): satu ajuan terbuka di atas daftar sampai ditutup.
  // Diingat PER id — tautan lonceng berikutnya untuk ajuan lain harus terbuka lagi.
  const [ditutupId, setDitutupId] = useState<string | null>(null);

  const alamat = (ubah: Partial<Saring>) => {
    const s = { ...saring, ...ubah };
    const q = new URLSearchParams();
    if (s.status) q.set("status", s.status);
    if (s.jenis) q.set("jenis", s.jenis);
    if (s.userId) q.set("orang", s.userId);
    if (s.bulan) q.set("bulan", s.bulan);
    const qs = q.toString();
    return qs ? `${ALAMAT}?${qs}` : ALAMAT;
  };
  const pindah = (ubah: Partial<Saring>) => router.push(alamat(ubah));

  // Baris terbaru dari daftar menang atas salinan `terpilih` (sesudah keputusan, keduanya disegarkan).
  const rincian =
    dibuka !== null
      ? (data.baris.find((b) => b.id === dibuka.id) ?? (terpilih?.id === dibuka.id ? terpilih : dibuka))
      : terpilih && ditutupId !== terpilih.id
        ? (data.baris.find((b) => b.id === terpilih.id) ?? terpilih)
        : null;

  const tutupRincian = () => {
    setDibuka(null);
    if (idDiminta) {
      setDitutupId(idDiminta);
      router.replace(alamat({}), { scroll: false });
    }
  };

  const menunggu = data.perStatus.DIAJUKAN;
  const disaring = Object.values(saring).some(Boolean);
  const ringkas = (b: BarisIzinKantor) => `${td(`jenis.${b.jenis}`)} · ${b.rentang} · ${b.nama}`;

  return (
    <div className="space-y-6">
      <PageHeader title={t("judul")} meta={t("ringkasMeta", { menunggu })} />

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <Select value={saring.bulan ?? SEMUA} onValueChange={(v) => pindah({ bulan: v === SEMUA ? null : v })}>
          <SelectTrigger className="w-full sm:w-48" aria-label={t("saringBulan")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SEMUA}>{t("semuaBulan")}</SelectItem>
            {pilihanBulan.map((b) => (
              <SelectItem key={b.kunci} value={b.kunci}>
                {b.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={saring.jenis ?? SEMUA} onValueChange={(v) => pindah({ jenis: v === SEMUA ? null : (v as JenisIzin) })}>
          <SelectTrigger className="w-full sm:w-40" aria-label={t("saringJenis")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SEMUA}>{t("semuaJenis")}</SelectItem>
            {JENIS_IZIN.map((j) => (
              <SelectItem key={j} value={j}>
                {td(`jenis.${j}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={saring.userId ?? SEMUA} onValueChange={(v) => pindah({ userId: v === SEMUA ? null : v })}>
          <SelectTrigger className="w-full sm:w-56" aria-label={t("saringOrang")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SEMUA}>{t("semuaOrang")}</SelectItem>
            {orang.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.nama}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {STATUS_IZIN.map((s) => (
          <Button
            key={s}
            variant="outline"
            aria-pressed={saring.status === s}
            onClick={() => pindah({ status: saring.status === s ? null : s })}
            className={cn(
              "h-auto flex-col items-start gap-0.5 whitespace-normal px-4 py-3 text-left",
              saring.status === s && "border-primary ring-1 ring-primary",
            )}
          >
            <span className="text-xs font-normal text-muted-foreground">{td(`status.${s}`)}</span>
            <span className={cn("text-lg font-semibold tabular-nums", s === "DIAJUKAN" && data.perStatus[s] > 0 && "text-amber-700 dark:text-amber-400")}>
              {data.perStatus[s]}
            </span>
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarOff className="h-5 w-5" />
            {t("daftarJudul")}
          </CardTitle>
        </CardHeader>
        <CardContent className={data.baris.length === 0 ? undefined : "px-0"}>
          {data.baris.length === 0 ? (
            <EmptyState
              icon={CalendarOff}
              title={disaring ? t("kosongSaringJudul") : t("kosongJudul")}
              description={disaring ? t("kosongSaringIsi") : t("kosongIsi")}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("kolom.nama")}</TableHead>
                    <TableHead>{t("kolom.jenis")}</TableHead>
                    <TableHead>{t("kolom.tanggal")}</TableHead>
                    <TableHead>{t("kolom.alasan")}</TableHead>
                    <TableHead>{t("kolom.foto")}</TableHead>
                    <TableHead>{t("kolom.status")}</TableHead>
                    <TableHead className="sticky right-0 bg-card text-right">
                      <span className="sr-only">{t("kolom.aksi")}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.baris.map((b) => (
                    <TableRow key={b.id} className={cn(b.status === "DIAJUKAN" && "bg-amber-500/[0.05]")}>
                      <TableCell className="min-w-[9rem] whitespace-normal">
                        <Button
                          variant="link"
                          className="h-auto p-0 text-left font-medium whitespace-normal"
                          onClick={() => setDibuka(b)}
                        >
                          {b.nama}
                        </Button>
                        <span className="block text-xs text-muted-foreground">{t("diajukanPada", { waktu: b.diajukan })}</span>
                      </TableCell>
                      <TableCell>
                        <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", nadaJenisIzin(b.jenis))}>
                          <IkonJenisIzin jenis={b.jenis} className="h-3.5 w-3.5" />
                          {td(`jenis.${b.jenis}`)}
                        </span>
                      </TableCell>
                      <TableCell className="min-w-[10rem] whitespace-normal">
                        <span className="block font-medium">{b.rentang}</span>
                        <span className="block text-xs text-muted-foreground">{t("hariKerja", { n: b.hariKerja })}</span>
                        {b.cuti && b.status === "DIAJUKAN" ? (
                          <span className="block text-xs text-muted-foreground">
                            {t("kuotaSingkat", { tahun: b.cuti.tahun, terpakai: b.cuti.disetujui, kuota: b.cuti.kuota })}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="min-w-[12rem] max-w-[20rem] whitespace-normal">
                        <span className="line-clamp-2 text-sm">{b.alasan}</span>
                      </TableCell>
                      <TableCell>
                        {b.fotoUrl ? (
                          <a href={b.fotoUrl} target="_blank" rel="noopener noreferrer" aria-label={t("lihatFoto")}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={b.fotoUrl} alt="" loading="lazy" className="h-10 w-10 rounded-md border object-cover" />
                          </a>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="min-w-[9rem] whitespace-normal">
                        <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", nadaStatusIzin(b.status))}>
                          {labelStatus(td, b)}
                        </span>
                        {b.catatanKantor ? (
                          <span className={cn("mt-1 block text-xs", b.status === "DISETUJUI" ? "text-muted-foreground" : "text-destructive")}>
                            {b.catatanKantor}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="sticky right-0 bg-card text-right">
                        <TombolKeputusanIzin
                          id={b.id}
                          status={b.status}
                          ringkas={ringkas(b)}
                          milikSendiri={b.userId === penggunaId}
                          bolehPutuskan={bolehPutuskan}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {data.terpotong ? <p className="px-6 pt-3 text-xs text-muted-foreground">{t("terpotong")}</p> : null}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={rincian !== null} onOpenChange={(v) => !v && tutupRincian()}>
        <DialogContent className="max-w-lg">
          {rincian ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <IkonJenisIzin jenis={rincian.jenis} className="h-5 w-5" />
                  {td(`jenis.${rincian.jenis}`)} · {rincian.nama}
                </DialogTitle>
                <DialogDescription>
                  {rincian.rentang} · {t("hariKerja", { n: rincian.hariKerja })}
                </DialogDescription>
              </DialogHeader>
              <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2 text-sm">
                <dt className="text-muted-foreground">{t("kolom.status")}</dt>
                <dd>
                  <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", nadaStatusIzin(rincian.status))}>
                    {labelStatus(td, rincian)}
                  </span>
                </dd>
                <dt className="text-muted-foreground">{t("kolom.alasan")}</dt>
                <dd className="whitespace-pre-wrap">{rincian.alasan}</dd>
                <dt className="text-muted-foreground">{t("rincian.diajukan")}</dt>
                <dd>{rincian.diajukan}</dd>
                {rincian.diputuskan ? (
                  <>
                    <dt className="text-muted-foreground">{t("rincian.diputuskan")}</dt>
                    <dd>
                      {rincian.diputuskan}
                      {rincian.diputuskanOleh ? ` · ${rincian.diputuskanOleh}` : ""}
                    </dd>
                  </>
                ) : null}
                {rincian.catatanKantor ? (
                  <>
                    <dt className="text-muted-foreground">{t("rincian.catatan")}</dt>
                    <dd className="whitespace-pre-wrap">{rincian.catatanKantor}</dd>
                  </>
                ) : null}
                {rincian.cuti ? (
                  <>
                    <dt className="text-muted-foreground">{t("rincian.kuota", { tahun: rincian.cuti.tahun })}</dt>
                    <dd>
                      {t("rincian.kuotaIsi", {
                        kuota: rincian.cuti.kuota,
                        disetujui: rincian.cuti.disetujui,
                        menunggu: rincian.cuti.menunggu,
                        sisa: rincian.cuti.sisa,
                      })}
                    </dd>
                  </>
                ) : null}
              </dl>
              {rincian.fotoUrl ? (
                <a href={rincian.fotoUrl} target="_blank" rel="noopener noreferrer" className="block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={rincian.fotoUrl} alt={t("lihatFoto")} className="max-h-72 w-full rounded-lg border object-contain" />
                </a>
              ) : rincian.jenis === "SAKIT" && rincian.hariKerja > 1 ? (
                <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">{t("tanpaSurat")}</p>
              ) : null}
              <div className="flex justify-end">
                <TombolKeputusanIzin
                  id={rincian.id}
                  status={rincian.status}
                  ringkas={ringkas(rincian)}
                  milikSendiri={rincian.userId === penggunaId}
                  bolehPutuskan={bolehPutuskan}
                  tata="baris"
                  onSelesai={tutupRincian}
                />
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
