"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Boxes, Download, Eye, FileUp, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { pratinjauPersediaanAwalAction, unduhDaftarPersediaanAction } from "@/app/actions/finance-saldo-awal";
import { formatRupiah } from "@/lib/format/rupiah";
import { bacaBerkasHpp } from "@/lib/finance/saldo-awal/baca-berkas";
import { kunciGalatSaldoAwal, nilaiGalat } from "@/lib/finance/saldo-awal/galat";
import type { GalatBerkasHpp, IsianHpp, PratinjauPersediaan } from "@/lib/finance/saldo-awal/persediaan";
import type { EntriPersediaan } from "@/lib/finance/saldo-awal/jenis";
import type { KeadaanJenisSaldoAwal } from "@/lib/finance/saldo-awal/queries";
import { AksiSaldoAwal, type KonteksSaldoAwal } from "./AksiSaldoAwal";

const MAKS_TAMPIL = 200;

function unduhBase64(base64: string, namaBerkas: string) {
  const bin = atob(base64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([arr], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = namaBerkas;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Persediaan awal: HPP per SKU/varian dari berkas Excel/CSV. Mengisi HPP stok
 * TANPA mengubah qty; yang dijurnal = nilai stok baru − nilai stok sekarang.
 */
export function EditorPersediaan({ keadaan, konteks }: { keadaan: KeadaanJenisSaldoAwal; konteks: KonteksSaldoAwal }) {
  const t = useTranslations("saldoAwal");
  const berkasRef = useRef<HTMLInputElement>(null);
  const [pending, mulai] = useTransition();
  const [mengunduh, setMengunduh] = useState(false);
  const tersimpan = ((keadaan.draf ?? keadaan.posting)?.isi.baris as EntriPersediaan[] | undefined) ?? [];
  const sumberTersimpan = keadaan.draf ? "draf" : keadaan.posting ? "posting" : null;
  const [isian, setIsian] = useState<IsianHpp[]>(() => tersimpan.map((b) => ({ itemId: b.itemId, variantSku: b.variantSku, hpp: b.hpp, sku: b.sku })));
  const [pratinjau, setPratinjau] = useState<PratinjauPersediaan | null>(null);
  const [tidakDikenal, setTidakDikenal] = useState<{ baris?: number; sku: string }[]>([]);
  const [galatBerkas, setGalatBerkas] = useState<GalatBerkasHpp[]>([]);
  const [namaBerkas, setNamaBerkas] = useState<string | null>(keadaan.draf?.namaBerkas ?? null);

  const tinjau = (masukan: { berkas?: { baris: number; sku: string; hpp: number }[]; isian?: IsianHpp[] }) =>
    mulai(async () => {
      const r = await pratinjauPersediaanAwalAction(masukan);
      if (!r.ok) {
        toast.error(t(kunciGalatSaldoAwal(r.kode), nilaiGalat({})));
        return;
      }
      setIsian(r.isian);
      setPratinjau(r.pratinjau);
      setTidakDikenal(r.tidakDikenal);
    });

  const unggah = async (file: File) => {
    try {
      const hasil = bacaBerkasHpp(await file.arrayBuffer());
      if (hasil.tanpaLembar || hasil.tanpaJudul) {
        toast.error(t("persediaan.tanpaJudul"));
        return;
      }
      setGalatBerkas(hasil.galat);
      setNamaBerkas(file.name);
      tinjau({ berkas: hasil.baris, isian });
    } catch {
      toast.error(t("persediaan.gagalBaca"));
    }
  };

  const unduh = async () => {
    setMengunduh(true);
    try {
      const r = await unduhDaftarPersediaanAction();
      if (!r.ok) {
        toast.error(t(kunciGalatSaldoAwal(r.kode), nilaiGalat({})));
        return;
      }
      unduhBase64(r.base64, r.namaBerkas);
    } finally {
      setMengunduh(false);
    }
  };

  const nilaiLama = keadaan.posting?.isi.ringkasan?.nilaiPerPeran;
  const kumulatifLama = (nilaiLama?.INVENTORY ?? 0) + (nilaiLama?.INVENTORY_FG ?? 0);
  const ekuitas = pratinjau ? Math.round((kumulatifLama + pratinjau.totalSelisih) * 100) / 100 : 0;
  const alasanBelum =
    isian.length === 0
      ? t("persediaan.belum")
      : !pratinjau
        ? t("alasan.tinjau")
        : tidakDikenal.length > 0
          ? t("alasan.tidakDikenal")
          : null;

  const barisTampil = pratinjau ? [...pratinjau.baris].sort((a, b) => Math.abs(b.selisih) - Math.abs(a.selisih)).slice(0, MAKS_TAMPIL) : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Boxes className="h-5 w-5" aria-hidden />
          {t("jenis.INVENTORY")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {konteks.bolehMengelola ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => void unduh()} disabled={mengunduh}>
              {mengunduh ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
              {t("persediaan.unduh")}
            </Button>
            <Button variant="outline" onClick={() => berkasRef.current?.click()} disabled={pending || konteks.terkunci !== null}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FileUp className="h-4 w-4" aria-hidden />}
              {t("persediaan.unggah")}
            </Button>
            <input
              ref={berkasRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void unggah(f);
              }}
            />
            {isian.length > 0 && !pratinjau ? (
              <Button variant="outline" onClick={() => tinjau({ isian })} disabled={pending}>
                <Eye className="h-4 w-4" aria-hidden />
                {t("persediaan.tinjau")}
              </Button>
            ) : null}
            {isian.length > 0 ? (
              <Button
                variant="ghost"
                onClick={() => {
                  setIsian([]);
                  setPratinjau(null);
                  setTidakDikenal([]);
                  setGalatBerkas([]);
                  setNamaBerkas(null);
                }}
                disabled={pending}
              >
                <X className="h-4 w-4" aria-hidden />
                {t("persediaan.kosongkan")}
              </Button>
            ) : null}
          </div>
        ) : null}

        <p className="text-sm text-muted-foreground">
          {isian.length === 0
            ? t("persediaan.belum")
            : pratinjau
              ? t("persediaan.ringkas", { n: pratinjau.baris.length, nilai: formatRupiah(pratinjau.totalSelisih) })
              : t("persediaan.tersimpan", { n: isian.length, sumber: t(`persediaan.sumber.${sumberTersimpan ?? "draf"}`) })}
          {namaBerkas ? ` · ${t("persediaan.berkas", { nama: namaBerkas })}` : ""}
        </p>

        {galatBerkas.length > 0 ? (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
            <p className="font-medium">{t("persediaan.galatBerkas", { n: galatBerkas.length })}</p>
            <ul className="mt-1 list-inside list-disc text-muted-foreground">
              {galatBerkas.slice(0, 20).map((g) => (
                <li key={`${g.baris}-${g.sku}`}>{t("persediaan.galatBaris", { baris: g.baris, sku: g.sku, sebab: t(`persediaan.galat.${g.sebab}`) })}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {tidakDikenal.length > 0 ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <p className="font-medium">{t("persediaan.tidakDikenal", { n: tidakDikenal.length })}</p>
            <p className="mt-1 break-words text-muted-foreground">{tidakDikenal.slice(0, 30).map((x) => x.sku).join(", ")}</p>
          </div>
        ) : null}

        {pratinjau ? (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Card className="gap-1 py-4">
                <CardContent className="px-4">
                  <p className="text-sm text-muted-foreground">{t("persediaan.bahan")}</p>
                  <p className="text-xl font-semibold tabular-nums">{formatRupiah(pratinjau.selisihPerPeranSen.INVENTORY / 100)}</p>
                </CardContent>
              </Card>
              <Card className="gap-1 py-4">
                <CardContent className="px-4">
                  <p className="text-sm text-muted-foreground">{t("persediaan.fg")}</p>
                  <p className="text-xl font-semibold tabular-nums">{formatRupiah(pratinjau.selisihPerPeranSen.INVENTORY_FG / 100)}</p>
                </CardContent>
              </Card>
              <Card className="gap-1 py-4">
                <CardContent className="px-4">
                  <p className="text-sm text-muted-foreground">{t("persediaan.nilaiBaru")}</p>
                  <p className="text-xl font-semibold tabular-nums">{formatRupiah(pratinjau.totalNilaiBaru)}</p>
                </CardContent>
              </Card>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("kolom.sku")}</TableHead>
                    <TableHead className="hidden 2xl:table-cell">{t("kolom.nama")}</TableHead>
                    <TableHead className="text-right">{t("kolom.qty")}</TableHead>
                    <TableHead className="hidden text-right xl:table-cell">{t("kolom.hppLama")}</TableHead>
                    <TableHead className="text-right">{t("kolom.hppBaru")}</TableHead>
                    <TableHead className="hidden text-right 2xl:table-cell">{t("kolom.nilaiBaru")}</TableHead>
                    <TableHead className="text-right">{t("kolom.dijurnal")}</TableHead>
                    <TableHead>{t("kolom.catatan")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {barisTampil.map((b) => (
                    <TableRow key={b.ivId}>
                      <TableCell className="font-mono text-xs">{b.sku}</TableCell>
                      <TableCell className="hidden whitespace-normal 2xl:table-cell">{b.nama}</TableCell>
                      <TableCell className="text-right tabular-nums">{b.qty.toLocaleString("id-ID")}</TableCell>
                      <TableCell className="hidden text-right tabular-nums xl:table-cell">{formatRupiah(b.hppLama)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatRupiah(b.hppBaru)}</TableCell>
                      <TableCell className="hidden text-right tabular-nums 2xl:table-cell">{formatRupiah(b.nilaiBaru)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatRupiah(b.selisih)}</TableCell>
                      <TableCell className="whitespace-normal text-xs text-muted-foreground">
                        {b.peringatan.map((w) => t(`persediaan.peringatan.${w}`, { hpp: formatRupiah(b.hppLama) })).join(" · ")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {pratinjau.baris.length > MAKS_TAMPIL ? (
              <p className="text-sm text-muted-foreground">{t("persediaan.lainnya", { n: pratinjau.baris.length - MAKS_TAMPIL })}</p>
            ) : null}
          </>
        ) : null}

        <AksiSaldoAwal
          jenis="INVENTORY"
          konteks={konteks}
          keadaan={keadaan}
          baris={isian.map((b) => ({ itemId: b.itemId, variantSku: b.variantSku, hpp: b.hpp }))}
          catatan=""
          ekuitas={ekuitas}
          alasanBelum={alasanBelum}
          namaBerkas={namaBerkas}
        />
      </CardContent>
    </Card>
  );
}
