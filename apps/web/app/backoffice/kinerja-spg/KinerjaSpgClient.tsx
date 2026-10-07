"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, ArrowUpDown, Gauge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatRupiah } from "@/lib/format/rupiah";
import { dinamis } from "@/lib/i18n/dinamis";
import { urutkanBaris, type ArahUrut } from "@/lib/spg/kinerja";
import type { BarisKinerjaSpg, DataKinerjaSpg } from "@/lib/spg/kinerja-queries";
import { cn } from "@/lib/utils";

const ALAMAT = "/backoffice/kinerja-spg";
const SEMUA = "__semua__";

type KunciKolom =
  | "nama"
  | "toko"
  | "jadwal"
  | "masuk"
  | "terlambat"
  | "tidakMasuk"
  | "izin"
  | "nota"
  | "potong"
  | "nilai"
  | "rata"
  | "pengunjung"
  | "konversi"
  | "target"
  | "tutup"
  | "titip"
  | "retur";

type Kolom = {
  kunci: KunciKolom;
  nilai: (b: BarisKinerjaSpg) => number | string | null;
  isi: (b: BarisKinerjaSpg) => ReactNode;
  teks?: boolean;
};

/**
 * Tabel dipecah dua tampilan supaya muat di laptop 1280 px tanpa digulir ke
 * samping. Nama dan toko ada di keduanya; kolom yang `sekunder` disembunyikan
 * di bawah lebar 2xl (1536 px) — angkanya tetap ada di halaman rincian SPG.
 */
type Tampilan = "penjualan" | "kehadiran";
const KOLOM_TAMPILAN: Record<Tampilan, KunciKolom[]> = {
  penjualan: ["nama", "toko", "nilai", "target", "nota", "potong", "pengunjung", "konversi", "rata", "retur"],
  kehadiran: ["nama", "toko", "jadwal", "masuk", "terlambat", "tidakMasuk", "izin", "tutup", "titip"],
};
const KOLOM_SEKUNDER: ReadonlySet<KunciKolom> = new Set(["rata", "retur"]);

/**
 * Kinerja SPG di kantor: bulan dan toko di alamat (keduanya ditulis dalam SATU
 * navigasi `replace`), tabel yang bisa diurutkan per kolom, baris membuka
 * rincian harian SPG itu. Kolom jadwal tampil "—" bila jadwal belum disusun —
 * bukan 0 — dan nilai kosong selalu di bawah saat diurutkan.
 */
export function KinerjaSpgClient({ data }: { data: DataKinerjaSpg }) {
  const t = useTranslations("kinerjaSpg");
  const td = dinamis(t);
  const locale = useLocale();
  const router = useRouter();
  const [menunggu, mulai] = useTransition();
  const [urut, setUrut] = useState<{ kunci: KunciKolom; arah: ArahUrut }>({ kunci: "nama", arah: "naik" });
  const [tampilan, setTampilan] = useState<Tampilan>("penjualan");

  const angka = new Intl.NumberFormat(locale === "en" ? "en-US" : "id-ID", { maximumFractionDigits: 1 });
  const persen = (n: number | null) => (n === null ? "—" : `${angka.format(n)}%`);
  const kosong = <span className="text-muted-foreground">—</span>;
  const tanpaJadwal = (
    <span className="cursor-help text-muted-foreground" title={t("sel.belumDisusun")}>
      —
    </span>
  );

  const pindah = (ubah: { bulan?: string; toko?: string | null }) => {
    const q = new URLSearchParams();
    q.set("bulan", ubah.bulan ?? data.bulan);
    const toko = ubah.toko !== undefined ? ubah.toko : data.storeId;
    if (toko) q.set("toko", toko);
    mulai(() => router.replace(`${ALAMAT}?${q.toString()}`, { scroll: false }));
  };
  const alamatRincian = (b: BarisKinerjaSpg) => `${ALAMAT}/${b.userId}?bulan=${data.bulan}`;

  const kolom: Kolom[] = [
    {
      kunci: "nama",
      teks: true,
      nilai: (b) => b.nama,
      isi: (b) => (
        <Link
          href={alamatRincian(b)}
          className="font-medium underline decoration-muted-foreground/50 underline-offset-2 hover:decoration-foreground"
          onClick={(e) => e.stopPropagation()}
        >
          {b.nama}
        </Link>
      ),
    },
    {
      kunci: "toko",
      teks: true,
      nilai: (b) => b.toko,
      isi: (b) => (
        <span className="block min-w-[10rem] whitespace-normal">
          {b.toko}
          {b.bukanTokoTetap ? <span className="block text-xs text-muted-foreground">{t("bukanTokoTetap")}</span> : null}
        </span>
      ),
    },
    { kunci: "jadwal", nilai: (b) => b.hariDijadwalkan, isi: (b) => (b.hariDijadwalkan === null ? tanpaJadwal : angka.format(b.hariDijadwalkan)) },
    { kunci: "masuk", nilai: (b) => b.hariMasuk, isi: (b) => angka.format(b.hariMasuk) },
    {
      kunci: "terlambat",
      nilai: (b) => b.terlambatKali,
      isi: (b) =>
        b.terlambatKali === null ? (
          tanpaJadwal
        ) : b.terlambatKali === 0 ? (
          "0"
        ) : (
          <span className="text-amber-700 dark:text-amber-300">{t("sel.terlambat", { kali: b.terlambatKali, menit: b.terlambatMenit ?? 0 })}</span>
        ),
    },
    {
      kunci: "tidakMasuk",
      nilai: (b) => b.tidakMasuk,
      isi: (b) =>
        b.tidakMasuk === null ? tanpaJadwal : <span className={cn(b.tidakMasuk > 0 && "font-medium text-destructive")}>{angka.format(b.tidakMasuk)}</span>,
    },
    { kunci: "izin", nilai: (b) => b.hariIzin, isi: (b) => angka.format(b.hariIzin) },
    { kunci: "nota", nilai: (b) => b.nota, isi: (b) => angka.format(b.nota) },
    { kunci: "potong", nilai: (b) => b.potong, isi: (b) => angka.format(b.potong) },
    { kunci: "nilai", nilai: (b) => b.nilai, isi: (b) => formatRupiah(b.nilai) },
    { kunci: "rata", nilai: (b) => b.rataNota, isi: (b) => (b.rataNota === null ? kosong : formatRupiah(b.rataNota)) },
    {
      kunci: "pengunjung",
      nilai: (b) => b.pengunjung,
      isi: (b) =>
        b.pengunjung === null ? (
          kosong
        ) : (
          <span title={b.hariPengunjungDariTutup > 0 ? t("sel.dariTutup", { n: b.hariPengunjungDariTutup }) : undefined}>
            {angka.format(b.pengunjung)}
            {b.hariPengunjungDariTutup > 0 ? <sup className="ml-0.5 text-muted-foreground">*</sup> : null}
          </span>
        ),
    },
    { kunci: "konversi", nilai: (b) => b.konversiPersen, isi: (b) => (b.konversiPersen === null ? kosong : persen(b.konversiPersen)) },
    {
      kunci: "target",
      nilai: (b) => b.capaianPersen,
      isi: (b) =>
        b.capaianPersen === null ? (
          <span className="text-muted-foreground" title={t("sel.tanpaTarget")}>
            —
          </span>
        ) : (
          <span className={cn(b.capaianPersen >= 100 && "font-medium text-emerald-700 dark:text-emerald-400")}>{persen(b.capaianPersen)}</span>
        ),
    },
    {
      kunci: "tutup",
      nilai: (b) => b.kepatuhanTutupPersen,
      isi: (b) =>
        b.kepatuhanTutupPersen === null ? (
          kosong
        ) : (
          <span className={cn(b.kepatuhanTutupPersen < 100 && "text-amber-700 dark:text-amber-300")}>
            {persen(b.kepatuhanTutupPersen)}
            <span className="block text-xs text-muted-foreground">{t("sel.tutup", { ditutup: b.hariJualDitutup, jual: b.hariJual })}</span>
          </span>
        ),
    },
    {
      kunci: "titip",
      nilai: (b) => b.titipDibuat,
      isi: (b) => (b.titipDibuat === 0 ? "0" : t("sel.titip", { dibuat: b.titipDibuat, selesai: b.titipSelesai })),
    },
    { kunci: "retur", nilai: (b) => b.persenKembali, isi: (b) => (b.persenKembali === null ? kosong : persen(b.persenKembali)) },
  ];

  const kolomTampil = KOLOM_TAMPILAN[tampilan].flatMap((k) => kolom.filter((x) => x.kunci === k));
  const sekunder = (k: Kolom) => KOLOM_SEKUNDER.has(k.kunci) && "hidden 2xl:table-cell";
  // Kolom urut yang tidak ada di tampilan ini jatuh ke urutan nama.
  const kolomUrut = kolomTampil.find((x) => x.kunci === urut.kunci) ?? kolomTampil[0];
  const arahUrut: ArahUrut = kolomUrut.kunci === urut.kunci ? urut.arah : "naik";
  const baris = urutkanBaris(data.baris, kolomUrut.nilai, arahUrut, (b) => `${b.nama} ${b.toko}`);

  const pilihUrut = (k: Kolom) =>
    setUrut((u) => (u.kunci === k.kunci ? { kunci: k.kunci, arah: u.arah === "naik" ? "turun" : "naik" } : { kunci: k.kunci, arah: k.teks ? "naik" : "turun" }));

  const totalNota = data.baris.reduce((n, b) => n + b.nota, 0);
  const totalNilai = data.baris.reduce((n, b) => n + b.nilai, 0);
  const jumlahSpg = new Set(data.baris.map((b) => b.userId)).size;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("judul")}
        meta={t(data.berjalan ? "ringkasBerjalan" : "ringkas", {
          bulan: data.labelBulan,
          sampai: data.labelSampai,
          spg: jumlahSpg,
          nota: angka.format(totalNota),
          nilai: formatRupiah(totalNilai),
        })}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <Select value={data.bulan} onValueChange={(v) => pindah({ bulan: v })} disabled={menunggu}>
          <SelectTrigger className="w-full sm:w-52" aria-label={t("bulan")}>
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
        <Select value={data.storeId ?? SEMUA} onValueChange={(v) => pindah({ toko: v === SEMUA ? null : v })} disabled={menunggu}>
          <SelectTrigger className="w-full sm:w-72" aria-label={t("toko")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SEMUA}>{t("semuaToko")}</SelectItem>
            {data.pilihanToko.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.kode ? `${p.nama} (${p.kode})` : p.nama}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card className={cn("transition-opacity", menunggu && "opacity-60")} aria-busy={menunggu}>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <Gauge className="h-5 w-5" />
            {t("daftarJudul")}
          </CardTitle>
          <Tabs value={tampilan} onValueChange={(v) => setTampilan(v as Tampilan)}>
            <TabsList>
              <TabsTrigger value="penjualan">{t("tampilan.penjualan")}</TabsTrigger>
              <TabsTrigger value="kehadiran">{t("tampilan.kehadiran")}</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent className={baris.length === 0 ? undefined : "px-0"}>
          {baris.length === 0 ? (
            <EmptyState icon={Gauge} title={t("kosongJudul")} description={data.storeId ? t("kosongSaringIsi") : t("kosongIsi")} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {kolomTampil.map((k) => {
                      const aktif = kolomUrut.kunci === k.kunci;
                      const Ikon = !aktif ? ArrowUpDown : arahUrut === "naik" ? ArrowUp : ArrowDown;
                      return (
                        <TableHead
                          key={k.kunci}
                          className={cn(!k.teks && "text-right", sekunder(k))}
                          aria-sort={aktif ? (arahUrut === "naik" ? "ascending" : "descending") : "none"}
                        >
                          <Button
                            variant="ghost"
                            size="sm"
                            className={cn(
                              "-mx-2 h-8 gap-1 px-2 font-medium [letter-spacing:inherit] [text-transform:inherit]",
                              !k.teks && "ml-auto flex",
                            )}
                            onClick={() => pilihUrut(k)}
                            aria-label={t("urut", { kolom: td(`kolom.${k.kunci}`) })}
                          >
                            {td(`kolom.${k.kunci}`)}
                            <Ikon className={cn("h-3.5 w-3.5", !aktif && "text-muted-foreground")} aria-hidden />
                          </Button>
                        </TableHead>
                      );
                    })}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {baris.map((b) => (
                    <TableRow
                      key={`${b.userId}|${b.storeId}`}
                      className={cn("cursor-pointer", (b.tidakMasuk ?? 0) > 0 && "bg-destructive/[0.04]")}
                      onClick={() => router.push(alamatRincian(b))}
                    >
                      {kolomTampil.map((k) => (
                        <TableCell key={k.kunci} className={cn(!k.teks && "text-right tabular-nums", sekunder(k))}>
                          {k.isi(b)}
                        </TableCell>
                      ))}
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
