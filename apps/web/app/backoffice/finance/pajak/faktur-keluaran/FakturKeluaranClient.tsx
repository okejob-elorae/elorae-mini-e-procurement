"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Download, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { RentangTanggalInput } from "@/components/ui/rentang-tanggal-input";
import { StatusPill } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatRupiah } from "@/lib/format/rupiah";
import { labelTanggal } from "@/lib/tanggal-isian";
import { eksporFakturKeluaranAction } from "@/app/actions/finance-pajak";
import type { BarisEkspor, SertakanFaktur } from "@/lib/finance/pajak/coretax-queries";
import { NavPajak, SpandukPajak, type AksesPajak } from "../_bersama/NavPajak";

type Props = {
  dari: string;
  sampai: string;
  sertakan: SertakanFaktur;
  baris: BarisEkspor[];
  terpotong: boolean;
  adaNpwp: boolean;
  statusPkp: string;
  rezimPph: string;
  akses: AksesPajak & { kelola: boolean };
  gagal: boolean;
};

function unduh(isi: string, namaBerkas: string) {
  const url = URL.createObjectURL(new Blob([isi], { type: "application/xml;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = namaBerkas;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function FakturKeluaranClient({ dari, sampai, sertakan, baris, terpotong, adaNpwp, statusPkp, rezimPph, akses, gagal }: Props) {
  const t = useTranslations("financeTax.faktur");
  const locale = useLocale();
  const router = useRouter();
  const [pindah, mulaiPindah] = useTransition();
  const [mengekspor, setMengekspor] = useState(false);

  const pergi = (q: { dari: string; sampai: string; sertakan: SertakanFaktur }) =>
    mulaiPindah(() =>
      router.replace(`/backoffice/finance/pajak/faktur-keluaran?${new URLSearchParams({ dari: q.dari, sampai: q.sampai, sertakan: q.sertakan }).toString()}`, {
        scroll: false,
      }),
    );

  const peringatan = baris.flatMap((b) => b.peringatan);
  const jumlahDpp = baris.reduce((s, b) => s + b.dpp, 0);
  const jumlahPpn = baris.reduce((s, b) => s + b.ppn, 0);

  const ekspor = async () => {
    setMengekspor(true);
    try {
      const r = await eksporFakturKeluaranAction({ dari, sampai, sertakan });
      if (!r.ok) {
        toast.error(t.has(`err.${r.kode}`) ? t(`err.${r.kode}`) : t("err.GAGAL"));
        return;
      }
      unduh(r.isi, r.namaBerkas);
      toast.success(t("eksporOk", { n: r.jumlah }));
    } finally {
      setMengekspor(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("judul")}
        meta={t("meta", { n: baris.length, dpp: formatRupiah(jumlahDpp), ppn: formatRupiah(jumlahPpn) })}
        actions={
          <Button onClick={() => void ekspor()} disabled={mengekspor || baris.length === 0 || !adaNpwp}>
            {mengekspor ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
            {t("unduh")}
          </Button>
        }
      />
      <NavPajak aktif="faktur" akses={akses} />
      <SpandukPajak statusPkp={statusPkp} rezimPph={rezimPph} akses={akses} />
      {statusPkp !== "PKP" ? <p className="text-sm text-amber-700 dark:text-amber-300">{t("bukanPkp")}</p> : null}
      {!adaNpwp ? (
        <p className="text-sm text-destructive">
          {t("npwpKosong")}{" "}
          {akses.pengaturan ? (
            <Link className="text-tautan hover:underline" href="/backoffice/settings/tax">
              {t("isiNpwp")}
            </Link>
          ) : null}
        </p>
      ) : null}

      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="rentang-faktur">{t("rentang")}</Label>
          <RentangTanggalInput id="rentang-faktur" dari={dari} sampai={sampai} required onChange={(r) => r.dari && r.sampai && pergi({ dari: r.dari, sampai: r.sampai, sertakan })} />
        </div>
        <div className="flex items-center gap-2 pb-2">
          <Checkbox
            id="sertakan-faktur"
            checked={sertakan === "SEMUA"}
            onCheckedChange={(v) => pergi({ dari, sampai, sertakan: v === true ? "SEMUA" : "MENUNGGU" })}
          />
          <Label htmlFor="sertakan-faktur" className="font-normal">
            {t("sertakan")}
          </Label>
        </div>
      </div>

      {peringatan.length > 0 ? (
        <Card className="border-amber-500/40">
          <CardHeader>
            <CardTitle className="text-base">{t("peringatan", { n: peringatan.length })}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {peringatan.slice(0, 30).map((p, i) => (
                <li key={`${p.nomor}-${p.kode}-${i}`}>{p.teks}</li>
              ))}
            </ul>
            {peringatan.length > 30 ? <p className="mt-2 text-xs text-muted-foreground">{t("peringatanLain", { n: peringatan.length - 30 })}</p> : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" aria-hidden />
            {t("daftar")}
          </CardTitle>
        </CardHeader>
        <CardContent className={pindah ? "opacity-60 transition-opacity" : undefined}>
          {terpotong ? <p className="mb-2 text-sm text-amber-700 dark:text-amber-300">{t("terpotong")}</p> : null}
          {gagal ? (
            <p className="text-sm text-destructive">{t("gagal")}</p>
          ) : baris.length === 0 ? (
            <EmptyState icon={FileText} title={t("kosong")} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("kolom.tanggal")}</TableHead>
                    <TableHead>{t("kolom.nota")}</TableHead>
                    <TableHead className="min-w-[160px]">{t("kolom.toko")}</TableHead>
                    <TableHead className="text-right">{t("kolom.total")}</TableHead>
                    <TableHead className="text-right">{t("kolom.dpp")}</TableHead>
                    <TableHead className="text-right">{t("kolom.ppn")}</TableHead>
                    <TableHead>{t("kolom.status")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {baris.map((b) => (
                    <TableRow key={b.deliveryId}>
                      <TableCell className="tabular-nums">{labelTanggal(b.tanggal, locale)}</TableCell>
                      <TableCell className="tabular-nums">{b.nomor}</TableCell>
                      <TableCell className="whitespace-normal">
                        {b.toko}
                        {b.tokoPkp ? <span className="block text-xs text-muted-foreground">{t("tokoPkp")}</span> : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatRupiah(b.total)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatRupiah(b.dpp)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatRupiah(b.ppn)}</TableCell>
                      <TableCell className="whitespace-normal">
                        <StatusPill tone={b.statusFaktur === "CREATED" ? "settled" : "waiting"}>{t(`status.${b.statusFaktur === "CREATED" ? "CREATED" : "PENDING"}`)}</StatusPill>
                        {b.nomorFaktur ? <span className="block text-xs tabular-nums text-muted-foreground">{b.nomorFaktur}</span> : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
