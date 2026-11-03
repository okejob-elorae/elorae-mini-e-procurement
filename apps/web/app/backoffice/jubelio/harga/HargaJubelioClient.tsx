"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { BadgeDollarSign, Loader2, Search, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
import { formatRupiah } from "@/lib/format/rupiah";
import { hargaSama, MAKS_BARIS_KONFIRMASI, selisihHarga, type JenisTampilHarga } from "@/lib/jubelio/harga/aturan";
import type { BarisHargaMenunggu } from "@/lib/jubelio/harga/queries";
import { kembalikanHargaErpAction, konfirmasiHargaJubelioAction } from "@/app/actions/jubelio-harga";
import { usePesanGalatJubelio } from "../RincianGalat";
import { TabelBedaJubelio, type BarisHargaBedaTampil } from "./TabelBedaJubelio";

export type BarisHargaTampil = BarisHargaMenunggu & { diubahPadaTampil: string | null };

type Props = {
  baris: BarisHargaTampil[];
  total: number;
  terpotong: boolean;
  /** Daftar "Beda di Jubelio" — hanya saat `jenis` = BEDA. */
  beda: { baris: BarisHargaBedaTampil[]; total: number; terpotong: boolean } | null;
  /** Barang yang harganya di Jubelio berbeda dengan ERP — spanduk di tampilan lain. */
  jumlahBeda: number;
  jenis: JenisTampilHarga | null;
  cari: string;
  /** Barang di Jubelio tanpa harga terkonfirmasi — kirimannya dilewati sampai harganya dikonfirmasi. */
  tanpaHarga: number;
  /** items:edit — tautan "Ubah 'Dijual di'" ke halaman barang (P76). */
  bolehUbahBarang: boolean;
};

const SEMUA = "__semua__";

/**
 * Daftar konfirmasi harga Jubelio. Data dan saringan dari server (URL); di sini hanya pilihan
 * baris dan tombolnya. Setiap tombol memanggil aksi yang digerbangi izin yang sama dengan
 * halamannya (`jubelio_prices:confirm`), jadi tidak ada gerbang tambahan di layar.
 *
 * Baris yang juga "Harga di Jubelio berbeda dengan ERP" menyebut harga yang terbaca di Jubelio,
 * dan setiap dialog yang menimpanya (setujui, kembalikan) menyebut harga yang akan diganti —
 * penimpaan hanya lewat keputusan yang melihat angkanya (jawaban pemilik P75).
 */
export function HargaJubelioClient({ baris, total, terpotong, beda, jumlahBeda, jenis, cari, tanpaHarga, bolehUbahBarang }: Props) {
  const t = useTranslations("jubelio.harga");
  const pesanGalat = usePesanGalatJubelio();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [kataCari, setKataCari] = useState(cari);
  const [dipilih, setDipilih] = useState<Set<string>>(new Set());
  const [konfirmasiBuka, setKonfirmasiBuka] = useState(false);
  const [kembalikan, setKembalikan] = useState<BarisHargaTampil | null>(null);

  const bisaDikirim = useMemo(() => baris.filter((b) => b.alasan == null), [baris]);
  // Diturunkan dari baris yang tampil: pilihan yang barisnya hilang sesudah muat ulang ikut hilang.
  const pilihan = useMemo(() => baris.filter((b) => dipilih.has(b.itemId) && b.alasan == null), [baris, dipilih]);
  const semuaTerpilih = bisaDikirim.length > 0 && pilihan.length === bisaDikirim.length;
  const pilihanTimpa = useMemo(() => pilihan.filter((b) => b.bedaDiJubelio), [pilihan]);

  const gantiUrl = (perubahan: { jenis?: JenisTampilHarga | null; cari?: string }) => {
    const p = new URLSearchParams();
    const j = perubahan.jenis === undefined ? jenis : perubahan.jenis;
    const c = perubahan.cari === undefined ? cari : perubahan.cari;
    if (j) p.set("jenis", j);
    if (c.trim()) p.set("cari", c.trim());
    const qs = p.toString();
    router.replace(qs ? `/backoffice/jubelio/harga?${qs}` : "/backoffice/jubelio/harga");
  };

  // Pencarian dikirim ke URL sesudah berhenti mengetik sebentar.
  useEffect(() => {
    if (kataCari.trim() === cari.trim()) return;
    const jeda = setTimeout(() => gantiUrl({ cari: kataCari }), 400);
    return () => clearTimeout(jeda);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kataCari]);

  const alihkan = (itemId: string) => {
    setDipilih((lama) => {
      const baru = new Set(lama);
      if (baru.has(itemId)) baru.delete(itemId);
      else baru.add(itemId);
      return baru;
    });
  };

  const alihkanSemua = () => {
    setDipilih(semuaTerpilih ? new Set() : new Set(bisaDikirim.map((b) => b.itemId)));
  };

  const setujui = () => {
    const kirim = pilihan.map((b) => ({ itemId: b.itemId, hargaErp: b.hargaErp }));
    if (kirim.length === 0) return;
    startTransition(async () => {
      const jumlah = new Map<string, number>();
      for (let i = 0; i < kirim.length; i += MAKS_BARIS_KONFIRMASI) {
        const r = await konfirmasiHargaJubelioAction(kirim.slice(i, i + MAKS_BARIS_KONFIRMASI));
        if (!r.ok) {
          toast.error(pesanGalat(r));
          break;
        }
        for (const h of r.data) jumlah.set(h.hasil, (jumlah.get(h.hasil) ?? 0) + 1);
      }
      setKonfirmasiBuka(false);
      for (const [hasil, count] of jumlah) {
        const pesan = t(`hasil.${hasil}`, { count });
        if (hasil === "DIKONFIRMASI") toast.success(pesan);
        else toast.warning(pesan);
      }
      setDipilih(new Set());
      router.refresh();
    });
  };

  const jalankanKembalikan = () => {
    const b = kembalikan;
    if (!b) return;
    startTransition(async () => {
      const r = await kembalikanHargaErpAction({ itemId: b.itemId, hargaErp: b.hargaErp });
      setKembalikan(null);
      if (!r.ok) {
        toast.error(pesanGalat(r));
        return;
      }
      if (r.data.hasil === "DIKEMBALIKAN") toast.success(t("kembalikanBerhasil"));
      else toast.error(t(`galat.${r.data.hasil}`));
      router.refresh();
    });
  };

  const harga = (nilai: string | null) => (nilai == null ? t("belumAda") : formatRupiah(nilai));
  /** Yang terbaca di Jubelio: satu harga, atau rentangnya bila varian berbeda. */
  const terbaca = (b: { jubelioTertinggi: string | null; jubelioTerendah: string | null }) => {
    const rp = (v: string | null) => {
      const n = v == null ? Number.NaN : Number(v);
      return Number.isFinite(n) && n > 0 ? formatRupiah(n) : t("tanpaHarga");
    };
    return b.jubelioTertinggi != null && b.jubelioTerendah != null && !hargaSama(b.jubelioTertinggi, b.jubelioTerendah)
      ? `${rp(b.jubelioTerendah)}–${rp(b.jubelioTertinggi)}`
      : rp(b.jubelioTertinggi ?? b.jubelioTerendah);
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} />

      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder={t("cari")}
            aria-label={t("cari")}
            value={kataCari}
            onChange={(e) => setKataCari(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select
          value={jenis ?? SEMUA}
          onValueChange={(v) => gantiUrl({ jenis: v === "BARU" || v === "UBAH" || v === "BEDA" ? v : null })}
        >
          <SelectTrigger className="w-[220px]" aria-label={t("colJenis")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SEMUA}>{t("filterSemua")}</SelectItem>
            <SelectItem value="BARU">{t("filterBaru")}</SelectItem>
            <SelectItem value="UBAH">{t("filterUbah")}</SelectItem>
            <SelectItem value="BEDA">{t("filterBeda")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {jenis !== "BEDA" && jumlahBeda > 0 ? (
        <p className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          <span>{t("bedaBanner", { count: jumlahBeda })}</span>
          <Link href="/backoffice/jubelio/harga?jenis=BEDA" className="font-medium underline underline-offset-2">
            {t("bedaLihat")}
          </Link>
        </p>
      ) : null}

      {tanpaHarga > 0 && jenis !== "BEDA" ? (
        <p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">{t("tanpaHargaInfo", { count: tanpaHarga })}</p>
      ) : null}

      {jenis === "BEDA" && beda ? <TabelBedaJubelio baris={beda.baris} total={beda.total} terpotong={beda.terpotong} /> : null}

      {jenis !== "BEDA" ? (
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2">
              <BadgeDollarSign className="h-5 w-5" />
              {t("cardTitle")}
            </CardTitle>
            <Button disabled={pilihan.length === 0 || isPending} onClick={() => setKonfirmasiBuka(true)}>
              {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              {t("setujui", { count: pilihan.length })}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {baris.length === 0 ? (
            <EmptyState icon={BadgeDollarSign} title={t("kosong")} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">
                      <Checkbox
                        checked={semuaTerpilih}
                        onCheckedChange={alihkanSemua}
                        disabled={bisaDikirim.length === 0 || isPending}
                        aria-label={t("pilihSemua")}
                      />
                    </TableHead>
                    <TableHead>{t("colSku")}</TableHead>
                    <TableHead>{t("colNama")}</TableHead>
                    <TableHead>{t("colJenis")}</TableHead>
                    <TableHead className="text-right">{t("colHargaJubelio")}</TableHead>
                    <TableHead className="text-right">{t("colHargaErp")}</TableHead>
                    <TableHead className="text-right">{t("colSelisih")}</TableHead>
                    <TableHead>{t("colDiubah")}</TableHead>
                    <TableHead>{t("colKeterangan")}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {baris.map((b) => {
                    const selisih = b.jenis === "UBAH" && b.hargaJubelio != null ? selisihHarga(b.hargaJubelio, b.hargaErp) : null;
                    return (
                      <TableRow key={b.itemId}>
                        <TableCell>
                          <Checkbox
                            checked={dipilih.has(b.itemId) && b.alasan == null}
                            onCheckedChange={() => alihkan(b.itemId)}
                            disabled={b.alasan != null || isPending}
                            aria-label={b.sku}
                          />
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          <Link href={`/backoffice/items/${b.itemId}`} className="underline-offset-2 hover:underline">
                            {b.sku}
                          </Link>
                        </TableCell>
                        <TableCell className="min-w-[180px] max-w-[320px] whitespace-normal">
                          <span>{b.nama}</span>
                          {!b.isActive ? (
                            <Badge variant="outline" className="ml-2">
                              {t("nonaktif")}
                            </Badge>
                          ) : null}
                        </TableCell>
                        <TableCell className="min-w-[180px] whitespace-normal">
                          <Badge variant={b.jenis === "BARU" ? "secondary" : "outline"} className="whitespace-normal text-left">
                            {b.jenis === "BARU" ? t("jenisBaru") : t("jenisUbah")}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <div>{harga(b.hargaJubelio)}</div>
                          {b.bedaDiJubelio ? (
                            <div className="text-xs text-destructive">{t("terbacaDiJubelio", { harga: terbaca(b) })}</div>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">{harga(b.hargaErp)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {selisih ? (
                            <span className={selisih.rupiah < 0 ? "text-destructive" : undefined}>
                              {selisih.rupiah > 0 ? "+" : ""}
                              {formatRupiah(selisih.rupiah)}
                              {selisih.persen != null ? ` (${selisih.persen > 0 ? "+" : ""}${selisih.persen}%)` : ""}
                            </span>
                          ) : (
                            t("belumAda")
                          )}
                        </TableCell>
                        <TableCell className="min-w-[140px] whitespace-normal text-sm">
                          <div>{b.diubahOleh ?? t("belumAda")}</div>
                          {b.diubahPadaTampil ? <div className="text-xs text-muted-foreground">{b.diubahPadaTampil}</div> : null}
                        </TableCell>
                        <TableCell className="min-w-[200px] max-w-[320px] whitespace-normal text-sm text-muted-foreground">
                          {b.alasan === "KATEGORI_BELUM_DIPETAKAN" ? (
                            <Link href="/backoffice/jubelio/categories" className="underline underline-offset-2">
                              {t(`alasan.${b.alasan}`)}
                            </Link>
                          ) : b.alasan ? (
                            t(`alasan.${b.alasan}`)
                          ) : null}
                          {b.jenis === "BARU" && bolehUbahBarang ? (
                            <Link href={`/backoffice/items/${b.itemId}`} className="block underline underline-offset-2">
                              {t("ubahDiBarang")}
                            </Link>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right">
                          {b.jenis === "UBAH" && b.hargaJubelio != null ? (
                            <Button variant="ghost" size="sm" disabled={isPending} onClick={() => setKembalikan(b)}>
                              {t("kembalikan")}
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          {terpotong ? (
            <p className="mt-4 text-xs text-muted-foreground">{t("terpotong", { shown: baris.length, total })}</p>
          ) : null}
        </CardContent>
      </Card>
      ) : null}

      <AlertDialog open={konfirmasiBuka} onOpenChange={(buka) => !isPending && setKonfirmasiBuka(buka)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("konfirmasiJudul", { count: pilihan.length })}</AlertDialogTitle>
            <AlertDialogDescription>{t("konfirmasiIsi")}</AlertDialogDescription>
          </AlertDialogHeader>
          {pilihanTimpa.length > 0 ? (
            <div className="space-y-1 text-sm">
              <p className="font-medium text-destructive">{t("konfirmasiTimpaDaftar", { count: pilihanTimpa.length })}</p>
              <ul className="max-h-48 space-y-0.5 overflow-y-auto tabular-nums">
                {pilihanTimpa.map((b) => (
                  <li key={b.itemId}>{t("konfirmasiTimpaBaris", { sku: b.sku, jubelio: terbaca(b), erp: harga(b.hargaErp) })}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>{t("batal")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending || pilihan.length === 0}
              onClick={(e) => {
                e.preventDefault();
                setujui();
              }}
            >
              {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t("kirim")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={kembalikan != null} onOpenChange={(buka) => !buka && !isPending && setKembalikan(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {kembalikan ? t("kembalikanJudul", { sku: kembalikan.sku, harga: harga(kembalikan.hargaJubelio) }) : null}
            </AlertDialogTitle>
            <AlertDialogDescription>{t("kembalikanIsi")}</AlertDialogDescription>
          </AlertDialogHeader>
          {kembalikan?.bedaDiJubelio ? (
            <p className="text-sm text-destructive">{t("konfirmasiTimpa", { harga: terbaca(kembalikan) })}</p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>{t("batal")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending}
              onClick={(e) => {
                e.preventDefault();
                jalankanKembalikan();
              }}
            >
              {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t("kembalikan")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}
