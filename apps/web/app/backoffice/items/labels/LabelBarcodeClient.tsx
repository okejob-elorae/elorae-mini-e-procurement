"use client";

import { useDeferredValue, useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, Barcode, FileText, Package, Plus, Printer, Search, X } from "lucide-react";
import { toast } from "sonner";
import { ambilBarangLabelAction, cariBarangLabelAction } from "@/app/actions/label-barcode";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { dinamis } from "@/lib/i18n/dinamis";
import {
  bacaOpsiLabel,
  DAFTAR_SUMBER_KODE_LABEL,
  jumlahAwal,
  jumlahBarang,
  jumlahSesuaiStok,
  KUNCI_SIMPAN_OPSI_LABEL,
  kodeLabel,
  kunciLabel,
  MAKS_LABEL_SEKALI_CETAK,
  periksaLabel,
  rapikanJumlah,
  susunBarisCetak,
  teksVarian,
  totalJumlah,
  type BarangLabel,
  type DilewatiDokumen,
  type JenisDokumenLabel,
  type JumlahLabel,
  type OpsiLayarLabel,
  type TanpaUkuranDokumen,
} from "@/lib/items/label";
import type { HasilCariLabel } from "@/lib/items/label-queries";
import {
  buildLabelBarcodeHtml,
  DAFTAR_GAYA_LABEL,
  DAFTAR_TATA_LETAK_LABEL,
  DAFTAR_UKURAN_LABEL,
  formatHargaLabel,
  tataLembarA4,
} from "@/lib/print/label-barcode-html";
import { cn } from "@/lib/utils";

export type DokumenLabelLayar = {
  jenis: JenisDokumenLabel;
  nomor: string;
  toko: string | null;
  totalDokumen: number;
  tanpaUkuran: TanpaUkuranDokumen[];
  dilewati: DilewatiDokumen[];
};

const tanpaLangganan = () => () => {};
function bacaSimpanan(): string | null {
  try {
    return window.localStorage.getItem(KUNCI_SIMPAN_OPSI_LABEL);
  } catch {
    return null;
  }
}

/** Daftar pendek untuk peringatan: lima pertama, sisanya "+N". */
function daftarPendek(isi: string[], lainnya: (n: number) => string): string {
  const unik = [...new Set(isi)];
  return unik.length > 5 ? `${unik.slice(0, 5).join(", ")} ${lainnya(unik.length - 5)}` : unik.join(", ");
}

export function LabelBarcodeClient({
  barangAwal,
  jumlahAwal: jumlahDariServer,
  dokumen,
  dokumenTidakAda,
  itemTidakAda,
}: {
  barangAwal: BarangLabel[];
  jumlahAwal: JumlahLabel;
  dokumen: DokumenLabelLayar | null;
  dokumenTidakAda: boolean;
  itemTidakAda: boolean;
}) {
  const t = useTranslations("labelBarcode");
  const td = dinamis(t);
  const locale = useLocale();
  const angka = new Intl.NumberFormat(locale === "en" ? "en-US" : "id-ID", { maximumFractionDigits: 2 });

  const [barang, setBarang] = useState<BarangLabel[]>(barangAwal);
  const [jumlah, setJumlah] = useState<JumlahLabel>(jumlahDariServer);
  const [lewati, setLewati] = useState(0);

  // Pilihan cetak diingat per peramban. Dibaca lewat useSyncExternalStore
  // supaya HTML server (bawaan) dan peramban sama saat hidrasi.
  const tersimpan = useSyncExternalStore(tanpaLangganan, bacaSimpanan, () => null);
  const [ubahan, setUbahan] = useState<Partial<OpsiLayarLabel>>({});
  const opsi: OpsiLayarLabel = { ...bacaOpsiLabel(tersimpan), ...ubahan };
  // Nilai tunggal, supaya hitungan di bawah hanya diulang bila pilihannya berubah.
  const { gaya, ukuran, tataLetak, tampilHarga, tampilNama, sumberKode } = opsi;
  // Harga dan nama hanya ada di gaya RINCI; gaya ELORAE tidak pernah mencetak harga.
  const hargaDicetak = gaya === "RINCI" && tampilHarga;
  function ubahOpsi(patch: Partial<OpsiLayarLabel>) {
    setUbahan((u) => ({ ...u, ...patch }));
    try {
      window.localStorage.setItem(KUNCI_SIMPAN_OPSI_LABEL, JSON.stringify({ ...opsi, ...patch }));
    } catch {
      // Penyimpanan ditolak (mode pribadi, penuh) — hanya kenyamanan.
    }
  }

  // ─── Cari dan tambah barang ────────────────────────────────────────────────
  const [cari, setCari] = useState("");
  const [hasil, setHasil] = useState<HasilCariLabel[] | null>(null);
  const [mencari, mulaiCari] = useTransition();
  const [menambah, mulaiTambah] = useTransition();
  const [ditambah, setDitambah] = useState<string | null>(null);

  function jalankanCari() {
    const q = cari.trim();
    if (q.length < 2) {
      setHasil(null);
      return;
    }
    mulaiCari(async () => {
      const r = await cariBarangLabelAction(q);
      if (!r.ok) {
        toast.error(td(`galat.${r.code}`));
        return;
      }
      setHasil(r.hasil);
    });
  }

  function tambah(itemId: string) {
    setDitambah(itemId);
    mulaiTambah(async () => {
      const r = await ambilBarangLabelAction([itemId]);
      setDitambah(null);
      if (!r.ok) {
        toast.error(td(`galat.${r.code}`));
        return;
      }
      const baru = r.barang.filter((b) => !barang.some((x) => x.itemId === b.itemId));
      if (baru.length === 0) return;
      setBarang((lama) => [...lama, ...baru.filter((b) => !lama.some((x) => x.itemId === b.itemId))]);
      setJumlah((j) => baru.reduce((acc, b) => ({ ...acc, ...jumlahAwal(b) }), j));
    });
  }

  function hapus(itemId: string) {
    setBarang((lama) => lama.filter((b) => b.itemId !== itemId));
  }

  function aturJumlah(isi: JumlahLabel) {
    setJumlah((j) => ({ ...j, ...isi }));
  }

  const semuaKosong = (b: BarangLabel): JumlahLabel => Object.fromEntries(b.varian.map((v) => [kunciLabel(b.itemId, v.variantSku), 0]));

  // ─── Dokumen cetak ─────────────────────────────────────────────────────────
  // Tanpa useMemo: React Compiler yang menyimpan hasilnya selama masukannya sama.
  const total = totalJumlah(barang, jumlah);
  const terlaluBanyak = total > MAKS_LABEL_SEKALI_CETAK;
  const lembar = tataLembarA4(ukuran);
  const lewatiSah = tataLetak === "A4" ? Math.min(Math.max(0, lewati), lembar.perHalaman - 1) : 0;
  const jumlahLembar = tataLetak === "A4" ? Math.ceil((total + lewatiSah) / lembar.perHalaman) : 0;

  const html = terlaluBanyak
    ? null
    : buildLabelBarcodeHtml(susunBarisCetak(barang, jumlah, sumberKode), { gaya, ukuran, tataLetak, tampilHarga, tampilNama, lewati: lewatiSah });
  // Pratinjau boleh tertinggal sesaat saat jumlah diketik; yang DICETAK selalu `html` terbaru.
  const htmlPratinjau = useDeferredValue(html);

  const peringatan = periksaLabel(barang, jumlah, { sumberKode, ukuran, tampilHarga: hargaDicetak });

  const alasanTidakBisaCetak =
    total === 0 ? t("cetak.alasanKosong") : terlaluBanyak ? t("cetak.alasanTerlaluBanyak", { maks: angka.format(MAKS_LABEL_SEKALI_CETAK) }) : null;

  /**
   * Cetak lewat bingkai tersembunyi yang dibuat saat tombol ditekan, berisi
   * dokumen TERBARU — bukan bingkai pratinjau, yang bisa masih memuat versi
   * sebelumnya. Bingkai dilepas sesudah jendela cetak ditutup.
   */
  function cetak() {
    if (html === null || alasanTidakBisaCetak) return;
    const f = document.createElement("iframe");
    f.setAttribute("title", t("pratinjau.judul"));
    f.setAttribute("aria-hidden", "true");
    f.setAttribute("style", "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;");
    document.body.appendChild(f);
    const w = f.contentWindow;
    if (!w) {
      f.remove();
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    const lepas = () => window.setTimeout(() => f.remove(), 0);
    w.addEventListener("afterprint", lepas, { once: true });
    // Cadangan bila `afterprint` tidak pernah datang (sebagian peramban).
    window.setTimeout(() => f.remove(), 120_000);
    window.setTimeout(() => {
      w.focus();
      w.print();
    }, 250);
  }

  const lainnya = (n: number) => t("peringatan.lainnya", { n });

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("judul")}
        description={t("deskripsi")}
        meta={t("ringkas", { label: angka.format(total), barang: barang.length })}
        actions={
          <Button variant="outline" asChild>
            <Link href="/backoffice/items">{t("keDaftarBarang")}</Link>
          </Button>
        }
      />

      {dokumenTidakAda ? (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>{t("dokumen.tidakAdaJudul")}</AlertTitle>
          <AlertDescription>{t("dokumen.tidakAdaIsi")}</AlertDescription>
        </Alert>
      ) : null}
      {itemTidakAda ? (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>{t("barangTidakAdaJudul")}</AlertTitle>
          <AlertDescription>{t("barangTidakAdaIsi")}</AlertDescription>
        </Alert>
      ) : null}

      {dokumen ? (
        <Alert>
          <FileText />
          <AlertTitle className="line-clamp-none">
            {t("dokumen.judul", { jenis: td(`dokumen.jenis.${dokumen.jenis}`), nomor: dokumen.nomor })}
          </AlertTitle>
          <AlertDescription>
            <p>
              {dokumen.toko
                ? t("dokumen.isiToko", { toko: dokumen.toko, pcs: angka.format(dokumen.totalDokumen) })
                : t("dokumen.isi", { pcs: angka.format(dokumen.totalDokumen) })}
            </p>
            {dokumen.tanpaUkuran.length > 0 ? (
              <div className="space-y-0.5">
                <p className="font-medium text-foreground">{t("dokumen.tanpaUkuranJudul")}</p>
                <ul className="list-disc pl-5">
                  {dokumen.tanpaUkuran.map((x) => (
                    <li key={x.itemId}>{t("dokumen.tanpaUkuranBaris", { nama: x.nama, pcs: angka.format(x.qty) })}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {dokumen.dilewati.length > 0 ? (
              <div className="space-y-0.5">
                <p className="font-medium text-foreground">{t("dokumen.dilewatiJudul")}</p>
                <ul className="list-disc pl-5">
                  {dokumen.dilewati.map((x, i) => (
                    <li key={`${x.nama}-${x.variantSku ?? ""}-${i}`}>
                      {t("dokumen.dilewatiBaris", {
                        nama: x.variantSku ? `${x.nama} (${x.variantSku})` : x.nama,
                        pcs: angka.format(x.qty),
                        alasan: td(`dokumen.alasan.${x.alasan}`),
                      })}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {/* ─── Kiri: barang dan jumlah label ─── */}
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Search className="h-5 w-5" />
                {t("cari.judul")}
              </CardTitle>
              <CardDescription>{t("cari.deskripsi")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  jalankanCari();
                }}
              >
                <Input
                  type="search"
                  value={cari}
                  onChange={(e) => setCari(e.target.value)}
                  placeholder={t("cari.placeholder")}
                  aria-label={t("cari.placeholder")}
                />
                <Button type="submit" variant="outline" disabled={mencari || cari.trim().length < 2}>
                  <Search className="h-4 w-4" />
                  {mencari ? t("cari.mencari") : t("cari.tombol")}
                </Button>
              </form>
              {hasil !== null ? (
                hasil.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("cari.kosong")}</p>
                ) : (
                  <ul className="divide-y rounded-md border">
                    {hasil.map((h) => {
                      const sudah = barang.some((b) => b.itemId === h.itemId);
                      return (
                        <li key={h.itemId} className="flex items-center justify-between gap-3 px-3 py-2">
                          <div className="min-w-0">
                            <p className="truncate font-medium">{h.nama}</p>
                            <p className="text-xs text-muted-foreground">
                              <span className="font-mono">{h.sku}</span>
                              {" · "}
                              {h.jumlahVarian > 0 ? t("cari.varian", { n: h.jumlahVarian }) : t("cari.tanpaVarian")}
                              {" · "}
                              {h.harga !== null ? formatHargaLabel(h.harga) : t("tanpaHarga")}
                            </p>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant={sudah ? "ghost" : "outline"}
                            disabled={sudah || menambah}
                            onClick={() => tambah(h.itemId)}
                          >
                            {sudah ? null : <Plus className="h-4 w-4" />}
                            {sudah ? t("cari.sudah") : ditambah === h.itemId ? t("cari.menambah") : t("cari.tambah")}
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                )
              ) : null}
            </CardContent>
          </Card>

          {barang.length === 0 ? (
            <Card>
              <CardContent>
                <EmptyState icon={Barcode} title={t("kosongJudul")} description={t("kosongIsi")} />
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold">{t("daftarJudul", { n: barang.length })}</h2>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setJumlah((j) => barang.reduce((acc, b) => ({ ...acc, ...jumlahSesuaiStok(b) }), j))}
                  >
                    {t("isiSemuaStok")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setJumlah((j) => barang.reduce((acc, b) => ({ ...acc, ...semuaKosong(b) }), j))}
                  >
                    {t("kosongkanSemua")}
                  </Button>
                </div>
              </div>

              {barang.map((b) => {
                const tanpaUkuranDok = dokumen?.tanpaUkuran.find((x) => x.itemId === b.itemId) ?? null;
                return (
                  <Card key={b.itemId}>
                    <CardHeader>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 space-y-1">
                          <CardTitle className="flex items-center gap-2">
                            <Package className="h-5 w-5 shrink-0" />
                            <span className="min-w-0 break-words">{b.nama}</span>
                          </CardTitle>
                          <CardDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="font-mono">{b.sku}</span>
                            <span>·</span>
                            <span>{b.harga !== null ? formatHargaLabel(b.harga) : t("tanpaHarga")}</span>
                            {!b.aktif ? <Badge variant="secondary">{t("tidakAktif")}</Badge> : null}
                            <span>·</span>
                            <span>{t("labelBarang", { n: angka.format(jumlahBarang(b, jumlah)) })}</span>
                          </CardDescription>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button variant="outline" size="sm" onClick={() => aturJumlah(jumlahSesuaiStok(b))}>
                            {t("isiStok")}
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => aturJumlah(jumlahAwal(b))}>
                            {t("semuaSatu")}
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => aturJumlah(semuaKosong(b))}>
                            {t("kosongkan")}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => hapus(b.itemId)}
                            aria-label={t("hapus", { nama: b.nama })}
                            title={t("hapus", { nama: b.nama })}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3 px-0">
                      {tanpaUkuranDok ? (
                        <p className="mx-6 rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
                          {t("tanpaUkuranDokumen", { pcs: angka.format(tanpaUkuranDok.qty) })}
                        </p>
                      ) : null}
                      {b.bervarian && b.stokTanpaUkuran > 0 ? (
                        <p className="mx-6 text-sm text-muted-foreground">
                          {t("stokTanpaUkuran", { pcs: angka.format(b.stokTanpaUkuran) })}
                        </p>
                      ) : null}
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="pl-6">{t("kolom.varian")}</TableHead>
                              <TableHead>{t("kolom.kode")}</TableHead>
                              <TableHead className="text-right">{t("kolom.stokGudang")}</TableHead>
                              <TableHead className="pr-6 text-right">{t("kolom.jumlah")}</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {b.varian.map((v) => {
                              const k = kunciLabel(b.itemId, v.variantSku);
                              const n = rapikanJumlah(jumlah[k] ?? 0);
                              const { kode, asal } = kodeLabel(b, v, sumberKode);
                              const namaVarian = b.bervarian ? (teksVarian(v) ?? v.variantSku) : t("tanpaVarian");
                              return (
                                <TableRow key={k} className={cn(n === 0 && "text-muted-foreground")}>
                                  <TableCell className="whitespace-normal pl-6">
                                    <span className="font-medium">{namaVarian}</span>
                                    {b.bervarian && teksVarian(v) ? (
                                      <span className="block font-mono text-xs text-muted-foreground">{v.variantSku}</span>
                                    ) : null}
                                  </TableCell>
                                  <TableCell className="whitespace-normal">
                                    <span className="font-mono text-sm">{kode}</span>
                                    {sumberKode === "BARCODE" && asal === "SKU_VARIAN" ? (
                                      <span className="block text-xs text-amber-700 dark:text-amber-300">{t("kodeCadangan")}</span>
                                    ) : null}
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums">{angka.format(v.stokGudang)}</TableCell>
                                  <TableCell className="pr-6 text-right">
                                    <Input
                                      type="number"
                                      inputMode="numeric"
                                      min={0}
                                      max={9999}
                                      step={1}
                                      className="ml-auto w-24 text-right tabular-nums"
                                      value={n === 0 ? "" : String(n)}
                                      placeholder="0"
                                      aria-label={t("jumlahUntuk", { varian: namaVarian })}
                                      onChange={(e) => setJumlah((j) => ({ ...j, [k]: rapikanJumlah(e.target.value) }))}
                                    />
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </>
          )}
        </div>

        {/* ─── Kanan: pilihan cetak dan peringatan ─── */}
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Printer className="h-5 w-5" />
                {t("opsi.judul")}
              </CardTitle>
              <CardDescription>{t("opsi.deskripsi")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="label-gaya">{t("opsi.gaya")}</Label>
                <Select value={gaya} onValueChange={(v) => ubahOpsi({ gaya: v as OpsiLayarLabel["gaya"] })}>
                  <SelectTrigger id="label-gaya" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DAFTAR_GAYA_LABEL.map((x) => (
                      <SelectItem key={x} value={x}>
                        {td(`opsi.gayaNama.${x}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{td(`opsi.gayaBantuan.${gaya}`)}</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="label-ukuran">{t("opsi.ukuran")}</Label>
                <Select value={ukuran} onValueChange={(v) => ubahOpsi({ ukuran: v as OpsiLayarLabel["ukuran"] })}>
                  <SelectTrigger id="label-ukuran" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DAFTAR_UKURAN_LABEL.map((u) => (
                      <SelectItem key={u} value={u}>
                        {td(`opsi.ukuranNama.${u}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="label-tata-letak">{t("opsi.tataLetak")}</Label>
                <Select value={tataLetak} onValueChange={(v) => ubahOpsi({ tataLetak: v as OpsiLayarLabel["tataLetak"] })}>
                  <SelectTrigger id="label-tata-letak" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DAFTAR_TATA_LETAK_LABEL.map((x) => (
                      <SelectItem key={x} value={x}>
                        {td(`opsi.tataLetakNama.${x}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {tataLetak === "A4"
                    ? t("opsi.infoA4", { kolom: lembar.kolom, baris: lembar.baris, per: lembar.perHalaman, lembar: jumlahLembar })
                    : t("opsi.infoGulungan", { ukuran: td(`opsi.ukuranNama.${ukuran}`) })}
                </p>
              </div>

              {tataLetak === "A4" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="label-lewati">{t("opsi.lewati")}</Label>
                  <Input
                    id="label-lewati"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={lembar.perHalaman - 1}
                    className="w-28 tabular-nums"
                    value={lewatiSah === 0 ? "" : String(lewatiSah)}
                    placeholder="0"
                    onChange={(e) => setLewati(rapikanJumlah(e.target.value))}
                  />
                  <p className="text-xs text-muted-foreground">{t("opsi.lewatiBantuan")}</p>
                </div>
              ) : null}

              <div className="space-y-1.5">
                <Label htmlFor="label-kode">{t("opsi.kode")}</Label>
                <Select value={sumberKode} onValueChange={(v) => ubahOpsi({ sumberKode: v as OpsiLayarLabel["sumberKode"] })}>
                  <SelectTrigger id="label-kode" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DAFTAR_SUMBER_KODE_LABEL.map((x) => (
                      <SelectItem key={x} value={x}>
                        {td(`opsi.kodeNama.${x}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{t("opsi.kodeBantuan")}</p>
              </div>

              {gaya === "RINCI" ? (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="label-harga">{t("opsi.tampilHarga")}</Label>
                    <Switch id="label-harga" checked={tampilHarga} onCheckedChange={(c) => ubahOpsi({ tampilHarga: c })} />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="label-nama">{t("opsi.tampilNama")}</Label>
                    <Switch id="label-nama" checked={tampilNama} onCheckedChange={(c) => ubahOpsi({ tampilNama: c })} />
                  </div>
                </>
              ) : null}

              <div className="space-y-2 border-t pt-4">
                <Button className="w-full" onClick={cetak} disabled={alasanTidakBisaCetak !== null}>
                  <Printer className="h-4 w-4" />
                  {t("cetak.tombol", { n: angka.format(total) })}
                </Button>
                <p className="text-xs text-muted-foreground">{alasanTidakBisaCetak ?? t("cetak.petunjuk")}</p>
              </div>
            </CardContent>
          </Card>

          {peringatan.tidakBisa.length > 0 ? (
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertTitle className="line-clamp-none">{t("peringatan.tidakBisaJudul")}</AlertTitle>
              <AlertDescription>{daftarPendek(peringatan.tidakBisa.map((x) => x.kode), lainnya)}</AlertDescription>
            </Alert>
          ) : null}
          {peringatan.rapat.length > 0 ? (
            <Alert>
              <AlertTriangle />
              <AlertTitle className="line-clamp-none">{t("peringatan.rapatJudul", { ukuran: td(`opsi.ukuranNama.${ukuran}`) })}</AlertTitle>
              <AlertDescription>
                <p>{t("peringatan.rapatIsi")}</p>
                <p className="font-mono text-xs">{daftarPendek(peringatan.rapat.map((x) => x.kode), lainnya)}</p>
              </AlertDescription>
            </Alert>
          ) : null}
          {peringatan.tanpaBarcode.length > 0 ? (
            <Alert>
              <AlertTriangle />
              <AlertTitle className="line-clamp-none">{t("peringatan.tanpaBarcodeJudul", { n: peringatan.tanpaBarcode.length })}</AlertTitle>
              <AlertDescription>
                <p>{t("peringatan.tanpaBarcodeIsi")}</p>
                <p className="font-mono text-xs">{daftarPendek(peringatan.tanpaBarcode.map((x) => x.variantSku), lainnya)}</p>
              </AlertDescription>
            </Alert>
          ) : null}
          {peringatan.tanpaHarga.length > 0 ? (
            <Alert>
              <AlertTriangle />
              <AlertTitle className="line-clamp-none">{t("peringatan.tanpaHargaJudul", { n: peringatan.tanpaHarga.length })}</AlertTitle>
              <AlertDescription>
                <p>{t("peringatan.tanpaHargaIsi")}</p>
                <p>{daftarPendek(peringatan.tanpaHarga.map((x) => x.nama), lainnya)}</p>
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Barcode className="h-5 w-5" />
            {t("pratinjau.judul")}
          </CardTitle>
          <CardDescription>{htmlPratinjau !== html ? t("cetak.alasanMemuat") : t("pratinjau.deskripsi")}</CardDescription>
        </CardHeader>
        <CardContent>
          {htmlPratinjau === null ? (
            <EmptyState
              icon={AlertTriangle}
              title={t("pratinjau.terlaluBanyakJudul")}
              description={t("cetak.alasanTerlaluBanyak", { maks: angka.format(MAKS_LABEL_SEKALI_CETAK) })}
            />
          ) : (
            <iframe title={t("pratinjau.judul")} srcDoc={htmlPratinjau} className="h-[70vh] w-full rounded-md border bg-muted" />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
