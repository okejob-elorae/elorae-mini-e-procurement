"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, BookText, CalendarRange, History, Loader2, Pause, Pencil, Play, Send, Trash2 } from "lucide-react";
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
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDisplayDate, formatDisplayDateTime } from "@/lib/date-only";
import { formatRupiah } from "@/lib/format/rupiah";
import { auditActionLabel } from "@/lib/audit/action-label";
import { labelKanalJurnal } from "@/lib/finance/journals/kanal";
import { bacaKunciBulan, labelBulan } from "@/lib/finance/periode/periode";
import type { RincianTemplat } from "@/lib/finance/berulang/queries";
import { aktifkanTemplatAction, hapusTemplatAction, hentikanTemplatAction, postingBerulangAction } from "@/app/actions/finance-berulang";
import { nadaKeadaanTemplat } from "../tampilan";
import { pesanGalatBerulang } from "../pesan";

type Props = { templat: RincianTemplat; penggunaId: string; bolehMengelola: boolean };

export function RincianTemplatClient({ templat: t0, penggunaId, bolehMengelola }: Props) {
  const t = useTranslations("jurnalBerulang");
  const tAudit = useTranslations("auditActions");
  const locale = useLocale();
  const router = useRouter();
  const [pending, mulai] = useTransition();
  const [hapus, setHapus] = useState(false);

  const menunggu = t0.keadaan === "MENUNGGU_PERSETUJUAN";
  const dihentikan = t0.keadaan === "DIHENTIKAN";
  const aktif = t0.keadaan === "AKTIF";
  const pembuatSama = menunggu && t0.pengubahTerakhirId === penggunaId;
  const pernahDiposting = t0.jurnal.length > 0;
  const bulan = (k: string) => {
    const tb = bacaKunciBulan(k);
    return tb ? labelBulan(tb, locale) : k;
  };
  const totalDebit = t0.baris.reduce((s, b) => s + Math.round(b.debit * 100), 0) / 100;
  const totalKredit = t0.baris.reduce((s, b) => s + Math.round(b.kredit * 100), 0) / 100;

  const jalankan = (aksi: () => Promise<{ ok: boolean; kode?: string }>, sukses: (r: Record<string, unknown>) => string, kePindah?: string) =>
    mulai(async () => {
      const r = (await aksi()) as { ok: boolean; kode?: string } & Record<string, unknown>;
      if (!r.ok) {
        toast.error(pesanGalatBerulang(t, r.kode ?? "GAGAL"));
        return;
      }
      toast.success(sukses(r));
      if (kePindah) router.push(kePindah);
      router.refresh();
    });

  const ringkasPosting = (p: unknown): string => {
    const r = p as { diposting?: number; dilewati?: unknown[]; gagal?: unknown[] } | undefined;
    if (!r) return "";
    return ` ${t("posting.hasil", { n: r.diposting ?? 0 })}${r.gagal?.length ? ` ${t("posting.adaGagal")}` : ""}`;
  };

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild>
        <Link href="/backoffice/finance/jurnal-berulang">
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t("kembali")}
        </Link>
      </Button>
      <PageHeader
        title={t0.nama}
        meta={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusPill tone={nadaKeadaanTemplat(t0.keadaan)}>{t(`keadaan.${t0.keadaan}`)}</StatusPill>
            <span>{t("setiapTanggal", { hari: t0.hari })}</span>
            <span>· {formatRupiah(t0.total)}</span>
            {t0.balikOtomatis ? <span>· {t("akrual")}</span> : null}
          </span>
        }
        actions={
          bolehMengelola ? (
            <>
              {menunggu || dihentikan ? (
                <Button
                  disabled={pending || pembuatSama}
                  title={pembuatSama ? t("menungguOrangLain") : undefined}
                  onClick={() =>
                    jalankan(
                      () => aktifkanTemplatAction({ id: t0.id }),
                      (r) => (r.disetujui ? t("disetujui") : t("dilanjutkan")) + ringkasPosting(r.posting),
                    )
                  }
                >
                  {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                  {menunggu ? t("setujui") : t("lanjutkan")}
                </Button>
              ) : null}
              {aktif ? (
                <>
                  <Button
                    variant="outline"
                    disabled={pending || t0.tertunda === 0}
                    onClick={() => jalankan(() => postingBerulangAction({ templatId: t0.id }), (r) => t("posting.hasil", { n: Number(r.diposting ?? 0) }))}
                  >
                    <Send className="mr-2 h-4 w-4" />
                    {t("postingSekarang")}
                  </Button>
                  <Button variant="outline" disabled={pending} onClick={() => jalankan(() => hentikanTemplatAction({ id: t0.id }), () => t("dihentikan"))}>
                    <Pause className="mr-2 h-4 w-4" />
                    {t("hentikan")}
                  </Button>
                </>
              ) : null}
              <Button variant="outline" asChild>
                <Link href={`/backoffice/finance/jurnal-berulang/${t0.id}/ubah`}>
                  <Pencil className="mr-2 h-4 w-4" />
                  {t("ubah")}
                </Link>
              </Button>
              {!pernahDiposting ? (
                <Button variant="destructive" disabled={pending} onClick={() => setHapus(true)}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  {t("hapus")}
                </Button>
              ) : null}
            </>
          ) : null
        }
      />

      {pembuatSama ? <p className="text-sm text-muted-foreground">{t("menungguOrangLain")}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("rinci.isi")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">{t("form.mulai")}</dt>
              <dd>{formatDisplayDate(t0.mulai, locale)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("form.selesai")}</dt>
              <dd>{t0.selesai ? formatDisplayDate(t0.selesai, locale) : t("tanpaAkhir")}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("kolom.berikutnya")}</dt>
              <dd>{t0.postingBerikutnya ? formatDisplayDate(t0.postingBerikutnya, locale) : "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("rinci.dibuat")}</dt>
              <dd>{t0.dibuatOleh ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("rinci.diubah")}</dt>
              <dd>{t0.pengubahTerakhir ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("kolom.disetujui")}</dt>
              <dd>{t0.disetujuiOleh ?? "—"}</dd>
            </div>
          </dl>
          {t0.keterangan ? <p className="text-sm whitespace-pre-line">{t0.keterangan}</p> : null}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[200px]">{t("form.akun")}</TableHead>
                  <TableHead className="hidden 2xl:table-cell">{t("form.kanal")}</TableHead>
                  <TableHead>{t("form.memo")}</TableHead>
                  <TableHead className="text-right">{t("form.debit")}</TableHead>
                  <TableHead className="text-right">{t("form.kredit")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {t0.baris.map((b, i) => (
                  <TableRow key={i}>
                    <TableCell className="whitespace-normal">
                      <span className="mr-2 font-mono text-sm">{b.akunKode}</span>
                      {b.akunNama}
                    </TableCell>
                    <TableCell className="hidden 2xl:table-cell">{b.kanal ? labelKanalJurnal(b.kanal) : "—"}</TableCell>
                    <TableCell className="whitespace-normal text-muted-foreground">{b.memo ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.debit > 0 ? formatRupiah(b.debit) : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.kredit > 0 ? formatRupiah(b.kredit) : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={2} className="font-medium">
                    {t("rinci.total")}
                  </TableCell>
                  <TableCell className="hidden 2xl:table-cell" />
                  <TableCell className="text-right font-medium tabular-nums">{formatRupiah(totalDebit)}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatRupiah(totalKredit)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarRange className="h-5 w-5" />
            {t("rinci.bulan")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {t0.bulan.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("rinci.belumJatuhTempo")}</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {t0.bulan.map((b) => (
                <li key={b.periode} className="flex flex-wrap items-center gap-3">
                  <span className="w-40">{bulan(b.periode)}</span>
                  <span className="text-muted-foreground">{formatDisplayDate(b.tanggal, locale)}</span>
                  <StatusPill tone={b.keadaan === "DIPOSTING" ? "settled" : b.keadaan === "TERTUNDA" ? "waiting" : "inactive"}>{t(`keadaanBulan.${b.keadaan}`)}</StatusPill>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookText className="h-5 w-5" />
            {t("rinci.jurnal")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {t0.jurnal.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("rinci.tanpaJurnal")}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("rinci.kolom.tanggal")}</TableHead>
                    <TableHead>{t("rinci.kolom.bulan")}</TableHead>
                    <TableHead>{t("rinci.kolom.jenis")}</TableHead>
                    <TableHead className="text-right">{t("rinci.kolom.total")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {t0.jurnal.map((j) => (
                    <TableRow key={j.id}>
                      <TableCell className="whitespace-nowrap">
                        <Link href={`/backoffice/finance/journals/${j.id}`} className="underline underline-offset-4">
                          {formatDisplayDate(j.tanggal, locale)}
                        </Link>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{bulan(j.periode)}</TableCell>
                      <TableCell>{j.jenis === "RECURRING_REVERSAL" ? t("rinci.jenisBalik") : t("rinci.jenisPosting")}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatRupiah(j.total)}</TableCell>
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
            <History className="h-5 w-5" />
            {t("rinci.riwayat")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm">
            {t0.riwayat.map((r, i) => (
              <li key={i} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
                <span className="text-muted-foreground sm:w-44 sm:shrink-0">{formatDisplayDateTime(r.waktu, locale)}</span>
                <span>
                  {auditActionLabel(tAudit, r.aksi, "RecurringJournal")}
                  {r.olehNama ? ` · ${r.olehNama}` : ""}
                  {r.alasan ? ` — ${r.alasan}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <AlertDialog open={hapus} onOpenChange={(v) => !pending && setHapus(v)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("hapusJudul")}</AlertDialogTitle>
            <AlertDialogDescription>{t("hapusIsi", { nama: t0.nama })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{t("batal")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                jalankan(() => hapusTemplatAction({ id: t0.id }), () => t("terhapus"), "/backoffice/finance/jurnal-berulang");
              }}
            >
              {t("hapus")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
