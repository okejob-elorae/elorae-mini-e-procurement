"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { ExternalLink, Plus, Tag, Trash2 } from "lucide-react";
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
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TanggalInput } from "@/components/ui/tanggal-input";
import { hapusBrandKolAction, tambahBrandKolAction } from "@/app/actions/kreatif-brand";
import { angkaTitik } from "@/lib/creative/angka-konten";
import { JENIS_BRAND, type JenisBrand } from "@/lib/creative/brand-collab";
import { alamatBrand } from "@/lib/creative/brand-param";
import type { BarisBrandKol } from "@/lib/creative/brand-queries";
import { formatDisplayDate } from "@/lib/date-only";
import { dinamis } from "@/lib/i18n/dinamis";
import { hariIniWib } from "@/lib/tanggal-isian";
import { LencanaBrand, PilJenisBrand } from "./LencanaBrand";

type Isian = { handle: string; nama: string; jenis: JenisBrand; link: string; tanggal: string };
const KOSONG: Isian = { handle: "", nama: "", jenis: "TAG", link: "", tanggal: "" };

/**
 * Tab Brand profil KOL: brand yang pernah ditandai KOL ini (dari ekstensi atau
 * diisi tangan), tambah manual, dan hapus. Penjelasannya di Bantuan.
 */
export function PanelBrandKolKlien({
  kolId,
  awal,
  total,
  bolehMengelola,
}: {
  kolId: string;
  awal: BarisBrandKol[];
  total: number;
  bolehMengelola: boolean;
}) {
  const t = useTranslations("kreatifRuang.brand");
  const td = dinamis(t);
  const locale = useLocale();
  const router = useRouter();
  const [hariIni] = useState(() => hariIniWib());
  const [buka, setBuka] = useState(false);
  const [isi, setIsi] = useState<Isian>(KOSONG);
  const [hapus, setHapus] = useState<BarisBrandKol | null>(null);
  const [pending, start] = useTransition();
  const ubah = <K extends keyof Isian>(k: K, v: Isian[K]) => setIsi((s) => ({ ...s, [k]: v }));

  const galat = (kode: string) => {
    toast.error(td(`err.${kode}`));
  };

  const simpan = () => {
    if (!isi.handle.trim()) {
      toast.error(t("form.handleWajib"));
      return;
    }
    start(async () => {
      const r = await tambahBrandKolAction({
        kolId,
        brandHandle: isi.handle,
        brandName: isi.nama.trim() || null,
        jenis: isi.jenis,
        postUrl: isi.link.trim() || null,
        tanggal: isi.tanggal || null,
      });
      if (!r.ok) return galat(r.kode);
      toast.success(t("profil.ditambah"));
      setBuka(false);
      setIsi(KOSONG);
      router.refresh();
    });
  };

  const hapusSekarang = () => {
    const b = hapus;
    if (!b) return;
    start(async () => {
      const r = await hapusBrandKolAction({ id: b.id, kolId });
      if (!r.ok) return galat(r.kode);
      toast.success(t("profil.dihapus"));
      setHapus(null);
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Tag className="h-5 w-5" aria-hidden />
          {t("profil.judul")}
        </CardTitle>
        {bolehMengelola ? (
          <Button size="sm" onClick={() => setBuka(true)}>
            <Plus className="h-4 w-4" />
            {t("profil.tambah")}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className={awal.length === 0 ? "" : "px-0"}>
        {awal.length === 0 ? (
          <EmptyState icon={Tag} title={t("profil.kosong")} description={t("profil.kosongIsi")} className="py-6" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">{t("kolom.brand")}</TableHead>
                    <TableHead>{t("kolom.jenis")}</TableHead>
                    <TableHead>{t("kolom.posting")}</TableHead>
                    <TableHead className="text-right">{t("kolom.views")}</TableHead>
                    <TableHead>{t("kolom.sumber")}</TableHead>
                    {bolehMengelola ? (
                      <TableHead className="pr-6 text-right">
                        <span className="sr-only">{t("kolom.aksi")}</span>
                      </TableHead>
                    ) : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {awal.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell className="whitespace-normal pl-6">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Link
                            href={alamatBrand({ brand: b.brandHandle })}
                            className="font-medium text-tautan hover:underline"
                            title={t("profil.lihatBrand", { brand: b.brandHandle })}
                          >
                            @{b.brandHandle}
                          </Link>
                          <LencanaBrand label={b.label} />
                        </div>
                        {b.brandName ? <p className="text-xs text-muted-foreground">{b.brandName}</p> : null}
                      </TableCell>
                      <TableCell>
                        <PilJenisBrand jenis={b.jenis} />
                      </TableCell>
                      <TableCell className="text-sm">
                        <span className="block tabular-nums">{b.postedAt ? formatDisplayDate(b.postedAt, locale) : t("profil.tanpaTanggal")}</span>
                        {b.postUrl ? (
                          <a href={b.postUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-tautan hover:underline">
                            {t("profil.buka")}
                            <ExternalLink className="h-3 w-3" aria-hidden />
                          </a>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">{b.views === null ? "—" : angkaTitik(b.views)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{t(`sumber.${b.sumber}`)}</TableCell>
                      {bolehMengelola ? (
                        <TableCell className="pr-6 text-right">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-destructive"
                            aria-label={t("profil.hapus", { brand: b.brandHandle })}
                            title={t("profil.hapus", { brand: b.brandHandle })}
                            onClick={() => setHapus(b)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {total > awal.length ? <p className="px-6 pt-3 text-xs text-muted-foreground">{t("profil.terpotong", { n: awal.length, total })}</p> : null}
          </>
        )}
      </CardContent>

      <Dialog open={buka} onOpenChange={(o) => !pending && setBuka(o)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("form.judul")}</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              simpan();
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="brand-handle">{t("form.handle")}</Label>
                <Input
                  id="brand-handle"
                  value={isi.handle}
                  placeholder={t("form.handlePlaceholder")}
                  maxLength={100}
                  autoComplete="off"
                  onChange={(e) => ubah("handle", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="brand-nama">{t("form.nama")}</Label>
                <Input id="brand-nama" value={isi.nama} maxLength={100} onChange={(e) => ubah("nama", e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t("form.jenis")}</Label>
              <Select value={isi.jenis} onValueChange={(v) => ubah("jenis", v as JenisBrand)}>
                <SelectTrigger className="w-full" aria-label={t("form.jenis")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {JENIS_BRAND.map((j) => (
                    <SelectItem key={j} value={j}>
                      {t(`jenis.${j}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="brand-link">{t("form.link")}</Label>
              <Input id="brand-link" inputMode="url" value={isi.link} placeholder={t("form.linkPlaceholder")} onChange={(e) => ubah("link", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="brand-tanggal">{t("form.tanggal")}</Label>
              <TanggalInput id="brand-tanggal" value={isi.tanggal} max={hariIni} onChange={(e) => ubah("tanggal", e.target.value)} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setBuka(false)} disabled={pending}>
                {t("form.batal")}
              </Button>
              <Button type="submit" disabled={pending || !isi.handle.trim()}>
                {t("form.simpan")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={hapus !== null} onOpenChange={(o) => !o && !pending && setHapus(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("profil.hapusJudul")}</AlertDialogTitle>
            <AlertDialogDescription>
              {hapus?.sumber === "EKSTENSI" ? t("profil.hapusIsiEkstensi", { brand: hapus.brandHandle }) : t("profil.hapusIsi", { brand: hapus?.brandHandle ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{t("profil.batal")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                hapusSekarang();
              }}
            >
              {t("profil.hapusYa")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
