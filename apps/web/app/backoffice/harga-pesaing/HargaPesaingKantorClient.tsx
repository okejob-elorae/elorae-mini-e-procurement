"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, Download, ImageIcon, Loader2, ListOrdered, Tag } from "lucide-react";
import { eksporHargaPesaingAction, type LabelEksporHargaPesaing } from "@/app/actions/harga-pesaing";
import type { BarisHargaPesaing } from "@/lib/salesman/checklist-queries";
import type { RingkasHargaPesaing } from "@/lib/salesman/harga-pesaing";
import { formatIDR } from "@/lib/sales-orders/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RentangTanggalInput } from "@/components/ui/rentang-tanggal-input";

const SEMUA = "SEMUA";
/** Rincian yang dirender di layar; Excel selalu membawa semuanya. */
const BARIS_TAMPIL = 300;

function unduh(base64: string, nama: string) {
  const bin = atob(base64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const blob = new Blob([arr], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nama;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function HargaPesaingKantorClient({
  data,
  saring,
  area,
  kategori,
}: {
  data: { baris: BarisHargaPesaing[]; ringkas: RingkasHargaPesaing[]; terpotong: boolean };
  saring: { dari: string; sampai: string; merek: string | null; kategori: string | null; area: string | null };
  area: { id: string; label: string }[];
  kategori: string[];
}) {
  const t = useTranslations("hargaPesaing");
  const tt = useTranslations("tanggalInput");
  const router = useRouter();
  const [, mulai] = useTransition();
  const [mengekspor, setMengekspor] = useState(false);
  const [merek, setMerek] = useState(saring.merek ?? "");
  const [kategoriKetik, setKategoriKetik] = useState(saring.kategori ?? "");

  const dorong = (ubah: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const semua = { dari: saring.dari, sampai: saring.sampai, merek: saring.merek, kategori: saring.kategori, area: saring.area, ...ubah };
    for (const [k, v] of Object.entries(semua)) if (v) p.set(k, v);
    mulai(() => router.push(`/backoffice/harga-pesaing?${p.toString()}`));
  };

  // Ketikan merek/kategori dikirim ke alamat sesudah jeda singkat, bukan per huruf.
  useEffect(() => {
    const h = setTimeout(() => {
      const m = merek.trim() || null;
      const k = kategoriKetik.trim() || null;
      if (m !== saring.merek || k !== saring.kategori) dorong({ merek: m, kategori: k });
    }, 400);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merek, kategoriKetik]);

  const ekspor = async () => {
    setMengekspor(true);
    try {
      const label: LabelEksporHargaPesaing = {
        judul: t("judul"),
        ringkasan: t("ekspor.ringkasan"),
        rincian: t("ekspor.rincian"),
        semuaKategori: t("tanpaKategori"),
        kolom: {
          merek: t("kolMerek"),
          kategori: t("kolKategori"),
          jumlah: t("kolJumlah"),
          min: t("kolMin"),
          rata: t("kolRata"),
          maks: t("kolMaks"),
          tanggal: t("kolTanggal"),
          toko: t("kolToko"),
          area: t("kolArea"),
          produk: t("kolProduk"),
          harga: t("kolHarga"),
          catatan: t("kolCatatan"),
          oleh: t("kolOleh"),
          foto: t("kolFoto"),
        },
      };
      const r = await eksporHargaPesaingAction(
        { dari: saring.dari, sampai: saring.sampai, merek: saring.merek, kategori: saring.kategori, groupId: saring.area },
        label,
      );
      if (!r.ok) {
        toast.error(r.kode === "TANPA_AKSES" ? t("err.TANPA_AKSES") : t("err.GAGAL"));
        return;
      }
      unduh(r.base64, r.filename);
    } catch {
      toast.error(t("err.GAGAL"));
    } finally {
      setMengekspor(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("judul")}
        meta={t("ringkas", { catatan: data.baris.length, kelompok: data.ringkas.length })}
        actions={
          <Button variant="outline" onClick={ekspor} disabled={mengekspor || data.baris.length === 0}>
            {mengekspor ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
            {t("eksporExcel")}
          </Button>
        }
      />

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full space-y-1 sm:w-64">
            <Label htmlFor="hp-periode" className="text-xs text-muted-foreground">
              {tt("periode")}
            </Label>
            <RentangTanggalInput
              id="hp-periode" required
              dari={saring.dari}
              sampai={saring.sampai}
              onChange={({ dari, sampai }) => dorong({ dari, sampai })}
            />
          </div>
          <div className="w-full space-y-1 sm:w-48">
            <Label htmlFor="hp-merek" className="text-xs text-muted-foreground">
              {t("saring.merek")}
            </Label>
            <Input id="hp-merek" value={merek} placeholder={t("saring.merekPetunjuk")} onChange={(e) => setMerek(e.target.value)} />
          </div>
          <div className="w-full space-y-1 sm:w-48">
            <Label htmlFor="hp-kategori" className="text-xs text-muted-foreground">
              {t("saring.kategori")}
            </Label>
            <Input
              id="hp-kategori"
              list="hp-kategori-saran"
              value={kategoriKetik}
              placeholder={t("saring.kategoriPetunjuk")}
              onChange={(e) => setKategoriKetik(e.target.value)}
            />
          </div>
          {/* Di luar kotak berlabel: sebagai anak terakhir, datalist membuat input dapat jarak bawah dan naik 4 px. */}
          <datalist id="hp-kategori-saran">
            {kategori.map((k) => (
              <option key={k} value={k} />
            ))}
          </datalist>
          <div className="w-full space-y-1 sm:w-52">
            <Label htmlFor="hp-area" className="text-xs text-muted-foreground">
              {t("saring.area")}
            </Label>
            <Select value={saring.area ?? SEMUA} onValueChange={(v) => dorong({ area: v === SEMUA ? null : v })}>
              <SelectTrigger id="hp-area" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SEMUA}>{t("saring.semuaArea")}</SelectItem>
                {area.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              setMerek("");
              setKategoriKetik("");
              mulai(() => router.push("/backoffice/harga-pesaing"));
            }}
          >
            {t("saring.reset")}
          </Button>
        </div>
      </Card>

      {data.terpotong ? (
        <p className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {t("terpotong")}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Tag className="h-4 w-4" aria-hidden />
            {t("ringkasJudul")}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {data.ringkas.length === 0 ? (
            <EmptyState icon={Tag} title={t("kosongJudul")} description={t("kosongIsi")} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("kolMerek")}</TableHead>
                    <TableHead>{t("kolKategori")}</TableHead>
                    <TableHead className="text-right">{t("kolJumlah")}</TableHead>
                    <TableHead className="text-right">{t("kolMin")}</TableHead>
                    <TableHead className="text-right">{t("kolRata")}</TableHead>
                    <TableHead className="text-right">{t("kolMaks")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.ringkas.map((g) => (
                    <TableRow key={`${g.merek}|${g.kategori ?? ""}`}>
                      <TableCell className="whitespace-normal font-medium">{g.merek}</TableCell>
                      <TableCell className="whitespace-normal">{g.kategori ?? <span className="text-muted-foreground">{t("tanpaKategori")}</span>}</TableCell>
                      <TableCell className="text-right tabular-nums">{g.jumlah}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatIDR(g.min)}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">{formatIDR(g.rata)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatIDR(g.maks)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {data.baris.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ListOrdered className="h-4 w-4" aria-hidden />
              {t("rincianJudul")}
            </CardTitle>
            {data.baris.length > BARIS_TAMPIL ? <CardDescription>{t("rincianTerbatas", { n: BARIS_TAMPIL })}</CardDescription> : null}
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("kolTanggal")}</TableHead>
                    <TableHead>{t("kolToko")}</TableHead>
                    <TableHead>{t("kolMerek")}</TableHead>
                    <TableHead>{t("kolProduk")}</TableHead>
                    <TableHead className="hidden 2xl:table-cell">{t("kolKategori")}</TableHead>
                    <TableHead className="text-right">{t("kolHarga")}</TableHead>
                    <TableHead className="hidden 2xl:table-cell">{t("kolOleh")}</TableHead>
                    <TableHead>{t("kolFoto")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.baris.slice(0, BARIS_TAMPIL).map((b) => (
                    <TableRow key={b.id}>
                      <TableCell>{b.tanggal}</TableCell>
                      <TableCell className="whitespace-normal">
                        {b.toko}
                        {b.area ? <span className="block text-xs text-muted-foreground">{b.area}</span> : null}
                      </TableCell>
                      <TableCell className="whitespace-normal">{b.merek}</TableCell>
                      <TableCell className="whitespace-normal">
                        {b.produk}
                        {b.catatan ? <span className="block whitespace-pre-line text-xs text-muted-foreground">{b.catatan}</span> : null}
                      </TableCell>
                      <TableCell className="hidden whitespace-normal 2xl:table-cell">{b.kategori ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatIDR(b.harga)}</TableCell>
                      <TableCell className="hidden whitespace-normal 2xl:table-cell">{b.oleh}</TableCell>
                      <TableCell>
                        {b.fotoUrl ? (
                          <Button asChild variant="ghost" size="icon" aria-label={t("lihatFoto")}>
                            <a href={b.fotoUrl} target="_blank" rel="noopener noreferrer">
                              <ImageIcon className="h-4 w-4" aria-hidden />
                            </a>
                          </Button>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
