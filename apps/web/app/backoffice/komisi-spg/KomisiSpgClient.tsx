"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ClipboardCheck, Coins, Loader2, Store } from "lucide-react";
import {
  batalkanTandaDicekAction,
  tandaiKomisiSpgDibayarAction,
  tandaiLaporanDicekAction,
  tetapkanKomisiSpgAction,
} from "@/app/actions/spg-komisi";
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
import type { KonsiMenungguKunciKantor, MenungguCekKantor } from "@/lib/spg/komisi-queries";
import { cn } from "@/lib/utils";

export type LaporanPutusTampil = {
  storeId: string;
  nama: string;
  kode: string;
  aktif: boolean;
  bulanJual: string;
  /** Null untuk komisi aturan lama yang ditetapkan tanpa tanda dicek. */
  dicek: { label: string; oleh: string | null } | null;
  potongToko: number;
  totalToko: number;
  potongTanpaTarif: number;
  adaResmi: boolean;
  adaDibayar: boolean;
  semuaDibayar: boolean;
  berbeda: boolean;
  aturanLama: boolean;
  baris: {
    userId: string;
    nama: string;
    ditugaskan: boolean;
    penerima: boolean;
    potong: number;
    komisi: number;
    potongTanpaTarif: number;
    status: StatusKomisi;
    resmi: {
      id: string;
      commission: number;
      /** Beban barang hilang yang dipotong saat ditetapkan. */
      deduction: number;
      unitsSold: number;
      aturanLama: boolean;
      ditetapkanLabel: string;
      dibayarLabel: string | null;
      note: string | null;
    } | null;
    /** Sisa beban barang hilang SPG ini yang belum terpotong. */
    bebanHilangSisa: number;
  }[];
};

export type KonsiTampil = {
  cycleId: string;
  noKonsi: string;
  nama: string;
  kode: string;
  bulanJual: string;
  dikunciLabel: string;
  /** Komisi menurut hitungan sekarang (tarif kategori × penjualan masing-masing SPG). */
  totalHitung: number;
  /** Komisi yang tersimpan saat dikunci — yang dibayar. */
  totalTersimpan: number;
  potongTanpaTarif: number;
  /** Hitungan sekarang tidak sama dengan yang tersimpan (per SPG). */
  berbeda: boolean;
  adaDibayar: boolean;
  semuaDibayar: boolean;
  baris: {
    id: string;
    nama: string;
    /** False = penjual dari toko lain: komisi saja, tanpa gaji pokok. */
    bergaji: boolean;
    gajiPokok: number;
    komisi: number;
    komisiHitung: number;
    total: number;
    potonganHilang: number;
    dibayarLabel: string | null;
  }[];
};

type Props = {
  /** Bulan PEMBAYARAN yang dibuka. */
  bulan: string;
  bulanIni: string;
  pilihan: string[];
  /** Menandai laporan dicek, membatalkannya, dan menetapkan komisi — `receivables:manage`. */
  bolehKelola: boolean;
  /** Menandai komisi dibayar — `spg_commission:pay`. */
  bolehBayar: boolean;
  /** Mengatur tarif per kategori — `spg_commission:manage`. */
  bolehAturTarif: boolean;
  putus: LaporanPutusTampil[];
  konsi: KonsiTampil[];
  menungguCek: MenungguCekKantor[];
  konsiMenungguKunci: KonsiMenungguKunciKantor[];
  ringkas: { totalDitetapkan: number; totalDibayar: number; belumDitetapkan: number; menungguCek: number };
};

/**
 * Komisi SPG satu BULAN PEMBAYARAN. Bulan dipilih lewat alamat (`?bulan=`), jadi bulan tertentu
 * bisa dibuka ulang dan dibagikan. Komisi milik bulan penjualannya tetapi dibayar di bulan
 * laporannya dicek: setiap laporan menyebut "Komisi penjualan …". Angka "hitungan" dihitung
 * langsung dengan satu hitungan komisi; angka "ditetapkan" adalah yang dibayar.
 */
export function KomisiSpgClient({
  bulan,
  bulanIni,
  pilihan,
  bolehKelola,
  bolehBayar,
  bolehAturTarif,
  putus,
  konsi,
  menungguCek,
  konsiMenungguKunci,
  ringkas,
}: Props) {
  const t = useTranslations("komisiSpg");
  const tBulan = dinamis(useTranslations("komisiSalesman"));
  const router = useRouter();
  const [pindah, mulaiPindah] = useTransition();
  const label = (b: string) => namaBulan(tBulan, b, "panjang");
  const kosong = putus.length === 0 && konsi.length === 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("judul")}
        meta={t("ringkasBayar", {
          resmi: formatIDR(ringkas.totalDitetapkan),
          dibayar: formatIDR(ringkas.totalDibayar),
          belum: ringkas.belumDitetapkan,
          tunggu: ringkas.menungguCek,
        })}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <Select value={bulan} onValueChange={(v) => mulaiPindah(() => router.replace(`/backoffice/komisi-spg?bulan=${v}`))}>
          <SelectTrigger className="w-full sm:w-[220px]" aria-label={t("pilihBulan")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {pilihan.map((b) => (
              <SelectItem key={b} value={b}>
                {label(b)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {pindah ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden /> : null}
        {bolehAturTarif ? (
          <Link
            href="/backoffice/settings/spg-commission"
            className="text-sm text-muted-foreground underline decoration-muted-foreground/50 underline-offset-2 hover:decoration-foreground"
          >
            {t("aturTarif")}
          </Link>
        ) : null}
      </div>

      <Alert>
        <AlertDescription>
          {t("aturan")}
          {bulan === bulanIni ? ` ${t("bulanBerjalanBayar")}` : ""}
        </AlertDescription>
      </Alert>

      <KartuMenunggu
        menungguCek={menungguCek}
        konsiMenungguKunci={konsiMenungguKunci}
        bulanIniLabel={label(bulanIni)}
        label={label}
        bolehKelola={bolehKelola}
      />

      {kosong ? (
        <Card>
          <CardContent>
            <EmptyState icon={Coins} title={t("laporan.kosongJudul", { bulan: label(bulan) })} description={t("laporan.kosongIsi")} />
          </CardContent>
        </Card>
      ) : null}

      {putus.map((l) => (
        <KartuPutus key={`${l.storeId}:${l.bulanJual}`} laporan={l} label={label} bolehKelola={bolehKelola} bolehBayar={bolehBayar} />
      ))}

      {konsi.map((k) => (
        <KartuKonsi key={k.cycleId} siklus={k} label={label} />
      ))}
    </div>
  );
}

function KartuMenunggu({
  menungguCek,
  konsiMenungguKunci,
  bulanIniLabel,
  label,
  bolehKelola,
}: {
  menungguCek: MenungguCekKantor[];
  konsiMenungguKunci: KonsiMenungguKunciKantor[];
  bulanIniLabel: string;
  label: (b: string) => string;
  bolehKelola: boolean;
}) {
  const t = useTranslations("komisiSpg");
  const ada = menungguCek.length > 0 || konsiMenungguKunci.length > 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardCheck className="h-5 w-5" aria-hidden />
          {t("tunggu.judul")}
        </CardTitle>
        <CardDescription>{t("tunggu.isi", { bulan: bulanIniLabel })}</CardDescription>
      </CardHeader>
      <CardContent className={ada ? "px-0" : undefined}>
        {!ada ? (
          <p className="text-sm text-muted-foreground">{t("tunggu.kosong")}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("kolom.toko")}</TableHead>
                  <TableHead>{t("tunggu.bulanJual")}</TableHead>
                  <TableHead className="text-right">{t("kolom.potong")}</TableHead>
                  <TableHead className="text-right">{t("kolom.hitungan")}</TableHead>
                  <TableHead className="text-right">{t("kolom.aksi")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {menungguCek.map((m) => (
                  <TableRow key={`${m.storeId}:${m.bulanJual}`}>
                    <TableCell className="min-w-[10rem] whitespace-normal">
                      <span className="font-medium">{m.nama}</span>
                      <span className="block text-xs text-muted-foreground">
                        {m.kode} · {t("tunggu.penerima", { n: m.jumlahPenerima })}
                      </span>
                      {m.adaResmiLama ? <span className="block text-xs text-amber-800 dark:text-amber-300">{t("tunggu.lama")}</span> : null}
                      {m.potongTanpaTarif > 0 ? (
                        <span className="block text-xs text-amber-800 dark:text-amber-300">{t("tanpaTarifCatatan", { pcs: m.potongTanpaTarif })}</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{label(m.bulanJual)}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.potongToko}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatIDR(m.totalToko)}</TableCell>
                    <TableCell className="text-right">
                      {bolehKelola ? (
                        <TombolDicek storeId={m.storeId} nama={m.nama} bulanJual={m.bulanJual} total={m.totalToko} bulanIniLabel={bulanIniLabel} label={label} />
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
                {konsiMenungguKunci.map((k) => (
                  <TableRow key={`konsi:${k.storeId}:${k.bulanJual}`}>
                    <TableCell className="min-w-[10rem] whitespace-normal">
                      <span className="font-medium">{k.nama}</span>
                      <span className="block text-xs text-muted-foreground">{t("konsiTunggu.isi")}</span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{label(k.bulanJual)}</TableCell>
                    <TableCell className="text-right">—</TableCell>
                    <TableCell className="text-right">—</TableCell>
                    <TableCell className="text-right">
                      <Button asChild variant="outline" size="sm">
                        <Link href={k.cycleId ? `/backoffice/konsinyasi/${k.cycleId}` : "/backoffice/konsinyasi"}>
                          {k.cycleId ? t("konsiTunggu.buka") : t("konsiTunggu.bukaDaftar")}
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
  );
}

function TombolDicek({
  storeId,
  nama,
  bulanJual,
  total,
  bulanIniLabel,
  label,
}: {
  storeId: string;
  nama: string;
  bulanJual: string;
  total: number;
  bulanIniLabel: string;
  label: (b: string) => string;
}) {
  const t = useTranslations("komisiSpg");
  const td = dinamis(t);
  const router = useRouter();
  const [sibuk, mulai] = useTransition();
  const [buka, setBuka] = useState(false);

  const tandai = () =>
    mulai(async () => {
      const r = await tandaiLaporanDicekAction({ storeId, periode: bulanJual });
      if (!r.ok) {
        toast.error(td(`err.${r.code}`));
        if (r.code === "SUDAH_DICEK" || r.code === "SUDAH_DIBAYAR") router.refresh();
        return;
      }
      setBuka(false);
      toast.success(t("dicekBerhasil", { bulan: label(r.bulanBayar) }));
      router.refresh();
    });

  return (
    <>
      <Button size="sm" onClick={() => setBuka(true)} disabled={sibuk}>
        {t("tandaiDicek")}
      </Button>
      <AlertDialog open={buka} onOpenChange={(v) => !sibuk && setBuka(v)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("dicekJudul", { toko: nama, bulan: label(bulanJual) })}</AlertDialogTitle>
            <AlertDialogDescription>{t("dicekIsi", { total: formatIDR(total), bulanBayar: bulanIniLabel, bulan: label(bulanJual) })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sibuk}>{t("batal")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={sibuk}
              onClick={(e) => {
                e.preventDefault();
                tandai();
              }}
            >
              {sibuk ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t("tandaiDicek")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function KartuPutus({
  laporan,
  label,
  bolehKelola,
  bolehBayar,
}: {
  laporan: LaporanPutusTampil;
  label: (b: string) => string;
  bolehKelola: boolean;
  bolehBayar: boolean;
}) {
  const t = useTranslations("komisiSpg");
  const td = dinamis(t);
  const router = useRouter();
  const [sibuk, mulai] = useTransition();
  const [buka, setBuka] = useState(false);
  const penerima = laporan.baris.filter((b) => b.penerima);
  const bulanLabel = label(laporan.bulanJual);

  // Alasan pertama yang menahan tombol Tetapkan, menurut urutan yang paling menentukan.
  const alasan = !laporan.dicek
    ? t("alasan.belumDicek")
    : laporan.adaDibayar
      ? t("alasan.sudahDibayar")
      : penerima.length === 0
        ? t("alasan.tanpaSpg")
        : null;

  const tetapkan = () =>
    mulai(async () => {
      const r = await tetapkanKomisiSpgAction({ storeId: laporan.storeId, periode: laporan.bulanJual });
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
          {laporan.nama}
          <span className="text-sm font-normal text-muted-foreground">{laporan.kode}</span>
          {!laporan.aktif ? <Badge variant="outline">{t("tokoNonaktif")}</Badge> : null}
        </CardTitle>
        <CardDescription>
          <span className="block font-medium text-foreground">{t("laporan.catatan", { bulan: bulanLabel })}</span>
          <span className="block">
            {laporan.dicek
              ? laporan.dicek.oleh
                ? t("laporan.dicek", { tanggal: laporan.dicek.label, nama: laporan.dicek.oleh })
                : t("laporan.dicekTanpaNama", { tanggal: laporan.dicek.label })
              : t("laporan.lama")}
          </span>
          <span className="block">{t("tokoRingkas", { pcs: laporan.potongToko, total: formatIDR(laporan.totalToko) })}</span>
        </CardDescription>
        {bolehKelola ? (
          <CardAction className="flex flex-col items-end gap-2">
            <Button onClick={() => setBuka(true)} disabled={alasan !== null || sibuk} variant={laporan.adaResmi ? "outline" : "default"}>
              {sibuk ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {laporan.adaResmi ? t("tetapkanUlang") : t("tetapkan")}
            </Button>
            {alasan ? <p className="max-w-[16rem] text-right text-xs text-muted-foreground">{alasan}</p> : null}
            {laporan.dicek && !laporan.adaDibayar ? (
              <TombolBatalDicek storeId={laporan.storeId} nama={laporan.nama} bulanJual={laporan.bulanJual} bulanLabel={bulanLabel} />
            ) : null}
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3 px-0">
        {laporan.potongTanpaTarif > 0 ? (
          <p className="mx-6 rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
            {t("tanpaTarifCatatan", { pcs: laporan.potongTanpaTarif })}
          </p>
        ) : null}
        {laporan.berbeda ? (
          <p className="mx-6 rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
            {laporan.adaDibayar ? t("berbedaDibayar") : t("berbeda")}
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
                {bolehBayar ? <TableHead className="text-right">{t("kolom.aksi")}</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {laporan.baris.map((b) => (
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
                  <TableCell className="text-right tabular-nums">{b.penerima ? formatIDR(b.komisi) : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {b.resmi ? (
                      <>
                        {formatIDR(b.resmi.commission)}
                        <span className="block text-xs text-muted-foreground">
                          {t("resmiRincianBaru", { pcs: b.resmi.unitsSold })}
                          {b.resmi.aturanLama ? ` · ${t("resmiAturanLama")}` : ""}
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
                  {bolehBayar ? (
                    <TableCell className="text-right">
                      {/* Membayar butuh laporan yang dicek dan baris bertarif kategori (penulis menolak
                          LAPORAN_BELUM_DICEK dan ATURAN_LAMA). */}
                      {b.resmi && b.status === "DITETAPKAN" && laporan.dicek && !b.resmi.aturanLama ? (
                        <TombolBayar
                          commissionId={b.resmi.id}
                          nama={b.nama}
                          jumlah={Math.max(0, b.resmi.commission - b.resmi.deduction)}
                          potongan={b.resmi.deduction}
                          bulanLabel={bulanLabel}
                          berbeda={laporan.berbeda}
                        />
                      ) : b.resmi && b.status === "DITETAPKAN" && laporan.dicek && b.resmi.aturanLama ? (
                        <span className="block max-w-[12rem] text-right text-xs text-muted-foreground">{t("alasan.aturanLamaBayar")}</span>
                      ) : null}
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="font-medium">{t("total")}</TableCell>
                <TableCell className="text-right tabular-nums">{laporan.potongToko}</TableCell>
                <TableCell className="text-right tabular-nums">{formatIDR(laporan.totalToko)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {laporan.adaResmi ? formatIDR(laporan.baris.reduce((n, b) => n + (b.resmi?.commission ?? 0), 0)) : "—"}
                </TableCell>
                <TableCell />
                {bolehBayar ? <TableCell /> : null}
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      </CardContent>

      <AlertDialog open={buka} onOpenChange={(v) => !sibuk && setBuka(v)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("konfirmasiJudul", { toko: laporan.nama, bulan: bulanLabel })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("konfirmasiIsi", { n: penerima.length, total: formatIDR(laporan.totalToko) })}
              {laporan.adaResmi ? ` ${t("konfirmasiUlang")}` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {laporan.potongTanpaTarif > 0 ? (
            <p className="rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
              {t("tanpaTarifCatatan", { pcs: laporan.potongTanpaTarif })}
            </p>
          ) : null}
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
              {laporan.adaResmi ? t("tetapkanUlang") : t("tetapkan")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function TombolBatalDicek({ storeId, nama, bulanJual, bulanLabel }: { storeId: string; nama: string; bulanJual: string; bulanLabel: string }) {
  const t = useTranslations("komisiSpg");
  const td = dinamis(t);
  const router = useRouter();
  const [sibuk, mulai] = useTransition();
  const [buka, setBuka] = useState(false);
  const [alasan, setAlasan] = useState("");
  const idAlasan = `batal-dicek-${storeId}-${bulanJual}`;

  const batalkan = () =>
    mulai(async () => {
      const r = await batalkanTandaDicekAction({ storeId, periode: bulanJual, alasan: alasan.trim() });
      if (!r.ok) {
        toast.error(td(`err.${r.code}`));
        if (r.code === "SUDAH_DIBAYAR" || r.code === "BELUM_DICEK") router.refresh();
        return;
      }
      setBuka(false);
      setAlasan("");
      toast.success(t("batalDicekBerhasil"));
      router.refresh();
    });

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setBuka(true)} disabled={sibuk}>
        {t("batalDicek")}
      </Button>
      <AlertDialog open={buka} onOpenChange={(v) => !sibuk && setBuka(v)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("batalDicekJudul", { toko: nama, bulan: bulanLabel })}</AlertDialogTitle>
            <AlertDialogDescription>{t("batalDicekIsi")}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor={idAlasan}>{t("batalDicekAlasan")}</Label>
            <Textarea
              id={idAlasan}
              value={alasan}
              onChange={(e) => setAlasan(e.target.value)}
              maxLength={500}
              placeholder={t("batalDicekContoh")}
              disabled={sibuk}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sibuk}>{t("batal")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={sibuk || alasan.trim() === ""}
              onClick={(e) => {
                e.preventDefault();
                batalkan();
              }}
            >
              {sibuk ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t("batalDicek")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function KartuKonsi({ siklus, label }: { siklus: KonsiTampil; label: (b: string) => string }) {
  const t = useTranslations("komisiSpg");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Store className="h-5 w-5" aria-hidden />
          {siklus.nama}
          <span className="text-sm font-normal text-muted-foreground">{siklus.noKonsi}</span>
        </CardTitle>
        <CardDescription>
          <span className="block font-medium text-foreground">{t("laporan.catatan", { bulan: label(siklus.bulanJual) })}</span>
          <span className="block">{t("konsi.dikunci", { tanggal: siklus.dikunciLabel })}</span>
          <span className="block">{t("konsi.bayarDiSiklus")}</span>
        </CardDescription>
        <CardAction>
          <Button asChild variant="outline" size="sm">
            <Link href={`/backoffice/konsinyasi/${siklus.cycleId}`}>{t("konsiTunggu.buka")}</Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3 px-0">
        {siklus.berbeda ? (
          <p className="mx-6 rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
            {siklus.adaDibayar ? t("konsi.berbedaDibayar") : t("konsi.berbeda")}
          </p>
        ) : null}
        {siklus.potongTanpaTarif > 0 ? (
          <p className="mx-6 rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
            {t("tanpaTarifCatatan", { pcs: siklus.potongTanpaTarif })}
          </p>
        ) : null}
        {siklus.baris.length === 0 ? (
          <p className="mx-6 text-sm text-muted-foreground">{t("konsi.tanpaBaris")}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("kolom.spg")}</TableHead>
                  <TableHead className="text-right">{t("kolom.gaji")}</TableHead>
                  <TableHead className="text-right">{t("kolom.hitungan")}</TableHead>
                  <TableHead className="text-right">{t("kolom.komisi")}</TableHead>
                  <TableHead className="text-right">{t("kolom.jumlah")}</TableHead>
                  <TableHead>{t("kolom.status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {siklus.baris.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="min-w-[10rem] whitespace-normal">
                      <span className="font-medium">{b.nama}</span>
                      {!b.bergaji ? <span className="block text-xs text-muted-foreground">{t("konsi.bukanPeserta")}</span> : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatIDR(b.gajiPokok)}</TableCell>
                    <TableCell
                      className={cn(
                        "text-right tabular-nums",
                        Math.round(b.komisiHitung * 100) !== Math.round(b.komisi * 100) && "text-amber-800 dark:text-amber-300",
                      )}
                    >
                      {formatIDR(b.komisiHitung)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatIDR(b.komisi)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatIDR(b.total)}
                      {b.potonganHilang > 0 ? (
                        <span className="block text-xs text-amber-800 dark:text-amber-300">
                          {t("resmiPotonganHilang", {
                            potongan: formatIDR(b.potonganHilang),
                            dibayar: formatIDR(Math.max(0, b.total - b.potonganHilang)),
                          })}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="min-w-[9rem] whitespace-normal">
                      <StatusBaris status={b.dibayarLabel ? "DIBAYAR" : "DITETAPKAN"} ditetapkan={siklus.dikunciLabel} dibayar={b.dibayarLabel} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="font-medium">{t("total")}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatIDR(siklus.baris.reduce((n, b) => n + b.gajiPokok, 0))}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatIDR(siklus.totalHitung)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatIDR(siklus.totalTersimpan)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatIDR(siklus.baris.reduce((n, b) => n + b.total, 0))}</TableCell>
                  <TableCell />
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        )}
      </CardContent>
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
        if (r.code === "SUDAH_DIBAYAR" || r.code === "LAPORAN_BELUM_DICEK" || r.code === "ATURAN_LAMA") router.refresh();
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
