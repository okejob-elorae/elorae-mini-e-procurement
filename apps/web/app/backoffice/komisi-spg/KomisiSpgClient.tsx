"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Coins, Loader2, Store } from "lucide-react";
import { tandaiKomisiSpgDibayarAction, tetapkanKomisiSpgAction } from "@/app/actions/spg-komisi";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { dinamis } from "@/lib/i18n/dinamis";
import { formatIDR } from "@/lib/sales-orders/format";
import { namaBulan } from "@/lib/salesman/komisi";
import type { StatusKomisi } from "@/lib/spg/komisi";
import type { TokoKonsiKomisi } from "@/lib/spg/komisi-queries";
import type { AturanKomisiPutus, DasarKomisi } from "@/lib/spg/pengaturan";
import { cn } from "@/lib/utils";

export type TokoKomisiTampil = {
  storeId: string;
  nama: string;
  kode: string;
  aktif: boolean;
  potongToko: number;
  totalToko: number;
  adaResmi: boolean;
  adaDibayar: boolean;
  semuaDibayar: boolean;
  berbeda: boolean;
  baris: {
    userId: string;
    nama: string;
    ditugaskan: boolean;
    penerima: boolean;
    potong: number;
    komisiKotor: number;
    potongan: number;
    komisi: number;
    status: StatusKomisi;
    resmi: {
      id: string;
      commission: number;
      /** Beban barang hilang yang dipotong saat ditetapkan. */
      deduction: number;
      unitsSold: number;
      basis: DasarKomisi;
      ditetapkanLabel: string;
      dibayarLabel: string | null;
      note: string | null;
    } | null;
    /** Sisa beban barang hilang SPG ini yang belum terpotong. */
    bebanHilangSisa: number;
  }[];
};

type Props = {
  periode: string;
  pilihan: string[];
  bulanSelesai: boolean;
  aturan: AturanKomisiPutus;
  bolehKelola: boolean;
  toko: TokoKomisiTampil[];
  tokoKonsi: TokoKonsiKomisi[];
  ringkas: { totalHitung: number; totalResmi: number; totalDibayar: number; tokoBelum: number };
};

/**
 * Komisi SPG toko putus satu bulan. Bulan dipilih lewat alamat (`?bulan=`),
 * jadi bulan tertentu bisa dibuka ulang dan dibagikan. Angka "hitungan"
 * dihitung langsung dari nota; angka "ditetapkan" adalah yang dibayar.
 */
export function KomisiSpgClient({ periode, pilihan, bulanSelesai, aturan, bolehKelola, toko, tokoKonsi, ringkas }: Props) {
  const t = useTranslations("komisiSpg");
  const td = dinamis(t);
  const tBulan = dinamis(useTranslations("komisiSalesman"));
  const router = useRouter();
  const [pindah, mulaiPindah] = useTransition();
  const bulanLabel = namaBulan(tBulan, periode, "panjang");

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("judul")}
        meta={t("ringkas", {
          hitung: formatIDR(ringkas.totalHitung),
          resmi: formatIDR(ringkas.totalResmi),
          dibayar: formatIDR(ringkas.totalDibayar),
          belum: ringkas.tokoBelum,
        })}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <Select value={periode} onValueChange={(v) => mulaiPindah(() => router.replace(`/backoffice/komisi-spg?bulan=${v}`))}>
          <SelectTrigger className="w-full sm:w-[200px]" aria-label={t("pilihBulan")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {pilihan.map((b) => (
              <SelectItem key={b} value={b}>
                {namaBulan(tBulan, b, "panjang")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {pindah ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden /> : null}
        <p className="text-sm text-muted-foreground">
          {td(`dasarAktif.${aturan.dasar}`)}{" "}
          <Link href="/backoffice/settings/spg" className="text-primary underline-offset-2 hover:underline">
            {t("ubahPengaturan")}
          </Link>
        </p>
      </div>

      {!aturan.aktif ? (
        <Alert>
          <AlertDescription>{t("mati")}</AlertDescription>
        </Alert>
      ) : null}
      {!bulanSelesai ? (
        <Alert>
          <AlertDescription>{t("bulanBerjalan")}</AlertDescription>
        </Alert>
      ) : null}

      {toko.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState icon={Coins} title={t("kosongJudul")} description={t("kosongIsi", { bulan: bulanLabel })} />
          </CardContent>
        </Card>
      ) : (
        toko.map((tk) => (
          <KartuToko key={tk.storeId} toko={tk} periode={periode} bulanLabel={bulanLabel} bulanSelesai={bulanSelesai} aktif={aturan.aktif} bolehKelola={bolehKelola} />
        ))
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Store className="h-5 w-5" aria-hidden />
            {t("konsi.judul")}
          </CardTitle>
        </CardHeader>
        <CardContent className={tokoKonsi.length === 0 ? undefined : "px-0"}>
          {tokoKonsi.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("konsi.kosong")}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("kolom.toko")}</TableHead>
                    <TableHead className="text-right">{t("konsi.jumlahSpg")}</TableHead>
                    <TableHead className="text-right">{t("kolom.aksi")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tokoKonsi.map((k) => (
                    <TableRow key={k.storeId}>
                      <TableCell className="whitespace-normal">
                        <span className="font-medium">{k.nama}</span>
                        <span className="block text-xs text-muted-foreground">{k.kode}</span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{k.jumlahSpg}</TableCell>
                      <TableCell className="text-right">
                        <Button asChild variant="outline" size="sm">
                          <Link href={k.siklusId ? `/backoffice/konsinyasi/${k.siklusId}` : "/backoffice/konsinyasi"}>
                            {k.siklusId ? t("konsi.bukaSiklus", { bulan: bulanLabel }) : t("konsi.bukaDaftar")}
                          </Link>
                        </Button>
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

function KartuToko({
  toko,
  periode,
  bulanLabel,
  bulanSelesai,
  aktif,
  bolehKelola,
}: {
  toko: TokoKomisiTampil;
  periode: string;
  bulanLabel: string;
  bulanSelesai: boolean;
  aktif: boolean;
  bolehKelola: boolean;
}) {
  const t = useTranslations("komisiSpg");
  const td = dinamis(t);
  const router = useRouter();
  const [sibuk, mulai] = useTransition();
  const [buka, setBuka] = useState(false);
  const penerima = toko.baris.filter((b) => b.penerima);
  const totalPenerima = penerima.reduce((n, b) => n + b.komisi, 0);

  // Alasan pertama yang menahan tombol, menurut urutan yang paling menentukan.
  const alasan = !bulanSelesai
    ? t("alasan.bulanBerjalan")
    : !aktif
      ? t("alasan.mati")
      : toko.adaDibayar
        ? t("alasan.sudahDibayar")
        : penerima.length === 0
          ? t("alasan.tanpaSpg")
          : null;

  const tetapkan = () =>
    mulai(async () => {
      const r = await tetapkanKomisiSpgAction({ storeId: toko.storeId, periode });
      if (!r.ok) {
        toast.error(td(`err.${r.code}`));
        return;
      }
      setBuka(false);
      toast.success(r.ulang ? t("tetapkanUlangBerhasil") : t("tetapkanBerhasil", { n: r.ditulis }));
      router.refresh();
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Coins className="h-5 w-5" aria-hidden />
          {toko.nama}
          <span className="text-sm font-normal text-muted-foreground">{toko.kode}</span>
          {!toko.aktif ? <Badge variant="outline">{t("tokoNonaktif")}</Badge> : null}
        </CardTitle>
        <CardDescription>{t("tokoRingkas", { pcs: toko.potongToko, total: formatIDR(toko.totalToko) })}</CardDescription>
        {bolehKelola ? (
          <CardAction className="flex flex-col items-end gap-1">
            <Button onClick={() => setBuka(true)} disabled={alasan !== null || sibuk} variant={toko.adaResmi ? "outline" : "default"}>
              {sibuk ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {toko.adaResmi ? t("tetapkanUlang") : t("tetapkan")}
            </Button>
            {alasan ? <p className="max-w-[16rem] text-right text-xs text-muted-foreground">{alasan}</p> : null}
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3 px-0">
        {toko.berbeda ? (
          <p className="mx-6 rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
            {toko.adaDibayar ? t("berbedaDibayar") : t("berbeda")}
          </p>
        ) : null}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("kolom.spg")}</TableHead>
                <TableHead className="text-right">{t("kolom.potong")}</TableHead>
                <TableHead className="text-right">{t("kolom.hitungan")}</TableHead>
                <TableHead className="text-right">{t("kolom.ditetapkan")}</TableHead>
                <TableHead>{t("kolom.status")}</TableHead>
                {bolehKelola ? <TableHead className="text-right">{t("kolom.aksi")}</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {toko.baris.map((b) => (
                <TableRow key={b.userId} className={cn(!b.penerima && "text-muted-foreground")}>
                  <TableCell className="min-w-[10rem] whitespace-normal">
                    <span className="font-medium">{b.nama}</span>
                    {!b.ditugaskan ? <span className="block text-xs text-muted-foreground">{t("bukanSpgToko")}</span> : null}
                    {!b.penerima ? <span className="block text-xs text-muted-foreground">{t("tidakMenerima")}</span> : null}
                    {b.bebanHilangSisa > 0 && b.status !== "DIBAYAR" ? (
                      <span className="block text-xs text-amber-800 dark:text-amber-300">
                        {t("bebanHilangSisa", { jumlah: formatIDR(b.bebanHilangSisa) })}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{b.potong}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {b.penerima ? formatIDR(b.komisi) : "—"}
                    {b.potongan > 0 ? (
                      <span className="block text-xs text-muted-foreground">
                        {t("rincianPotongan", { kotor: formatIDR(b.komisiKotor), potongan: formatIDR(b.potongan) })}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {b.resmi ? (
                      <>
                        {formatIDR(b.resmi.commission)}
                        <span className="block text-xs text-muted-foreground">
                          {t("resmiRincian", { pcs: b.resmi.unitsSold, dasar: td(`dasarPendek.${b.resmi.basis}`) })}
                        </span>
                        {b.resmi.deduction > 0 ? (
                          <span className="block text-xs text-amber-800 dark:text-amber-300">
                            {t("resmiPotonganHilang", {
                              potongan: formatIDR(b.resmi.deduction),
                              dibayar: formatIDR(Math.max(0, b.resmi.commission - b.resmi.deduction)),
                            })}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="min-w-[9rem] whitespace-normal">
                    <StatusBaris status={b.status} ditetapkan={b.resmi?.ditetapkanLabel ?? null} dibayar={b.resmi?.dibayarLabel ?? null} />
                    {b.resmi?.note ? <span className="block text-xs text-muted-foreground">{b.resmi.note}</span> : null}
                  </TableCell>
                  {bolehKelola ? (
                    <TableCell className="text-right">
                      {b.resmi && b.status === "DITETAPKAN" ? (
                        <TombolBayar
                          commissionId={b.resmi.id}
                          nama={b.nama}
                          jumlah={Math.max(0, b.resmi.commission - b.resmi.deduction)}
                          potongan={b.resmi.deduction}
                          bulanLabel={bulanLabel}
                          berbeda={toko.berbeda}
                        />
                      ) : null}
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="font-medium">{t("total")}</TableCell>
                <TableCell className="text-right tabular-nums">{toko.potongToko}</TableCell>
                <TableCell className="text-right tabular-nums">{formatIDR(totalPenerima)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {toko.adaResmi ? formatIDR(toko.baris.reduce((n, b) => n + (b.resmi?.commission ?? 0), 0)) : "—"}
                </TableCell>
                <TableCell />
                {bolehKelola ? <TableCell /> : null}
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      </CardContent>

      <AlertDialog open={buka} onOpenChange={(v) => !sibuk && setBuka(v)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("konfirmasiJudul", { toko: toko.nama, bulan: bulanLabel })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("konfirmasiIsi", { n: penerima.length, total: formatIDR(totalPenerima) })}
              {toko.adaResmi ? ` ${t("konfirmasiUlang")}` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sibuk}>{t("batal")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={sibuk}
              onClick={(e) => {
                e.preventDefault();
                tetapkan();
              }}
            >
              {sibuk ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {toko.adaResmi ? t("tetapkanUlang") : t("tetapkan")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function StatusBaris({ status, ditetapkan, dibayar }: { status: StatusKomisi; ditetapkan: string | null; dibayar: string | null }) {
  const t = useTranslations("komisiSpg");
  if (status === "DIBAYAR") {
    return (
      <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-800 dark:text-emerald-300">
        {t("status.dibayar", { tanggal: dibayar ?? "—" })}
      </Badge>
    );
  }
  if (status === "DITETAPKAN") {
    return (
      <Badge variant="outline" className="border-amber-500/50 text-amber-800 dark:text-amber-300">
        {t("status.ditetapkan", { tanggal: ditetapkan ?? "—" })}
      </Badge>
    );
  }
  return <Badge variant="outline">{t("status.belum")}</Badge>;
}

function TombolBayar({
  commissionId,
  nama,
  jumlah,
  potongan,
  bulanLabel,
  berbeda,
}: {
  commissionId: string;
  nama: string;
  /** Yang dibayarkan: komisi − potongan beban barang hilang. */
  jumlah: number;
  potongan: number;
  bulanLabel: string;
  berbeda: boolean;
}) {
  const t = useTranslations("komisiSpg");
  const td = dinamis(t);
  const router = useRouter();
  const [sibuk, mulai] = useTransition();
  const [buka, setBuka] = useState(false);
  const [catatan, setCatatan] = useState("");

  const bayar = () =>
    mulai(async () => {
      const r = await tandaiKomisiSpgDibayarAction({ commissionId, catatan: catatan.trim() || null });
      if (!r.ok) {
        toast.error(td(`err.${r.code}`));
        if (r.code === "SUDAH_DIBAYAR") router.refresh();
        return;
      }
      setBuka(false);
      setCatatan("");
      toast.success(t("bayarBerhasil", { nama }));
      router.refresh();
    });

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setBuka(true)} disabled={sibuk}>
        {t("tandaiDibayar")}
      </Button>
      <AlertDialog open={buka} onOpenChange={(v) => !sibuk && setBuka(v)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("bayarJudul", { nama, bulan: bulanLabel })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("bayarIsi", { jumlah: formatIDR(jumlah) })}
              {potongan > 0 ? ` ${t("bayarPotonganHilang", { potongan: formatIDR(potongan) })}` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {berbeda ? <p className="rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">{t("bayarBerbeda")}</p> : null}
          <div className="space-y-1.5">
            <Label htmlFor={`catatan-${commissionId}`}>{t("catatanLabel")}</Label>
            <Textarea
              id={`catatan-${commissionId}`}
              value={catatan}
              onChange={(e) => setCatatan(e.target.value)}
              maxLength={500}
              placeholder={t("catatanContoh")}
              disabled={sibuk}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sibuk}>{t("batal")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={sibuk}
              onClick={(e) => {
                e.preventDefault();
                bayar();
              }}
            >
              {sibuk ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t("tandaiDibayar")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
