"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, Loader2, Lock, LockOpen, Receipt } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatRupiah } from "@/lib/format/rupiah";
import { cn } from "@/lib/utils";
import { bukaRekapPpnAction, finalkanRekapPpnAction } from "@/app/actions/finance-pajak";
import type { RekapPpnLengkap, RingkasMasaPpn } from "@/lib/finance/pajak/masa-queries";
import { journalSourceLabel } from "../../journals/journal-source-label";
import { NavPajak, SpandukPajak, type AksesPajak } from "../_bersama/NavPajak";
import { labelMasa } from "../_bersama/akses";

type Props = {
  tahun: number;
  masaIni: string;
  masa: string | null;
  daftar: RingkasMasaPpn[];
  rincian: RekapPpnLengkap | null;
  statusPkp: string;
  rezimPph: string;
  akses: AksesPajak & { kelola: boolean };
  gagal: boolean;
};

function Angka({ judul, nilai, keterangan, nada }: { judul: string; nilai: number; keterangan?: string; nada?: "merah" | "hijau" }) {
  return (
    <Card className="gap-1 py-4">
      <CardContent className="px-4">
        <p className="text-sm text-muted-foreground">{judul}</p>
        <p className={cn("text-2xl font-semibold tabular-nums", nada === "merah" && "text-red-700 dark:text-red-300", nada === "hijau" && "text-emerald-700 dark:text-emerald-300")}>
          {formatRupiah(nilai)}
        </p>
        {keterangan ? <p className="text-xs text-muted-foreground">{keterangan}</p> : null}
      </CardContent>
    </Card>
  );
}

export function RekapPpnClient({ tahun, masaIni, masa, daftar, rincian, statusPkp, rezimPph, akses, gagal }: Props) {
  const t = useTranslations("financeTax.ppn");
  const tj = useTranslations("financeJournals");
  const locale = useLocale();
  const router = useRouter();
  const [pindah, mulaiPindah] = useTransition();
  const [pending, mulai] = useTransition();
  const [konfirmasi, setKonfirmasi] = useState(false);
  const [buka, setBuka] = useState(false);
  const [alasan, setAlasan] = useState("");

  const pergi = (q: string) => mulaiPindah(() => router.replace(`/backoffice/finance/pajak/ppn?${q}`, { scroll: false }));
  const tersimpan = rincian?.tersimpan ?? null;
  const final = tersimpan?.status === "FINAL";
  const r = rincian?.rekap;

  const pesanGagal = (kode: string, peran?: string) => (kode === "UNMAPPED_ROLE" ? t("err.UNMAPPED_ROLE", { peran: peran ?? "" }) : t.has(`err.${kode}`) ? t(`err.${kode}`) : t("err.GAGAL"));

  const finalkan = () =>
    mulai(async () => {
      if (!masa) return;
      const h = await finalkanRekapPpnAction({ masa });
      setKonfirmasi(false);
      if (!h.ok) {
        toast.error(pesanGagal(h.kode, "peran" in h ? h.peran : undefined));
        return;
      }
      toast.success(t("finalOk", { masa: labelMasa(masa, locale) }));
      router.refresh();
    });

  const bukaKembali = () =>
    mulai(async () => {
      if (!masa) return;
      const h = await bukaRekapPpnAction({ masa, alasan });
      if (!h.ok) {
        toast.error(pesanGagal(h.kode));
        return;
      }
      setBuka(false);
      setAlasan("");
      toast.success(t("bukaOk", { masa: labelMasa(masa, locale) }));
      router.refresh();
    });

  return (
    <div className="space-y-6">
      <PageHeader title={t("judul")} meta={t("meta", { tahun })} />
      <NavPajak aktif="ppn" akses={akses} />
      <SpandukPajak statusPkp={statusPkp} rezimPph={rezimPph} akses={akses} />

      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" aria-label={t("tahunSebelum")} onClick={() => pergi(`tahun=${tahun - 1}`)} disabled={pindah}>
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </Button>
        <p className="min-w-20 text-center font-medium tabular-nums">{tahun}</p>
        <Button
          variant="outline"
          size="icon"
          aria-label={t("tahunSesudah")}
          onClick={() => pergi(`tahun=${tahun + 1}`)}
          disabled={pindah || tahun >= Number(masaIni.slice(0, 4))}
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Button>
      </div>

      {masa && rincian && r ? (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 capitalize">
              <Receipt className="h-5 w-5" aria-hidden />
              {t("masaJudul", { masa: labelMasa(masa, locale) })}
              <StatusPill tone={final ? "settled" : "waiting"}>{final ? t("status.FINAL") : t("status.BELUM")}</StatusPill>
            </CardTitle>
            {akses.kelola ? (
              <div className="flex flex-wrap gap-2">
                {final ? (
                  <Button variant="outline" onClick={() => setBuka(true)} disabled={pending}>
                    <LockOpen className="h-4 w-4" aria-hidden />
                    {t("bukaKembali")}
                  </Button>
                ) : (
                  <Button onClick={() => setKonfirmasi(true)} disabled={pending || masa >= masaIni}>
                    <Lock className="h-4 w-4" aria-hidden />
                    {t("finalkan")}
                  </Button>
                )}
              </div>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-4">
            {!final && masa >= masaIni ? <p className="text-sm text-muted-foreground">{t("masaBerjalan")}</p> : null}
            {!rincian.akun.keluaran || !rincian.akun.masukan ? <p className="text-sm text-amber-700 dark:text-amber-300">{t("peranBelum")}</p> : null}
            {rincian.akun.sama ? <p className="text-sm text-destructive">{t("akunSama")}</p> : null}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Angka judul={t("kartu.keluaran")} nilai={r.keluaran} keterangan={t("kartu.dpp", { dpp: formatRupiah(r.keluaranDpp) })} />
              <Angka judul={t("kartu.masukan")} nilai={r.masukan} keterangan={t("kartu.dpp", { dpp: formatRupiah(r.masukanDpp) })} />
              <Angka judul={t("kartu.kompensasi")} nilai={r.kompensasi} keterangan={t("kartu.kompensasiKet")} />
              <Angka
                judul={r.saldo >= 0 ? t("kartu.kurangBayar") : t("kartu.lebihBayar")}
                nilai={Math.abs(r.saldo)}
                nada={r.saldo > 0 ? "merah" : r.saldo < 0 ? "hijau" : undefined}
                keterangan={r.saldo > 0 ? t("kartu.kurangBayarKet") : r.saldo < 0 ? t("kartu.lebihBayarKet") : undefined}
              />
            </div>
            {rincian.rincian.barisTanpaDpp > 0 ? (
              <p className="text-sm text-amber-700 dark:text-amber-300">{t("tanpaDppPerkiraan", { n: rincian.rincian.barisTanpaDpp })}</p>
            ) : null}
            {final && tersimpan ? (
              <p className="text-sm text-muted-foreground">
                {t("dibekukan")}
                {tersimpan.journalId ? (
                  <>
                    {" "}
                    <Link className="text-tautan hover:underline" href={`/backoffice/finance/journals/${tersimpan.journalId}`}>
                      {t("lihatJurnal")}
                    </Link>
                  </>
                ) : null}
              </p>
            ) : null}
            {rincian.rincian.perSumber.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("kolom.sumber")}</TableHead>
                      <TableHead className="text-right">{t("kolom.keluaran")}</TableHead>
                      <TableHead className="text-right">{t("kolom.masukan")}</TableHead>
                      <TableHead className="text-right">{t("kolom.baris")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rincian.rincian.perSumber.map((s) => (
                      <TableRow key={s.sourceType ?? "manual"}>
                        <TableCell>{s.sourceType ? journalSourceLabel(tj, s.sourceType) : t("manual")}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatRupiah(s.keluaran)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatRupiah(s.masukan)}</TableCell>
                        <TableCell className="text-right tabular-nums">{s.baris}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("tanpaBaris")}</p>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" aria-hidden />
            {t("daftar", { tahun })}
          </CardTitle>
        </CardHeader>
        <CardContent className={pindah ? "opacity-60 transition-opacity" : undefined}>
          {gagal ? (
            <p className="text-sm text-destructive">{t("gagal")}</p>
          ) : daftar.length === 0 ? (
            <EmptyState icon={Receipt} title={t("kosong", { tahun })} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("kolom.masa")}</TableHead>
                    <TableHead className="text-right">{t("kolom.keluaran")}</TableHead>
                    <TableHead className="text-right">{t("kolom.masukan")}</TableHead>
                    <TableHead className="text-right">{t("kolom.saldo")}</TableHead>
                    <TableHead className="hidden text-right 2xl:table-cell">{t("kolom.disetor")}</TableHead>
                    <TableHead>{t("kolom.status")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {daftar.map((m) => (
                    <TableRow key={m.masa} className={cn("cursor-pointer", m.masa === masa && "bg-muted/60")} onClick={() => pergi(`masa=${m.masa}`)}>
                      <TableCell className="capitalize">
                        <Link className="font-medium text-tautan hover:underline" href={`/backoffice/finance/pajak/ppn?masa=${m.masa}`} replace scroll={false}>
                          {labelMasa(m.masa, locale)}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatRupiah(m.keluaran)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatRupiah(m.masukan)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {m.saldo == null ? (
                          <span className="text-muted-foreground">{formatRupiah(m.keluaran - m.masukan)}*</span>
                        ) : (
                          formatRupiah(m.saldo)
                        )}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums 2xl:table-cell">{formatRupiah(m.disetor)}</TableCell>
                      <TableCell>
                        <StatusPill tone={m.status === "FINAL" ? "settled" : m.masa < masaIni ? "waiting" : "inactive"}>{t(`status.${m.status}`)}</StatusPill>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="mt-2 text-xs text-muted-foreground">{t("bintang")}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={konfirmasi} onOpenChange={(v) => !pending && setKonfirmasi(v)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("konfirmasiJudul", { masa: masa ? labelMasa(masa, locale) : "" })}</AlertDialogTitle>
            <AlertDialogDescription>{r ? t("konfirmasiIsi", { saldo: formatRupiah(Math.abs(r.saldo)), arah: r.saldo >= 0 ? t("kurang") : t("lebih") }) : null}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{t("batal")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                finalkan();
              }}
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {t("finalkan")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={buka} onOpenChange={(v) => !pending && setBuka(v)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("bukaJudul", { masa: masa ? labelMasa(masa, locale) : "" })}</DialogTitle>
            <DialogDescription>{t("bukaIsi")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="alasan-buka-ppn">{t("alasan")}</Label>
            <Textarea id="alasan-buka-ppn" rows={3} maxLength={500} value={alasan} onChange={(e) => setAlasan(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBuka(false)} disabled={pending}>
              {t("batal")}
            </Button>
            <Button variant="destructive" onClick={bukaKembali} disabled={pending || alasan.trim().length < 5}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {t("bukaKembali")}
            </Button>
          </DialogFooter>
          {alasan.trim().length < 5 ? <p className="text-xs text-muted-foreground">{t("alasanMin")}</p> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
