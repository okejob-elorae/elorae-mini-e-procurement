"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeft, Eraser, Loader2, PackagePlus, Plus, Save, Search, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cariBarangTargetAction, simpanTargetStokAction, type BarangTarget } from "@/app/actions/store-stock-targets";
import { kunciStok, periksaTarget, type KodeTarget } from "@/lib/konsinyasi/isi-ulang";
import { dinamis } from "@/lib/i18n/dinamis";
import { cn } from "@/lib/utils";

export type BarisTarget = {
  variantSku: string;
  label: string | null;
  /** null = barang ini belum pernah ada di toko. */
  qty: number | null;
  soldLast30: number;
  perkiraan: boolean;
  minQty: number | null;
  maxQty: number | null;
};
export type BlokTarget = { itemId: string; sku: string; nama: string; baris: BarisTarget[] };

type Isian = { min: string; max: string };

const keIsian = (b: BarisTarget): Isian => ({ min: b.minQty === null ? "" : String(b.minQty), max: b.maxQty === null ? "" : String(b.maxQty) });
const keAngka = (s: string): number | null => (s.trim() === "" ? null : Number(s));
/** Dua isian sama nilainya ("03" dan "3" sama; isian tak terbaca tidak pernah sama). */
const samaNilai = (a: Isian, b: Isian) => keAngka(a.min) === keAngka(b.min) && keAngka(a.max) === keAngka(b.max);
/** Titik ribuan tanpa `Intl` — keluaran server dan browser harus sama persis. */
const ribuan = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

export function TargetStokClient({
  store,
  source,
  blok: blokAwal,
}: {
  store: { id: string; name: string; code: string; termsType: "PUTUS" | "KONSI" };
  source: "BUKU_TOKO" | "TITIPAN";
  blok: BlokTarget[];
}) {
  const t = useTranslations("storeStockTargets");
  const td = dinamis(t);
  const router = useRouter();
  const [blok, setBlok] = useState(blokAwal);
  const awalDariProps = useMemo(() => {
    const m = new Map<string, Isian>();
    for (const b of blokAwal) for (const r of b.baris) m.set(kunciStok(b.itemId, r.variantSku), keIsian(r));
    return m;
  }, [blokAwal]);
  const [awal, setAwal] = useState(awalDariProps);
  const [isian, setIsian] = useState(awalDariProps);
  const [galatServer, setGalatServer] = useState<Map<string, KodeTarget>>(new Map());
  const [saring, setSaring] = useState("");
  const [massal, setMassal] = useState<Isian>({ min: "", max: "" });
  const [cari, setCari] = useState("");
  const [hasilCari, setHasilCari] = useState<BarangTarget[]>([]);
  const [mencari, startCari] = useTransition();
  const [menyimpan, startSimpan] = useTransition();

  const nilai = (k: string): Isian => isian.get(k) ?? { min: "", max: "" };
  const kodeBaris = (k: string): KodeTarget | null => {
    const v = nilai(k);
    return periksaTarget({ minQty: keAngka(v.min), maxQty: keAngka(v.max) }) ?? galatServer.get(k) ?? null;
  };

  const tampil = useMemo(() => {
    const q = saring.trim().toLowerCase();
    if (!q) return blok;
    return blok.filter((b) => b.nama.toLowerCase().includes(q) || b.sku.toLowerCase().includes(q));
  }, [blok, saring]);

  const berubah = useMemo(() => {
    const out: { itemId: string; variantSku: string; minQty: number | null; maxQty: number | null; k: string }[] = [];
    for (const b of blok)
      for (const r of b.baris) {
        const k = kunciStok(b.itemId, r.variantSku);
        const v = isian.get(k) ?? { min: "", max: "" };
        const a = awal.get(k) ?? { min: "", max: "" };
        if (!samaNilai(v, a)) {
          out.push({ itemId: b.itemId, variantSku: r.variantSku, minQty: keAngka(v.min), maxQty: keAngka(v.max), k });
        }
      }
    return out;
  }, [blok, isian, awal]);
  const adaGalat = berubah.some((b) => periksaTarget(b) !== null);

  // Perubahan yang belum disimpan tidak boleh hilang diam-diam saat tab ditutup.
  useEffect(() => {
    if (berubah.length === 0) return;
    const tahan = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", tahan);
    return () => window.removeEventListener("beforeunload", tahan);
  }, [berubah.length]);

  // Pencarian barang di server, ditunda sebentar supaya tidak satu kueri per ketukan.
  useEffect(() => {
    const q = cari.trim();
    if (q.length < 2) return;
    // Jawaban untuk ketikan yang sudah diganti diabaikan — urutan jawaban
    // server tidak dijamin sama dengan urutan ketikan.
    let usang = false;
    const jeda = setTimeout(() => {
      startCari(async () => {
        const r = await cariBarangTargetAction(q);
        if (usang) return;
        if (r.ok) setHasilCari(r.barang);
        else toast.error(td(`err.${r.code}`));
      });
    }, 300);
    return () => {
      usang = true;
      clearTimeout(jeda);
    };
  }, [cari, td]);

  function ubah(k: string, bagian: keyof Isian, v: string) {
    setIsian((m) => new Map(m).set(k, { ...(m.get(k) ?? { min: "", max: "" }), [bagian]: v }));
    setGalatServer((m) => {
      if (!m.has(k)) return m;
      const n = new Map(m);
      n.delete(k);
      return n;
    });
  }

  function tambahBarang(b: BarangTarget) {
    if (blok.some((x) => x.itemId === b.itemId)) return;
    setBlok((xs) =>
      [
        ...xs,
        {
          itemId: b.itemId,
          sku: b.sku,
          nama: b.nama,
          baris: b.varian.map((v) => ({ variantSku: v.variantSku, label: v.label, qty: null, soldLast30: 0, perkiraan: false, minQty: null, maxQty: null })),
        },
      ].sort((x, y) => x.nama.localeCompare(y.nama)),
    );
    toast.success(t("addedToast", { nama: b.nama }));
  }

  function terapkanMassal() {
    const kode = periksaTarget({ minQty: keAngka(massal.min), maxQty: keAngka(massal.max) });
    if (kode || (massal.min.trim() === "" && massal.max.trim() === "")) {
      toast.error(td(`row.${kode ?? "SEBAGIAN"}`));
      return;
    }
    setIsian((m) => {
      const n = new Map(m);
      for (const b of tampil) for (const r of b.baris) n.set(kunciStok(b.itemId, r.variantSku), { ...massal });
      return n;
    });
    toast.success(t("bulkApplied", { count: tampil.reduce((s, b) => s + b.baris.length, 0) }));
  }

  function simpan() {
    if (berubah.length === 0 || adaGalat) return;
    const dikirim = berubah;
    startSimpan(async () => {
      const r = await simpanTargetStokAction({
        storeId: store.id,
        baris: dikirim.map(({ itemId, variantSku, minQty, maxQty }) => ({ itemId, variantSku, minQty, maxQty })),
      });
      if (r.ok) {
        // Yang tersimpan hanya yang DIKIRIM — ketikan selama menyimpan tetap
        // terhitung belum disimpan.
        setAwal((m) => {
          const n = new Map(m);
          for (const b of dikirim) n.set(b.k, { min: b.minQty === null ? "" : String(b.minQty), max: b.maxQty === null ? "" : String(b.maxQty) });
          return n;
        });
        setGalatServer(new Map());
        toast.success(r.diubah > 0 ? t("saved", { count: r.diubah }) : t("noChanges"));
        router.refresh();
      } else if (r.code === "BARIS_TIDAK_VALID") {
        setGalatServer(new Map(r.baris.map((b) => [kunciStok(b.itemId, b.variantSku), b.kode])));
        toast.error(t("err.BARIS_TIDAK_VALID"));
      } else {
        toast.error(td(`err.${r.code}`));
      }
    });
  }

  const jumlahBaris = blok.reduce((s, b) => s + b.baris.length, 0);
  // Hasil lama tidak ditampilkan begitu kotak cari dikosongkan.
  const hasilTampil = cari.trim().length >= 2 ? hasilCari : [];

  return (
    <div className="space-y-6">
      <div className="-ml-2">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/backoffice/stores/${store.id}`}>
            <ArrowLeft className="h-4 w-4" />
            {store.name}
          </Link>
        </Button>
      </div>

      <PageHeader
        title={t("title")}
        meta={`${store.code} — ${store.name} · ${source === "BUKU_TOKO" ? t("sourceBuku") : t("sourceTitipan")}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href="/backoffice/konsinyasi/isi-ulang">{t("linkOverview")}</Link>
            </Button>
            <Button onClick={simpan} disabled={menyimpan || berubah.length === 0 || adaGalat}>
              {menyimpan ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {menyimpan ? t("saving") : t("save", { count: berubah.length })}
            </Button>
          </div>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <PackagePlus className="h-4 w-4" />
            {t("addTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label={t("searchPlaceholder")}
              placeholder={t("searchPlaceholder")}
              value={cari}
              onChange={(e) => setCari(e.target.value)}
              className="pl-9"
            />
          </div>
          {mencari ? <p className="text-sm text-muted-foreground">{t("searching")}</p> : null}
          {!mencari && cari.trim().length >= 2 && hasilTampil.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("searchEmpty")}</p>
          ) : null}
          {hasilTampil.length > 0 ? (
            <ul className="divide-y rounded-lg border">
              {hasilTampil.map((b) => {
                const sudah = blok.some((x) => x.itemId === b.itemId);
                return (
                  <li key={b.itemId} className="flex items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{b.nama}</p>
                      <p className="text-xs text-muted-foreground">
                        {b.sku} · {t("variantCount", { count: b.varian.length })}
                      </p>
                    </div>
                    <Button size="sm" variant="outline" disabled={sudah} onClick={() => tambahBarang(b)}>
                      <Plus className="h-4 w-4" />
                      {sudah ? t("alreadyListed") : t("add")}
                    </Button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="space-y-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Target className="h-4 w-4" />
            {t("cardTitle")}
            <span className="text-sm font-normal text-muted-foreground">({t("rowCount", { count: jumlahBaris })})</span>
          </CardTitle>
          <p className="text-sm text-muted-foreground">{t("hint")}</p>
          {blok.length > 0 ? (
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
              <div className="relative max-w-sm flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  aria-label={t("filterPlaceholder")}
                  placeholder={t("filterPlaceholder")}
                  value={saring}
                  onChange={(e) => setSaring(e.target.value)}
                  className="pl-9"
                />
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1">
                  <Label htmlFor="massal-min" className="text-xs">{t("bulkMin")}</Label>
                  <Input
                    id="massal-min"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    className="w-20"
                    value={massal.min}
                    onChange={(e) => setMassal((m) => ({ ...m, min: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="massal-max" className="text-xs">{t("bulkMax")}</Label>
                  <Input
                    id="massal-max"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    className="w-20"
                    value={massal.max}
                    onChange={(e) => setMassal((m) => ({ ...m, max: e.target.value }))}
                  />
                </div>
                <Button variant="outline" onClick={terapkanMassal}>
                  {saring.trim() ? t("bulkApplyFiltered") : t("bulkApply")}
                </Button>
              </div>
            </div>
          ) : null}
        </CardHeader>
        <CardContent>
          {blok.length === 0 ? (
            <EmptyState icon={Target} title={t("emptyTitle")} description={t("emptyBody")} />
          ) : tampil.length === 0 ? (
            <EmptyState icon={Search} title={t("filterEmpty")} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("col.item")}</TableHead>
                    <TableHead>{t("col.variant")}</TableHead>
                    <TableHead className="text-right">{t("col.stock")}</TableHead>
                    <TableHead className="text-right">{t("col.sold30")}</TableHead>
                    <TableHead>{t("col.min")}</TableHead>
                    <TableHead>{t("col.max")}</TableHead>
                    <TableHead className="w-10">
                      <span className="sr-only">{t("col.clear")}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tampil.flatMap((b) =>
                    b.baris.map((r, i) => {
                      const k = kunciStok(b.itemId, r.variantSku);
                      const v = nilai(k);
                      const kode = kodeBaris(k);
                      const a = awal.get(k) ?? { min: "", max: "" };
                      const diubah = !samaNilai(v, a);
                      const namaBaris = r.label ? `${b.nama} ${r.label}` : b.nama;
                      return (
                        <TableRow key={k} className={cn(i === 0 && "border-t-2", diubah && "bg-primary/5")}>
                          <TableCell className="whitespace-normal">
                            {i === 0 ? (
                              <div>
                                <p className="font-medium">{b.nama}</p>
                                <p className="text-xs text-muted-foreground">{b.sku}</p>
                              </div>
                            ) : null}
                          </TableCell>
                          <TableCell className="whitespace-normal">
                            {r.label ?? <span className="text-muted-foreground">{t("noVariant")}</span>}
                            {kode ? <p className="text-xs text-destructive">{td(`row.${kode}`)}</p> : null}
                          </TableCell>
                          <TableCell className={cn("text-right tabular-nums", r.qty !== null && r.qty < 0 && "text-red-600 dark:text-red-400")}>
                            {r.qty === null ? "—" : `${r.perkiraan ? "≈" : ""}${ribuan(r.qty)}`}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{ribuan(r.soldLast30)}</TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              inputMode="numeric"
                              min={0}
                              aria-label={t("minFor", { nama: namaBaris })}
                              aria-invalid={!!kode}
                              className={cn("w-20", kode && "border-destructive")}
                              value={v.min}
                              onChange={(e) => ubah(k, "min", e.target.value)}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              inputMode="numeric"
                              min={0}
                              aria-label={t("maxFor", { nama: namaBaris })}
                              aria-invalid={!!kode}
                              className={cn("w-20", kode && "border-destructive")}
                              value={v.max}
                              onChange={(e) => ubah(k, "max", e.target.value)}
                            />
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={t("clearFor", { nama: namaBaris })}
                              disabled={v.min === "" && v.max === ""}
                              onClick={() => {
                                ubah(k, "min", "");
                                ubah(k, "max", "");
                              }}
                            >
                              <Eraser className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    }),
                  )}
                </TableBody>
              </Table>
            </div>
          )}
          {berubah.length > 0 ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              <Badge variant="outline">{t("unsaved", { count: berubah.length })}</Badge>
              <Button onClick={simpan} disabled={menyimpan || adaGalat}>
                {menyimpan ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {menyimpan ? t("saving") : t("save", { count: berubah.length })}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
