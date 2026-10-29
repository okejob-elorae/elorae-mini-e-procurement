"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, BarChart3, Info, Scale, ShoppingBag, Store, TrendingUp, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDisplayDate } from "@/lib/date-only";
import { formatRupiah } from "@/lib/format/rupiah";
import { dinamis } from "@/lib/i18n/dinamis";
import type { Perbandingan } from "@/lib/spg/efektivitas-promo";
import type { HasilEfektivitas } from "@/lib/spg/efektivitas-promo-queries";
import { cn } from "@/lib/utils";
import { akhirInklusif, angkaId, KELAS_ARAH, perubahanPersen, rupiahPecahan } from "../../efektivitas-tampil";
import { NADA_STATUS_PROMO } from "../../tampilan";
import { GrafikHarianPromo } from "./GrafikHarianPromo";

/** Panah + persen, atau keterangan "belum ada pembanding" — tidak pernah warna saja. */
function Perubahan({ persen, kosong }: { persen: number | null; kosong: string }) {
  const u = perubahanPersen(persen);
  return u ? <span className={cn("font-medium tabular-nums", KELAS_ARAH[u.arah])}>{u.teks}</span> : <span className="text-xs text-muted-foreground">{kosong}</span>;
}

function Angka({ label, nilai, sub }: { label: string; nilai: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-md border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums">{nilai}</dd>
      {sub ? <dd className="mt-0.5 text-xs text-muted-foreground">{sub}</dd> : null}
    </div>
  );
}

/**
 * Hasil satu promo konter: pemakaian, penjualan barang sasaran selama promo vs
 * periode sebelumnya yang sama panjang, keranjang, pelanggan, dan per toko.
 * Semua angka dari server (`hasilEfektivitasPromo`); di sini hanya ditampilkan.
 */
export function HasilEfektivitasClient({ data, dari, sampai }: { data: HasilEfektivitas; dari: string | null; sampai: string | null }) {
  const t = useTranslations("efektivitasPromo.hasil");
  const tk = useTranslations("efektivitasPromo");
  const ts = dinamis(useTranslations("promoKonter"));
  const locale = useLocale();
  const tgl = (d: Date | string) => formatDisplayDate(d, locale);
  const { promo: p, hasil: h } = data;
  const kembaliKeDaftar = `/backoffice/promo-konter?${new URLSearchParams({ tab: "efektivitas", ...(dari && sampai ? { dari, sampai } : {}) }).toString()}`;
  const belumAda = tk("belumAdaPembanding");

  const kepala = (
    <PageHeader
      title={p.name}
      meta={
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
          <StatusPill tone={NADA_STATUS_PROMO[p.status]}>{ts(`status.${p.status}`)}</StatusPill>
          <span>{p.ringkasan}</span>
          {p.memberOnly ? <span>· {t("khususMember")}</span> : null}
          <span>
            ·{" "}
            {p.semuaToko ? t("semuaToko") : t("nToko", { n: angkaId(p.jumlahToko) })} ·{" "}
            {p.semuaBarang ? t("semuaBarang") : t("nSasaran", { barang: angkaId(p.jumlahBarang), kategori: angkaId(p.jumlahKategori) })}
          </span>
        </span>
      }
      actions={
        <>
          <Button variant="outline" asChild>
            <Link href={kembaliKeDaftar}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t("kembali")}
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href={`/backoffice/promo-konter/${p.id}`}>{t("lihatPromo")}</Link>
          </Button>
        </>
      }
    />
  );

  if (!h) {
    return (
      <div className="space-y-6">
        {kepala}
        <Card>
          <CardContent>
            <EmptyState icon={TrendingUp} title={t("belumBerjalanJudul")} description={t("belumBerjalanIsi")} />
          </CardContent>
        </Card>
      </div>
    );
  }

  const jual = h.penjualan;
  const pakai = h.pemakaian;
  const periodePromo = `${tgl(h.promo.mulai)} – ${h.masihBerjalan ? tk("sampaiSekarang") : tgl(akhirInklusif(h.promo.akhir))}`;
  const periodePembanding = `${tgl(h.pembanding.mulai)} – ${tgl(akhirInklusif(h.pembanding.akhir))}`;
  const hari = angkaId(h.hari, 1);
  const kembali = h.pelanggan.kembali;

  const catatan: string[] = [];
  if (h.notaLama > 0) catatan.push(t("catatan.notaLama", { n: angkaId(h.notaLama) }));
  if (h.dipotongRentang) catatan.push(t("catatan.dipotong", { mulai: tgl(h.mulaiPromo) }));
  if (h.masihBerjalan) catatan.push(t("catatan.berjalan"));
  if (h.berhentiDimatikan) catatan.push(h.akhirDariPerubahan ? t("catatan.dimatikanPerkiraan", { tanggal: tgl(akhirInklusif(h.promo.akhir)) }) : t("catatan.dimatikan", { tanggal: tgl(akhirInklusif(h.promo.akhir)) }));
  if (p.adaKategori) catatan.push(t("catatan.kategori"));

  const baris: { label: string; v: Perbandingan; harian: [number | null, number | null]; uang: boolean }[] = [
    { label: t("penjualan.pcs"), v: jual.pcs, harian: jual.perHari.pcs, uang: false },
    { label: t("penjualan.rupiah"), v: jual.rupiah, harian: jual.perHari.rupiah, uang: true },
    { label: t("penjualan.nota"), v: jual.nota, harian: jual.perHari.nota, uang: false },
  ];
  const tampil = (v: number | null, uang: boolean, desimal = 0) => (v === null ? "—" : uang ? formatRupiah(v) : angkaId(v, desimal));
  const selisihTeks = (v: number, uang: boolean) => `${v > 0 ? "+" : ""}${uang ? formatRupiah(v) : angkaId(v)}`;

  return (
    <div className="space-y-6">
      {kepala}

      <div className="flex gap-3 rounded-lg border bg-muted/40 p-4 text-sm">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="space-y-1">
          <p className="font-medium">{tk("pengakuan")}</p>
          <p className="text-muted-foreground">{t("periode", { promo: periodePromo, pembanding: periodePembanding, hari })}</p>
          {catatan.map((c) => (
            <p key={c} className="text-muted-foreground">
              {c}
            </p>
          ))}
          {h.dipotongRentang ? (
            <p>
              <Link href={`/backoffice/promo-konter/${p.id}/hasil`} className="text-tautan underline-offset-2 hover:underline">
                {t("lihatSeluruh")}
              </Link>
            </p>
          ) : null}
        </div>
      </div>

      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Angka
          label={t("ringkas.nota")}
          nilai={angkaId(pakai.nota)}
          sub={pakai.pcs === null ? t("ringkas.belanja") : t("ringkas.pcs", { n: angkaId(pakai.pcs) })}
        />
        <Angka
          label={t("ringkas.potongan")}
          nilai={formatRupiah(pakai.potongan)}
          sub={pakai.konsi.potongan > 0 ? t("ringkas.potonganSub", { elorae: formatRupiah(pakai.konsi.elorae) }) : undefined}
        />
        <Angka
          label={t("ringkas.penjualan")}
          nilai={<Perubahan persen={jual.rupiah.persen} kosong={belumAda} />}
          sub={t("ringkas.penjualanSub", { promo: formatRupiah(jual.rupiah.promo), pembanding: formatRupiah(jual.rupiah.pembanding) })}
        />
        <Angka
          label={t("ringkas.biaya")}
          nilai={
            h.biaya === null ? (
              <span className="text-base">{t(h.biayaAlasan === "TANPA_PEMBANDING" ? "ringkas.tanpaPembanding" : "ringkas.tidakNaik")}</span>
            ) : (
              rupiahPecahan(h.biaya)
            )
          }
          sub={
            h.biaya === null
              ? t(h.biayaAlasan === "TANPA_PEMBANDING" ? "ringkas.tanpaPembandingSub" : "ringkas.tidakNaikSub")
              : t("ringkas.biayaSub", { selisih: formatRupiah(jual.rupiah.selisih) })
          }
        />
      </dl>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            {t("grafik.judul")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <GrafikHarianPromo data={h.harian} totalPromo={jual.pcs.promo} totalPembanding={jual.pcs.pembanding} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            {t("penjualan.judul")}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("penjualan.ukuran")}</TableHead>
                <TableHead className="text-right">{t("penjualan.selamaPromo")}</TableHead>
                <TableHead className="text-right">{t("penjualan.perHari")}</TableHead>
                <TableHead className="text-right">{t("penjualan.pembanding")}</TableHead>
                <TableHead className="text-right">{t("penjualan.perHari")}</TableHead>
                <TableHead className="text-right">{t("penjualan.selisih")}</TableHead>
                <TableHead className="text-right">{t("penjualan.perubahan")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {baris.map((b) => (
                <TableRow key={b.label}>
                  <TableCell className="font-medium">{b.label}</TableCell>
                  <TableCell className="text-right tabular-nums">{tampil(b.v.promo, b.uang)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{tampil(b.harian[0], b.uang, 1)}</TableCell>
                  <TableCell className="text-right tabular-nums">{tampil(b.v.pembanding, b.uang)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{tampil(b.harian[1], b.uang, 1)}</TableCell>
                  <TableCell className="text-right tabular-nums">{selisihTeks(b.v.selisih, b.uang)}</TableCell>
                  <TableCell className="text-right">
                    <Perubahan persen={b.v.persen} kosong={belumAda} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Scale className="h-5 w-5" />
              {t("tanggungan.judul")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{t("tanggungan.konsi")}</dt>
                <dd className="tabular-nums">{formatRupiah(pakai.konsi.potongan)}</dd>
              </div>
              <div className="flex justify-between gap-3 pl-3">
                <dt className="text-muted-foreground">{t("tanggungan.konsiToko")}</dt>
                <dd className="tabular-nums">{formatRupiah(pakai.konsi.toko)}</dd>
              </div>
              <div className="flex justify-between gap-3 pl-3">
                <dt className="text-muted-foreground">{t("tanggungan.konsiElorae")}</dt>
                <dd className="font-medium tabular-nums">{formatRupiah(pakai.konsi.elorae)}</dd>
              </div>
              <div className="flex justify-between gap-3 border-t pt-2">
                <dt className="text-muted-foreground">{t("tanggungan.putus")}</dt>
                <dd className="tabular-nums">{formatRupiah(pakai.putus.potongan)}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShoppingBag className="h-5 w-5" />
              {t("keranjang.judul")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{t("keranjang.dengan", { n: angkaId(h.keranjang.dengan.nota) })}</dt>
                <dd className="font-medium tabular-nums">{h.keranjang.dengan.rataRata === null ? "—" : formatRupiah(h.keranjang.dengan.rataRata)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{t("keranjang.tanpa", { n: angkaId(h.keranjang.tanpa.nota) })}</dt>
                <dd className="tabular-nums">{h.keranjang.tanpa.rataRata === null ? "—" : formatRupiah(h.keranjang.tanpa.rataRata)}</dd>
              </div>
              <div className="flex justify-between gap-3 border-t pt-2">
                <dt className="text-muted-foreground">{t("keranjang.selisih")}</dt>
                <dd className="tabular-nums">
                  {h.keranjang.selisih === null ? (
                    <span className="text-xs text-muted-foreground">{t("keranjang.tidakBisa")}</span>
                  ) : (
                    <>
                      {selisihTeks(h.keranjang.selisih, true)} <Perubahan persen={h.keranjang.persen} kosong="" />
                    </>
                  )}
                </dd>
              </div>
            </dl>
            {h.keranjang.dikecualikan > 0 ? (
              <p className="mt-3 text-xs text-muted-foreground">{t("keranjang.dikecualikan", { n: angkaId(h.keranjang.dikecualikan) })}</p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              {t("pelanggan.judul")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{t("pelanggan.cakupan")}</dt>
                <dd className="tabular-nums">
                  {h.pelanggan.cakupan === null
                    ? "—"
                    : t("pelanggan.cakupanNilai", { persen: angkaId(h.pelanggan.cakupan, 1), tercatat: angkaId(h.pelanggan.notaTercatat), nota: angkaId(h.pelanggan.notaPromo) })}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{t("pelanggan.pembeli")}</dt>
                <dd className="font-medium tabular-nums">{angkaId(h.pelanggan.pembeli)}</dd>
              </div>
              <div className="flex justify-between gap-3 pl-3">
                <dt className="text-muted-foreground">{t("pelanggan.baru")}</dt>
                <dd className="tabular-nums">{angkaId(h.pelanggan.baru)}</dd>
              </div>
              <div className="flex justify-between gap-3 pl-3">
                <dt className="text-muted-foreground">{t("pelanggan.member")}</dt>
                <dd className="tabular-nums">{angkaId(h.pelanggan.member)}</dd>
              </div>
              <div className="flex justify-between gap-3 border-t pt-2">
                <dt className="text-muted-foreground">{t("pelanggan.kembali")}</dt>
                <dd className="text-right tabular-nums">
                  {kembali.dinilai ? (
                    <>
                      {angkaId(kembali.pembeli)}
                      {kembali.persen === null ? null : <span className="text-muted-foreground"> ({angkaId(kembali.persen, 1)}%)</span>}
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {kembali.masihBerjalan ? t("pelanggan.kembaliBerjalan") : t("pelanggan.kembaliBelum", { tanggal: tgl(kembali.sejak) })}
                    </span>
                  )}
                </dd>
              </div>
            </dl>
            {h.pelanggan.notaPromo > 0 && h.pelanggan.notaTercatat === 0 ? (
              <p className="mt-3 text-xs text-muted-foreground">{t("pelanggan.tanpaPembeli")}</p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Store className="h-5 w-5" />
            {t("toko.judul")}
          </CardTitle>
        </CardHeader>
        <CardContent className={h.perToko.length === 0 ? undefined : "px-0"}>
          {h.perToko.length === 0 ? (
            <EmptyState icon={Store} title={t("toko.kosongJudul")} description={t("toko.kosongIsi")} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("toko.toko")}</TableHead>
                  <TableHead className="text-right">{t("toko.nota")}</TableHead>
                  <TableHead className="text-right">{t("toko.potongan")}</TableHead>
                  <TableHead className="text-right">{t("toko.pcs")}</TableHead>
                  <TableHead className="text-right">{t("toko.rupiahPromo")}</TableHead>
                  <TableHead className="text-right">{t("toko.rupiahPembanding")}</TableHead>
                  <TableHead className="text-right">{t("toko.perubahan")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {h.perToko.map((s) => (
                  <TableRow key={s.storeId}>
                    <TableCell className="min-w-[12rem] whitespace-normal">
                      <span className="font-medium">{s.nama}</span>
                      {s.termsType ? <span className="block text-xs text-muted-foreground">{t(s.termsType === "KONSI" ? "toko.konsi" : "toko.putus")}</span> : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{angkaId(s.pemakaian.nota)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatRupiah(s.pemakaian.potongan)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {angkaId(s.penjualan.pcs.promo)} / {angkaId(s.penjualan.pcs.pembanding)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatRupiah(s.penjualan.rupiah.promo)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatRupiah(s.penjualan.rupiah.pembanding)}</TableCell>
                    <TableCell className="text-right">
                      <Perubahan persen={s.penjualan.rupiah.persen} kosong={belumAda} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
