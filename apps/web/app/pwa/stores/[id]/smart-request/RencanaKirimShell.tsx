"use client";

import { useMemo, useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, ChevronDown, ChevronUp, Loader2, MapPinOff, Minus, PackageX, Plus, Send, Trash2 } from "lucide-react";
import type { PackRatioRow } from "@elorae/db/pack-ratio";
import { TautanKembali } from "@/app/pwa/TautanKembali";
import { KeteranganKirim } from "@/app/pwa/KeteranganKirim";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { dinamis } from "@/lib/i18n/dinamis";
import { newLocalId } from "@/lib/pwa/id-lokal";
import { formatIDR } from "@/lib/sales-orders/format";
import {
  bacaKriteriaTersimpan,
  kunciPenyimpanan,
  type KriteriaBangun,
  type KriteriaTersimpan,
} from "@/lib/field-sales/smart-request/kriteria";
import type { AlasanRencana, KurangUkuran, SebabDilewati } from "@/lib/field-sales/smart-request/rencana";
import type { DilewatiDraf } from "@/lib/field-sales/smart-request/rencana-draf";
import type { DasarLaku } from "@/lib/field-sales/smart-request/rencana-queries";
import { cn } from "@/lib/utils";
import { teksAlasanKredit } from "../catalog/KreditBanner";
import { bangunRencanaKirimAction, kirimRencanaKirimAction } from "./actions";
import { FormKriteria } from "./FormKriteria";

/**
 * Rencana kirim di HP: formulir kriteria → draf yang ditinjau → kirim.
 *
 * Draf TIDAK PERNAH terkirim sendiri. Jumlahnya boleh diubah (tidak pernah
 * melebihi stok gudang yang dibaca saat menyusun) dan barisnya boleh dihapus;
 * yang dikirim hanya barang, varian, dan jumlah — HP tidak pernah mengirim
 * harga. Toko konsinyasi tidak punya harga, total, maupun anggaran di layar ini,
 * dan datanya dari server memang tidak membawanya.
 *
 * Kriteria terakhir diingat per toko di HP (localStorage) — kenyamanan saja.
 */

type Kategori = { id: string; name: string };

type BarisHp = {
  variantSku: string;
  label: string | null;
  namaProduk: string;
  qty: number;
  tersedia: number;
  /** Hanya toko putus. */
  hargaSatuan?: number;
};
type ArtikelHp = {
  itemId: string;
  sku: string;
  nama: string;
  kategori: string | null;
  alasan: AlasanRencana[];
  kurang: KurangUkuran[];
  baris: BarisHp[];
};
type Draf = { artikel: ArtikelHp[]; dilewati: DilewatiDraf[]; lebih: number; maks: number; kunci: string };

/** Isian tersimpan di HP; `undefined` di server dan selama hidrasi. */
const tanpaLangganan = () => () => {};
function bacaSimpanan(storeId: string): string | null {
  try {
    return window.localStorage.getItem(kunciPenyimpanan(storeId));
  } catch {
    return null;
  }
}

export function RencanaKirimShell({
  storeId,
  storeName,
  konsi,
  visitId,
  categories,
  ratio,
  hariBaruBawaan,
  dasarLaku,
}: {
  storeId: string;
  storeName: string;
  konsi: boolean;
  /** Kunjungan berjalan di toko ini; null = belum check-in (menyusun boleh, mengirim tidak). */
  visitId: string | null;
  categories: Kategori[];
  ratio: PackRatioRow[];
  hariBaruBawaan: number;
  dasarLaku: DasarLaku;
}) {
  const t = useTranslations("pwa.rencanaKirim");
  const td = dinamis(t);
  const tKredit = useTranslations("pwa.kredit");
  const locale = useLocale();
  const router = useRouter();
  const angka = new Intl.NumberFormat(locale === "en" ? "en-US" : "id-ID", { maximumFractionDigits: 0 });

  // Kriteria terakhir untuk toko ini. Dibaca lewat useSyncExternalStore supaya
  // HTML server (tanpa simpanan) dan HP sama saat hidrasi; formulir dipasang
  // ulang sekali begitu simpanannya terbaca.
  const simpanan = useSyncExternalStore(tanpaLangganan, () => bacaSimpanan(storeId), () => undefined);
  const kriteriaAwal = useMemo(
    () =>
      simpanan === undefined
        ? null
        : bacaKriteriaTersimpan(simpanan, { kategoriAda: new Set(categories.map((c) => c.id)), hariBaruBawaan, adaRasio: ratio.length > 0 }),
    [simpanan, categories, hariBaruBawaan, ratio.length],
  );

  // ─── Draf ──────────────────────────────────────────────────────────────────
  const [fase, setFase] = useState<"kriteria" | "draf">("kriteria");
  const [draf, setDraf] = useState<Draf | null>(null);
  const [dilewatiBuka, setDilewatiBuka] = useState(false);
  const [menyusun, mulaiSusun] = useTransition();
  const [mengirim, mulaiKirim] = useTransition();

  function susun(kriteria: KriteriaBangun, simpan: KriteriaTersimpan) {
    try {
      window.localStorage.setItem(kunciPenyimpanan(storeId), JSON.stringify(simpan));
    } catch {
      // Penyimpanan ditolak (mode pribadi, penuh) — hanya kenyamanan.
    }
    mulaiSusun(async () => {
      try {
        const res = await bangunRencanaKirimAction({ storeId, ...kriteria });
        if (!res.ok) {
          toast.error(td(`galat.${res.code}`));
          return;
        }
        const artikel: ArtikelHp[] = res.artikel;
        // Satu kunci per draf: kiriman ulang draf yang sama (jaringan putus sesudah
        // server mencatat) mengembalikan pesanan yang sudah ada, bukan pesanan kedua.
        setDraf({ artikel, dilewati: res.dilewati, lebih: res.lebih, maks: kriteria.maksArtikel, kunci: newLocalId() });
        setDilewatiBuka(false);
        setFase("draf");
        window.scrollTo({ top: 0 });
      } catch {
        toast.error(t("gagalSusun"));
      }
    });
  }

  function ubahQty(itemId: string, variantSku: string, qty: number) {
    setDraf((d) =>
      d && {
        ...d,
        artikel: d.artikel.map((a) =>
          a.itemId !== itemId
            ? a
            : {
                ...a,
                baris: a.baris.map((b) =>
                  b.variantSku === variantSku ? { ...b, qty: Math.max(1, Math.min(qty, Math.max(b.tersedia, 1))) } : b,
                ),
              },
        ),
      },
    );
  }
  function hapusBaris(itemId: string, variantSku: string) {
    setDraf((d) =>
      d && {
        ...d,
        artikel: d.artikel
          .map((a) => (a.itemId !== itemId ? a : { ...a, baris: a.baris.filter((b) => b.variantSku !== variantSku) }))
          .filter((a) => a.baris.length > 0),
      },
    );
  }
  function hapusArtikel(itemId: string) {
    setDraf((d) => d && { ...d, artikel: d.artikel.filter((a) => a.itemId !== itemId) });
  }

  const ringkas = useMemo(() => {
    const artikel = draf?.artikel ?? [];
    let pcs = 0;
    let nilai = 0;
    for (const a of artikel) for (const b of a.baris) {
      pcs += b.qty;
      nilai += b.qty * (b.hargaSatuan ?? 0);
    }
    return { artikel: artikel.length, pcs, nilai };
  }, [draf]);

  const kurangKirim: string | null = !draf || ringkas.pcs === 0 ? t("kirimKosong") : visitId === null ? t("kirimBelumCheckin") : null;

  function kirim() {
    if (!draf || kurangKirim !== null) return;
    const lines = draf.artikel.flatMap((a) =>
      a.baris.map((b) => ({ itemId: a.itemId, variantSku: b.variantSku, productName: b.namaProduk, qty: b.qty })),
    );
    mulaiKirim(async () => {
      try {
        const res = await kirimRencanaKirimAction({ storeId, visitId: visitId ?? undefined, idempotencyKey: draf.kunci, lines });
        if (res.ok) {
          if (res.kreditDitahan) toast.warning(tKredit("terkirimDitahan", { orderNo: res.orderNo }));
          else toast.success(t("terkirim", { orderNo: res.orderNo }));
          router.replace(`/pwa/stores/${storeId}`);
          return;
        }
        if (res.code === "KREDIT_DIBLOKIR") {
          toast.error(tKredit("toastDiblokir", { alasan: res.alasan.map((a) => teksAlasanKredit(a, tKredit)).join("; ") }));
        } else if (res.code === "NO_ACTIVE_VISIT") toast.error(t("errNoActiveVisit"));
        else if (res.code === "MIN_QTY") toast.error(t("errMinQty"));
        else if (res.code === "EMPTY") toast.error(t("kirimKosong"));
        else if (res.code === "UNAUTHORIZED" || res.code === "TOKO_TIDAK_AKTIF" || res.code === "BUKAN_TOKO_SAYA") {
          toast.error(td(`galat.${res.code}`));
        } else toast.error(t("errGeneric"));
      } catch {
        toast.error(t("errGeneric"));
      }
    });
  }

  // ─── Teks ──────────────────────────────────────────────────────────────────
  const teksAlasan = (a: AlasanRencana): string => {
    switch (a.jenis) {
      case "BELUM_DIKIRIM":
        return t("alasan.BELUM_DIKIRIM");
      case "LAKU_DI_SINI":
        return t("alasan.LAKU_DI_SINI", { laku: angka.format(a.laku), sisa: angka.format(a.sisa) });
      case "DIPESAN_DI_SINI":
        return t("alasan.DIPESAN_DI_SINI", { pcs: angka.format(a.pcs) });
      case "LAKU_DI_TOKO_LAIN":
        return t("alasan.LAKU_DI_TOKO_LAIN", { pcs: angka.format(a.pcs), toko: angka.format(a.toko) });
      case "BARANG_BARU":
        return a.umurHari === 0 ? t("alasan.BARANG_BARU_HARI_INI") : t("alasan.BARANG_BARU", { umur: angka.format(a.umurHari) });
    }
  };
  const teksSebab = (s: SebabDilewati): string => {
    switch (s.jenis) {
      case "SUDAH_CUKUP":
        return s.dalamProses > 0
          ? t("sebab.SUDAH_CUKUP_PROSES", { sisa: angka.format(s.sisa), proses: angka.format(s.dalamProses) })
          : t("sebab.SUDAH_CUKUP", { sisa: angka.format(s.sisa) });
      case "UKURAN_TIDAK_ADA":
        return t("sebab.UKURAN_TIDAK_ADA", { ukuran: s.ukuran });
      case "STOK_GUDANG_KURANG":
        return t("sebab.STOK_GUDANG_KURANG", { ukuran: s.ukuran, butuh: angka.format(s.butuh), ada: angka.format(s.ada) });
      default:
        return td(`sebab.${s.jenis}`);
    }
  };
  const teksKurang = (k: KurangUkuran[]) =>
    t("kurangStok", {
      rincian: k
        .map((x) => t("kurangUkuran", { ukuran: x.ukuran || t("tanpaUkuran"), butuh: angka.format(x.butuh), ada: angka.format(x.ada) }))
        .join("; "),
    });

  return (
    <div className="flex min-h-dvh flex-col gap-4 p-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
        <TautanKembali cadangan={`/pwa/stores/${storeId}`} />
      </Button>

      <header className="space-y-1">
        <h1 className="text-2xl font-bold leading-tight">{t("judul")}</h1>
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>{storeName}</span>
          <Badge variant="outline">{t(konsi ? "jenisToko.KONSI" : "jenisToko.PUTUS")}</Badge>
        </p>
      </header>

      {visitId === null ? (
        <section className="beranda-kartu space-y-2 border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40">
          <p className="flex items-center gap-2 font-medium">
            <MapPinOff className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden />
            {t("belumCheckinJudul")}
          </p>
          <p className="text-sm text-muted-foreground">{t("belumCheckinIsi")}</p>
          <Button asChild variant="outline" size="sm">
            <Link href={`/pwa/stores/${storeId}`}>{t("keHalamanToko")}</Link>
          </Button>
        </section>
      ) : null}

      <div className={cn("flex flex-1 flex-col gap-4", fase !== "kriteria" && "hidden")}>
        <FormKriteria
          key={simpanan === undefined ? "awal" : "pulih"}
          konsi={konsi}
          categories={categories}
          ratio={ratio}
          hariBaruBawaan={hariBaruBawaan}
          dasarLaku={dasarLaku}
          awal={kriteriaAwal}
          menyusun={menyusun}
          onSusun={susun}
        />
      </div>

      {fase === "draf" && draf ? (
        <>
          <Button type="button" variant="ghost" size="sm" className="-ml-2 self-start" onClick={() => setFase("kriteria")}>
            <ArrowLeft className="h-4 w-4" aria-hidden />
            {t("ubahKriteria")}
          </Button>

          <div className="space-y-1">
            <h2 className="text-lg font-semibold">{t("drafJudul")}</h2>
            <p className="text-sm text-muted-foreground">{t("drafBantu")}</p>
          </div>

          <section className="beranda-kartu space-y-1" aria-live="polite">
            <p className="text-base font-semibold tabular-nums">
              {t("ringkasArtikel", { n: angka.format(ringkas.artikel) })} · {t("ringkasPcs", { n: angka.format(ringkas.pcs) })}
            </p>
            {konsi ? null : (
              <>
                <p className="flex items-baseline justify-between gap-3 pt-1">
                  <span className="text-sm text-muted-foreground">{t("estimasi")}</span>
                  <span className="text-lg font-semibold tabular-nums">{formatIDR(ringkas.nilai)}</span>
                </p>
                <p className="text-xs text-muted-foreground">{t("estimasiBantu")}</p>
              </>
            )}
          </section>

          {draf.artikel.length === 0 ? (
            <section className="beranda-kartu flex flex-col items-center gap-2 py-8 text-center">
              <PackageX className="h-8 w-8 text-muted-foreground" aria-hidden />
              <p className="font-medium">{t("kosongJudul")}</p>
              <p className="text-sm text-muted-foreground">{t("kosongIsi")}</p>
            </section>
          ) : (
            <div className="flex flex-col gap-3">
              {draf.artikel.map((a) => {
                const pcsArtikel = a.baris.reduce((s, b) => s + b.qty, 0);
                const nilaiArtikel = a.baris.reduce((s, b) => s + b.qty * (b.hargaSatuan ?? 0), 0);
                return (
                  <Card key={a.itemId} className="gap-0 py-0">
                    <CardContent className="space-y-3 p-4">
                      <div className="space-y-1">
                        <p className="font-medium leading-snug">{a.nama}</p>
                        <p className="text-xs text-muted-foreground">
                          {a.sku}
                          {a.kategori ? ` · ${a.kategori}` : null} · {t("ringkasPcs", { n: angka.format(pcsArtikel) })}
                        </p>
                        <div className="flex flex-wrap gap-1 pt-1">
                          {a.alasan.map((al, i) => (
                            <Badge key={`${al.jenis}-${i}`} variant="secondary" className="whitespace-normal text-left">
                              {teksAlasan(al)}
                            </Badge>
                          ))}
                        </div>
                        {a.kurang.length > 0 ? (
                          <p className="flex items-start gap-1.5 pt-1 text-xs text-amber-700 dark:text-amber-400">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                            <span>{teksKurang(a.kurang)}</span>
                          </p>
                        ) : null}
                      </div>

                      <ul className="divide-y rounded-md border">
                        {a.baris.map((b) => {
                          const nama = b.label ? `${a.nama} ${b.label}` : a.nama;
                          return (
                            <li key={b.variantSku || "-"} className="space-y-2 p-3">
                              <div className="flex items-center gap-2">
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-medium">{b.label ?? t("tanpaUkuran")}</p>
                                  <p className="text-xs text-muted-foreground">{t("stokGudang", { n: angka.format(b.tersedia) })}</p>
                                </div>
                                <div className="flex shrink-0 items-center gap-1">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="icon-lg"
                                    disabled={b.qty <= 1}
                                    onClick={() => ubahQty(a.itemId, b.variantSku, b.qty - 1)}
                                    aria-label={t("kurangi", { nama })}
                                  >
                                    <Minus className="h-4 w-4" aria-hidden />
                                  </Button>
                                  <span className="w-8 text-center text-sm font-semibold tabular-nums">{b.qty}</span>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="icon-lg"
                                    disabled={b.qty >= b.tersedia}
                                    onClick={() => ubahQty(a.itemId, b.variantSku, b.qty + 1)}
                                    aria-label={t("tambah", { nama })}
                                  >
                                    <Plus className="h-4 w-4" aria-hidden />
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-lg"
                                    onClick={() => hapusBaris(a.itemId, b.variantSku)}
                                    aria-label={t("hapusBaris", { nama })}
                                  >
                                    <Trash2 className="h-4 w-4 text-destructive" aria-hidden />
                                  </Button>
                                </div>
                              </div>
                              {b.hargaSatuan !== undefined ? (
                                <p className="text-xs text-muted-foreground tabular-nums">
                                  {t("perPcs", { harga: formatIDR(b.hargaSatuan) })}
                                </p>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>

                      {konsi ? null : (
                        <p className="flex items-baseline justify-between gap-3 text-sm">
                          <span className="text-muted-foreground">{t("subtotal")}</span>
                          <span className="font-semibold tabular-nums">{formatIDR(nilaiArtikel)}</span>
                        </p>
                      )}

                      <Button type="button" variant="ghost" size="sm" className="-ml-2 text-destructive" onClick={() => hapusArtikel(a.itemId)}>
                        <Trash2 className="h-4 w-4" aria-hidden />
                        {t("hapusArtikel")}
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {draf.lebih > 0 ? (
            <p className="text-sm text-muted-foreground">{t("lebih", { n: angka.format(draf.lebih), maks: angka.format(draf.maks) })}</p>
          ) : null}

          {draf.dilewati.length > 0 ? (
            <Collapsible open={dilewatiBuka} onOpenChange={setDilewatiBuka}>
              <CollapsibleTrigger asChild>
                <Button type="button" variant="outline" className="h-11 w-full justify-between">
                  <span>{t("dilewatiJudul", { n: angka.format(draf.dilewati.length) })}</span>
                  {dilewatiBuka ? <ChevronUp className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2">
                <ul className="space-y-2">
                  {draf.dilewati.map((d) => (
                    <li key={d.itemId} className="flex items-start gap-2 rounded-md border border-dashed p-3 text-sm">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{d.nama}</span>
                        <span className="block text-xs text-muted-foreground">
                          {d.sku} · {teksSebab(d.sebab)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </CollapsibleContent>
            </Collapsible>
          ) : null}

          <div className="sticky bottom-0 -mx-4 -mb-4 mt-auto space-y-2 border-t bg-background px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            <Button type="button" className="w-full" size="lg" disabled={kurangKirim !== null || mengirim} onClick={kirim}>
              {mengirim ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  {t("mengirim")}
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" aria-hidden />
                  {t("kirim")}
                </>
              )}
            </Button>
            <KeteranganKirim teks={kurangKirim} />
          </div>
        </>
      ) : null}
    </div>
  );
}
