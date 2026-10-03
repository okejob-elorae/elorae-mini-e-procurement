"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, Info, Loader2, Sparkles, Store, X } from "lucide-react";
import { simpanPromoKonterAction } from "@/app/actions/promo-konter";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { RentangTanggalInput } from "@/components/ui/rentang-tanggal-input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { StatusPill } from "@/components/ui/status-pill";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { formatRupiah } from "@/lib/format/rupiah";
import { dinamis } from "@/lib/i18n/dinamis";
import { JENIS_PROMO_KONTER, promoNota, type JenisPromoKonter } from "@/lib/spg/promo-konter";
import {
  contohPromo,
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
import { AturanTumpukPromo } from "./AturanTumpukPromo";
import { formatPersen, NADA_STATUS_PROMO } from "./tampilan";
import { TombolPromoKonter } from "./TombolPromoKonter";

type ModeBarang = "SEMUA" | "BARANG" | "KATEGORI";
const MODE_BARANG: readonly ModeBarang[] = ["SEMUA", "BARANG", "KATEGORI"];

/** Barang yang ditulis di daftar pencarian sekaligus — sisanya lewat pencarian. */
const BARANG_TAMPIL = 60;

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
    };
  }
  return {
    name: a.name,
    type: (JENIS_PROMO_KONTER as readonly string[]).includes(a.type) ? (a.type as JenisPromoKonter) : "PERSEN",
    value: teks(a.value),
    buyQty: teks(a.buyQty),
    freeQty: teks(a.freeQty),
    minSubtotal: teks(a.minSubtotal),
    mode: a.allItems ? "SEMUA" : a.itemIds.length > 0 ? "BARANG" : "KATEGORI",
    itemIds: a.itemIds,
    categoryIds: a.categoryIds,
    allStores: a.allStores,
    storeIds: a.storeIds,
    dari: a.dari,
    sampai: a.sampai,
    priority: String(a.priority),
    note: a.note,
    dibagi: a.storeSharePercent > 0,
    bagianToko: a.storeSharePercent > 0 ? teks(a.storeSharePercent) : "",
    aktif: true,
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

  const contoh = useMemo(
    () => contohPromo({ type: k.type, value: isian.value, buyQty: isian.buyQty, freeQty: isian.freeQty, minSubtotal: isian.minSubtotal }),
    [k.type, isian.value, isian.buyQty, isian.freeQty, isian.minSubtotal],
  );

  const namaBarang = useMemo(() => new Map(opsi.barang.map((b) => [b.id, b])), [opsi.barang]);
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
  const labelNilai = tfd(`nilai.${k.type}`);
  const persenType = k.type === "PERSEN" || k.type === "MIN_BELANJA_PERSEN";

  return (
    <div className="space-y-6">
      <PageHeader
        title={id ? awal?.name || t("judulUbah") : t("judulBaru")}
        description={id ? t("deskripsiUbah") : t("deskripsiBaru")}
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

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
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
                      ? tf("contoh.belum")
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
              </section>

              <Separator />

              {/* Sasaran barang */}
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

        <div className="space-y-6">
          <AturanTumpukPromo />
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{tf("diskonManualJudul")}</CardTitle>
              <CardDescription>{tf("diskonManualIsi")}</CardDescription>
            </CardHeader>
          </Card>
        </div>
      </div>
    </div>
  );
}
