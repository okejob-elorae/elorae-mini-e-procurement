"use client";

import { useMemo, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Loader2, Plus, X } from "lucide-react";
import { simpanTabelUkuranAction } from "@/app/actions/size-charts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { dinamis } from "@/lib/i18n/dinamis";
import {
  BATAS_TABEL_UKURAN,
  SATUAN_UKURAN,
  bacaAngkaUkuran,
  periksaTabelUkuran,
  teksAngkaUkuran,
  type IsianTabelUkuran,
  type MasalahTabelUkuran,
} from "@/lib/items/size-chart";
import type { BarisDaftarTabelUkuran, KategoriTabelUkuran } from "@/lib/items/size-chart-queries";
import { cn } from "@/lib/utils";

type Kolom = { kunci: string; judul: string };
type Baris = { kunci: string; ukuran: string; sel: Record<string, string> };

let urutan = 0;
const kunciBaru = () => `k${++urutan}`;

const TANPA_KATEGORI = "__tanpa__";
/** Ukuran pakaian yang paling sering — satu ketukan untuk tabel baru. */
const UKURAN_UMUM = ["S", "M", "L", "XL", "XXL"];
const KOLOM_UMUM = ["Lebar dada", "Panjang badan", "Panjang lengan"];

function geser<T>(daftar: T[], i: number, arah: -1 | 1): T[] {
  const j = i + arah;
  if (j < 0 || j >= daftar.length) return daftar;
  const salin = [...daftar];
  [salin[i], salin[j]] = [salin[j], salin[i]];
  return salin;
}

/**
 * Formulir tabel ukuran (dialog, pola formulir pemasok). Kolom pengukuran bisa
 * ditambah, dihapus, dan digeser; angka setiap ukuran mengikuti kolomnya
 * (disimpan per kunci kolom, jadi menggeser kolom tidak mengacak angkanya).
 * Tanpa `bolehUbah` semua isian terkunci dan tombol simpan tidak ada.
 */
export function FormTabelUkuran({
  awal,
  kategori,
  bolehUbah,
  onTutup,
  onTersimpan,
}: {
  awal: BarisDaftarTabelUkuran | null;
  kategori: KategoriTabelUkuran[];
  bolehUbah: boolean;
  onTutup: () => void;
  onTersimpan: () => void;
}) {
  const t = useTranslations("sizeCharts");
  const tm = dinamis(useTranslations("sizeCharts.masalah"));
  const locale = useLocale();
  const [menyimpan, mulai] = useTransition();

  const [nama, setNama] = useState(awal?.name ?? "");
  const [satuan, setSatuan] = useState<string>(awal?.unit ?? "cm");
  const [kategoriId, setKategoriId] = useState<string>(awal?.categoryId ?? "");
  const [aktif, setAktif] = useState(awal?.isActive ?? true);
  const [catatan, setCatatan] = useState(awal?.note ?? "");
  // Kunci kolom dibuat sekali saat dialog dibuka; angka awal setiap ukuran
  // dipasangkan ke kunci itu menurut urutan `columns`.
  const [awalan] = useState(() => {
    const kol: Kolom[] = (awal?.columns.length ? awal.columns : KOLOM_UMUM).map((judul) => ({ kunci: kunciBaru(), judul }));
    const bar: Baris[] = (awal?.rows ?? []).map((r) => {
      const sel: Record<string, string> = {};
      kol.forEach((k, i) => (sel[k.kunci] = teksAngkaUkuran(r.nilai[i] ?? null, locale)));
      return { kunci: kunciBaru(), ukuran: r.ukuran, sel };
    });
    return { kol, bar };
  });
  const [kolom, setKolom] = useState<Kolom[]>(awalan.kol);
  const [baris, setBaris] = useState<Baris[]>(awalan.bar);

  const [masalahServer, setMasalahServer] = useState<string | null>(null);
  const [cobaKirim, setCobaKirim] = useState(false);

  const isian = useMemo<IsianTabelUkuran>(
    () => ({
      name: nama,
      unit: satuan,
      categoryId: kategoriId || null,
      columns: kolom.map((k) => k.judul),
      rows: baris.map((b) => ({
        ukuran: b.ukuran,
        // Sel yang tidak terbaca menjadi NaN — `periksaTabelUkuran` menolaknya.
        nilai: kolom.map((k) => bacaAngkaUkuran(b.sel[k.kunci] ?? "")),
      })),
      note: catatan.trim() ? catatan : null,
      isActive: aktif,
    }),
    [nama, satuan, kategoriId, kolom, baris, catatan, aktif],
  );
  const periksa = useMemo(() => periksaTabelUkuran(isian), [isian]);
  const masalah: MasalahTabelUkuran[] = periksa.ok ? [] : periksa.masalah;
  const selSalah = (b: Baris, k: Kolom) => {
    const n = bacaAngkaUkuran(b.sel[k.kunci] ?? "");
    return n !== null && Number.isNaN(n);
  };

  const opsiKategori = useMemo(
    () => [
      { value: TANPA_KATEGORI, label: t("form.tanpaKategori") },
      ...kategori.map((k) => ({
        value: k.id,
        label: `${k.code ? `${k.code} - ` : ""}${k.name}${k.isActive ? "" : ` (${t("nonaktif").toLowerCase()})`}`,
      })),
    ],
    [kategori, t],
  );

  const ubahKolom = (kunci: string, judul: string) => setKolom((ks) => ks.map((k) => (k.kunci === kunci ? { ...k, judul } : k)));
  const tambahKolom = () => setKolom((ks) => (ks.length >= BATAS_TABEL_UKURAN.kolom ? ks : [...ks, { kunci: kunciBaru(), judul: "" }]));
  const hapusKolom = (kunci: string) => setKolom((ks) => ks.filter((k) => k.kunci !== kunci));
  const ubahUkuran = (kunci: string, ukuran: string) => setBaris((bs) => bs.map((b) => (b.kunci === kunci ? { ...b, ukuran } : b)));
  const ubahSel = (kunciBaris: string, kunciKolom: string, teks: string) =>
    setBaris((bs) => bs.map((b) => (b.kunci === kunciBaris ? { ...b, sel: { ...b.sel, [kunciKolom]: teks } } : b)));
  const tambahBaris = (ukuran = "") =>
    setBaris((bs) => (bs.length >= BATAS_TABEL_UKURAN.baris ? bs : [...bs, { kunci: kunciBaru(), ukuran, sel: {} }]));
  const hapusBaris = (kunci: string) => setBaris((bs) => bs.filter((b) => b.kunci !== kunci));

  const simpan = () => {
    setCobaKirim(true);
    setMasalahServer(null);
    if (!periksa.ok) return;
    mulai(async () => {
      const h = await simpanTabelUkuranAction(awal?.id ?? null, isian);
      if (h.ok) {
        toast.success(awal ? t("toast.diubah", { name: nama.trim() }) : t("toast.dibuat", { name: nama.trim() }));
        onTersimpan();
        return;
      }
      const pesan =
        h.code === "DUPLIKAT_KATEGORI"
          ? t("galat.duplikatKategori", { name: h.namaBentrok })
          : h.code === "TIDAK_SAH"
            ? h.masalah.map((m) => tm(m)).join(" ")
            : h.code === "KATEGORI_TIDAK_DITEMUKAN"
              ? t("galat.kategoriTidakDitemukan")
              : h.code === "TIDAK_DITEMUKAN"
                ? t("galat.tidakDitemukan")
                : h.code === "TANPA_AKSES"
                  ? t("galat.tanpaAkses")
                  : t("galat.gagal");
      setMasalahServer(pesan);
      toast.error(pesan);
    });
  };

  const terkunci = !bolehUbah || menyimpan;

  return (
    <Dialog open onOpenChange={(o) => !o && !menyimpan && onTutup()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{!bolehUbah ? (awal?.name ?? t("judul")) : awal ? t("form.judulUbah") : t("form.judulBaru")}</DialogTitle>
          <DialogDescription>{t("form.deskripsi")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="tu-nama">{t("form.nama")} *</Label>
              <Input
                id="tu-nama"
                value={nama}
                onChange={(e) => setNama(e.target.value)}
                placeholder={t("form.namaContoh")}
                maxLength={BATAS_TABEL_UKURAN.nama}
                disabled={terkunci}
                aria-invalid={cobaKirim && masalah.includes("NAMA_WAJIB")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tu-satuan">{t("form.satuan")}</Label>
              <Select value={satuan} onValueChange={setSatuan} disabled={terkunci}>
                <SelectTrigger id="tu-satuan" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SATUAN_UKURAN.map((s) => (
                    <SelectItem key={s} value={s}>
                      {t(`satuan.${s}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="tu-kategori">{t("form.kategori")}</Label>
              <SearchableCombobox
                id="tu-kategori"
                options={opsiKategori}
                value={kategoriId || TANPA_KATEGORI}
                onValueChange={(v) => setKategoriId(v === TANPA_KATEGORI ? "" : v)}
                placeholder={t("form.tanpaKategori")}
                disabled={terkunci}
              />
              <p className="text-xs text-muted-foreground">{t("form.kategoriBantuan")}</p>
            </div>
            <div className="flex items-start gap-3 rounded-md border p-3">
              <Switch id="tu-aktif" checked={aktif} onCheckedChange={setAktif} disabled={terkunci} />
              <div className="space-y-0.5">
                <Label htmlFor="tu-aktif">{t("aktif")}</Label>
                <p className="text-xs text-muted-foreground">{t("form.aktifBantuan")}</p>
              </div>
            </div>
          </div>

          {/* Kolom pengukuran: judul, urutan, tambah/hapus. */}
          <section className="space-y-2" aria-labelledby="tu-kolom-judul">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 id="tu-kolom-judul" className="font-medium">
                  {t("form.kolomJudul")}
                </h3>
                <p className="text-xs text-muted-foreground">{t("form.kolomBantuan")}</p>
              </div>
              {bolehUbah ? (
                <Button type="button" variant="outline" size="sm" onClick={tambahKolom} disabled={terkunci || kolom.length >= BATAS_TABEL_UKURAN.kolom}>
                  <Plus className="mr-1 h-4 w-4" />
                  {t("form.tambahKolom")}
                </Button>
              ) : null}
            </div>
            <ol className="space-y-2">
              {kolom.map((k, i) => (
                <li key={k.kunci} className="flex items-center gap-2">
                  <span className="w-6 shrink-0 text-right text-sm tabular-nums text-muted-foreground">{i + 1}</span>
                  <Input
                    value={k.judul}
                    onChange={(e) => ubahKolom(k.kunci, e.target.value)}
                    placeholder={t("form.kolomContoh")}
                    maxLength={BATAS_TABEL_UKURAN.judulKolom}
                    disabled={terkunci}
                    aria-label={t("form.kolomAria", { n: i + 1 })}
                    aria-invalid={cobaKirim && !k.judul.trim()}
                    className="max-w-sm"
                  />
                  {bolehUbah ? (
                    <div className="flex shrink-0 items-center">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => setKolom((ks) => geser(ks, i, -1))}
                        disabled={terkunci || i === 0}
                        aria-label={t("form.kolomKiri", { name: k.judul || String(i + 1) })}
                        title={t("form.kolomKiri", { name: k.judul || String(i + 1) })}
                      >
                        <ArrowLeft className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => setKolom((ks) => geser(ks, i, 1))}
                        disabled={terkunci || i === kolom.length - 1}
                        aria-label={t("form.kolomKanan", { name: k.judul || String(i + 1) })}
                        title={t("form.kolomKanan", { name: k.judul || String(i + 1) })}
                      >
                        <ArrowRight className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive"
                        onClick={() => hapusKolom(k.kunci)}
                        disabled={terkunci || kolom.length <= 1}
                        aria-label={t("form.kolomHapus", { name: k.judul || String(i + 1) })}
                        title={t("form.kolomHapus", { name: k.judul || String(i + 1) })}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>

          {/* Angka per ukuran. Tabel lebar bergeser di dalam dialog. */}
          <section className="space-y-2" aria-labelledby="tu-baris-judul">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 id="tu-baris-judul" className="font-medium">
                  {t("form.barisJudul", { satuan: t(`satuanPendek.${satuan === "inci" ? "inci" : "cm"}`) })}
                </h3>
                <p className="text-xs text-muted-foreground">{t("form.barisBantuan")}</p>
              </div>
              {bolehUbah ? (
                <div className="flex flex-wrap gap-2">
                  {baris.length === 0 ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => UKURAN_UMUM.forEach((u) => tambahBaris(u))}
                      disabled={terkunci}
                    >
                      {t("form.isiUmum", { list: UKURAN_UMUM.join(", ") })}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => tambahBaris()}
                    disabled={terkunci || baris.length >= BATAS_TABEL_UKURAN.baris}
                  >
                    <Plus className="mr-1 h-4 w-4" />
                    {t("form.tambahBaris")}
                  </Button>
                </div>
              ) : null}
            </div>
            {baris.length === 0 ? (
              <p className={cn("rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground", cobaKirim && "border-destructive")}>
                {t("form.barisKosong")}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[96px]">{t("form.ukuran")}</TableHead>
                      {kolom.map((k, i) => (
                        <TableHead key={k.kunci} className="min-w-[110px] whitespace-normal">
                          {k.judul.trim() || t("form.kolomAria", { n: i + 1 })}
                        </TableHead>
                      ))}
                      {bolehUbah ? <TableHead className="w-[120px]" /> : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {baris.map((b, i) => (
                      <TableRow key={b.kunci}>
                        <TableCell>
                          <Input
                            value={b.ukuran}
                            onChange={(e) => ubahUkuran(b.kunci, e.target.value)}
                            placeholder="M"
                            maxLength={BATAS_TABEL_UKURAN.ukuran}
                            disabled={terkunci}
                            aria-label={t("form.ukuranAria", { n: i + 1 })}
                            aria-invalid={cobaKirim && !b.ukuran.trim()}
                          />
                        </TableCell>
                        {kolom.map((k) => {
                          const salah = selSalah(b, k);
                          return (
                            <TableCell key={k.kunci}>
                              <Input
                                value={b.sel[k.kunci] ?? ""}
                                onChange={(e) => ubahSel(b.kunci, k.kunci, e.target.value)}
                                inputMode="decimal"
                                disabled={terkunci}
                                aria-label={t("form.selAria", { ukuran: b.ukuran || String(i + 1), kolom: k.judul || "" })}
                                aria-invalid={salah}
                                className={cn("tabular-nums", salah && "border-destructive")}
                              />
                            </TableCell>
                          );
                        })}
                        {bolehUbah ? (
                          <TableCell>
                            <div className="flex items-center justify-end">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => setBaris((bs) => geser(bs, i, -1))}
                                disabled={terkunci || i === 0}
                                aria-label={t("form.barisNaik", { ukuran: b.ukuran || String(i + 1) })}
                                title={t("form.barisNaik", { ukuran: b.ukuran || String(i + 1) })}
                              >
                                <ArrowUp className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => setBaris((bs) => geser(bs, i, 1))}
                                disabled={terkunci || i === baris.length - 1}
                                aria-label={t("form.barisTurun", { ukuran: b.ukuran || String(i + 1) })}
                                title={t("form.barisTurun", { ukuran: b.ukuran || String(i + 1) })}
                              >
                                <ArrowDown className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="text-destructive hover:text-destructive"
                                onClick={() => hapusBaris(b.kunci)}
                                disabled={terkunci}
                                aria-label={t("form.barisHapus", { ukuran: b.ukuran || String(i + 1) })}
                                title={t("form.barisHapus", { ukuran: b.ukuran || String(i + 1) })}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        ) : null}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>

          <div className="space-y-2">
            <Label htmlFor="tu-catatan">{t("form.catatan")}</Label>
            <Textarea
              id="tu-catatan"
              value={catatan}
              onChange={(e) => setCatatan(e.target.value)}
              placeholder={t("form.catatanContoh")}
              maxLength={BATAS_TABEL_UKURAN.catatan}
              rows={3}
              disabled={terkunci}
            />
          </div>

          {bolehUbah && cobaKirim && masalah.length > 0 ? (
            <ul className="list-disc space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3 pl-7 text-sm text-destructive" role="alert">
              {masalah.map((m) => (
                <li key={m}>{tm(m)}</li>
              ))}
            </ul>
          ) : null}
          {masalahServer ? (
            <p className="text-sm text-destructive" role="alert">
              {masalahServer}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onTutup} disabled={menyimpan}>
            {bolehUbah ? t("batal") : t("tutup")}
          </Button>
          {bolehUbah ? (
            <Button type="button" onClick={simpan} disabled={menyimpan}>
              {menyimpan ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {awal ? t("form.simpanUbah") : t("form.simpanBaru")}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
