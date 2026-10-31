"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, BadgeCheck, Info, Loader2, Minus, Plus, Sparkles, Store, Trash2, X } from "lucide-react";
import { simpanPromoKonterAction } from "@/app/actions/promo-konter";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { RentangTanggalInput } from "@/components/ui/rentang-tanggal-input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SearchableCombobox, type SearchableComboboxOption } from "@/components/ui/searchable-combobox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { StatusPill } from "@/components/ui/status-pill";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { formatRupiah } from "@/lib/format/rupiah";
import { dinamis } from "@/lib/i18n/dinamis";
import {
  JENIS_PROMO_KONTER,
  PAKET_MAKS_KOMPONEN,
  PAKET_MAKS_POTONG,
  PAKET_MAKS_QTY_KOMPONEN,
  promoNota,
  type JenisPromoKonter,
  type KomponenPaket,
} from "@/lib/spg/promo-konter";
import {
  contohPromo,
  jumlahPotongPaket,
  periksaIsianPromoKonter,
  PANJANG_CATATAN_MAKS,
  PANJANG_NAMA_MAKS,
  rapikanIsianPromoKonter,
  type IsianPromoKonter,
  type MasalahIsianPromoKonter,
  type StatusPromoKonter,
} from "@/lib/spg/promo-konter-kantor";
import type { OpsiFormPromoKonter } from "@/lib/spg/promo-konter-kantor-queries";
import { cn } from "@/lib/utils";
import { formatPersen, NADA_STATUS_PROMO } from "./tampilan";
import { TombolPromoKonter } from "./TombolPromoKonter";

type ModeBarang = "SEMUA" | "BARANG" | "KATEGORI";
const MODE_BARANG: readonly ModeBarang[] = ["SEMUA", "BARANG", "KATEGORI"];

/** Barang yang ditulis di daftar pencarian sekaligus — sisanya lewat pencarian. */
const BARANG_TAMPIL = 60;

/** Satu baris isi paket di formulir. `kunci` hanya untuk React; jumlah masih teks ketikan. */
type BarisKomponen = { kunci: string; jenis: KomponenPaket["jenis"]; refId: string; qty: string };
const JENIS_KOMPONEN: readonly KomponenPaket["jenis"][] = ["ITEM", "CATEGORY"];

let urutKomponen = 0;
const barisKomponenBaru = (k: Partial<Omit<BarisKomponen, "kunci">> = {}): BarisKomponen => {
  urutKomponen += 1;
  return { kunci: `komponen-${urutKomponen}`, jenis: "ITEM", refId: "", qty: "1", ...k };
};

type Keadaan = {
  name: string;
  type: JenisPromoKonter;
  value: string;
  buyQty: string;
  freeQty: string;
  minSubtotal: string;
  mode: ModeBarang;
  itemIds: string[];
  categoryIds: string[];
  allStores: boolean;
  storeIds: string[];
  dari: string;
  sampai: string;
  priority: string;
  note: string;
  dibagi: boolean;
  bagianToko: string;
  aktif: boolean;
  memberOnly: boolean;
  komponen: BarisKomponen[];
};

const teks = (n: number | null) => (n === null || !Number.isFinite(n) ? "" : String(n));
const angka = (s: string): number | null => (s.trim() === "" ? null : Number(s.replace(",", ".")));

function keadaanAwal(a: IsianPromoKonter | null): Keadaan {
  if (!a) {
    return {
      name: "",
      type: "PERSEN",
      value: "",
      buyQty: "",
      freeQty: "",
      minSubtotal: "",
      mode: "SEMUA",
      itemIds: [],
      categoryIds: [],
      allStores: true,
      storeIds: [],
      dari: "",
      sampai: "",
      priority: "0",
      note: "",
      dibagi: false,
      bagianToko: "",
      aktif: true,
      memberOnly: false,
      komponen: [barisKomponenBaru()],
    };
  }
  const paket = a.type === "PAKET";
  return {
    name: a.name,
    type: (JENIS_PROMO_KONTER as readonly string[]).includes(a.type) ? (a.type as JenisPromoKonter) : "PERSEN",
    value: teks(a.value),
    buyQty: teks(a.buyQty),
    freeQty: teks(a.freeQty),
    minSubtotal: teks(a.minSubtotal),
    // Barang paket ada di komponennya; pilihan "barang yang ikut" mulai bersih kalau jenisnya diganti.
    mode: paket || a.allItems ? "SEMUA" : a.itemIds.length > 0 ? "BARANG" : "KATEGORI",
    itemIds: paket ? [] : a.itemIds,
    categoryIds: paket ? [] : a.categoryIds,
    allStores: a.allStores,
    storeIds: a.storeIds,
    dari: a.dari,
    sampai: a.sampai,
    priority: String(a.priority),
    note: a.note,
    dibagi: a.storeSharePercent > 0,
    bagianToko: a.storeSharePercent > 0 ? teks(a.storeSharePercent) : "",
    aktif: true,
    memberOnly: a.memberOnly === true,
    komponen:
      paket && a.komponen.length > 0
        ? a.komponen.map((x) => barisKomponenBaru({ jenis: x.jenis, refId: x.refId, qty: teks(x.qty) }))
        : [barisKomponenBaru()],
  };
}

function keIsian(k: Keadaan): IsianPromoKonter {
  return {
    name: k.name,
    type: k.type,
    value: angka(k.value),
    buyQty: angka(k.buyQty),
    freeQty: angka(k.freeQty),
    minSubtotal: angka(k.minSubtotal),
    allItems: k.mode === "SEMUA",
    itemIds: k.mode === "BARANG" ? k.itemIds : [],
    categoryIds: k.mode === "KATEGORI" ? k.categoryIds : [],
    allStores: k.allStores,
    storeIds: k.allStores ? [] : k.storeIds,
    dari: k.dari,
    sampai: k.sampai,
    priority: angka(k.priority) ?? 0,
    note: k.note,
    // "Dibagi" tanpa angka = belum diisi, bukan "penuh Elorae" diam-diam.
    storeSharePercent: k.dibagi ? (angka(k.bagianToko) ?? Number.NaN) : 0,
    memberOnly: k.memberOnly,
    // Baris yang belum lengkap tetap dikirim, supaya pemeriksa menolaknya — tidak dibuang diam-diam.
    komponen: k.type === "PAKET" ? k.komponen.map((b) => ({ jenis: b.jenis, refId: b.refId, qty: angka(b.qty) ?? Number.NaN })) : [],
  };
}

const ubahDaftar = (daftar: string[], id: string, pilih: boolean) => (pilih ? [...new Set([...daftar, id])] : daftar.filter((x) => x !== id));

export function PromoKonterForm({
  id,
  awal,
  isActive = true,
  status,
  nota = 0,
  opsi,
  bolehUbah,
}: {
  id: string | null;
  awal: IsianPromoKonter | null;
  isActive?: boolean;
  status?: StatusPromoKonter;
  nota?: number;
  opsi: OpsiFormPromoKonter;
  bolehUbah: boolean;
}) {
  const t = useTranslations("promoKonter");
  const tf = useTranslations("promoKonter.form");
  const td = dinamis(t);
  const tfd = dinamis(tf);
  const router = useRouter();
  const [sibuk, mulai] = useTransition();
  const [k, setK] = useState<Keadaan>(() => keadaanAwal(awal));
  const [dicoba, setDicoba] = useState(false);
  const [masalahServer, setMasalahServer] = useState<MasalahIsianPromoKonter[]>([]);
  const [cariBarang, setCariBarang] = useState("");
  const [cariToko, setCariToko] = useState("");

  const nonaktif = !bolehUbah || sibuk;
  const ubah = <K extends keyof Keadaan>(kunci: K, nilai: Keadaan[K]) => {
    setK((x) => ({ ...x, [kunci]: nilai }));
    setMasalahServer([]);
  };

  const isian = useMemo(() => keIsian(k), [k]);
  const masalahLokal = useMemo(() => {
    const m = periksaIsianPromoKonter(rapikanIsianPromoKonter(isian));
    // "Dibagi dengan toko" harus lebih dari 0 — 0 berarti "penuh Elorae", pilih yang itu.
    if (k.dibagi && isian.storeSharePercent === 0 && !m.includes("BAGIAN_TOKO_TIDAK_VALID")) m.push("BAGIAN_TOKO_TIDAK_VALID");
    return m;
  }, [isian, k.dibagi]);
  const masalah = [...new Set([...(dicoba ? masalahLokal : []), ...masalahServer])];

  const namaBarang = useMemo(() => new Map(opsi.barang.map((b) => [b.id, b])), [opsi.barang]);
  const contoh = useMemo(
    () =>
      contohPromo({
        type: k.type,
        value: isian.value,
        buyQty: isian.buyQty,
        freeQty: isian.freeQty,
        minSubtotal: isian.minSubtotal,
        komponen: isian.komponen,
        hargaBarang: (id) => namaBarang.get(id)?.harga ?? null,
      }),
    [k.type, isian.value, isian.buyQty, isian.freeQty, isian.minSubtotal, isian.komponen, namaBarang],
  );
  const barangSaring = useMemo(() => {
    const q = cariBarang.trim().toLowerCase();
    const cocok = q ? opsi.barang.filter((b) => b.sku.toLowerCase().includes(q) || b.nama.toLowerCase().includes(q)) : opsi.barang;
    return { tampil: cocok.slice(0, BARANG_TAMPIL), sisa: Math.max(0, cocok.length - BARANG_TAMPIL) };
  }, [opsi.barang, cariBarang]);
  const tokoSaring = useMemo(() => {
    const q = cariToko.trim().toLowerCase();
    return q ? opsi.toko.filter((s) => s.nama.toLowerCase().includes(q) || s.kode.toLowerCase().includes(q)) : opsi.toko;
  }, [opsi.toko, cariToko]);
  const tokoBerSpg = useMemo(() => opsi.toko.filter((s) => s.aktif && s.spg > 0).map((s) => s.id), [opsi.toko]);

  const simpan = (e: React.FormEvent) => {
    e.preventDefault();
    if (!bolehUbah || sibuk) return;
    setDicoba(true);
    if (masalahLokal.length > 0) return;
    mulai(async () => {
      try {
        const r = await simpanPromoKonterAction({ id, isian, aktif: k.aktif });
        if (r.ok) {
          toast.success(id ? t("okUbah") : t("okBuat"));
          router.push("/backoffice/promo-konter");
          return;
        }
        if (r.code === "TIDAK_VALID") {
          setMasalahServer(r.masalah);
          if (r.masalah.length === 0) toast.error(t("err.GAGAL"));
          return;
        }
        toast.error(td(`err.${r.code}`));
      } catch {
        toast.error(t("err.GAGAL"));
      }
    });
  };

  const jenisBelanja = promoNota(k.type);
  const jenisPaket = k.type === "PAKET";
  const labelNilai = tfd(`nilai.${k.type}`);
  const persenType = k.type === "PERSEN" || k.type === "MIN_BELANJA_PERSEN";

  return (
    <div className="space-y-6">
      {/* Tautan kembali di atas judul, sama dengan formulir lain di grup ini. */}
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/backoffice/promo-konter">
          <ArrowLeft className="mr-2 h-4 w-4" aria-hidden />
          {t("kembaliKeDaftar")}
        </Link>
      </Button>
      <PageHeader
        title={id ? awal?.name || t("judulUbah") : t("judulBaru")}
        meta={
          status ? (
            <span className="flex flex-wrap items-center gap-2">
              <StatusPill tone={NADA_STATUS_PROMO[status]}>{td(`status.${status}`)}</StatusPill>
              <span>{t("nNota", { n: nota })}</span>
              {!bolehUbah ? <span className="text-amber-700 dark:text-amber-400">{t("hanyaLihat")}</span> : null}
            </span>
          ) : !bolehUbah ? (
            <span className="text-amber-700 dark:text-amber-400">{t("hanyaLihat")}</span>
          ) : undefined
        }
        actions={
          id ? (
            <TombolPromoKonter id={id} nama={awal?.name ?? ""} isActive={isActive} nota={nota} bolehUbah={bolehUbah} sesudahHapus="/backoffice/promo-konter" />
          ) : undefined
        }
      />

      {id && nota > 0 ? (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>{tf("sudahDipakaiJudul", { n: nota })}</AlertTitle>
          <AlertDescription>{tf("sudahDipakaiIsi")}</AlertDescription>
        </Alert>
      ) : null}

      <form onSubmit={simpan} className="min-w-0">
        <Card>
          <CardContent className="space-y-6">
            {/* Promo */}
            <section className="space-y-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{tf("bagian.promo")}</h3>
              <div className="space-y-1.5">
                <Label htmlFor="pk-nama">{tf("nama")}</Label>
                <Input
                  id="pk-nama"
                  value={k.name}
                  maxLength={PANJANG_NAMA_MAKS}
                  disabled={nonaktif}
                  placeholder={tf("namaContoh")}
                  onChange={(e) => ubah("name", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pk-jenis">{tf("jenis")}</Label>
                <Select value={k.type} disabled={nonaktif} onValueChange={(v) => ubah("type", v as JenisPromoKonter)}>
                  <SelectTrigger id="pk-jenis" className="w-full sm:w-96">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {JENIS_PROMO_KONTER.map((j) => (
                      <SelectItem key={j} value={j}>
                        {td(`jenis.${j}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{tfd(`jenisBantu.${k.type}`)}</p>
              </div>

              {jenisPaket ? (
                <IsiPaketEditor
                  baris={k.komponen}
                  opsi={opsi}
                  nonaktif={nonaktif}
                  dicoba={dicoba}
                  onUbah={(komponen) => ubah("komponen", komponen)}
                />
              ) : null}

              {k.type === "BELI_GRATIS" ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="pk-beli">{tf("beli")}</Label>
                    <Input id="pk-beli" type="number" inputMode="numeric" min={1} step={1} value={k.buyQty} disabled={nonaktif} onChange={(e) => ubah("buyQty", e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pk-gratis">{tf("gratis")}</Label>
                    <Input id="pk-gratis" type="number" inputMode="numeric" min={1} step={1} value={k.freeQty} disabled={nonaktif} onChange={(e) => ubah("freeQty", e.target.value)} />
                  </div>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  {jenisBelanja ? (
                    <div className="space-y-1.5">
                      <Label htmlFor="pk-min">{tf("minBelanja")}</Label>
                      <Input
                        id="pk-min"
                        type="number"
                        inputMode="numeric"
                        min={0}
                        value={k.minSubtotal}
                        disabled={nonaktif}
                        onChange={(e) => ubah("minSubtotal", e.target.value)}
                      />
                    </div>
                  ) : null}
                  <div className="space-y-1.5">
                    <Label htmlFor="pk-nilai">{labelNilai}</Label>
                    <Input
                      id="pk-nilai"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={persenType ? 100 : undefined}
                      step={persenType ? "0.01" : "1"}
                      value={k.value}
                      disabled={nonaktif}
                      onChange={(e) => ubah("value", e.target.value)}
                    />
                  </div>
                </div>
              )}

              <p className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                <span>
                  {!contoh
                    ? jenisPaket
                      ? tf("contoh.belumPaket")
                      : tf("contoh.belum")
                    : contoh.jenis === "BUNDEL" && contoh.dariHargaBarang
                      ? contoh.terbentuk
                        ? tf("contoh.bundelAsli", {
                            kotor: formatRupiah(contoh.kotor),
                            bayar: formatRupiah(contoh.bayar),
                            hemat: formatRupiah(contoh.kotor - contoh.bayar),
                          })
                        : tf("contoh.bundelAsliTidak", { kotor: formatRupiah(contoh.kotor) })
                    : contoh.jenis === "BUNDEL"
                      ? contoh.terbentuk
                        ? tf("contoh.bundel", {
                            qty: contoh.qty,
                            harga: formatRupiah(contoh.harga),
                            kotor: formatRupiah(contoh.kotor),
                            bayar: formatRupiah(contoh.bayar),
                            hemat: formatRupiah(contoh.kotor - contoh.bayar),
                          })
                        : tf("contoh.bundelTidak", { qty: contoh.qty, harga: formatRupiah(contoh.harga), kotor: formatRupiah(contoh.kotor) })
                    : contoh.jenis === "SATUAN"
                      ? contoh.sesudah < contoh.harga
                        ? tf("contoh.satuan", { barang: tf("contoh.barang"), harga: formatRupiah(contoh.harga), sesudah: formatRupiah(contoh.sesudah) })
                        : tf("contoh.tanpaPotongan", { barang: tf("contoh.barang"), harga: formatRupiah(contoh.harga) })
                      : contoh.jenis === "PAKET"
                        ? tf("contoh.paket", {
                            qty: contoh.qty,
                            barang: tf("contoh.barang"),
                            harga: formatRupiah(contoh.harga),
                            kotor: formatRupiah(contoh.kotor),
                            bayar: formatRupiah(contoh.bayar),
                            gratis: contoh.gratis,
                          })
                        : tf("contoh.nota", { belanja: formatRupiah(contoh.belanja), sesudah: formatRupiah(contoh.sesudah) })}
                </span>
              </p>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-3 rounded-md border p-3">
                  <Label htmlFor="pk-member" className="cursor-pointer">
                    <BadgeCheck className="h-4 w-4 text-muted-foreground" aria-hidden />
                    {tf("memberOnly")}
                  </Label>
                  <Switch id="pk-member" checked={k.memberOnly} disabled={nonaktif} onCheckedChange={(v) => ubah("memberOnly", v)} />
                </div>
                <p className="text-xs text-muted-foreground">{tf("memberOnlyBantu")}</p>
              </div>
            </section>

            {/* Sasaran barang — paket memakai isinya sendiri (di bagian Promo). */}
            {!jenisPaket ? (
              <>
                <Separator />

                <section className="space-y-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{tf("bagian.barang")}</h3>
                  <div className="flex flex-wrap gap-2" role="group" aria-label={tf("bagian.barang")}>
                    {MODE_BARANG.map((m) => (
                      <Button key={m} type="button" variant={k.mode === m ? "default" : "outline"} aria-pressed={k.mode === m} disabled={nonaktif} onClick={() => ubah("mode", m)}>
                        {tfd(`mode.${m}`)}
                      </Button>
                    ))}
                  </div>
                  {jenisBelanja ? <p className="text-xs text-muted-foreground">{tf("barangPromoBelanja")}</p> : null}

                  {k.mode === "BARANG" ? (
                    <div className="space-y-2">
                      {k.itemIds.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {k.itemIds.map((iid) => {
                            const b = namaBarang.get(iid);
                            return (
                              <Badge key={iid} variant="secondary" className="gap-1 pr-1">
                                <span className="max-w-[16rem] truncate">{b ? `${b.nama} · ${b.sku}` : iid}</span>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-5 w-5"
                                  disabled={nonaktif}
                                  aria-label={tf("buang", { nama: b?.nama ?? iid })}
                                  onClick={() => ubah("itemIds", ubahDaftar(k.itemIds, iid, false))}
                                >
                                  <X className="h-3 w-3" />
                                </Button>
                              </Badge>
                            );
                          })}
                        </div>
                      ) : null}
                      <Input type="search" placeholder={tf("cariBarang")} aria-label={tf("cariBarang")} value={cariBarang} onChange={(e) => setCariBarang(e.target.value)} />
                      <ScrollArea className="h-56 rounded-md border">
                        <div className="space-y-0.5 p-2">
                          {barangSaring.tampil.length === 0 ? <p className="p-2 text-sm text-muted-foreground">{tf("tidakAdaBarang")}</p> : null}
                          {barangSaring.tampil.map((b) => (
                            <Label key={b.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm font-normal hover:bg-muted/50">
                              <Checkbox checked={k.itemIds.includes(b.id)} disabled={nonaktif} onCheckedChange={(v) => ubah("itemIds", ubahDaftar(k.itemIds, b.id, v === true))} />
                              <span className="font-mono text-xs text-muted-foreground">{b.sku}</span>
                              <span className="truncate">{b.nama}</span>
                              {!b.aktif ? <span className="ml-auto text-xs text-muted-foreground">{tf("nonaktif")}</span> : null}
                            </Label>
                          ))}
                          {barangSaring.sisa > 0 ? <p className="p-2 text-xs text-muted-foreground">{tf("barangLagi", { n: barangSaring.sisa })}</p> : null}
                        </div>
                      </ScrollArea>
                      <p className="text-xs text-muted-foreground">{tf("nDipilih", { n: k.itemIds.length })}</p>
                    </div>
                  ) : null}

                  {k.mode === "KATEGORI" ? (
                    <div className="space-y-2">
                      {opsi.kategori.length === 0 ? <p className="text-sm text-muted-foreground">{tf("tidakAdaKategori")}</p> : null}
                      <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                        {opsi.kategori.map((c) => (
                          <Label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm font-normal">
                            <Checkbox checked={k.categoryIds.includes(c.id)} disabled={nonaktif} onCheckedChange={(v) => ubah("categoryIds", ubahDaftar(k.categoryIds, c.id, v === true))} />
                            <span className="truncate">{c.nama}</span>
                            {!c.aktif ? <span className="ml-auto text-xs text-muted-foreground">{tf("nonaktif")}</span> : null}
                          </Label>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">{tf("nDipilih", { n: k.categoryIds.length })}</p>
                    </div>
                  ) : null}
                </section>
              </>
            ) : null}

            <Separator />

            {/* Toko */}
            <section className="space-y-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{tf("bagian.toko")}</h3>
              <div className="flex items-center justify-between gap-3 rounded-md border p-3">
                <Label htmlFor="pk-semua-toko" className="cursor-pointer">
                  {tf("semuaToko")}
                </Label>
                <Switch id="pk-semua-toko" checked={k.allStores} disabled={nonaktif} onCheckedChange={(v) => ubah("allStores", v)} />
              </div>
              <p className="text-xs text-muted-foreground">{tf("tokoBantu")}</p>
              {!k.allStores ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    <Input type="search" className="sm:max-w-xs" placeholder={tf("cariToko")} aria-label={tf("cariToko")} value={cariToko} onChange={(e) => setCariToko(e.target.value)} />
                    <Button type="button" variant="outline" disabled={nonaktif || tokoBerSpg.length === 0} onClick={() => ubah("storeIds", [...new Set([...k.storeIds, ...tokoBerSpg])])}>
                      {tf("pilihTokoSpg", { n: tokoBerSpg.length })}
                    </Button>
                    <Button type="button" variant="ghost" disabled={nonaktif || k.storeIds.length === 0} onClick={() => ubah("storeIds", [])}>
                      {tf("kosongkan")}
                    </Button>
                  </div>
                  <ScrollArea className="h-56 rounded-md border">
                    <div className="space-y-0.5 p-2">
                      {tokoSaring.length === 0 ? <p className="p-2 text-sm text-muted-foreground">{tf("tidakAdaToko")}</p> : null}
                      {tokoSaring.map((s) => (
                        <Label key={s.id} className="flex cursor-pointer flex-wrap items-center gap-2 rounded px-2 py-1.5 text-sm font-normal hover:bg-muted/50">
                          <Checkbox checked={k.storeIds.includes(s.id)} disabled={nonaktif} onCheckedChange={(v) => ubah("storeIds", ubahDaftar(k.storeIds, s.id, v === true))} />
                          <span className="truncate">{s.nama}</span>
                          <span className="font-mono text-xs text-muted-foreground">{s.kode}</span>
                          <Badge variant="outline">{s.termsType === "KONSI" ? tf("konsi") : tf("putus")}</Badge>
                          {s.spg > 0 ? (
                            <Badge variant="secondary" className="gap-1">
                              <Store className="h-3 w-3" aria-hidden />
                              {tf("adaSpg", { n: s.spg })}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">{tf("tanpaSpg")}</span>
                          )}
                          {!s.aktif ? <span className="ml-auto text-xs text-muted-foreground">{tf("nonaktif")}</span> : null}
                        </Label>
                      ))}
                    </div>
                  </ScrollArea>
                  <p className="text-xs text-muted-foreground">{tf("nDipilih", { n: k.storeIds.length })}</p>
                </div>
              ) : null}
            </section>

            <Separator />

            {/* Penanggung potongan */}
            <section className="space-y-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{tf("bagian.tanggungan")}</h3>
              <div className="flex flex-wrap gap-2" role="group" aria-label={tf("bagian.tanggungan")}>
                <Button type="button" variant={!k.dibagi ? "default" : "outline"} aria-pressed={!k.dibagi} disabled={nonaktif} onClick={() => ubah("dibagi", false)}>
                  {tf("eloraePenuh")}
                </Button>
                <Button type="button" variant={k.dibagi ? "default" : "outline"} aria-pressed={k.dibagi} disabled={nonaktif} onClick={() => ubah("dibagi", true)}>
                  {tf("dibagiToko")}
                </Button>
              </div>
              {k.dibagi ? (
                <div className="space-y-1.5 sm:max-w-xs">
                  <Label htmlFor="pk-bagian-toko">{tf("bagianToko")}</Label>
                  <Input
                    id="pk-bagian-toko"
                    type="number"
                    inputMode="decimal"
                    min={1}
                    max={100}
                    step="0.01"
                    value={k.bagianToko}
                    disabled={nonaktif}
                    onChange={(e) => ubah("bagianToko", e.target.value)}
                  />
                  {isian.storeSharePercent > 0 && isian.storeSharePercent <= 100 ? (
                    <p className="text-xs text-muted-foreground">
                      {tf("bagianRingkas", {
                        toko: formatPersen(isian.storeSharePercent),
                        elorae: formatPersen(Math.round((100 - isian.storeSharePercent) * 100) / 100),
                      })}
                    </p>
                  ) : null}
                </div>
              ) : null}
              <p className="text-xs text-muted-foreground">{tf("tanggunganBantu")}</p>
            </section>

            <Separator />

            {/* Masa berlaku & prioritas */}
            <section className="space-y-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{tf("bagian.masa")}</h3>
              <div className="space-y-1.5 sm:max-w-sm">
                <Label htmlFor="pk-masa">{tf("masa")}</Label>
                <RentangTanggalInput
                  id="pk-masa"
                  pilihanCepat={false}
                  bolehTerbuka
                  dari={k.dari}
                  sampai={k.sampai}
                  disabled={nonaktif}
                  onChange={({ dari, sampai }) => {
                    setK((x) => ({ ...x, dari, sampai }));
                    setMasalahServer([]);
                  }}
                />
                <p className="text-xs text-muted-foreground">{tf("masaBantu")}</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="pk-prioritas">{tf("prioritas")}</Label>
                  <Input
                    id="pk-prioritas"
                    type="number"
                    inputMode="numeric"
                    step={1}
                    value={k.priority}
                    disabled={nonaktif}
                    onChange={(e) => ubah("priority", e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">{tf("prioritasBantu")}</p>
                </div>
                {!id ? (
                  <div className="flex items-center justify-between gap-3 self-start rounded-md border p-3">
                    <Label htmlFor="pk-aktif" className="cursor-pointer">
                      {tf("langsungAktif")}
                    </Label>
                    <Switch id="pk-aktif" checked={k.aktif} disabled={nonaktif} onCheckedChange={(v) => ubah("aktif", v)} />
                  </div>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pk-catatan">{tf("catatan")}</Label>
                <Textarea
                  id="pk-catatan"
                  rows={3}
                  maxLength={PANJANG_CATATAN_MAKS}
                  value={k.note}
                  disabled={nonaktif}
                  placeholder={tf("catatanContoh")}
                  onChange={(e) => ubah("note", e.target.value)}
                />
              </div>
            </section>

            {masalah.length > 0 ? (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>{tf("periksaJudul")}</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc space-y-0.5 pl-4">
                    {masalah.map((m) => (
                      <li key={m}>{tfd(`masalah.${m}`)}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            ) : null}

            <div className={cn("flex flex-wrap items-center gap-2", !bolehUbah && "hidden")}>
              <Button type="submit" disabled={nonaktif}>
                {sibuk ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {tf("simpan")}
              </Button>
              <Button type="button" variant="outline" disabled={sibuk} onClick={() => router.push("/backoffice/promo-konter")}>
                {t("batal")}
              </Button>
            </div>
            {!bolehUbah ? (
              <Button type="button" variant="outline" onClick={() => router.push("/backoffice/promo-konter")}>
                {t("kembali")}
              </Button>
            ) : null}
          </CardContent>
        </Card>
      </form>
    </div>
  );
}

/**
 * Isi satu paket: baris [Barang tertentu | Barang dari kategori] + pilihan +
 * jumlah. Barang/kategori yang sudah dipakai baris lain tidak bisa dipilih lagi
 * (satu komponen satu baris). Baris yang belum lengkap tidak dibuang — pemeriksa
 * isian menolaknya, dan baris itu ditandai di sini.
 */
function IsiPaketEditor({
  baris,
  opsi,
  nonaktif,
  dicoba,
  onUbah,
}: {
  baris: BarisKomponen[];
  opsi: OpsiFormPromoKonter;
  nonaktif: boolean;
  dicoba: boolean;
  onUbah: (baris: BarisKomponen[]) => void;
}) {
  const tf = useTranslations("promoKonter.form");
  const tfd = dinamis(tf);
  const labelNonaktif = tf("nonaktif");

  const opsiBarang = useMemo<SearchableComboboxOption[]>(
    () => opsi.barang.map((b) => ({ value: b.id, label: `${b.nama} · ${b.sku}${b.aktif ? "" : ` (${labelNonaktif})`}` })),
    [opsi.barang, labelNonaktif],
  );
  const opsiKategori = useMemo<SearchableComboboxOption[]>(
    () => opsi.kategori.map((c) => ({ value: c.id, label: c.aktif ? c.nama : `${c.nama} (${labelNonaktif})` })),
    [opsi.kategori, labelNonaktif],
  );

  const qtyBaris = (b: BarisKomponen) => angka(b.qty);
  const qtySah = (b: BarisKomponen) => {
    const n = qtyBaris(b);
    return n !== null && Number.isInteger(n) && n >= 1 && n <= PAKET_MAKS_QTY_KOMPONEN;
  };
  const total = jumlahPotongPaket(baris.map((b) => ({ jenis: b.jenis, refId: b.refId, qty: qtyBaris(b) ?? Number.NaN })));
  const kurangPotong = total < 2;
  const lebihPotong = total > PAKET_MAKS_POTONG;

  const ganti = (kunci: string, ubahan: Partial<Omit<BarisKomponen, "kunci">>) =>
    onUbah(baris.map((b) => (b.kunci === kunci ? { ...b, ...ubahan } : b)));
  const langkah = (b: BarisKomponen, arah: 1 | -1) => {
    const n = qtyBaris(b);
    const awal = n !== null && Number.isInteger(n) ? n : 1;
    ganti(b.kunci, { qty: String(Math.min(PAKET_MAKS_QTY_KOMPONEN, Math.max(1, awal + arah))) });
  };

  return (
    <div className="space-y-3 rounded-md border bg-muted/20 p-3">
      <div className="space-y-0.5">
        <p className="text-sm font-medium">{tf("paket.judul")}</p>
        <p className="text-xs text-muted-foreground">{tf("paket.bantu")}</p>
      </div>

      <div className="hidden gap-2 px-3 text-xs text-muted-foreground sm:grid sm:grid-cols-[12rem_minmax(0,1fr)_8.5rem_2.25rem]" aria-hidden>
        <span>{tf("paket.kolomJenis")}</span>
        <span>{tf("paket.kolomPilihan")}</span>
        <span>{tf("paket.kolomJumlah")}</span>
        <span />
      </div>

      <ol className="space-y-2">
        {baris.map((b, i) => {
          const dipakaiLain = new Set(baris.filter((x) => x.kunci !== b.kunci && x.jenis === b.jenis && x.refId).map((x) => x.refId));
          const dasar = b.jenis === "ITEM" ? opsiBarang : opsiKategori;
          // Yang sudah dipakai baris lain tidak bisa dipilih lagi: satu barang/kategori satu baris.
          const pilihan = dipakaiLain.size === 0 ? dasar : dasar.map((o) => (dipakaiLain.has(o.value) ? { ...o, disabled: true } : o));
          const belumDipilih = dicoba && !b.refId;
          const n = qtyBaris(b);
          return (
            <li
              key={b.kunci}
              className="grid gap-2 rounded-md border bg-background p-3 sm:grid-cols-[12rem_minmax(0,1fr)_8.5rem_2.25rem] sm:items-start"
            >
              <Select
                value={b.jenis}
                disabled={nonaktif}
                onValueChange={(v) => ganti(b.kunci, { jenis: v as KomponenPaket["jenis"], refId: "" })}
              >
                <SelectTrigger className="w-full" aria-label={tf("paket.jenisBaris", { n: i + 1 })}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {JENIS_KOMPONEN.map((j) => (
                    <SelectItem key={j} value={j}>
                      {tfd(`paket.jenis.${j}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="min-w-0 space-y-1">
                <SearchableCombobox
                  aria-label={tf("paket.pilihanBaris", { n: i + 1 })}
                  options={pilihan}
                  value={b.refId}
                  disabled={nonaktif}
                  aria-invalid={belumDipilih}
                  placeholder={b.jenis === "ITEM" ? tf("paket.pilihBarang") : tf("paket.pilihKategori")}
                  searchPlaceholder={b.jenis === "ITEM" ? tf("cariBarang") : tf("paket.cariKategori")}
                  emptyMessage={b.jenis === "ITEM" ? tf("tidakAdaBarang") : tf("tidakAdaKategori")}
                  onValueChange={(v) => ganti(b.kunci, { refId: v })}
                />
                {belumDipilih ? <p className="text-xs text-destructive">{tf("paket.belumDipilih")}</p> : null}
              </div>

              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  disabled={nonaktif || (n !== null && n <= 1)}
                  aria-label={tf("paket.kurangi", { n: i + 1 })}
                  onClick={() => langkah(b, -1)}
                >
                  <Minus className="h-4 w-4" />
                </Button>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={PAKET_MAKS_QTY_KOMPONEN}
                  step={1}
                  className="w-14 px-1 text-center tabular-nums"
                  value={b.qty}
                  disabled={nonaktif}
                  aria-invalid={!qtySah(b)}
                  aria-label={tf("paket.jumlahBaris", { n: i + 1 })}
                  onChange={(e) => ganti(b.kunci, { qty: e.target.value })}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  disabled={nonaktif || (n !== null && n >= PAKET_MAKS_QTY_KOMPONEN)}
                  aria-label={tf("paket.tambahi", { n: i + 1 })}
                  onClick={() => langkah(b, 1)}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>

              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={nonaktif || baris.length <= 1}
                aria-label={tf("paket.hapusBaris", { n: i + 1 })}
                title={tf("paket.hapusBaris", { n: i + 1 })}
                onClick={() => onUbah(baris.filter((x) => x.kunci !== b.kunci))}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={nonaktif || baris.length >= PAKET_MAKS_KOMPONEN}
          onClick={() => onUbah([...baris, barisKomponenBaru()])}
        >
          <Plus className="mr-1 h-4 w-4" aria-hidden />
          {tf("paket.tambah")}
        </Button>
        <p className={cn("text-sm tabular-nums", (kurangPotong || lebihPotong) && "text-amber-700 dark:text-amber-400")} aria-live="polite">
          {tf("paket.total", { n: total })}
          {kurangPotong ? ` ${tf("paket.minimal")}` : lebihPotong ? ` ${tf("paket.maksimal", { n: PAKET_MAKS_POTONG })}` : ""}
        </p>
      </div>
      {baris.length >= PAKET_MAKS_KOMPONEN ? <p className="text-xs text-muted-foreground">{tf("paket.maksBaris", { n: PAKET_MAKS_KOMPONEN })}</p> : null}
    </div>
  );
}
