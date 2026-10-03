"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Layers, Loader2, Search, Settings } from "lucide-react";
import { terapkanUsulanKelasAction } from "./actions";
import type { BarisKelasToko } from "@/lib/stores/queries";
import type { KelasToko } from "@/lib/stores/kelas-toko";
import { formatIDR } from "@/lib/sales-orders/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const angka = new Intl.NumberFormat("id-ID");

/** Usulan yang bisa diterapkan: ada, dan berbeda dari kelas sekarang. */
const bisaDiterapkan = (b: BarisKelasToko) => b.usulan !== null && b.usulan !== b.kelas;

function LencanaKelas({ kelas, kosong }: { kelas: KelasToko | null; kosong: string }) {
  if (!kelas) return <span className="text-muted-foreground">{kosong}</span>;
  return (
    <Badge variant={kelas === "A" ? "default" : kelas === "B" ? "secondary" : "outline"} className="font-mono">
      {kelas}
    </Badge>
  );
}

export function KelasTokoClient({
  baris,
  hari,
  jarakHari,
  persen,
  otomatisAktif,
  bolehKelola,
  bolehAturJarak,
}: {
  baris: BarisKelasToko[];
  hari: number;
  jarakHari: Record<KelasToko, number>;
  persen: Record<KelasToko, number>;
  otomatisAktif: boolean;
  bolehKelola: boolean;
  bolehAturJarak: boolean;
}) {
  const t = useTranslations("kelasToko.halaman");
  const tBadge = useTranslations("stores.badge");
  const router = useRouter();
  const [sibuk, mulai] = useTransition();
  const [cari, setCari] = useState("");
  const [hanyaBerbeda, setHanyaBerbeda] = useState(true);
  const [dipilih, setDipilih] = useState<Set<string>>(() => new Set());
  const [konfirmasi, setKonfirmasi] = useState(false);

  const jumlahBerbeda = useMemo(() => baris.filter(bisaDiterapkan).length, [baris]);
  const tampil = useMemo(() => {
    const q = cari.trim().toLowerCase();
    return baris.filter(
      (b) =>
        (!hanyaBerbeda || bisaDiterapkan(b)) &&
        (!q || b.name.toLowerCase().includes(q) || b.code.toLowerCase().includes(q)),
    );
  }, [baris, cari, hanyaBerbeda]);
  const tampilBisa = tampil.filter(bisaDiterapkan);
  // Pilihan yang masih terlihat dan masih bisa diterapkan — pilihan yang
  // tersaring keluar tidak ikut diterapkan diam-diam.
  const pilihanAktif = tampilBisa.filter((b) => dipilih.has(b.storeId));
  const semuaTerpilih = tampilBisa.length > 0 && pilihanAktif.length === tampilBisa.length;

  const ubahPilih = (id: string, ya: boolean) =>
    setDipilih((prev) => {
      const baru = new Set(prev);
      if (ya) baru.add(id);
      else baru.delete(id);
      return baru;
    });

  const pilihSemua = (ya: boolean) =>
    setDipilih((prev) => {
      const baru = new Set(prev);
      for (const b of tampilBisa) {
        if (ya) baru.add(b.storeId);
        else baru.delete(b.storeId);
      }
      return baru;
    });

  const terapkan = () =>
    mulai(async () => {
      const r = await terapkanUsulanKelasAction(pilihanAktif.map((b) => b.storeId));
      setKonfirmasi(false);
      if (!r.ok) {
        toast.error(r.code === "FORBIDDEN" ? t("errForbidden") : t("errInvalid"));
        return;
      }
      toast.success(t("berhasil", { count: r.diubah }));
      setDipilih(new Set());
      router.refresh();
    });

  const nilai = (b: BarisKelasToko) =>
    b.satuan === "POTONG" ? t("potong", { n: angka.format(b.nilai) }) : formatIDR(b.nilai);

  return (
    <div className="space-y-6">
      <div className="-ml-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/backoffice/stores">
            <ArrowLeft className="h-4 w-4" />
            {t("kembali")}
          </Link>
        </Button>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("judul")}</h1>
          <p className="text-muted-foreground">{t("subjudul", { days: hari })}</p>
        </div>
        {bolehAturJarak ? (
          <Button asChild variant="outline">
            <Link href="/backoffice/settings/salesman">
              <Settings className="h-4 w-4" />
              {t("aturJarak")}
            </Link>
          </Button>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("caraJudul")}</CardTitle>
          <CardDescription>{t("caraIsi", { days: hari })}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="grid gap-2 sm:grid-cols-3">
            {(["A", "B", "C"] as const).map((k) => (
              <div key={k} className="flex items-center gap-3 rounded-lg border p-3">
                <LencanaKelas kelas={k} kosong="" />
                <div className="min-w-0">
                  <p className="font-medium">
                    {k === "A"
                      ? t("aturanA", { pct: persen.A })
                      : k === "B"
                        ? t("aturanB", { pct: persen.B })
                        : t("aturanC", { pct: persen.C })}
                  </p>
                  <p className="text-xs text-muted-foreground">{t("tiapHari", { days: jarakHari[k] })}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{t("konsiCatatan")}</p>
          <p className="text-xs text-muted-foreground">{otomatisAktif ? t("otomatisNyala") : t("otomatisMati")}</p>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("cari")}
            value={cari}
            onChange={(e) => setCari(e.target.value)}
            className="pl-9"
            aria-label={t("cari")}
          />
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="hanya-berbeda"
            checked={hanyaBerbeda}
            onCheckedChange={(v) => setHanyaBerbeda(v === true)}
          />
          <Label htmlFor="hanya-berbeda" className="cursor-pointer text-sm font-normal">
            {t("hanyaBerbeda", { count: jumlahBerbeda })}
          </Label>
        </div>
        {bolehKelola ? (
          <Button className="sm:ml-auto" disabled={sibuk || pilihanAktif.length === 0} onClick={() => setKonfirmasi(true)}>
            {sibuk ? <Loader2 className="h-4 w-4 animate-spin" /> : <Layers className="h-4 w-4" />}
            {t("terapkan", { count: pilihanAktif.length })}
          </Button>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5" />
            {t("daftarJudul")}
            <span className="ml-2 text-sm font-normal text-muted-foreground">({t("jumlah", { count: tampil.length })})</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {tampil.length === 0 ? (
            <div className="py-12 text-center">
              <Layers className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
              <p className="text-muted-foreground">{hanyaBerbeda && !cari.trim() ? t("kosongBerbeda") : t("kosong")}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {bolehKelola ? (
                      <TableHead className="w-10">
                        <Checkbox
                          aria-label={t("pilihSemua")}
                          checked={semuaTerpilih}
                          disabled={tampilBisa.length === 0}
                          onCheckedChange={(v) => pilihSemua(v === true)}
                        />
                      </TableHead>
                    ) : null}
                    <TableHead>{t("kolomKode")}</TableHead>
                    <TableHead>{t("kolomNama")}</TableHead>
                    <TableHead>{t("kolomArea")}</TableHead>
                    <TableHead>{t("kolomJenis")}</TableHead>
                    <TableHead className="text-right">{t("kolomNilai", { days: hari })}</TableHead>
                    <TableHead>{t("kolomSekarang")}</TableHead>
                    <TableHead>{t("kolomUsulan")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tampil.map((b) => {
                    const bisa = bisaDiterapkan(b);
                    return (
                      <TableRow key={b.storeId}>
                        {bolehKelola ? (
                          <TableCell>
                            <Checkbox
                              aria-label={t("pilihToko", { name: b.name })}
                              checked={bisa && dipilih.has(b.storeId)}
                              disabled={!bisa}
                              onCheckedChange={(v) => ubahPilih(b.storeId, v === true)}
                            />
                          </TableCell>
                        ) : null}
                        <TableCell className="font-mono text-xs">{b.code}</TableCell>
                        <TableCell className="font-medium">
                          <Link href={`/backoffice/stores/${b.storeId}`} className="hover:underline">
                            {b.name}
                          </Link>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {b.areaKode ?? <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell>
                          <Badge variant={b.termsType === "PUTUS" ? "outline" : "secondary"}>
                            {b.termsType === "PUTUS" ? tBadge("putus") : tBadge("konsi")}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {b.nilai > 0 ? nilai(b) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell>
                          <LencanaKelas kelas={b.kelas} kosong={t("tanpaKelas")} />
                        </TableCell>
                        <TableCell>
                          {b.usulan === null ? (
                            <span className="text-xs text-muted-foreground">{t("tanpaPembelian")}</span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5">
                              {bisa ? <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden /> : null}
                              <LencanaKelas kelas={b.usulan} kosong="" />
                              {!bisa ? <span className="text-xs text-muted-foreground">{t("sudahSesuai")}</span> : null}
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={konfirmasi} onOpenChange={(v) => !sibuk && setKonfirmasi(v)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("konfirmasiJudul", { count: pilihanAktif.length })}</AlertDialogTitle>
            <AlertDialogDescription>{t("konfirmasiIsi")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sibuk}>{t("batal")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={sibuk}
              onClick={(e) => {
                // Tetap terbuka sampai server menjawab; ditutup oleh `terapkan`.
                e.preventDefault();
                terapkan();
              }}
            >
              {sibuk ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {sibuk ? t("menerapkan") : t("ya")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
