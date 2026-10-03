"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, CalendarClock, CheckCircle2, ChevronLeft, ChevronRight, Gift, Loader2, MessageCircle, Minus, PencilLine, Plus, Sparkles, WifiOff } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cartCount, cartTotal, buildOrderLines, type CartLine } from "@/lib/field-sales/cart";
import { susunIsiUlang } from "@/lib/salesman/ulang";
import { enqueueOrder, newLocalId } from "@/lib/pwa/offline/queue";
import { flushPendingOrders } from "@/lib/pwa/offline/sync";
import { PERISTIWA_ANTREAN } from "@/lib/pwa/offline/hitung";
import { ikatanKunjungan } from "@/lib/pwa/offline/luring-kunjungan";
import { useKunjunganLokal } from "@/lib/pwa/offline/luring-kunjungan-hook";
import { denganBatasWaktu, galatJaringan } from "@/lib/field-sales/jaringan-lemah";
import { nilaiKredit, type AlasanKredit, type AturanKredit, type KeadaanTagihan } from "@/lib/salesman/kredit";
import { submitFieldSalesOrder, previewFieldSalesPromos, type PromoPreviewResult, type SubmitResult } from "./actions";
import { VariantSheet } from "./VariantSheet";
import { AppealPriceSheet } from "./AppealPriceSheet";
import { KreditBanner, teksAlasanKredit, type PenilaianKatalog } from "./KreditBanner";
import type { MinimumKatalog } from "@/lib/field-sales/minimum-toko";
import type { PenolakanJarakJauh, SaluranJarakJauh } from "@/lib/field-sales/jarak-jauh";
import type { AlasanIndenDitolak } from "@/lib/field-sales/inden";
import { kunciBaris, tambahCadanganLama } from "@/lib/field-sales/ganti-pesanan";
import { salinanPesananWaAction, type HasilSalinanWa } from "@/app/pwa/orders/actions";

import { TautanKembali } from "@/app/pwa/TautanKembali";
type CatalogItem = {
  itemId: string;
  sku: string;
  nameId: string;
  categoryId: string | null;
  categoryName: string | null;
  primaryImageUrl: string | null;
  available: number;
  price: number | null;
  priceLabel: string | null;
  neverSent: boolean;
  minOrderQty: number;
  /** Minimum barang ini adalah minimum "pesan ulang" toko (bukan minimum barang sendiri). */
  minPesanUlang?: boolean;
  variants: Array<{ variantSku: string; variantLabel: string; available: number }>;
};

type Payload = { items: CatalogItem[] };

/** Bahan penilaian kredit toko PUTUS, dibaca server saat halaman dibuka. */
export type KreditKatalog = {
  aturan: AturanKredit;
  batas: { creditLimit: number | null; maxOpenInvoices: number | null };
  /** null = tagihan toko gagal dibaca di server. */
  keadaan: KeadaanTagihan | null;
};
type LoadState = "loading" | "ready" | "error";

/** Rentang kirim yang sudah diformat server (WIB). */
type KirimKatalog = { jenis: "RENTANG" | "MULAI" | "SAMPAI"; teks: string } | null;

/**
 * Mode pre-order (`?inden=<id>`), disiapkan server:
 * - PESAN: jendela BUKA — hanya barangnya yang tampil, tanpa batas stok.
 * - DITOLAK: jendela tidak bisa dipesan (atau toko konsinyasi) — katalog menjelaskan, keranjang tertutup.
 */
export type IndenKatalog =
  | { mode: "PESAN"; id: string; name: string; tutup: string; kirim: KirimKatalog; items: CatalogItem[] }
  | { mode: "DITOLAK"; alasan: AlasanIndenDitolak; name: string | null };

/** Jendela pre-order yang sedang buka, untuk katalog stok siap toko PUTUS. */
export type IndenTerbukaKatalog = { id: string; name: string; tutup: string; kirim: KirimKatalog; itemIds: string[] };

/**
 * Mengubah pesanan sendiri (`?ganti=<id>`), disiapkan server:
 * - UBAH: pesanan masih menunggu — keranjang diisi barisnya, kirim = mengganti.
 *   `cadangan` = stok yang dipegang pesanan lama, dihitung tersedia lagi.
 * - DITOLAK: pesanan sudah diputuskan kantor (atau bukan milik Anda) — tidak diisi.
 */
export type GantiKatalog =
  | { mode: "UBAH"; id: string; orderNo: string; portal: boolean; note: string; cadangan: Record<string, number> }
  | { mode: "DITOLAK"; orderNo: string | null };

/** Baris awal keranjang: pesanan terakhir yang diulang, atau pesanan yang diubah (dengan ajuan harganya). */
type BarisAwal = { itemId: string; variantSku: string; qty: number; requestedUnitPrice?: number | null; appealReason?: string | null };

const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
const PAGE_SIZE = 10;
// Cart lines are keyed by item + variant so distinct variants of the same item are distinct
// entries; simple items (no variants) always use variantSku "".
const variantKey = (itemId: string, variantSku: string) => `${itemId}::${variantSku}`;

export function CatalogShell({
  storeId,
  storeName,
  termsType,
  hasActiveVisit,
  visitId,
  checkinAtMs = null,
  isiAwal = null,
  sumber = null,
  kredit = null,
  minimum = null,
  jarakJauh = null,
  jarakJauhDitolak = null,
  cariAwal = null,
  inden = null,
  indenTerbuka = [],
  ganti = null,
}: {
  storeId: string;
  storeName: string;
  termsType: "PUTUS" | "KONSI";
  hasActiveVisit: boolean;
  visitId: string | null;
  /** Jam check-in kunjungan server — check-in tanpa sinyal yang lebih baru menggantikannya. */
  checkinAtMs?: number | null;
  /** Baris pesanan terakhir yang diulang (kartu "Saran pesanan") atau pesanan yang diubah; null = keranjang kosong. */
  isiAwal?: BarisAwal[] | null;
  /** `permintaan:<id>` / `rekomendasi:<id>` — keranjang diisi dari dokumen itu, pesanannya ditautkan balik. */
  sumber?: string | null;
  /** Hanya untuk toko PUTUS; null = tidak dinilai (konsinyasi). */
  kredit?: KreditKatalog | null;
  /**
   * Minimum yang berlaku di toko ini (PUTUS). Payload katalog hanya tahu minimum
   * pesanan pertama; ini menimpanya dengan aturan yang sama dengan server.
   */
  minimum?: MinimumKatalog | null;
  /** Pesanan jarak jauh (WA/telepon): keranjang terbuka tanpa check-in. */
  jarakJauh?: { saluran: SaluranJarakJauh } | null;
  /** Pesanan jarak jauh diminta tapi ditolak aturan pemilik. */
  jarakJauhDitolak?: PenolakanJarakJauh | null;
  /** Kata cari awal dari alamat (`?q=`). */
  cariAwal?: string | null;
  /** Mode pre-order; null = katalog stok siap. */
  inden?: IndenKatalog | null;
  /** Jendela pre-order yang sedang buka (hanya di katalog stok siap toko PUTUS). */
  indenTerbuka?: IndenTerbukaKatalog[];
  /** Mengubah pesanan sendiri; null = pesanan baru. */
  ganti?: GantiKatalog | null;
}) {
  const t = useTranslations("pwa.catalog");
  const tKredit = useTranslations("pwa.kredit");
  const tJarak = useTranslations("pwa.jarakJauh");
  const tMin = useTranslations("minimumPesanan");
  const tBonus = useTranslations("promoBonus");
  const tInden = useTranslations("pwa.inden");
  const tUbah = useTranslations("pwa.ubahPesanan");
  const isKonsi = termsType === "KONSI";
  const gantiUbah = ganti?.mode === "UBAH" ? ganti : null;
  const indenPesan = inden?.mode === "PESAN" ? inden : null;
  const indenTolak = inden?.mode === "DITOLAK" ? inden : null;
  // Kunjungan yang berlaku: dari server, atau check-in yang dicatat tanpa sinyal
  // dan masih di HP (`visitClientId`). Pesanan di kunjungan HP ikut antrean dan
  // terkirim SESUDAH check-in-nya; gagal di HP bila check-in itu ditolak server.
  const { kunjungan: kunjunganLokal } = useKunjunganLokal(storeId, { segarkanSaatTerkirim: true });
  const ikatan = jarakJauh ? null : ikatanKunjungan(hasActiveVisit && visitId ? { id: visitId, checkinAtMs } : null, kunjunganLokal);
  // Keranjang terbuka saat check-in di toko ini ATAU saat mencatat pesanan jarak jauh.
  // Pre-order yang ditolak (jendela tutup, toko konsinyasi) tidak membuka keranjang sama sekali.
  const bisaPesan = (ikatan !== null || jarakJauh !== null) && indenTolak === null;
  /** Alamat katalog ini — stok siap atau satu jendela pre-order — dengan saluran jarak jauh yang sama. */
  const alamatKatalog = (indenId?: string) => {
    const p = new URLSearchParams();
    if (jarakJauh) p.set("jarakJauh", jarakJauh.saluran);
    if (indenId) p.set("inden", indenId);
    const qs = p.toString();
    return `/pwa/stores/${storeId}/catalog${qs ? `?${qs}` : ""}`;
  };
  const teksKirim = (k: KirimKatalog) => (k ? tInden(`kirim.${k.jenis}`, { teks: k.teks }) : null);
  /** "kirim 10–20 Nov" dipakai di tengah kalimat; di awal kalimat huruf pertamanya dibesarkan. */
  const kapital = (teks: string) => teks.charAt(0).toUpperCase() + teks.slice(1);
  // Barang stok siap yang juga ada di jendela yang sedang buka → jendela pertama (tutup paling cepat).
  const jendelaPerBarang = useMemo(() => {
    const m = new Map<string, IndenTerbukaKatalog>();
    for (const j of indenTerbuka) for (const id of j.itemIds) if (!m.has(id)) m.set(id, j);
    return m;
  }, [indenTerbuka]);
  // Pre-order: barangnya datang bersama halaman — langsung siap, tanpa kilasan "Memuat katalog…".
  const [items, setItems] = useState<CatalogItem[]>(() => (inden?.mode === "PESAN" ? terapkanMinimum(inden.items) : []));
  const [state, setState] = useState<LoadState>(inden ? "ready" : "loading");
  const [q, setQ] = useState(cariAwal ?? "");
  const [cat, setCat] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [cart, setCart] = useState<Map<string, CartLine>>(new Map());
  const [sheetItem, setSheetItem] = useState<CatalogItem | null>(null);
  const [appealKey, setAppealKey] = useState<string | null>(null);
  const [view, setView] = useState<"catalog" | "review">("catalog");
  // Mengubah pesanan: catatan lama ikut (tanpa baris yang ditulis sistem).
  const [note, setNote] = useState(gantiUbah?.note ?? "");
  /** Pesanan yang baru terkirim online — layar sukses dengan salinan WA untuk toko. */
  const [terkirim, setTerkirim] = useState<{ orderId: string | null; orderNo: string } | null>(null);
  const router = useRouter();
  const [online, setOnline] = useState(true);
  const [preview, setPreview] = useState<PromoPreviewResult | null>(null);
  /*
   * Penolakan BLOKIR dari server, terikat pada keranjang yang ditolak. Setiap
   * perubahan keranjang membuat Map baru, jadi penolakan lama gugur sendiri
   * tanpa efek — keranjang yang sudah dikurangi dinilai ulang dari awal.
   */
  const [blokirServer, setBlokirServer] = useState<{ alasan: AlasanKredit[]; keranjang: Map<string, CartLine> } | null>(null);
  const [pending, startTransition] = useTransition();
  const cartBarRef = useRef<HTMLDivElement | null>(null);
  const [cartBarHeight, setCartBarHeight] = useState(0);
  const reviewBarRef = useRef<HTMLDivElement | null>(null);
  const [reviewBarHeight, setReviewBarHeight] = useState(0);

  function bentukBaris(
    it: CatalogItem,
    variantSku: string,
    variantLabel: string | null,
    qty: number,
    available: number,
    existing?: CartLine,
  ): CartLine {
    return {
      itemId: it.itemId,
      variantSku,
      variantLabel,
      sku: it.sku,
      nameId: it.nameId,
      unitPrice: isKonsi ? 0 : (it.price ?? 0),
      available,
      qty,
      requestedUnitPrice: existing?.requestedUnitPrice ?? null,
      appealReason: existing?.appealReason ?? null,
    };
  }

  function setQty(it: CatalogItem, variantSku: string, variantLabel: string | null, qty: number) {
    const key = variantKey(it.itemId, variantSku);
    // Simple items (no variants) cap at the item aggregate; variant lines cap at that
    // variant's own available (looked up from it.variants, falling back to the aggregate).
    const available = variantSku ? (it.variants.find((v) => v.variantSku === variantSku)?.available ?? 0) : it.available;
    setCart((prev) => {
      const next = new Map(prev);
      if (qty <= 0) next.delete(key);
      else {
        // Preserve an existing price appeal across qty edits — this rebuilds the whole line,
        // so a bare object literal here would silently drop requestedUnitPrice/appealReason.
        next.set(key, bentukBaris(it, variantSku, variantLabel, qty, available, prev.get(key)));
      }
      return next;
    });
  }

  // Putus only — sets/clears a per-line price appeal (requested price + reason). The store
  // price itself stays read-only; this never changes unitPrice, only the appeal fields the
  // office reviews at approve.
  function setAppeal(key: string, appeal: { requestedUnitPrice: number; appealReason: string } | null) {
    setCart((prev) => {
      const existing = prev.get(key);
      if (!existing) return prev;
      const next = new Map(prev);
      next.set(key, {
        ...existing,
        requestedUnitPrice: appeal?.requestedUnitPrice ?? null,
        appealReason: appeal?.appealReason ?? null,
      });
      return next;
    });
  }

  const cartLines = useMemo(() => Array.from(cart.values()), [cart]);

  // Minimum pesan per BARANG: varian satu barang dijumlah bersama, persis aturan server.
  const qtyPerBarang = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of cartLines) m.set(l.itemId, (m.get(l.itemId) ?? 0) + l.qty);
    return m;
  }, [cartLines]);
  const minPerBarang = useMemo(() => new Map(items.map((i) => [i.itemId, i.minOrderQty])), [items]);
  const appealLine = appealKey ? cart.get(appealKey) ?? null : null;
  const showCartBar = cartLines.length > 0 && view === "catalog";

  useLayoutEffect(() => {
    if (!showCartBar) {
      setCartBarHeight(0);
      return;
    }
    const el = cartBarRef.current;
    if (!el) return;
    const measure = () => setCartBarHeight(el.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [showCartBar]);

  useLayoutEffect(() => {
    if (view !== "review" || cartLines.length === 0) {
      setReviewBarHeight(0);
      return;
    }
    const el = reviewBarRef.current;
    if (!el) return;
    const measure = () => setReviewBarHeight(el.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [view, online, pending, cartLines.length]);

  useEffect(() => {
    const set = () => setOnline(navigator.onLine);
    set();
    window.addEventListener("online", set);
    window.addEventListener("offline", set);
    return () => {
      window.removeEventListener("online", set);
      window.removeEventListener("offline", set);
    };
  }, []);

  // Read-only promo quote for the putus review — never blocks Kirim; a stale/failed/in-flight
  // call just falls back to the undiscounted cartTotal (guarded via the `alive` flag below).
  useEffect(() => {
    if (view !== "review" || isKonsi || cartLines.length === 0) {
      setPreview(null);
      return;
    }
    let alive = true;
    // Reset immediately so a cart change never renders a discount computed for the old lines.
    setPreview(null);
    const requestLines = buildOrderLines(cartLines).map((l) => ({
      itemId: l.itemId,
      variantSku: l.variantSku,
      productName: l.productName,
      qty: l.qty,
      unitPrice: l.unitPrice,
    }));
    previewFieldSalesPromos({ storeId, lines: requestLines, inden: indenPesan !== null })
      .then((res) => {
        if (alive) setPreview(res);
      })
      .catch(() => {
        // Silent fallback to undiscounted totals — promo quote is informational only.
      });
    return () => {
      alive = false;
    };
    // indenPesan tetap selama katalog ini hidup (halaman memasang ulang katalog per jendela).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, cartLines, isKonsi, storeId]);

  // Total yang dinilai = total bersih sesudah promo, sama dengan yang dinilai server.
  // Selagi kutipan promo belum datang dipakai total kotor (lebih besar, jadi lebih ketat).
  const totalBersih = preview ? preview.netTotal : cartTotal(cartLines);
  const blokirAktif = blokirServer !== null && blokirServer.keranjang === cart;
  const penilaianKredit = useMemo((): PenilaianKatalog | null => {
    if (!kredit || isKonsi || cartLines.length === 0) return null;
    if (blokirAktif) return { tingkat: "BLOKIR", alasan: blokirServer!.alasan, takTerbaca: false };
    // Tagihan tak terbaca: server menahan pesanan di mode TAHAN/BLOKIR, membiarkannya di PERINGATAN.
    if (!kredit.keadaan) return kredit.aturan.mode === "PERINGATAN" ? null : { tingkat: "TAHAN", alasan: [], takTerbaca: true };
    const hasil = nilaiKredit(kredit.keadaan, kredit.aturan, kredit.batas, totalBersih);
    return hasil.tingkat === "AMAN" ? null : { tingkat: hasil.tingkat, alasan: hasil.alasan, takTerbaca: false };
  }, [kredit, isKonsi, cartLines.length, blokirAktif, blokirServer, totalBersih]);
  const kirimDiblokir = penilaianKredit?.tingkat === "BLOKIR";

  /**
   * Simpan ke antrean HP — dipakai saat HP offline DAN saat kiriman online tidak
   * sampai (sinyal lemah). `localId` yang sama dipakai sebagai kunci idempotensi,
   * jadi kalau server ternyata sempat mencatatnya, kiriman ulang dari antrean
   * hanya mengembalikan pesanan yang sudah ada.
   */
  async function simpanKeAntrean(localId: string): Promise<boolean> {
    if (!isKonsi) {
      // Aggregate qty per item (mirrors the server's per-item min-qty rule) so an
      // item's variants collectively satisfy the minimum, not each variant alone.
      const violations = Array.from(qtyPerBarang, ([itemId, qty]) => {
        const it = items.find((i) => i.itemId === itemId);
        const min = it?.minOrderQty ?? 0;
        return qty < min ? `${it?.nameId ?? itemId} (min ${min})` : null;
      }).filter((v): v is string => v !== null);
      if (violations.length > 0) {
        toast.error(`Jumlah di bawah minimum: ${violations.join(", ")}.`);
        return false;
      }
    }
    await enqueueOrder({
      localId,
      storeId,
      storeName,
      visitId: jarakJauh ? null : (ikatan?.visitId ?? null),
      visitClientId: jarakJauh ? null : (ikatan?.visitClientId ?? null),
      note: note.trim() || undefined,
      lines: buildOrderLines(cartLines),
      remoteChannel: jarakJauh?.saluran ?? null,
      // Pre-order ikut antrean dengan jendelanya; server menilai ulang jendela itu saat sinkron.
      preorderWindowId: indenPesan?.id ?? null,
      // Ubah pesanan: pesanan lama baru dibatalkan saat antrean ini sampai di server.
      gantiOrderId: gantiUbah?.id ?? null,
      gantiOrderNo: gantiUbah?.orderNo ?? null,
    });
    window.dispatchEvent(new Event(PERISTIWA_ANTREAN));
    // Pesanan di antrean belum punya nomor — salinan WA ke toko baru bisa dari "Pesanan saya" sesudah terkirim.
    toast.success(gantiUbah ? tUbah("antreanGanti", { orderNo: gantiUbah.orderNo }) : "Pesanan disimpan — dikirim otomatis saat online", {
      description: tUbah("antreanWa"),
    });
    setCart(new Map());
    setNote("");
    // Offline: stay on the already-loaded catalog (a router.push to the dynamic
    // store page has no offline cache → Chrome dino). Salesman keeps browsing.
    setView("catalog");
    return true;
  }

  function onSubmit() {
    const localId = newLocalId();
    startTransition(async () => {
      try {
        if (!online) {
          await simpanKeAntrean(localId);
          return;
        }
        // Check-in yang masih di antrean HP belum dikenal server: pesanannya ikut
        // antrean (terkirim sesudah check-in itu), juga saat ada sinyal.
        if (ikatan?.visitClientId) {
          if (await simpanKeAntrean(localId)) {
            const { kirimSemuaAntrean } = await import("@/lib/pwa/offline/sync");
            void kirimSemuaAntrean().then(() => window.dispatchEvent(new Event(PERISTIWA_ANTREAN)), () => undefined);
          }
          return;
        }

        let res: SubmitResult;
        try {
          res = await denganBatasWaktu(
            submitFieldSalesOrder({
              storeId,
              visitId: jarakJauh ? undefined : (ikatan?.visitId ?? undefined),
              note: note.trim() || undefined,
              lines: buildOrderLines(cartLines),
              idempotencyKey: localId,
              remoteChannel: jarakJauh?.saluran ?? null,
              preorderWindowId: indenPesan?.id ?? null,
              gantiOrderId: gantiUbah?.id ?? null,
              sumber,
            }),
          );
        } catch (err) {
          // Hanya galat JARINGAN yang diantrekan. Galat server dilempar ulang ke
          // penangkap luar: mengirim ulang hanya akan gagal dengan cara yang sama.
          if (!galatJaringan(err, navigator.onLine)) throw err;
          if (await simpanKeAntrean(localId)) {
            // HP merasa online, jadi peristiwa "online" yang biasanya memicu
            // sinkron tidak akan datang. Coba kirim sekali lagi sebentar lagi.
            window.setTimeout(() => {
              void flushPendingOrders().then(() => window.dispatchEvent(new Event(PERISTIWA_ANTREAN)));
            }, 30_000);
          }
          return;
        }
        if (res.ok) {
          toast.success(
            res.kreditDitahan
              ? tKredit("terkirimDitahan", { orderNo: res.orderNo })
              : gantiUbah
                ? tUbah("terkirimGanti", { orderNo: res.orderNo, lama: gantiUbah.orderNo })
                : indenPesan
                  ? tInden("terkirim", { orderNo: res.orderNo })
                  : `Pesanan ${res.orderNo} terkirim`,
          );
          setCart(new Map());
          setNote("");
          // Mengubah pesanan: langsung ke detail pesanan PENGGANTI. Layar sukses di
          // sini tidak bertahan — server merender ulang katalog (pesanan lama sudah
          // dibatalkan, `?ganti=` jadi "tidak bisa diubah") dan `key` komponen ini
          // ikut berubah, sehingga salesman melihat spanduk merah dan mengira
          // perubahannya gagal. Detail pesanan punya tombol salinan WA yang sama.
          if (gantiUbah && res.orderId) {
            router.replace(`/pwa/orders/${res.orderId}`);
            return;
          }
          // Layar sukses (bukan langsung pindah): salesman bisa mengirim salinan pesanan ke toko lewat WA.
          setTerkirim({ orderId: res.orderId ?? null, orderNo: res.orderNo });
          setView("catalog");
          window.scrollTo({ top: 0 });
          return;
        }
        if (res.code === "KREDIT_DIBLOKIR") {
          setBlokirServer({ alasan: res.alasan, keranjang: cart });
          toast.error(
            tKredit("toastDiblokir", { alasan: res.alasan.map((a) => teksAlasanKredit(a, tKredit)).join("; ") }),
          );
          return;
        }
        let msg: string;
        if (res.code === "MIN_QTY") {
          const parts = res.violations.map((v) => {
            const name = cartLines.find((l) => l.itemId === v.itemId)?.nameId ?? "produk";
            return `${name} (min ${v.requiredMin})`;
          });
          msg = `Jumlah di bawah minimum: ${parts.join(", ")}.`;
        } else if (res.code === "NO_ACTIVE_VISIT") {
          msg = "Check in dulu untuk memesan.";
        } else if (res.code === "JARAK_JAUH_NONAKTIF" || res.code === "BUKAN_TOKO_SENDIRI") {
          msg = tJarak(`tolak.${res.code}`);
        } else if (res.code === "INDEN_DITOLAK") {
          msg = tInden(`tolak.${res.alasan}`);
        } else if (res.code === "PESANAN_LAMA_TIDAK_BISA_DIGANTI") {
          msg = tUbah("tolakKirim", { orderNo: gantiUbah?.orderNo ?? "" });
        } else if (res.code === "UNAUTHORIZED") {
          msg = "Sesi berakhir. Masuk lagi.";
        } else {
          msg = "Tidak ada item.";
        }
        toast.error(msg);
      } catch {
        toast.error("Gagal mengirim pesanan. Coba lagi.");
      }
    });
  }

  /*
   * Ulangi pesanan terakhir: baris lama masuk keranjang, dibatasi stok yang
   * tersedia SEKARANG. Yang habis atau sudah tidak dijual dilewati dan disebut
   * jumlahnya — keranjang yang diam-diam lebih pendek dari pesanan lama terbaca
   * sebagai kesalahan. Harga tetap dihitung server saat dikirim.
   */
  const sudahDiisi = useRef(false);

  /*
   * Minimum yang ditampilkan = minimum yang akan dinilai server untuk toko ini:
   * minimum barang sendiri bila ada, selain itu minimum toko (pesanan pertama
   * atau pesan ulang). Tanpa `minimum` (konsinyasi) payload dipakai apa adanya.
   */
  function terapkanMinimum(daftar: CatalogItem[]): CatalogItem[] {
    if (!minimum) return daftar;
    return daftar.map((it) => {
      const sendiri = minimum.perBarang[it.itemId];
      return sendiri !== undefined
        ? { ...it, minOrderQty: sendiri, minPesanUlang: false }
        : { ...it, minOrderQty: minimum.min, minPesanUlang: minimum.pesanUlang };
    });
  }
  function isiUlang(daftar: CatalogItem[], baris: NonNullable<typeof isiAwal>) {
    const hasil = susunIsiUlang(daftar, baris, isKonsi);
    /*
     * Mengubah pesanan: ajuan harga baris lama ikut — salesman tidak perlu
     * mengetik ulang. Mengulang pesanan terakhir tidak membawa ajuan apa pun
     * (barisnya tidak memuatnya). Konsinyasi tidak punya ajuan harga.
     */
    const ajuan = new Map(
      baris
        .filter((b) => !isKonsi && b.requestedUnitPrice != null)
        .map((b) => [kunciBaris(b.itemId, b.variantSku), { requestedUnitPrice: b.requestedUnitPrice!, appealReason: b.appealReason ?? null }]),
    );
    setCart(
      new Map(
        hasil.baris.map((l) => {
          const a = ajuan.get(kunciBaris(l.itemId, l.variantSku));
          return [variantKey(l.itemId, l.variantSku), a ? { ...l, ...a } : l];
        }),
      ),
    );
    if (gantiUbah) {
      if (hasil.baris.length > 0) toast.success(tUbah("terisi", { count: hasil.baris.length, orderNo: gantiUbah.orderNo }));
      if (hasil.dilewati > 0) toast.warning(tUbah("dilewati", { count: hasil.dilewati }));
      return;
    }
    // Keranjang dari permintaan SPG / rekomendasi menyebut sumbernya, bukan
    // "pesanan terakhir" — salesman harus tahu dari mana isinya datang.
    const kunciIsi = sumber?.startsWith("permintaan:")
      ? "filledFromRequest"
      : sumber?.startsWith("rekomendasi:")
        ? "filledFromRecommendation"
        : "repeatFilled";
    if (hasil.baris.length > 0) toast.success(t(kunciIsi, { count: hasil.baris.length }));
    if (hasil.dilewati > 0) toast.warning(t("repeatSkipped", { count: hasil.dilewati }));
  }

  useEffect(() => {
    // Pre-order: barangnya sudah dimuat server bersama halaman (ikut tersimpan
    // di cache halaman SW, jadi tetap terbuka tanpa sinyal). Tidak ada yang diambil.
    if (inden) {
      setItems(indenPesan ? terapkanMinimum(indenPesan.items) : []);
      setState("ready");
      // Mengubah pre-order: baris lamanya diisi dari barang jendela yang sama.
      if (indenPesan && gantiUbah && isiAwal?.length && bisaPesan && !sudahDiisi.current) {
        sudahDiisi.current = true;
        isiUlang(indenPesan.items, isiAwal);
      }
      return;
    }
    let alive = true;
    setState("loading");
    fetch(`/pwa/api/catalog?storeId=${encodeURIComponent(storeId)}`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<Payload>;
      })
      .then((data) => {
        if (!alive) return;
        // Mengubah pesanan: stok yang dipegang pesanan lama dihitung tersedia lagi —
        // penulis melepasnya sebelum pengganti dicadangkan.
        const katalog = gantiUbah ? tambahCadanganLama(data.items, gantiUbah.cadangan) : data.items;
        setItems(terapkanMinimum(katalog));
        setState("ready");
        if (isiAwal?.length && bisaPesan && !sudahDiisi.current) {
          sudahDiisi.current = true;
          isiUlang(katalog, isiAwal);
        }
      })
      .catch(() => {
        if (alive) setState("error");
      });
    return () => {
      alive = false;
    };
    // isiAwal dan hasActiveVisit tetap selama halaman ini hidup (datang dari
    // server sekali), dan pengisian ulang dijaga `sudahDiisi` — memuat ulang
    // katalog karena keduanya berubah hanya akan mengosongkan keranjang.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);

  const categories = useMemo(() => {
    const map = new Map<string, string>();
    for (const it of items) if (it.categoryId && it.categoryName) map.set(it.categoryId, it.categoryName);
    return Array.from(map, ([id, name]) => ({ id, name }));
  }, [items]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((it) => {
      if (cat && it.categoryId !== cat) return false;
      if (!needle) return true;
      return it.sku.toLowerCase().includes(needle) || it.nameId.toLowerCase().includes(needle);
    });
  }, [items, q, cat]);

  // Reset to page 1 whenever the filtered set changes (new search or category).
  useEffect(() => {
    setPage(1);
  }, [q, cat]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const shown = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (terkirim) {
    return <SuksesKirim storeId={storeId} storeName={storeName} orderId={terkirim.orderId} orderNo={terkirim.orderNo} />;
  }

  return (
    <div className="flex min-h-dvh flex-col gap-3 p-4">
      <header className="-ml-2">
        <Button asChild variant="ghost" size="sm">
          <TautanKembali cadangan={`/pwa/stores/${storeId}`} />
        </Button>
      </header>

      <div>
        <h1 className="text-lg font-semibold">{storeName}</h1>
        <p className="text-sm text-muted-foreground">
          {inden ? tInden("subjudul") : `Katalog produk · ${termsType}`}
        </p>
      </div>

      {gantiUbah && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm">
          <PencilLine className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden />
          <div className="min-w-0 space-y-0.5">
            <p className="font-semibold">{tUbah("bannerJudul", { orderNo: gantiUbah.orderNo })}</p>
            <p className="text-xs">{tUbah("bannerIsi", { orderNo: gantiUbah.orderNo })}</p>
            {gantiUbah.portal && <p className="text-xs text-muted-foreground">{tUbah("bannerPortal")}</p>}
            <Link
              href={`/pwa/orders/${gantiUbah.id}`}
              className="inline-flex min-h-11 items-center text-xs font-medium text-foreground underline underline-offset-2"
            >
              {tUbah("batalMengubah")}
            </Link>
          </div>
        </div>
      )}
      {ganti?.mode === "DITOLAK" && (
        <div role="alert" className="space-y-1 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm text-red-800 dark:text-red-300">
          <p className="font-semibold">
            {ganti.orderNo ? tUbah("ditolakJudul", { orderNo: ganti.orderNo }) : tUbah("ditolakJudulTanpaNomor")}
          </p>
          <p className="text-xs">{tUbah("ditolakIsi")}</p>
          <Link href="/pwa/orders" className="inline-flex min-h-11 items-center text-xs font-medium underline underline-offset-2">
            {tUbah("keDaftar")}
          </Link>
        </div>
      )}

      {jarakJauh && (
        <div className="flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2.5 text-sm">
          <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0">
            <p className="font-semibold">{tJarak("banner", { saluran: tJarak(`saluran.${jarakJauh.saluran}`) })}</p>
            <p className="text-xs text-muted-foreground">{tJarak("bannerIsi")}</p>
          </div>
        </div>
      )}
      {jarakJauhDitolak && (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm text-red-800 dark:text-red-300">
          {tJarak(`tolak.${jarakJauhDitolak}`)}
        </div>
      )}

      {/* Pre-order: jendela, tanggal tutup, rentang kirim — salesman perlu ketiganya untuk menjawab toko. */}
      {indenPesan && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm">
          <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden />
          <div className="min-w-0 space-y-0.5">
            <p className="font-semibold">{tInden("bannerJudul", { nama: indenPesan.name })}</p>
            <p className="text-xs">
              {tInden("tutup", { tanggal: indenPesan.tutup })}
              {indenPesan.kirim ? ` · ${teksKirim(indenPesan.kirim)}` : ""}
            </p>
            <p className="text-xs text-muted-foreground">{tInden("bannerIsi")}</p>
            {/* Mengubah pre-order tetap di jendelanya (server membawanya dari pesanan lama). */}
            {!gantiUbah && (
              <Link href={alamatKatalog()} className="inline-flex min-h-11 items-center text-xs font-medium text-foreground underline underline-offset-2">
                {tInden("kembaliStokSiap")}
              </Link>
            )}
          </div>
        </div>
      )}
      {indenTolak && (
        <Card role="alert" className="gap-2 p-4">
          <p className="font-semibold">{indenTolak.name ? tInden("tolakJudulNama", { nama: indenTolak.name }) : tInden("tolakJudul")}</p>
          <p className="text-sm text-muted-foreground">{tInden(`tolak.${indenTolak.alasan}`)}</p>
          {indenTolak.alasan !== "KONSI" && !gantiUbah && (
            <Button asChild variant="outline" className="mt-1 self-start">
              <Link href={alamatKatalog()}>{tInden("kembaliStokSiap")}</Link>
            </Button>
          )}
        </Card>
      )}
      {!inden && view === "catalog" && indenTerbuka.length > 0 && (
        <section aria-label={tInden("entryJudul")} className="flex flex-col gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <CalendarClock className="h-4 w-4 text-amber-700 dark:text-amber-400" aria-hidden />
            {tInden("entryJudul")}
          </p>
          <p className="text-xs text-muted-foreground">{tInden("entryIsi")}</p>
          <ul className="flex flex-col gap-2">
            {indenTerbuka.map((j) => (
              <li key={j.id} className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{j.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {tInden("tutup", { tanggal: j.tutup })}
                    {j.kirim ? ` · ${teksKirim(j.kirim)}` : ""}
                  </p>
                </div>
                <Button asChild size="sm" variant="outline" className="shrink-0">
                  <Link href={alamatKatalog(j.id)}>{tInden("entryTombol")}</Link>
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {view === "catalog" && !indenTolak && (
        <>
          <Input
            placeholder="Cari SKU atau nama"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />

          {categories.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant={cat === null ? "default" : "outline"} onClick={() => setCat(null)}>
                Semua
              </Button>
              {categories.map((c) => (
                <Button
                  key={c.id}
                  size="sm"
                  variant={cat === c.id ? "default" : "outline"}
                  onClick={() => setCat(c.id)}
                >
                  {c.name}
                </Button>
              ))}
            </div>
          )}

          {isKonsi &&
            bisaPesan &&
            // Variant items are excluded — auto-suggest can't pick a variant for the
            // salesman, so those items must be added via the variant sheet instead.
            items.some(
              (it) => it.neverSent && it.available > 0 && it.variants.length === 0 && !cart.has(variantKey(it.itemId, "")),
            ) && (
            <Button
              type="button"
              variant="outline"
              className="justify-start"
              onClick={() =>
                setCart((prev) => {
                  const next = new Map(prev);
                  let added = 0;
                  for (const it of items) {
                    const key = variantKey(it.itemId, "");
                    if (it.neverSent && it.available > 0 && it.variants.length === 0 && !next.has(key)) {
                      next.set(key, {
                        itemId: it.itemId,
                        variantSku: "",
                        variantLabel: null,
                        sku: it.sku,
                        nameId: it.nameId,
                        unitPrice: 0,
                        available: it.available,
                        qty: 1,
                        requestedUnitPrice: null,
                        appealReason: null,
                      });
                      added += 1;
                    }
                  }
                  if (added > 0) toast.success(`${added} produk baru ditambahkan`);
                  return next;
                })
              }
            >
              <Sparkles className="h-4 w-4" />
              Sarankan produk baru
            </Button>
          )}

          {state === "loading" && <p className="text-sm text-muted-foreground">Memuat katalog…</p>}
          {state === "error" && (
            <p className="text-sm text-destructive">
              Gagal memuat katalog. Periksa koneksi lalu coba lagi.
            </p>
          )}
          {state === "ready" && filtered.length === 0 && (
            <p className="text-sm text-muted-foreground">Tidak ada produk cocok.</p>
          )}

          <div className="flex flex-col gap-2">
            {shown.map((it) => {
              const hasVariants = it.variants.length > 0;
              const qty = cart.get(variantKey(it.itemId, ""))?.qty ?? 0;
              const canOrder = (isKonsi || it.price != null) && it.available > 0;
              // For variant items, the badge summarizes what's already in the cart across
              // that item's variant lines (variantSku "" is never used once it has variants).
              const variantLines = hasVariants ? cartLines.filter((l) => l.itemId === it.itemId) : [];
              const variantCount = variantLines.length;
              const variantUnits = variantLines.reduce((s, l) => s + l.qty, 0);
              return (
                <Card key={it.sku} className="flex flex-row items-center gap-3 p-3">
                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded bg-muted">
                    {it.primaryImageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={it.primaryImageUrl} alt={it.nameId} className="h-full w-full object-cover" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{it.nameId}</p>
                    <p className="truncate text-xs text-muted-foreground">{it.sku}</p>
                    {it.categoryName && <p className="truncate text-xs text-muted-foreground">{it.categoryName}</p>}
                    {!isKonsi && it.minOrderQty > 1 && (
                      <p className="text-xs text-muted-foreground">
                        {it.minPesanUlang
                          ? hasVariants
                            ? tMin("minUlangVarian", { min: it.minOrderQty })
                            : tMin("minUlang", { min: it.minOrderQty })
                          : hasVariants
                            ? tKredit("minPesanVarian", { min: it.minOrderQty })
                            : tKredit("minPesan", { min: it.minOrderQty })}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    {isKonsi ? (
                      <div className="flex items-center gap-1.5">
                        <Badge variant={it.available > 0 ? "secondary" : "destructive"}>
                          {it.available > 0 ? `${it.available} tersedia` : "Habis"}
                        </Badge>
                        {it.neverSent && <Badge variant="default">Baru</Badge>}
                      </div>
                    ) : indenPesan ? (
                      // Pre-order: barangnya belum ada; stok bukan batas.
                      <Badge variant="outline" className="border-amber-500/40 text-amber-800 dark:text-amber-300">
                        {tInden("stokAkanDatang")}
                      </Badge>
                    ) : (
                      <Badge variant={it.available > 0 ? "secondary" : "destructive"}>
                        {it.available > 0 ? tInden("stokSiap", { jumlah: it.available }) : tInden("habis")}
                      </Badge>
                    )}
                    {!isKonsi && !indenPesan && jendelaPerBarang.has(it.itemId) && (
                      <Link
                        href={alamatKatalog(jendelaPerBarang.get(it.itemId)!.id)}
                        // Sasaran sentuh 44 px seperti tombol PWA lain — ini satu-satunya jalan ke pre-order dari kartu barang.
                        className="inline-flex min-h-11 items-center text-xs font-medium text-amber-800 underline underline-offset-2 dark:text-amber-300"
                      >
                        {it.available > 0 ? tInden("jugaBisaInden") : tInden("bisaInden")}
                      </Link>
                    )}
                    {!isKonsi && (
                      <>
                        {it.price != null && (
                          <>
                            {it.priceLabel && (
                              <span className="text-xs text-muted-foreground">{it.priceLabel}</span>
                            )}
                            <span className="text-sm font-semibold tabular-nums">{rupiah(it.price)}</span>
                          </>
                        )}
                        {it.price == null && it.available > 0 && (
                          <span className="text-xs italic text-muted-foreground">Harga belum diset</span>
                        )}
                      </>
                    )}
                    {canOrder && bisaPesan && hasVariants && (
                      <Button type="button" variant="outline" size="sm" onClick={() => setSheetItem(it)}>
                        {variantUnits > 0 ? t("variantBadge", { variants: variantCount, units: variantUnits }) : t("selectVariant")}
                      </Button>
                    )}
                    {canOrder && bisaPesan && !hasVariants && (
                      <div className="flex items-center gap-1.5">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon-lg"
                          disabled={qty <= 0}
                          onClick={() => setQty(it, "", null, qty - 1)}
                          aria-label={`Kurangi ${it.nameId}`}
                        >
                          <Minus className="h-4 w-4" />
                        </Button>
                        <span className="w-5 text-center text-sm font-semibold tabular-nums">{qty}</span>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon-lg"
                          disabled={qty >= it.available}
                          onClick={() => setQty(it, "", null, qty + 1)}
                          aria-label={`Tambah ${it.nameId}`}
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                    {canOrder && !bisaPesan && (
                      <span className="text-xs text-muted-foreground">Check in untuk pesan</span>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>

          {state === "ready" && filtered.length > 0 && (
            <div className="flex items-center justify-center gap-3 pt-1">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                aria-label="Halaman sebelumnya"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm tabular-nums text-muted-foreground">
                {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                aria-label="Halaman berikutnya"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}

          {showCartBar && <div aria-hidden style={{ height: cartBarHeight }} />}
        </>
      )}

      {view === "review" && (
        <>
          <div className="-ml-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setView("catalog")}>
              <ArrowLeft className="h-4 w-4" />
              Kembali ke katalog
            </Button>
          </div>

          {cartLines.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <p className="text-sm text-muted-foreground">Keranjang kosong.</p>
              <Button type="button" onClick={() => setView("catalog")}>
                Kembali ke katalog
              </Button>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                {cartLines.map((line, lineIdx) => {
                  const lineTotal = line.qty * line.unitPrice;
                  const lineDiscount = preview?.lineDiscounts[lineIdx] ?? 0;
                  const netLineTotal = lineTotal - lineDiscount;
                  const it: CatalogItem =
                    items.find((i) => i.sku === line.sku) ?? {
                      itemId: line.itemId,
                      sku: line.sku,
                      nameId: line.nameId,
                      categoryId: null,
                      categoryName: null,
                      primaryImageUrl: null,
                      available: line.available,
                      price: line.unitPrice,
                      priceLabel: null,
                      neverSent: false,
                      minOrderQty: 0,
                      variants: [],
                    };
                  const lineLabel = line.variantLabel ? `${line.nameId} ${line.variantLabel}` : line.nameId;
                  const minBarang = minPerBarang.get(line.itemId) ?? 0;
                  const qtyBarang = qtyPerBarang.get(line.itemId) ?? 0;
                  const kurangMinimum = !isKonsi && minBarang > 1 && qtyBarang < minBarang;
                  return (
                    <Card key={variantKey(line.itemId, line.variantSku)} className="flex flex-row items-center gap-3 p-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{line.nameId}</p>
                        {line.variantLabel && (
                          <p className="truncate text-xs text-muted-foreground">{line.variantLabel}</p>
                        )}
                        <p className="truncate text-xs text-muted-foreground">{line.sku}</p>
                        {!isKonsi && (
                          <p className="text-xs text-muted-foreground tabular-nums">
                            {rupiah(line.unitPrice)} / pcs
                          </p>
                        )}
                        {kurangMinimum && (
                          <p className="text-xs text-destructive">
                            {tKredit("kurangMinimum", { min: minBarang, jumlah: qtyBarang })}
                          </p>
                        )}
                        {!isKonsi && line.requestedUnitPrice != null && (
                          <p className="truncate text-xs text-amber-600 dark:text-amber-500">
                            Diajukan {rupiah(line.requestedUnitPrice)}/pcs
                            {line.appealReason ? ` — ${line.appealReason}` : ""}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        <div className="flex items-center gap-1.5">
                          <Button
                            type="button"
                            variant="outline"
                            size="icon-lg"
                            onClick={() => setQty(it, line.variantSku, line.variantLabel, line.qty - 1)}
                            aria-label={`Kurangi ${lineLabel}`}
                          >
                            <Minus className="h-4 w-4" />
                          </Button>
                          <span className="w-5 text-center text-sm font-semibold tabular-nums">{line.qty}</span>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon-lg"
                            disabled={line.qty >= line.available}
                            onClick={() => setQty(it, line.variantSku, line.variantLabel, line.qty + 1)}
                            aria-label={`Tambah ${lineLabel}`}
                          >
                            <Plus className="h-4 w-4" />
                          </Button>
                        </div>
                        {!isKonsi && (
                          lineDiscount > 0 ? (
                            <div className="flex flex-col items-end gap-0.5">
                              <span className="text-xs text-muted-foreground line-through tabular-nums">
                                {rupiah(lineTotal)}
                              </span>
                              <div className="flex items-center gap-1">
                                <span className="text-sm font-semibold tabular-nums">{rupiah(netLineTotal)}</span>
                                <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                                  {t("promoTag")}
                                </Badge>
                              </div>
                            </div>
                          ) : (
                            <span className="text-sm font-semibold tabular-nums">{rupiah(lineTotal)}</span>
                          )
                        )}
                        {!isKonsi && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-10 px-3 text-xs"
                            onClick={() => setAppealKey(variantKey(line.itemId, line.variantSku))}
                          >
                            {line.requestedUnitPrice != null ? "Ubah pengajuan" : "Ajukan Harga"}
                          </Button>
                        )}
                      </div>
                    </Card>
                  );
                })}
              </div>

              {!isKonsi && preview && preview.bonus.length > 0 && (
                <section aria-label={tBonus("judulTinjau")} className="flex flex-col gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
                  <p className="flex items-center gap-1.5 text-sm font-semibold">
                    <Gift className="h-4 w-4 text-emerald-700 dark:text-emerald-400" aria-hidden />
                    {tBonus("judulTinjau")}
                  </p>
                  <ul className="flex flex-col gap-1.5">
                    {preview.bonus.map((b, i) => (
                      <li key={`${b.productName}-${i}`} className="text-sm">
                        {b.qty > 0 && (
                          <span className="block">
                            <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                              {tBonus("barisGratis", { qty: b.qty, promo: b.promoName })}
                            </span>{" "}
                            <span className="text-muted-foreground">{b.productName}</span>
                          </span>
                        )}
                        {b.kurang > 0 && (
                          <span className="block text-xs text-amber-800 dark:text-amber-300">
                            {tBonus("kurangStok", { qty: b.kurang, produk: b.productName })}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {indenPesan && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm">
                  <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden />
                  <div className="min-w-0">
                    <p className="font-semibold">{tInden("tinjauJudul", { nama: indenPesan.name })}</p>
                    <p className="text-xs text-muted-foreground">
                      {indenPesan.kirim ? `${kapital(teksKirim(indenPesan.kirim)!)}. ` : ""}
                      {tInden("tinjauIsi")}
                    </p>
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <label htmlFor="catatan" className="text-sm font-medium">
                  Catatan (opsional)
                </label>
                <Textarea
                  id="catatan"
                  placeholder="Tulis catatan untuk pesanan ini…"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                />
              </div>

              {!isKonsi && (
                <div className="flex flex-col gap-1 border-t pt-3">
                  {preview && preview.orderDiscount > 0 && (
                    <div className="flex items-center justify-between text-sm text-muted-foreground">
                      <span>{t("promoOrderDiscount")}</span>
                      <span className="tabular-nums">−{rupiah(preview.orderDiscount)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Total</span>
                    <span className="text-base font-semibold tabular-nums">
                      {rupiah(preview ? preview.netTotal : cartTotal(cartLines))}
                    </span>
                  </div>
                </div>
              )}

              {penilaianKredit && <KreditBanner penilaian={penilaianKredit} />}
            </>
          )}

          <div aria-hidden style={{ height: reviewBarHeight }} />
        </>
      )}

      {view === "review" && cartLines.length > 0 && (
        <div
          ref={reviewBarRef}
          className="sticky bottom-0 -mx-4 -mb-4 mt-auto border-t bg-background px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
        >
          {!online && (
            <p className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <WifiOff className="h-3.5 w-3.5 shrink-0" />
              Offline — pesanan disimpan & dikirim otomatis saat online
            </p>
          )}
          <Button
            type="button"
            className="w-full"
            size="lg"
            onClick={onSubmit}
            disabled={pending || cartLines.length === 0 || kirimDiblokir}
          >
            {pending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Mengirim…
              </>
            ) : gantiUbah ? (
              tUbah("tombolKirim")
            ) : indenPesan ? (
              tInden("tombolKirim")
            ) : (
              "Kirim"
            )}
          </Button>
        </div>
      )}

      {showCartBar && (
        <div
          ref={cartBarRef}
          className="sticky bottom-0 -mx-4 -mb-4 mt-auto border-t bg-background px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
        >
          <div className="flex min-w-0 items-center justify-between gap-3">
            <p className="truncate text-sm font-medium">
              {isKonsi ? (
                `${cartCount(cartLines)} item · ${cartLines.length} SKU`
              ) : (
                <>
                  {cartCount(cartLines)} item · <span className="tabular-nums">{rupiah(cartTotal(cartLines))}</span>
                </>
              )}
            </p>
            <Button onClick={() => setView("review")}>
              Tinjau
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <VariantSheet
        item={sheetItem}
        isKonsi={isKonsi}
        inden={indenPesan !== null}
        hasActiveVisit={bisaPesan}
        cart={cart}
        setQty={setQty}
        open={sheetItem !== null}
        onOpenChange={(next) => {
          if (!next) setSheetItem(null);
        }}
      />

      <AppealPriceSheet
        line={appealLine}
        open={appealLine !== null}
        onOpenChange={(next) => {
          if (!next) setAppealKey(null);
        }}
        onSave={(requestedUnitPrice, appealReason) => {
          if (appealKey) setAppeal(appealKey, { requestedUnitPrice, appealReason });
        }}
        onClear={() => {
          if (appealKey) setAppeal(appealKey, null);
        }}
      />
    </div>
  );
}

/**
 * Sesudah pesanan terkirim ONLINE: nomor pesanan, salinan ke toko lewat
 * WhatsApp, lalu kembali ke toko. Teks salinan dirakit server dari pesanan yang
 * TERCATAT (harga server sesudah promo, baris bonus; konsinyasi tanpa harga),
 * bukan dari keranjang di HP — yang dikirim ke toko sama dengan yang diputuskan kantor.
 */
function SuksesKirim({
  storeId,
  storeName,
  orderId,
  orderNo,
}: {
  storeId: string;
  storeName: string;
  orderId: string | null;
  orderNo: string;
}) {
  const tUbah = useTranslations("pwa.ubahPesanan");
  const [salinan, setSalinan] = useState<HasilSalinanWa | "memuat">(orderId ? "memuat" : { ok: false, code: "TIDAK_DITEMUKAN" });

  useEffect(() => {
    if (!orderId) return;
    let hidup = true;
    salinanPesananWaAction(orderId)
      .then((r) => {
        if (hidup) setSalinan(r);
      })
      .catch(() => {
        if (hidup) setSalinan({ ok: false, code: "GAGAL" });
      });
    return () => {
      hidup = false;
    };
  }, [orderId]);

  return (
    <div className="flex flex-col gap-4 p-4">
      <Card className="items-center gap-3 p-6 text-center">
        <CheckCircle2 className="h-10 w-10 text-emerald-600 dark:text-emerald-400" aria-hidden />
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">{tUbah("suksesJudul", { orderNo })}</h1>
          <p className="text-sm text-muted-foreground">{tUbah("suksesIsi", { toko: storeName })}</p>
        </div>
      </Card>

      {salinan === "memuat" ? (
        <Button type="button" size="lg" disabled>
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          {tUbah("waMenyiapkan")}
        </Button>
      ) : salinan.ok ? (
        <div className="flex flex-col gap-1.5">
          <Button asChild size="lg">
            <a href={salinan.tautan} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="h-4 w-4" aria-hidden />
              {tUbah("waKirim")}
            </a>
          </Button>
          {!salinan.adaNomor && <p className="text-center text-xs text-muted-foreground">{tUbah("waTanpaNomor")}</p>}
        </div>
      ) : (
        <p className="rounded-lg border px-3 py-2.5 text-sm text-muted-foreground">{tUbah("waGagal")}</p>
      )}

      {orderId && (
        <Button asChild variant="outline">
          <Link href={`/pwa/orders/${orderId}`}>{tUbah("lihatPesanan")}</Link>
        </Button>
      )}
      <Button asChild variant="outline">
        <Link href={`/pwa/stores/${storeId}`}>
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {tUbah("kembaliKeToko")}
        </Link>
      </Button>
    </div>
  );
}
