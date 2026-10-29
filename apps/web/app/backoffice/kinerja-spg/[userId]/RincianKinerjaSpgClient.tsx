"use client";

import { useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, CalendarDays, Gauge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatRupiah } from "@/lib/format/rupiah";
import { dinamis } from "@/lib/i18n/dinamis";
import type { BagianKinerjaSpg, DataKinerjaSpgHarian, HariKinerjaTampil } from "@/lib/spg/kinerja-queries";
import { cn } from "@/lib/utils";

const NADA_STATUS: Record<NonNullable<HariKinerjaTampil["status"]>, string> = {
  HADIR: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  TERLAMBAT: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  MASUK_SAAT_LIBUR: "bg-muted text-muted-foreground",
  TIDAK_MASUK: "bg-destructive/10 text-destructive",
  BELUM_MASUK: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  IZIN: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
};

/**
 * Rincian harian satu SPG: ringkasan bulan (angka yang sama dengan barisnya di
 * daftar) lalu satu baris per hari — shift, jam masuk dan keterangannya,
 * penjualan bersih, pengunjung, konversi, tutup hari, titip pesan. Hari yang
 * belum tiba hanya menampilkan jadwalnya. Bulan berpindah dengan `replace`.
 */
export function RincianKinerjaSpgClient({ data }: { data: DataKinerjaSpgHarian }) {
  const t = useTranslations("kinerjaSpg");
  const td = dinamis(t);
  const locale = useLocale();
  const router = useRouter();
  const [menunggu, mulai] = useTransition();
  const angka = new Intl.NumberFormat(locale === "en" ? "en-US" : "id-ID", { maximumFractionDigits: 1 });
  const persen = (n: number | null) => (n === null ? "—" : `${angka.format(n)}%`);

  const gantiBulan = (bulan: string) => mulai(() => router.replace(`/backoffice/kinerja-spg/${data.userId}?bulan=${bulan}`, { scroll: false }));

  const keterangan = (h: HariKinerjaTampil): ReactNode => {
    if (!h.status) return h.depan ? null : <span className="text-muted-foreground">—</span>;
    const teks =
      h.status === "TERLAMBAT"
        ? t("rincian.status.TERLAMBAT", { menit: h.terlambatMenit ?? 0 })
        : h.status === "IZIN"
          ? td(`rincian.jenisIzin.${h.izin ?? "IZIN"}`)
          : td(`rincian.status.${h.status}`);
    return <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", NADA_STATUS[h.status])}>{teks}</span>;
  };

  const shift = (h: HariKinerjaTampil): ReactNode => {
    if (!h.shift) return <span className="text-muted-foreground">{t("rincian.tanpaJadwalPendek")}</span>;
    if (h.shift.jenis === "LIBUR") return t("rincian.libur");
    return (
      <span>
        {h.shift.label}
        {/* Jam gaya WIB "10.00", sama dengan kisi Jadwal SPG. */}
        {h.shift.mulai ? (
          <span className="block text-xs text-muted-foreground">{`${h.shift.mulai.replace(":", ".")}–${(h.shift.selesai ?? "").replace(":", ".")}`}</span>
        ) : null}
      </span>
    );
  };

  const tutup = (h: HariKinerjaTampil): ReactNode => {
    if (h.depan || (h.nota === 0 && !h.tutup)) return <span className="text-muted-foreground">—</span>;
    if (h.tutup) return t("rincian.tutupAda");
    return <span className="font-medium text-amber-700 dark:text-amber-300">{t("rincian.tutupBelum")}</span>;
  };

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href={`/backoffice/kinerja-spg?bulan=${data.bulan}`}>
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          {t("rincian.kembali")}
        </Link>
      </Button>

      <PageHeader
        title={data.nama}
        meta={data.labelBulan}
        actions={
          <Select value={data.bulan} onValueChange={gantiBulan} disabled={menunggu}>
            <SelectTrigger className="w-52" aria-label={t("bulan")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {data.pilihanBulan.map((p) => (
                <SelectItem key={p.bulan} value={p.bulan}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      <div className={cn("space-y-6 transition-opacity", menunggu && "opacity-60")} aria-busy={menunggu}>
        {data.bagian.length === 0 ? (
          <Card>
            <CardContent>
              <EmptyState icon={Gauge} title={t("rincian.kosongJudul")} description={t("rincian.kosongIsi", { bulan: data.labelBulan })} />
            </CardContent>
          </Card>
        ) : (
          data.bagian.map((b) => <BagianToko key={b.storeId} b={b} angka={angka} persen={persen} keterangan={keterangan} shift={shift} tutup={tutup} toleransi={data.toleransiMenit} />)
        )}
      </div>
    </div>
  );
}

function BagianToko({
  b,
  angka,
  persen,
  keterangan,
  shift,
  tutup,
  toleransi,
}: {
  b: BagianKinerjaSpg;
  angka: Intl.NumberFormat;
  persen: (n: number | null) => string;
  keterangan: (h: HariKinerjaTampil) => ReactNode;
  shift: (h: HariKinerjaTampil) => ReactNode;
  tutup: (h: HariKinerjaTampil) => ReactNode;
  toleransi: number;
}) {
  const t = useTranslations("kinerjaSpg");
  const r = b.ringkas;
  const kosong = "—";
  const ubin: { label: string; nilai: string; catatan?: string }[] = [
    {
      label: t("rincian.ubin.kehadiran"),
      nilai: r.hariDijadwalkan === null ? t("rincian.ubin.masukSaja", { masuk: r.hariMasuk }) : t("rincian.ubin.masukDari", { masuk: r.hariMasuk, jadwal: r.hariDijadwalkan }),
      catatan: r.jadwalDisusun ? undefined : t("rincian.ubin.belumDisusun"),
    },
    {
      label: t("kolom.terlambat"),
      nilai: r.terlambatKali === null ? kosong : t("sel.terlambatPenuh", { kali: r.terlambatKali, menit: r.terlambatMenit ?? 0 }),
      catatan: t("rincian.ubin.toleransi", { menit: toleransi }),
    },
    { label: t("kolom.tidakMasuk"), nilai: r.tidakMasuk === null ? kosong : angka.format(r.tidakMasuk) },
    { label: t("kolom.izin"), nilai: angka.format(r.hariIzin) },
    { label: t("kolom.nota"), nilai: angka.format(r.nota), catatan: t("rincian.ubin.potong", { n: angka.format(r.potong) }) },
    { label: t("kolom.nilai"), nilai: formatRupiah(r.nilai), catatan: r.rataNota === null ? undefined : t("rincian.ubin.rata", { nilai: formatRupiah(r.rataNota) }) },
    {
      label: t("kolom.pengunjung"),
      nilai: r.pengunjung === null ? kosong : angka.format(r.pengunjung),
      catatan: r.hariPengunjungDariTutup > 0 ? t("sel.dariTutup", { n: r.hariPengunjungDariTutup }) : undefined,
    },
    { label: t("kolom.konversi"), nilai: persen(r.konversiPersen) },
    {
      label: t("kolom.target"),
      nilai: persen(r.capaianPersen),
      catatan: r.target === null ? t("sel.tanpaTarget") : t("rincian.ubin.target", { capai: formatRupiah(r.nilaiOrang), target: formatRupiah(r.target) }),
    },
    { label: t("kolom.tutup"), nilai: persen(r.kepatuhanTutupPersen), catatan: t("sel.tutup", { ditutup: r.hariJualDitutup, jual: r.hariJual }) },
    { label: t("kolom.titip"), nilai: t("sel.titip", { dibuat: r.titipDibuat, selesai: r.titipSelesai }) },
    { label: t("kolom.retur"), nilai: persen(r.persenKembali), catatan: t("rincian.ubin.kembali", { kembali: r.qtyKembali, terjual: r.qtyTerjual }) },
    { label: t("kolom.pembeli"), nilai: persen(r.persenBerpembeli), catatan: t("sel.pembeli", { ada: r.notaBerpembeli, nota: r.nota }) },
    { label: t("kolom.memberBaru"), nilai: angka.format(r.memberBaru) },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <CalendarDays className="h-5 w-5" />
          {b.kodeToko ? `${b.toko} (${b.kodeToko})` : b.toko}
          {b.bukanTokoTetap ? <span className="text-sm font-normal text-muted-foreground">· {t("bukanTokoTetap")}</span> : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
          {ubin.map((u) => (
            <div key={u.label} className="rounded-lg border px-3 py-2">
              <p className="text-xs text-muted-foreground">{u.label}</p>
              <p className="text-lg font-semibold tabular-nums">{u.nilai}</p>
              {u.catatan ? <p className="text-xs text-muted-foreground">{u.catatan}</p> : null}
            </div>
          ))}
        </div>

        <div className="-mx-6 overflow-x-auto [--tabel-tepi:1.5rem]">
          <Table>
            {/* Judul kolom boleh patah dua baris supaya tabel muat di laptop 1280 px. */}
            <TableHeader className="[&_th]:whitespace-normal">
              <TableRow>
                <TableHead>{t("rincian.kolom.hari")}</TableHead>
                <TableHead>{t("rincian.kolom.shift")}</TableHead>
                <TableHead>{t("rincian.kolom.masuk")}</TableHead>
                <TableHead className="min-w-[9rem]">{t("rincian.kolom.keterangan")}</TableHead>
                <TableHead className="text-right">{t("kolom.nota")}</TableHead>
                <TableHead className="text-right">{t("kolom.potong")}</TableHead>
                <TableHead className="text-right">{t("kolom.nilai")}</TableHead>
                <TableHead className="text-right">{t("kolom.pengunjung")}</TableHead>
                {/* Konversi = nota ÷ pengunjung: disembunyikan di bawah 2xl supaya tabel muat di laptop 1280 px. */}
                <TableHead className="hidden text-right 2xl:table-cell">{t("kolom.konversi")}</TableHead>
                <TableHead>{t("kolom.tutup")}</TableHead>
                <TableHead className="text-right">{t("kolom.titip")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {b.hari.map((h) => (
                <TableRow key={h.day} className={cn(h.depan && "text-muted-foreground opacity-60", h.status === "TIDAK_MASUK" && "bg-destructive/[0.04]")}>
                  <TableCell className="font-medium">{h.label}</TableCell>
                  <TableCell>{shift(h)}</TableCell>
                  <TableCell className="tabular-nums">{h.jamMasuk ?? <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="whitespace-normal">{keterangan(h)}</TableCell>
                  <TableCell className="text-right tabular-nums">{h.depan ? "" : angka.format(h.nota)}</TableCell>
                  <TableCell className="text-right tabular-nums">{h.depan ? "" : angka.format(h.potong)}</TableCell>
                  <TableCell className="text-right tabular-nums">{h.depan ? "" : formatRupiah(h.nilai)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {h.pengunjung === null ? (
                      h.depan ? (
                        ""
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )
                    ) : (
                      <span title={h.pengunjungDariTutup ? t("rincian.dariTutupHari") : undefined}>
                        {angka.format(h.pengunjung)}
                        {h.pengunjungDariTutup ? <sup className="ml-0.5 text-muted-foreground">*</sup> : null}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums 2xl:table-cell">{h.konversiPersen === null ? (h.depan ? "" : <span className="text-muted-foreground">—</span>) : persen(h.konversiPersen)}</TableCell>
                  <TableCell>{tutup(h)}</TableCell>
                  <TableCell className="text-right tabular-nums">{h.titipDibuat > 0 ? angka.format(h.titipDibuat) : ""}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
