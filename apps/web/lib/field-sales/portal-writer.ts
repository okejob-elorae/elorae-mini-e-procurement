import { z } from "zod";
import { prisma } from "@elorae/db";
import { listCatalogForPwa, serializeCatalogItem, type CatalogItem } from "@/lib/catalog/queries";
import { fetchActivePromosForStore } from "@/lib/promos/queries";
import { formatDateOnlyJakarta, formatDisplayDateTime, parseDateOnly } from "@/lib/date-only";
import { JENIS_KABAR, kabariPengguna, type Kabar } from "@/lib/notifications/kabar-pengguna";
import { formatIDR } from "@/lib/sales-orders/format";
import { createFieldSalesOrder } from "./writer";
import { applyItemAggregatedPromos } from "./promo-apply";
import { susunBonusPesanan } from "./bonus";
import { muatMinimumKatalog } from "./minimum-toko";
import { MinQtyViolationError, NoActiveVisitError } from "./errors";
import { KreditDiblokirError } from "./kredit-pesanan";
import { JarakJauhDitolakError, SALURAN_PORTAL } from "./jarak-jauh";
import { keadaanPesanan, type KeadaanPesanan } from "./pwa-queries";
import { capTautanDipakai, type AksesPortal } from "./portal-toko";
import { emberBarang, emberKetersediaan, type Ketersediaan } from "./portal-toko-aturan";

/**
 * Portal pesan mandiri toko — alur PUBLIK: katalog, pratinjau, kirim pesanan,
 * dan "Pesanan saya". Setiap fungsi menerima `AksesPortal` yang BARU SAJA
 * dibuka dari token oleh pemanggilnya (`bukaTautanPortal`); tidak ada yang
 * mempercayai id toko dari peramban.
 *
 * Yang tidak pernah keluar ke toko: angka stok (hanya ember Tersedia/Terbatas/
 * Habis), harga pokok, margin, keadaan tagihan/kredit, alasan penolakan
 * internal, dan — untuk toko KONSINYASI — harga atau total dalam bentuk apa
 * pun: kuncinya tidak ada di muatan, bukan sekadar disembunyikan di layar.
 */

// ── Katalog ──────────────────────────────────────────────────────────────

export type VarianPortal = { variantSku: string; label: string; ketersediaan: Ketersediaan };

type BarangDasar = {
  itemId: string;
  sku: string;
  nama: string;
  kategoriId: string | null;
  kategori: string | null;
  gambar: string | null;
  ketersediaan: Ketersediaan;
  /** Kosong = barang tanpa varian (dipesan langsung). */
  varian: VarianPortal[];
};

export type BarangPortalPutus = BarangDasar & {
  /** null = harga belum ditetapkan kantor; barang itu tidak bisa dipesan. */
  harga: number | null;
  minPesan: number;
};
export type BarangPortalKonsi = BarangDasar;

export type KepalaPortal = { namaToko: string; namaSalesman: string | null };

export type KatalogPortal =
  | { jenis: "PUTUS"; kepala: KepalaPortal; barang: BarangPortalPutus[]; minimum: { min: number; pesanUlang: boolean } }
  | { jenis: "KONSI"; kepala: KepalaPortal; barang: BarangPortalKonsi[] };

function varianDari(c: CatalogItem): VarianPortal[] {
  return c.variants.map((v) => ({ variantSku: v.variantSku, label: v.variantLabel, ketersediaan: emberKetersediaan(v.available) }));
}

function dasarDari(c: CatalogItem): BarangDasar {
  const varian = varianDari(c);
  return {
    itemId: c.itemId,
    sku: c.sku,
    nama: c.nameId,
    kategoriId: c.categoryId,
    kategori: c.categoryName,
    gambar: c.primaryImageUrl,
    ketersediaan: varian.length > 0 ? emberBarang(varian.map((v) => v.ketersediaan)) : emberKetersediaan(c.available),
    varian,
  };
}

/**
 * Baris katalog salesman → baris portal. Ditulis sebagai objek BARU kunci demi
 * kunci (bukan `{ ...c }` lalu menghapus), supaya kolom yang kelak ditambahkan
 * ke katalog salesman tidak ikut bocor ke toko tanpa ada yang memutuskannya.
 */
export function barangPortalPutus(c: CatalogItem, min: { min: number; perBarang: Record<string, number> }): BarangPortalPutus {
  return { ...dasarDari(c), harga: c.price, minPesan: min.perBarang[c.itemId] ?? min.min };
}

export function barangPortalKonsi(c: CatalogItem): BarangPortalKonsi {
  return dasarDari(c);
}

export async function katalogPortal(akses: AksesPortal): Promise<KatalogPortal | null> {
  const payload = await listCatalogForPwa(akses.toko.id);
  if (!payload) return null;
  const kepala: KepalaPortal = { namaToko: akses.toko.name, namaSalesman: akses.toko.namaSalesman };
  if (akses.toko.termsType === "KONSI") {
    return { jenis: "KONSI", kepala, barang: payload.items.map(barangPortalKonsi) };
  }
  const min = await muatMinimumKatalog(akses.toko.id);
  return {
    jenis: "PUTUS",
    kepala,
    barang: payload.items.map((c) => barangPortalPutus(c, min)),
    minimum: { min: min.min, pesanUlang: min.pesanUlang },
  };
}

// ── Baris pesanan ────────────────────────────────────────────────────────

export const MAKS_BARIS_PORTAL = 200;
export const MAKS_QTY_PORTAL = 9999;

const skemaBaris = z.object({
  itemId: z.string().min(1).max(64),
  variantSku: z.string().max(100),
  qty: z.number().int().min(1).max(MAKS_QTY_PORTAL),
});
export const skemaBarisPortal = z.array(skemaBaris).min(1).max(MAKS_BARIS_PORTAL);
export type BarisPortalMasuk = z.infer<typeof skemaBaris>;

export const skemaKirimPortal = z.object({
  lines: skemaBarisPortal,
  note: z.string().max(500).optional(),
  /** Dibuat peramban SEKALI per formulir — kiriman ulang memakai kunci yang sama. */
  idempotencyKey: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/),
});

/** Barang yang bermasalah, disebut dengan NAMANYA — tanpa angka stok. */
export type MasalahBaris =
  | { code: "BARANG_TIDAK_TERSEDIA"; nama: string[] }
  | { code: "STOK_KURANG"; nama: string[] }
  | { code: "HARGA_BELUM_ADA"; nama: string[] }
  | { code: "QTY_TERLALU_BANYAK"; nama: string[] };

export type BarisSah = {
  itemId: string;
  variantSku: string;
  productName: string;
  qty: number;
  /** Harga satuan toko (PUTUS); KONSI selalu 0 — penulis menghitung sendiri di kedua kasus. */
  unitPrice: number;
  /** Nama barang tanpa varian — untuk pesan minimum pesan (minimum dihitung per barang). */
  namaBarang: string;
};

/** Baris yang sama (barang + varian) digabung; jumlahnya dijumlahkan. */
export function gabungBaris(lines: BarisPortalMasuk[]): BarisPortalMasuk[] {
  const peta = new Map<string, BarisPortalMasuk>();
  for (const l of lines) {
    const k = `${l.itemId}::${l.variantSku}`;
    const ada = peta.get(k);
    peta.set(k, ada ? { ...ada, qty: ada.qty + l.qty } : { ...l });
  }
  return [...peta.values()];
}

const namaBaris = (c: CatalogItem, variantSku: string): string => {
  if (!variantSku) return c.nameId;
  const v = c.variants.find((x) => x.variantSku === variantSku);
  return v ? `${c.nameId} — ${v.variantLabel}` : c.nameId;
};

/**
 * Barang yang diminta, dimuat SEMPIT (hanya id yang diminta) dengan serializer
 * yang sama dengan katalog — harga, varian, dan stok tersedia di sini sama
 * persis dengan yang dilihat toko.
 */
async function muatBarangDiminta(akses: AksesPortal, itemIds: string[]): Promise<Map<string, CatalogItem>> {
  const store = await prisma.store.findUnique({ where: { id: akses.toko.id }, select: { termsType: true, marginPercent: true } });
  if (!store) return new Map();
  const ctx = { termsType: store.termsType, marginPercent: store.marginPercent ? Number(store.marginPercent) : null };
  const rows = await prisma.item.findMany({
    where: { id: { in: itemIds }, isActive: true, type: "FINISHED_GOOD" },
    select: {
      id: true,
      sku: true,
      nameId: true,
      categoryId: true,
      category: { select: { name: true } },
      sellingPrice: true,
      minOrderQty: true,
      variants: true,
      inventoryValues: { select: { variantSku: true, qtyOnHand: true, reservedQty: true, totalValue: true } },
    },
  });
  return new Map(rows.map((r) => [r.id, serializeCatalogItem(r, ctx, null, false, 0)]));
}

/**
 * Memeriksa baris toko terhadap katalog SAAT INI: barang aktif barang jadi,
 * varian yang memang ada, stok cukup, dan (PUTUS) harga sudah ditetapkan.
 * Stok yang kurang DITOLAK di portal — tidak seperti pesanan salesman yang
 * hanya diberi peringatan — karena pesanan portal mencadangkan stok tanpa ada
 * orang kantor yang melihatnya dulu; tautan yang bocor tidak boleh bisa
 * mengunci stok yang tidak ada.
 */
export async function periksaBarisPortal(
  akses: AksesPortal,
  masuk: BarisPortalMasuk[],
): Promise<{ ok: true; baris: BarisSah[] } | { ok: false; masalah: MasalahBaris }> {
  const lines = gabungBaris(masuk);
  const terlalu = lines.filter((l) => l.qty > MAKS_QTY_PORTAL);
  const barang = await muatBarangDiminta(akses, [...new Set(lines.map((l) => l.itemId))]);
  if (terlalu.length > 0) {
    return { ok: false, masalah: { code: "QTY_TERLALU_BANYAK", nama: terlalu.map((l) => (barang.get(l.itemId) ? namaBaris(barang.get(l.itemId)!, l.variantSku) : l.itemId)) } };
  }
  const isKonsi = akses.toko.termsType === "KONSI";

  const tidakAda: string[] = [];
  const kurang: string[] = [];
  const tanpaHarga: string[] = [];
  const baris: BarisSah[] = [];
  for (const l of lines) {
    const c = barang.get(l.itemId);
    if (!c) {
      // Id barang yang tidak dikenal TIDAK disebut balik — hanya "barang tidak tersedia".
      tidakAda.push("—");
      continue;
    }
    const nama = namaBaris(c, l.variantSku);
    let tersedia: number;
    if (c.variants.length > 0) {
      const v = c.variants.find((x) => x.variantSku === l.variantSku);
      if (!v) {
        tidakAda.push(nama);
        continue;
      }
      tersedia = v.available;
    } else {
      if (l.variantSku !== "") {
        tidakAda.push(nama);
        continue;
      }
      tersedia = c.available;
    }
    if (tersedia <= 0 || l.qty > tersedia) kurang.push(nama);
    if (!isKonsi && c.price == null) tanpaHarga.push(nama);
    baris.push({ itemId: l.itemId, variantSku: l.variantSku, productName: nama, qty: l.qty, unitPrice: isKonsi ? 0 : c.price ?? 0, namaBarang: c.nameId });
  }
  if (tidakAda.length > 0) return { ok: false, masalah: { code: "BARANG_TIDAK_TERSEDIA", nama: tidakAda.filter((n) => n !== "—") } };
  if (tanpaHarga.length > 0) return { ok: false, masalah: { code: "HARGA_BELUM_ADA", nama: tanpaHarga } };
  if (kurang.length > 0) return { ok: false, masalah: { code: "STOK_KURANG", nama: kurang } };
  return { ok: true, baris };
}

// ── Pratinjau ────────────────────────────────────────────────────────────

export type PratinjauPortal =
  | {
      ok: true;
      jenis: "PUTUS";
      /** Sejajar dengan baris yang dikirim (sesudah digabung): harga satuan, subtotal, potongan promo. */
      baris: Array<{ itemId: string; variantSku: string; hargaSatuan: number; subtotal: number; potongan: number }>;
      potonganPesanan: number;
      total: number;
      bonus: Array<{ nama: string; qty: number }>;
    }
  /** Konsinyasi: TIDAK ADA angka uang sama sekali. */
  | { ok: true; jenis: "KONSI" }
  | { ok: false; masalah: MasalahBaris };

/**
 * Pratinjau harga untuk layar tinjau toko PUTUS — helper promo dan bonus yang
 * SAMA dengan penulis pesanan, jadi angka yang dilihat toko sama dengan yang
 * tercatat. Harga satuan selalu dihitung server; peramban tidak mengirim harga.
 */
export async function pratinjauPortal(akses: AksesPortal, masuk: BarisPortalMasuk[]): Promise<PratinjauPortal> {
  const cek = await periksaBarisPortal(akses, masuk);
  if (!cek.ok) return cek;
  if (akses.toko.termsType === "KONSI") return { ok: true, jenis: "KONSI" };

  const baris = cek.baris;
  const itemIds = [...new Set(baris.map((l) => l.itemId))];
  const inv = await prisma.inventoryValue.findMany({ where: { itemId: { in: itemIds } }, select: { itemId: true, avgCost: true } });
  const avgCost = new Map<string, number>();
  for (const r of inv) if (!avgCost.has(r.itemId)) avgCost.set(r.itemId, Number(r.avgCost));
  const sekarang = new Date();
  const promo = await fetchActivePromosForStore(akses.toko.id, sekarang);
  const applied = applyItemAggregatedPromos(
    baris.map((l) => ({ itemId: l.itemId, qty: l.qty, unitPrice: l.unitPrice, avgCost: avgCost.get(l.itemId) ?? 0 })),
    promo,
  );
  const kotor = baris.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  const total = kotor - applied.lineDiscounts.reduce((s, d) => s + d, 0) - applied.orderDiscountAmount;

  // Bonus: gagal di sini hanya menghilangkan baris bonus dari pratinjau. Angka
  // "kurang" sengaja tidak dikirim — itu membuka stok barang bonusnya.
  let bonus: Array<{ nama: string; qty: number }> = [];
  try {
    const hasil = await susunBonusPesanan(prisma, {
      storeId: akses.toko.id,
      now: sekarang,
      lines: baris.map((l) => ({ itemId: l.itemId, variantSku: l.variantSku, qty: l.qty, productName: l.productName })),
      pesananBelumDicadangkan: true,
    });
    bonus = hasil.filter((b) => b.qty > 0).map((b) => ({ nama: b.productName, qty: b.qty }));
  } catch {
    bonus = [];
  }

  return {
    ok: true,
    jenis: "PUTUS",
    baris: baris.map((l, i) => ({
      itemId: l.itemId,
      variantSku: l.variantSku,
      hargaSatuan: l.unitPrice,
      subtotal: l.qty * l.unitPrice,
      potongan: applied.lineDiscounts[i] ?? 0,
    })),
    potonganPesanan: applied.orderDiscountAmount,
    total,
    bonus,
  };
}

// ── Kirim pesanan ────────────────────────────────────────────────────────

export type GagalKirimPortal =
  | { ok: false; code: "TIDAK_SAH" }
  | { ok: false; code: "BATAS_HARIAN"; batas: number }
  | { ok: false; code: "MIN_PESAN"; kurang: Array<{ nama: string; min: number; jumlah: number }> }
  /** Kredit toko diblokir — tanpa angka, tanpa alasan: "hubungi salesman Anda". */
  | { ok: false; code: "HUBUNGI_SALESMAN" }
  | { ok: false; code: "GAGAL" }
  | { ok: false; masalah: MasalahBaris; code: "BARIS" };

export type HasilKirimPortal =
  | { ok: true; jenis: "PUTUS"; orderNo: string; total: number; ulang: boolean }
  | { ok: true; jenis: "KONSI"; orderNo: string; ulang: boolean }
  | GagalKirimPortal;

/** Kunci idempoten disimpan bercakupan TAUTAN: kunci dari tautan lain (atau dari HP salesman) tidak pernah cocok. */
export function kunciIdempotenPortal(linkId: string, kunciKlien: string): string {
  return `portal:${linkId}:${kunciKlien}`;
}

/** Awal hari ini (00.00 WIB) sebagai instan. */
export function awalHariWib(sekarang: Date): Date {
  return parseDateOnly(formatDateOnlyJakarta(sekarang))!;
}

export async function hitungPesananPortalHariIni(storeId: string, sekarang: Date = new Date()): Promise<number> {
  return prisma.fieldSalesOrder.count({
    where: { storeId, remoteChannel: SALURAN_PORTAL, createdAt: { gte: awalHariWib(sekarang) } },
  });
}

/** Kabar ke salesman pemegang toko. KONSI tanpa nilai uang — aturan tetap aplikasi salesman. */
export function kabarPesananPortal(k: {
  orderId: string;
  orderNo: string;
  namaToko: string;
  jenis: "PUTUS" | "KONSI";
  total: number | null;
  jumlahPcs: number;
}): Kabar {
  const isi =
    k.jenis === "KONSI"
      ? `${k.namaToko} memesan sendiri lewat portal · permintaan konsinyasi ${k.jumlahPcs} pcs. Menunggu persetujuan kantor.`
      : `${k.namaToko} memesan sendiri lewat portal · ${k.jumlahPcs} pcs, total ${formatIDR(k.total ?? 0)}. Menunggu persetujuan kantor.`;
  return {
    jenis: JENIS_KABAR.PESANAN_PORTAL,
    judul: `Pesanan portal ${k.orderNo}`,
    isi,
    data: { orderId: k.orderId },
  };
}

/**
 * Pesanan dari portal toko. Urutan pemeriksaan:
 * 1. bentuk masukan (zod) — termasuk kunci idempoten WAJIB;
 * 2. kiriman ulang (kunci yang sama dari tautan yang sama) → pesanan yang sudah
 *    ada, apa adanya, TANPA dihitung ke batas harian dan tanpa kabar ulang;
 * 3. batas harian pemilik;
 * 4. baris terhadap katalog saat ini;
 * 5. penulis pesanan biasa (`createFieldSalesOrder`, saluran `PORTAL`): harga,
 *    promo, minimum, kredit, cadangan stok, dan kabar ke kantor semuanya dari sana.
 *
 * Batas harian dihitung di luar transaksi penulis: dua kiriman yang tiba
 * bersamaan bisa sama-sama lolos dan melewati batas satu-dua pesanan. Itu
 * diterima — batasnya penahan banjir, bukan pembukuan.
 */
export async function kirimPesananPortal(akses: AksesPortal, input: unknown, sekarang: Date = new Date()): Promise<HasilKirimPortal> {
  const parsed = skemaKirimPortal.safeParse(input);
  if (!parsed.success) return { ok: false, code: "TIDAK_SAH" };
  const { lines, note, idempotencyKey } = parsed.data;
  const kunci = kunciIdempotenPortal(akses.linkId, idempotencyKey);

  const ada = await prisma.fieldSalesOrder.findUnique({
    where: { idempotencyKey: kunci },
    select: { orderNo: true, orderType: true, total: true, storeId: true },
  });
  if (ada) {
    // Kunci bercakupan tautan → toko pasti sama; diperiksa lagi sebagai pagar.
    if (ada.storeId !== akses.toko.id) return { ok: false, code: "GAGAL" };
    return ada.orderType === "KONSI"
      ? { ok: true, jenis: "KONSI", orderNo: ada.orderNo, ulang: true }
      : { ok: true, jenis: "PUTUS", orderNo: ada.orderNo, total: Number(ada.total), ulang: true };
  }

  const hariIni = await hitungPesananPortalHariIni(akses.toko.id, sekarang);
  if (hariIni >= akses.aturan.maksPesananPerHari) return { ok: false, code: "BATAS_HARIAN", batas: akses.aturan.maksPesananPerHari };

  const cek = await periksaBarisPortal(akses, lines);
  if (!cek.ok) return { ok: false, code: "BARIS", masalah: cek.masalah };

  const catatan = note?.trim() ? note.trim() : undefined;
  let hasil: Awaited<ReturnType<typeof createFieldSalesOrder>>;
  try {
    hasil = await createFieldSalesOrder({
      storeId: akses.toko.id,
      salesmanId: akses.toko.salesmanId,
      lines: cek.baris.map((b) => ({ itemId: b.itemId, variantSku: b.variantSku, productName: b.productName, qty: b.qty, unitPrice: b.unitPrice })),
      note: catatan,
      idempotencyKey: kunci,
      remoteChannel: SALURAN_PORTAL,
    });
  } catch (e) {
    if (e instanceof MinQtyViolationError) {
      const namaPer = new Map(cek.baris.map((b) => [b.itemId, b.namaBarang]));
      return {
        ok: false,
        code: "MIN_PESAN",
        kurang: e.violations.map((v) => ({ nama: namaPer.get(v.itemId) ?? "—", min: v.requiredMin, jumlah: v.actualQty })),
      };
    }
    if (e instanceof KreditDiblokirError) return { ok: false, code: "HUBUNGI_SALESMAN" };
    // Pemegang toko berganti di tengah jalan, atau keadaan lain yang tidak perlu diketahui toko.
    if (e instanceof JarakJauhDitolakError || e instanceof NoActiveVisitError) return { ok: false, code: "GAGAL" };
    // Log tanpa token: hanya id tautan dan toko.
    console.error("[portal-toko] kirim pesanan gagal", { linkId: akses.linkId, storeId: akses.toko.id }, e);
    return { ok: false, code: "GAGAL" };
  }

  await capTautanDipakai(akses.linkId, { paksa: true, sekarang });
  const jenis = akses.toko.termsType;
  const order = await prisma.fieldSalesOrder.findUnique({ where: { id: hasil.orderId }, select: { total: true } });
  const total = jenis === "KONSI" ? null : Number(order?.total ?? 0);
  void kabariPengguna(
    akses.toko.salesmanId,
    kabarPesananPortal({
      orderId: hasil.orderId,
      orderNo: hasil.orderNo,
      namaToko: akses.toko.name,
      jenis,
      total,
      jumlahPcs: cek.baris.reduce((n, b) => n + b.qty, 0),
    }),
  );
  return jenis === "KONSI"
    ? { ok: true, jenis: "KONSI", orderNo: hasil.orderNo, ulang: false }
    : { ok: true, jenis: "PUTUS", orderNo: hasil.orderNo, total: total ?? 0, ulang: false };
}

// ── Pesanan saya (toko) ──────────────────────────────────────────────────

export type PesananTokoPortal = {
  orderNo: string;
  /** Sudah diformat di server (WIB). */
  tanggal: string;
  keadaan: KeadaanPesanan;
  dariPortal: boolean;
  jumlahPcs: number;
  baris: Array<{ nama: string; qty: number; bonus: boolean }>;
  /** Hanya pesanan PUTUS yang tidak ditolak, di toko PUTUS. Kunci TIDAK ADA untuk konsinyasi. */
  total?: number;
};

/**
 * Pesanan terbaru toko ini — dari portal maupun dari salesman. Alasan
 * penolakan TIDAK disertakan: itu catatan kantor, bisa menyebut tagihan toko.
 */
export async function pesananTokoPortal(akses: AksesPortal, batas = 20): Promise<PesananTokoPortal[]> {
  const rows = await prisma.fieldSalesOrder.findMany({
    where: { storeId: akses.toko.id },
    orderBy: [{ createdAt: "desc" }, { orderNo: "desc" }],
    take: batas,
    select: {
      orderNo: true,
      orderType: true,
      status: true,
      deliveryStatus: true,
      total: true,
      createdAt: true,
      remoteChannel: true,
      lines: { select: { productName: true, qty: true, isBonus: true }, orderBy: { id: "asc" } },
    },
  });
  const tokoPutus = akses.toko.termsType === "PUTUS";
  return rows.map((r) => {
    const keadaan = keadaanPesanan({ status: r.status, orderType: r.orderType, deliveryStatus: r.deliveryStatus });
    const dasar: PesananTokoPortal = {
      orderNo: r.orderNo,
      tanggal: formatDisplayDateTime(r.createdAt),
      keadaan,
      dariPortal: r.remoteChannel === SALURAN_PORTAL,
      jumlahPcs: r.lines.reduce((n, l) => n + l.qty, 0),
      baris: r.lines.map((l) => ({ nama: l.productName, qty: l.qty, bonus: l.isBonus })),
    };
    if (tokoPutus && r.orderType === "PUTUS" && r.status !== "REJECTED") dasar.total = Number(r.total);
    return dasar;
  });
}

