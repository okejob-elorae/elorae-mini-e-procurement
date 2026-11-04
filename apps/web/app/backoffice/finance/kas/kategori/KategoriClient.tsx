"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft, Loader2, Pencil, Plus, Sparkles, Tags } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { INFO_POTONG_PEMASOK, SEMUA_JENIS_POTONG_PEMASOK, bacaJenisPotongPemasok } from "@/lib/finance/pajak/pemotongan";
import type { KategoriTampil } from "@/lib/finance/kas/kategori-writer";
import { pasangKategoriBawaanAction, simpanKategoriAction } from "@/app/actions/finance-kas";
import { pesanGalatKas } from "../_bersama/pesan-kas";

type Akun = { id: string; kode: string; nama: string; tipe: string };
type Isian = { id: string | null; nama: string; jenis: "OUT" | "IN"; akunId: string; potong: string; aktif: boolean };
const TANPA = "__tanpa__";

export function KategoriClient({ kategori, akun, bolehKelola }: { kategori: KategoriTampil[]; akun: Akun[]; bolehKelola: boolean }) {
  const t = useTranslations("financeKas");
  const router = useRouter();
  const [pending, mulai] = useTransition();
  const [isian, setIsian] = useState<Isian | null>(null);
  const pesan = (kode: string) => pesanGalatKas(t as unknown as Parameters<typeof pesanGalatKas>[0], { kode: `KAT_${kode}` });

  const simpan = () =>
    mulai(async () => {
      if (!isian) return;
      const r = await simpanKategoriAction({ id: isian.id, nama: isian.nama, jenis: isian.jenis, akunId: isian.akunId, jenisPotong: isian.potong === TANPA ? null : isian.potong, aktif: isian.aktif });
      if (!r.ok) return void toast.error(r.kode === "TANPA_AKSES" || r.kode === "GAGAL" ? pesanGalatKas(t as unknown as Parameters<typeof pesanGalatKas>[0], { kode: r.kode }) : pesan(r.kode));
      toast.success(t("kategori.tersimpan"));
      setIsian(null);
      router.refresh();
    });

  const bawaan = () =>
    mulai(async () => {
      const r = await pasangKategoriBawaanAction();
      if (!r.ok) return void toast.error(r.kode === "TANPA_AKUN" ? pesan("TANPA_AKUN") : pesanGalatKas(t as unknown as Parameters<typeof pesanGalatKas>[0], { kode: r.kode }));
      toast.success(t("kategori.bawaanTerpasang", { dibuat: r.dibuat, dilewati: r.dilewati }));
      router.refresh();
    });

  const opsiAkun = (jenis: "OUT" | "IN") =>
    akun
      .filter((a) => (jenis === "OUT" ? a.tipe !== "PENDAPATAN" : a.tipe !== "BEBAN" && a.tipe !== "HPP"))
      .map((a) => ({ value: a.id, label: `${a.kode} · ${a.nama}` }));

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("kategori.judul")}
        actions={
          <>
            <Link href="/backoffice/finance/kas">
              <Button variant="outline">
                <ArrowLeft className="mr-2 h-4 w-4" />
                {t("kembali")}
              </Button>
            </Link>
            {bolehKelola && (
              <>
                <Button variant="outline" onClick={bawaan} disabled={pending}>
                  <Sparkles className="mr-2 h-4 w-4" />
                  {t("kategori.isiBawaan")}
                </Button>
                <Button onClick={() => setIsian({ id: null, nama: "", jenis: "OUT", akunId: "", potong: TANPA, aktif: true })}>
                  <Plus className="mr-2 h-4 w-4" />
                  {t("kategori.tambah")}
                </Button>
              </>
            )}
          </>
        }
      />

      <Card className="py-0">
        <CardHeader className="pt-6">
          <CardTitle className="flex items-center gap-2">
            <Tags className="h-5 w-5" />
            {t("kategori.daftar")}
          </CardTitle>
        </CardHeader>
        <CardContent className="pb-6">
          {kategori.length === 0 ? (
            <EmptyState icon={Tags} title={t("kategori.kosong")} description={bolehKelola ? t("kategori.kosongIsi") : undefined} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("kategori.nama")}</TableHead>
                    <TableHead>{t("kategori.akun")}</TableHead>
                    <TableHead className="hidden xl:table-cell">{t("kategori.potong")}</TableHead>
                    <TableHead className="hidden text-right xl:table-cell">{t("kategori.dipakai")}</TableHead>
                    <TableHead>{t("kategori.status")}</TableHead>
                    {bolehKelola && (
                      <TableHead className="w-12">
                        <span className="sr-only">{t("kategori.ubah")}</span>
                      </TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {kategori.map((k) => {
                    const p = bacaJenisPotongPemasok(k.jenisPotong);
                    return (
                      <TableRow key={k.id}>
                        <TableCell className="whitespace-normal">
                          <p className="font-medium">{k.nama}</p>
                          <p className="text-xs text-muted-foreground">{t(`jenis.${k.jenis}`)}</p>
                        </TableCell>
                        <TableCell className="whitespace-normal text-sm">
                          {k.akunKode} · {k.akunNama}
                        </TableCell>
                        <TableCell className="hidden text-sm xl:table-cell">{p ? INFO_POTONG_PEMASOK[p].label : "–"}</TableCell>
                        <TableCell className="hidden text-right tabular-nums xl:table-cell">{k.dipakai}</TableCell>
                        <TableCell>{k.aktif ? <StatusPill tone="settled">{t("kategori.aktif")}</StatusPill> : <StatusPill tone="inactive">{t("kategori.nonaktif")}</StatusPill>}</TableCell>
                        {bolehKelola && (
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={t("kategori.ubahNama", { nama: k.nama })}
                              onClick={() => setIsian({ id: k.id, nama: k.nama, jenis: k.jenis, akunId: k.akunId, potong: p ?? TANPA, aktif: k.aktif })}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isian != null} onOpenChange={(v) => !pending && !v && setIsian(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isian?.id ? t("kategori.ubah") : t("kategori.tambah")}</DialogTitle>
            <DialogDescription>{t("kategori.dialogIsi")}</DialogDescription>
          </DialogHeader>
          {isian && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="nama-kategori">{t("kategori.nama")}</Label>
                <Input id="nama-kategori" value={isian.nama} maxLength={100} onChange={(e) => setIsian({ ...isian, nama: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>{t("form.jenis")}</Label>
                <Select value={isian.jenis} onValueChange={(v) => setIsian({ ...isian, jenis: v as "OUT" | "IN", akunId: "", potong: v === "IN" ? TANPA : isian.potong })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="OUT">{t("jenis.OUT")}</SelectItem>
                    <SelectItem value="IN">{t("jenis.IN")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("kategori.akun")}</Label>
                <SearchableCombobox options={opsiAkun(isian.jenis)} value={isian.akunId} onValueChange={(v) => setIsian({ ...isian, akunId: v })} placeholder={t("form.pilihAkun")} triggerClassName="w-full" />
              </div>
              {isian.jenis === "OUT" && (
                <div className="space-y-2">
                  <Label>{t("kategori.potong")}</Label>
                  <Select value={isian.potong} onValueChange={(v) => setIsian({ ...isian, potong: v })}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={TANPA}>{t("form.tanpaPotong")}</SelectItem>
                      {SEMUA_JENIS_POTONG_PEMASOK.map((j) => (
                        <SelectItem key={j} value={j}>
                          {INFO_POTONG_PEMASOK[j].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={isian.aktif} onCheckedChange={(v) => setIsian({ ...isian, aktif: v === true })} />
                {t("kategori.aktif")}
              </label>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsian(null)} disabled={pending}>
              {t("tutup")}
            </Button>
            <Button onClick={simpan} disabled={pending || !isian?.nama.trim() || !isian?.akunId}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("simpan")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
