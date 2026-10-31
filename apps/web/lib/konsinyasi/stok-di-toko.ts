import { prisma } from "@elorae/db";
import { formatDisplayDate } from "@/lib/date-only";
import { parseItemVariants, variantDetailForSku } from "@/lib/items/variants";
import { kirimanMenunggu } from "@/lib/spg/kiriman";
import { jumlahLakuBersihSejak } from "@/lib/spg/laku-bersih";
import {
  kunciStok,
  nilaiIsiUlang,
  ringkasPenilaian,
  urutkanPenilaian,
  type RingkasanStok,
  type TandaStok,
} from "./isi-ulang";

/**
 * Stok barang di sebuah toko konsinyasi / toko ber-SPG, per barang × ukuran.
 *
 * Ada DUA sumber, dan satu toko hanya dibaca dari SATU di antaranya:
 *
 * - BUKU_TOKO — buku stok toko (`StoreStockMovement`): SPG menerima kiriman,
 *   menjual, dan menghitung (opname) langsung di toko. Tanggalnya harian dan
 *   ukurannya tepat, jadi kalau buku itu ADA, dialah yang dipercaya.
 * - TITIPAN — hitungan modul konsinyasi ("stok titipan dihitung, tidak
 *   disimpan"): dikirim − terjual resmi − diretur. Dipakai untuk toko yang
 *   belum punya satu pun gerakan buku (toko tanpa SPG, atau SPG-nya belum
 *   mulai mencatat). Mutasi antar toko yang diterima kantor atas nama toko
 *   tanpa buku ikut sebagai "dikirim" (jumlah DITERIMA dari tanda terimanya) —
 *   penerimaan kantor sengaja tidak membukakan buku untuk toko itu.
 *
 * Kenapa tidak dijumlah atau dicampur: keduanya menghitung barang yang SAMA.
 * Kiriman yang diterima SPG sudah masuk buku sebagai TERIMA, dan penjualannya
 * sudah keluar sebagai JUAL — menambah hitungan titipan di atasnya akan
 * menghitung setiap potong dua kali. Buku juga lebih benar: opname SPG adalah
 * hitungan fisik, sedangkan titipan hanya selisih dua dokumen.
 *
 * Batas TITIPAN yang perlu diketahui pembacanya:
 * - "Terjual" hanya dari siklus yang sudah DIKUNCI (`ConsignmentSold`) — bulan
 *   yang belum dikunci belum mengurangi apa pun, jadi stoknya terbaca lebih.
 * - Terjual dan retur dilaporkan per BARANG, tidak per ukuran. Untuk barang
 *   bervarian, jumlah itu dibagi ke ukuran sebanding jumlah kirimannya, dan
 *   barisnya ditandai `perkiraan`.
 * - Tanggal terjual hanya sampai BULAN: setiap siklus dianggap terjual di akhir
 *   bulannya (dibatasi hari ini). Itu arah yang aman untuk tanda TIDAK_LAKU —
 *   barang dianggap laku selambat mungkin, jadi tidak dicap tidak laku terlalu
 *   cepat.
 */

export type SumberStokToko = "BUKU_TOKO" | "TITIPAN";

/** Barang hilang yang mengurangi titipan: keputusannya sudah ditetapkan (atau selesai)… */
const STATUS_HILANG_DIPUTUSKAN = ["DITETAPKAN", "SELESAI"] as const;
/** …dan hilangnya DI TOKO (opname / dicatat kantor), bukan di jalan. */
const SUMBER_HILANG_DI_TOKO = ["OPNAME", "MANUAL"] as const;

const HARI_MS = 86_400_000;

export type BarisStokMentah = {
  itemId: string;
  variantSku: string;
  qty: number;
  soldLast30: number;
  soldLast60: number;
  lastSaleAt: Date | null;
  firstInAt: Date | null;
  /** TITIPAN saja: terjual per barang dibagi ke ukuran — angka ukurannya perkiraan. */
  perkiraan: boolean;
};

export type BarisStokDiToko = BarisStokMentah & {
  source: SumberStokToko;
  sku: string;
  nama: string;
  varian: string | null;
};

export type StokDiToko = { source: SumberStokToko; baris: BarisStokDiToko[] };

// ---------------------------------------------------------------------------
// Bagian murni
// ---------------------------------------------------------------------------

/**
 * Bagi `total` ke beberapa baris sebanding `bobot`, dalam bilangan bulat
 * (sisa terbesar). Jumlah hasilnya SELALU sama dengan total — yang dibagi
 * adalah potong barang, tidak boleh ada potong yang hilang atau muncul.
 * Tanpa bobot positif sama sekali, semuanya jatuh ke baris pertama.
 */
export function bagiSebanding(total: number, bobot: number[]): number[] {
  const n = bobot.length;
  if (n === 0) return [];
  const hasil = new Array<number>(n).fill(0);
  if (total === 0) return hasil;
  const w = bobot.map((b) => Math.max(0, b));
  const jumlahBobot = w.reduce((s, b) => s + b, 0);
  if (jumlahBobot === 0) {
    hasil[0] = total;
    return hasil;
  }
  const pecahan: { i: number; sisa: number }[] = [];
  let terbagi = 0;
  for (let i = 0; i < n; i++) {
    const tepat = (total * w[i]) / jumlahBobot;
    hasil[i] = Math.floor(tepat);
    terbagi += hasil[i];
    pecahan.push({ i, sisa: tepat - hasil[i] });
  }
  pecahan.sort((a, b) => b.sisa - a.sisa || a.i - b.i);
  for (let k = 0; k < total - terbagi; k++) hasil[pecahan[k % n].i] += 1;
  return hasil;
}

/** Saat terakhir sebuah bulan menurut kalender Jakarta, sebagai instant UTC. */
export function akhirBulanWib(tahun: number, bulan: number): Date {
  const berikut = bulan === 12 ? `${tahun + 1}-01` : `${tahun}-${String(bulan + 1).padStart(2, "0")}`;
  return new Date(new Date(`${berikut}-01T00:00:00+07:00`).getTime() - 1);
}

type Kunci = { itemId: string; variantSku: string };

/** Gabungkan agregat buku stok toko menjadi baris stok. */
export function gabungBukuToko(input: {
  saldo: (Kunci & { qty: number; pertama: Date | null })[];
  jualTerakhir: (Kunci & { terakhir: Date | null })[];
  jual30: (Kunci & { qty: number })[];
  jual60: (Kunci & { qty: number })[];
}): BarisStokMentah[] {
  const k = (x: Kunci) => kunciStok(x.itemId, x.variantSku);
  const terakhir = new Map(input.jualTerakhir.map((j) => [k(j), j.terakhir]));
  // JUAL ditulis negatif (−qty per baris nota); terjual = kebalikannya.
  const laku30 = new Map(input.jual30.map((j) => [k(j), Math.max(0, -j.qty)]));
  const laku60 = new Map(input.jual60.map((j) => [k(j), Math.max(0, -j.qty)]));
  return input.saldo.map((s) => ({
    itemId: s.itemId,
    variantSku: s.variantSku ?? "",
    qty: s.qty,
    soldLast30: laku30.get(k(s)) ?? 0,
    soldLast60: laku60.get(k(s)) ?? 0,
    lastSaleAt: terakhir.get(k(s)) ?? null,
    firstInAt: s.pertama,
    perkiraan: false,
  }));
}

/**
 * Stok titipan per barang × ukuran: dikirim − terjual − diretur − keluar lain.
 *
 * `masuk` per ukuran (pesanan konsinyasi disetujui, kiriman modul konsinyasi);
 * `terjual` dan `retur` per barang (laporan resmi & NRI hanya sampai barang).
 * `keluarUkuran` per ukuran: barang yang meninggalkan toko tanpa terjual dan
 * tanpa nota retur — rusak kiriman yang DIHAPUSKAN gudang, dan barang hilang
 * yang sudah ditetapkan. Dikurangkan dari ukurannya sendiri kalau ukuran itu
 * tercatat masuk; kalau tidak (mis. kiriman modul konsinyasi yang hanya sampai
 * barang), dari barangnya — dibagi sebanding seperti retur.
 * Sisa negatif dipertahankan — sama dengan `stokTitipan` di `aturan.ts`.
 */
export function hitungTitipan(input: {
  masuk: (Kunci & { qty: number; tanggal: Date })[];
  terjual: { itemId: string; qty: number; tanggal: Date }[];
  retur: { itemId: string; qty: number }[];
  keluarUkuran?: (Kunci & { qty: number })[];
  sekarang: Date;
}): BarisStokMentah[] {
  const batas30 = input.sekarang.getTime() - 30 * HARI_MS;
  const batas60 = input.sekarang.getTime() - 60 * HARI_MS;

  // Baris per ukuran, urut kemunculan pertama supaya pembagian stabil.
  const baris = new Map<string, { itemId: string; variantSku: string; masuk: number; pertama: Date | null }>();
  for (const m of input.masuk) {
    const k = kunciStok(m.itemId, m.variantSku);
    const ada = baris.get(k);
    if (ada) {
      ada.masuk += m.qty;
      if (!ada.pertama || m.tanggal < ada.pertama) ada.pertama = m.tanggal;
    } else {
      baris.set(k, { itemId: m.itemId, variantSku: m.variantSku ?? "", masuk: m.qty, pertama: m.tanggal });
    }
  }

  type PerBarang = { keluar: number; laku30: number; laku60: number; terakhir: Date | null };
  const perBarang = new Map<string, PerBarang>();
  const ambil = (itemId: string) => {
    let p = perBarang.get(itemId);
    if (!p) perBarang.set(itemId, (p = { keluar: 0, laku30: 0, laku60: 0, terakhir: null }));
    return p;
  };
  for (const t of input.terjual) {
    if (t.qty <= 0) continue;
    const p = ambil(t.itemId);
    p.keluar += t.qty;
    const w = t.tanggal.getTime();
    if (w >= batas30) p.laku30 += t.qty;
    if (w >= batas60) p.laku60 += t.qty;
    if (!p.terakhir || t.tanggal > p.terakhir) p.terakhir = t.tanggal;
  }
  for (const r of input.retur) if (r.qty > 0) ambil(r.itemId).keluar += r.qty;
  const keluarPerUkuran = new Map<string, number>();
  for (const k of input.keluarUkuran ?? []) {
    if (!(k.qty > 0)) continue;
    const kunci = kunciStok(k.itemId, k.variantSku);
    if (baris.has(kunci)) keluarPerUkuran.set(kunci, (keluarPerUkuran.get(kunci) ?? 0) + k.qty);
    else ambil(k.itemId).keluar += k.qty;
  }

  // Barang yang terjual/diretur tanpa pernah tercatat dikirim tetap muncul
  // (sisa negatif) — pertanyaan yang harus terlihat, bukan disembunyikan.
  const dikirim = new Set([...baris.values()].map((b) => b.itemId));
  for (const itemId of perBarang.keys()) {
    if (!dikirim.has(itemId)) {
      baris.set(kunciStok(itemId, ""), { itemId, variantSku: "", masuk: 0, pertama: null });
    }
  }

  const hasil: BarisStokMentah[] = [];
  const perItem = new Map<string, { itemId: string; variantSku: string; masuk: number; pertama: Date | null }[]>();
  for (const b of baris.values()) {
    const d = perItem.get(b.itemId);
    if (d) d.push(b);
    else perItem.set(b.itemId, [b]);
  }
  for (const [itemId, daftar] of perItem) {
    const p = perBarang.get(itemId) ?? { keluar: 0, laku30: 0, laku60: 0, terakhir: null };
    const bobot = daftar.map((d) => d.masuk);
    const keluar = bagiSebanding(p.keluar, bobot);
    const laku30 = bagiSebanding(p.laku30, bobot);
    const laku60 = bagiSebanding(p.laku60, bobot);
    daftar.forEach((d, i) => {
      hasil.push({
        itemId,
        variantSku: d.variantSku,
        qty: d.masuk - keluar[i] - (keluarPerUkuran.get(kunciStok(itemId, d.variantSku)) ?? 0),
        soldLast30: laku30[i],
        soldLast60: laku60[i],
        lastSaleAt: p.terakhir,
        firstInAt: d.pertama,
        perkiraan: daftar.length > 1 && p.keluar > 0,
      });
    });
  }
  return hasil;
}

/** Label ukuran singkat untuk layar: "Hitam · M", jatuh ke rincian lengkap atau SKU-nya. */
export function labelVarian(variants: unknown, variantSku: string): string | null {
  if (!variantSku) return null;
  const row = parseItemVariants(variants).find((v) => (v.sku ?? "").trim() === variantSku.trim());
  const ringkas = row
    ? [row.color, row.size, row.name]
        .map((x) => (x != null ? String(x).trim() : ""))
        .filter(Boolean)
        .join(" · ")
    : "";
  return ringkas || variantDetailForSku(variants, variantSku) || variantSku;
}

// ---------------------------------------------------------------------------
// Pemuat basis data
// ---------------------------------------------------------------------------

type InfoBarang = { id: string; sku: string; nameId: string; variants: unknown };

async function muatBarang(itemIds: string[]): Promise<Map<string, InfoBarang>> {
  if (itemIds.length === 0) return new Map();
  const items = await prisma.item.findMany({
    where: { id: { in: itemIds } },
    select: { id: true, sku: true, nameId: true, variants: true },
  });
  return new Map(items.map((i) => [i.id, i]));
}

function beriNama(b: BarisStokMentah, source: SumberStokToko, barang: Map<string, InfoBarang>): BarisStokDiToko {
  const i = barang.get(b.itemId);
  return {
    ...b,
    source,
    sku: b.variantSku || i?.sku || "",
    nama: i?.nameId ?? b.itemId,
    varian: i ? labelVarian(i.variants, b.variantSku) : b.variantSku || null,
  };
}

/** Stok beberapa toko sekaligus — kueri dikelompokkan, bukan satu putaran per toko. */
export async function muatStokDiToko(storeIds: string[], sekarang = new Date()): Promise<Map<string, StokDiToko>> {
  const hasil = new Map<string, StokDiToko>();
  if (storeIds.length === 0) return hasil;
  const batas30 = new Date(sekarang.getTime() - 30 * HARI_MS);
  const batas60 = new Date(sekarang.getTime() - 60 * HARI_MS);

  const saldo = await prisma.storeStockMovement.groupBy({
    by: ["storeId", "itemId", "variantSku"],
    where: { storeId: { in: storeIds } },
    _sum: { qty: true },
    _min: { createdAt: true },
  });
  const berbuku = new Set(saldo.map((s) => s.storeId));
  const idBuku = storeIds.filter((id) => berbuku.has(id));
  const idTitipan = storeIds.filter((id) => !berbuku.has(id));

  const mentah = new Map<string, { source: SumberStokToko; baris: BarisStokMentah[] }>();

  if (idBuku.length > 0) {
    const jual = { storeId: { in: idBuku }, kind: "JUAL" as const };
    // Laku BERSIH (`gerakLakuBersih`): barang yang dikembalikan pembeli —
    // layak (RETUR_PEMBELI) maupun rusak (tanpa baris buku) — mengurangi angka
    // laku, supaya barang yang banyak kembali tidak terbaca cepat laku.
    // Tanggal terakhir laku tetap dari penjualan saja.
    const [terakhir, j30, j60] = await Promise.all([
      prisma.storeStockMovement.groupBy({ by: ["storeId", "itemId", "variantSku"], where: jual, _max: { createdAt: true } }),
      jumlahLakuBersihSejak(idBuku, batas30),
      jumlahLakuBersihSejak(idBuku, batas60),
    ]);
    const keBaris = (peta: Map<string, number> | undefined) =>
      [...(peta ?? new Map<string, number>())].map(([k, qty]) => {
        const i = k.indexOf("::");
        return { itemId: k.slice(0, i), variantSku: k.slice(i + 2), qty };
      });
    for (const id of idBuku) {
      mentah.set(id, {
        source: "BUKU_TOKO",
        baris: gabungBukuToko({
          saldo: saldo.filter((s) => s.storeId === id).map((s) => ({ itemId: s.itemId, variantSku: s.variantSku, qty: s._sum.qty ?? 0, pertama: s._min.createdAt })),
          jualTerakhir: terakhir.filter((s) => s.storeId === id).map((s) => ({ itemId: s.itemId, variantSku: s.variantSku, terakhir: s._max.createdAt })),
          jual30: keBaris(j30.get(id)),
          jual60: keBaris(j60.get(id)),
        }),
      });
    }
  }

  if (idTitipan.length > 0) {
    const [pesanan, kiriman, terjual, retur, mutasi, rusakDihapus, hilang] = await Promise.all([
      // Pesanan konsinyasi yang disetujui = barang berpindah ke toko (transfer
      // dicatat saat disetujui, konsinyasi tidak punya pengiriman terpisah). Di
      // titik yang sama stok gudang utama dipotong (KONSI_TRANSFER) — toko ini
      // gudang lain, jadi setiap potong ada di SATU tempat saja.
      prisma.fieldSalesOrderLine.findMany({
        where: { order: { storeId: { in: idTitipan }, orderType: "KONSI", status: "APPROVED" } },
        select: { itemId: true, variantSku: true, qty: true, cancelledQty: true, order: { select: { storeId: true, approvedAt: true, createdAt: true } } },
      }),
      // Kiriman modul konsinyasi. Baris yang diketik nama saja (tanpa itemId)
      // tidak bisa dicocokkan ke barang mana pun — dilewati, sama dengan buku toko
      // (dan sama dengan gudang: baris itu juga tidak pernah memotong stok gudang).
      // Varian ada sejak kiriman memotong gudang per varian; kiriman lama tanpa
      // varian tetap per barang.
      prisma.consignmentShipmentItem.findMany({
        where: { itemId: { not: null }, shipment: { storeId: { in: idTitipan } } },
        select: { itemId: true, variantSku: true, qty: true, shipment: { select: { storeId: true, shippedAt: true } } },
      }),
      prisma.consignmentSold.findMany({
        where: { itemId: { not: null }, cycle: { storeId: { in: idTitipan } } },
        select: { itemId: true, qty: true, cycle: { select: { storeId: true, periodYear: true, periodMonth: true } } },
      }),
      // Hanya NRI yang sudah FINAL: NRI DRAFT belum melepas apa pun.
      prisma.warehouseReturnItem.findMany({
        where: { itemId: { not: null }, warehouseReturn: { storeId: { in: idTitipan }, status: "FINAL" } },
        select: { itemId: true, qty: true, warehouseReturn: { select: { storeId: true } } },
      }),
      // Mutasi antar toko yang sudah diterima di toko ini (biasanya oleh kantor,
      // karena toko tanpa buku tidak punya SPG yang mencatat): jumlah DITERIMA.
      prisma.storeReceiptLine.findMany({
        where: { itemId: { not: null }, qtyReceived: { gt: 0 }, receipt: { storeId: { in: idTitipan }, sourceType: { in: ["MUTASI", "MUTASI_KEMBALI"] } } },
        select: { itemId: true, variantSku: true, qtyReceived: true, receipt: { select: { storeId: true, receivedAt: true } } },
      }),
      // Barang rusak kiriman yang gudang putuskan DIHAPUSKAN (klaim ekspedisi /
      // dihapus): tercatat masuk di atas, tapi tidak ada lagi di toko.
      // LAYAK_JUAL tetap di toko; KEMBALI_GUDANG keluar lewat NRI (retur).
      prisma.storeReceiptLine.findMany({
        where: { itemId: { not: null }, qtyDamaged: { gt: 0 }, damageStatus: "DIHAPUSKAN", receipt: { storeId: { in: idTitipan } } },
        select: { itemId: true, variantSku: true, qtyDamaged: true, receipt: { select: { storeId: true } } },
      }),
      // Barang hilang DI TOKO yang sudah diputuskan. Sumber kiriman/mutasi
      // sengaja tidak ikut: barang itu tidak pernah tiba, jadi tidak pernah
      // tercatat masuk di sini.
      prisma.stockLossLine.findMany({
        where: {
          itemId: { not: null },
          qty: { gt: 0 },
          loss: { storeId: { in: idTitipan }, status: { in: [...STATUS_HILANG_DIPUTUSKAN] }, source: { in: [...SUMBER_HILANG_DI_TOKO] } },
        },
        select: { itemId: true, variantSku: true, qty: true, loss: { select: { storeId: true } } },
      }),
    ]);
    for (const id of idTitipan) {
      mentah.set(id, {
        source: "TITIPAN",
        baris: hitungTitipan({
          masuk: [
            ...pesanan
              .filter((l) => l.order.storeId === id)
              .map((l) => ({
                itemId: l.itemId,
                variantSku: l.variantSku ?? "",
                qty: l.qty - l.cancelledQty,
                tanggal: l.order.approvedAt ?? l.order.createdAt,
              })),
            ...kiriman
              .filter((l) => l.shipment.storeId === id && l.itemId)
              .map((l) => ({ itemId: l.itemId as string, variantSku: l.variantSku ?? "", qty: l.qty, tanggal: l.shipment.shippedAt })),
            ...mutasi
              .filter((l) => l.receipt.storeId === id && l.itemId)
              .map((l) => ({ itemId: l.itemId as string, variantSku: l.variantSku ?? "", qty: l.qtyReceived, tanggal: l.receipt.receivedAt })),
          ],
          terjual: terjual
            .filter((s) => s.cycle.storeId === id && s.itemId)
            .map((s) => {
              const akhir = akhirBulanWib(s.cycle.periodYear, s.cycle.periodMonth);
              return { itemId: s.itemId as string, qty: s.qty, tanggal: akhir > sekarang ? sekarang : akhir };
            }),
          retur: retur
            .filter((r) => r.warehouseReturn.storeId === id && r.itemId)
            .map((r) => ({ itemId: r.itemId as string, qty: r.qty })),
          keluarUkuran: [
            ...rusakDihapus
              .filter((l) => l.receipt.storeId === id && l.itemId)
              .map((l) => ({ itemId: l.itemId as string, variantSku: l.variantSku ?? "", qty: l.qtyDamaged })),
            ...hilang
              .filter((l) => l.loss.storeId === id && l.itemId)
              .map((l) => ({ itemId: l.itemId as string, variantSku: l.variantSku ?? "", qty: l.qty })),
          ],
          sekarang,
        }),
      });
    }
  }

  const barang = await muatBarang([...new Set([...mentah.values()].flatMap((m) => m.baris.map((b) => b.itemId)))]);
  for (const id of storeIds) {
    const m = mentah.get(id) ?? { source: "TITIPAN" as const, baris: [] };
    hasil.set(id, {
      source: m.source,
      baris: m.baris
        .map((b) => beriNama(b, m.source, barang))
        .sort((a, b) => a.nama.localeCompare(b.nama) || a.sku.localeCompare(b.sku)),
    });
  }
  return hasil;
}

/** Stok satu toko — lihat catatan di kepala berkas tentang pilihan sumbernya. */
export async function stokDiToko(storeId: string, sekarang = new Date()): Promise<StokDiToko> {
  return (await muatStokDiToko([storeId], sekarang)).get(storeId) ?? { source: "TITIPAN", baris: [] };
}

// ---------------------------------------------------------------------------
// Penilaian lengkap: stok + target + gudang + dalam proses
// ---------------------------------------------------------------------------

export type BarisTokoDinilai = {
  itemId: string;
  variantSku: string;
  sku: string;
  nama: string;
  varian: string | null;
  qty: number;
  soldLast30: number;
  soldLast60: number;
  lastSaleAt: Date | null;
  perkiraan: boolean;
  target: { minQty: number; maxQty: number } | null;
  dalamProses: number;
  tersediaGudang: number;
  tanda: TandaStok[];
  saranQty: number;
  kurangGudang: boolean;
};

export type PenilaianToko = {
  source: SumberStokToko;
  baris: BarisTokoDinilai[];
  ringkas: RingkasanStok;
};

/**
 * Stok gudang yang boleh dikirim per barang × ukuran: qtyOnHand − reservedQty.
 *
 * Baris `null` dan `""` untuk barang yang sama dinilai dengan yang TERKECIL,
 * seperti `listKonsiSuggestions`: penulis pesanan memesan terhadap satu baris
 * saja, jadi menjumlahkan keduanya menawarkan lebih dari yang bisa dipenuhi.
 */
async function muatTersediaGudang(itemIds: string[]): Promise<Map<string, number>> {
  const peta = new Map<string, number>();
  if (itemIds.length === 0) return peta;
  const rows = await prisma.inventoryValue.findMany({
    where: { itemId: { in: itemIds } },
    select: { itemId: true, variantSku: true, qtyOnHand: true, reservedQty: true },
  });
  for (const r of rows) {
    const k = kunciStok(r.itemId, r.variantSku);
    const ada = Number(r.qtyOnHand) - Number(r.reservedQty);
    peta.set(k, peta.has(k) ? Math.min(peta.get(k) as number, ada) : ada);
  }
  return peta;
}

/**
 * Barang yang sedang menuju toko, per toko: supaya isi ulang tidak memesan
 * barang yang sama dua kali.
 *
 * - Pesanan yang MENUNGGU persetujuan (semua jenis).
 * - Pesanan PUTUS yang disetujui tapi belum terkirim semua (sisa terbuka).
 * - Toko berbuku saja: kiriman yang sudah jalan tapi belum diterima SPG
 *   (termasuk pesanan konsinyasi yang disetujui). Untuk toko TITIPAN, pesanan
 *   konsinyasi yang disetujui SUDAH dihitung sebagai stok di toko.
 */
async function muatDalamProses(
  storeIds: string[],
  sumber: Map<string, SumberStokToko>,
  sekarang: Date,
): Promise<Map<string, Map<string, number>>> {
  const hasil = new Map<string, Map<string, number>>(storeIds.map((id) => [id, new Map()]));
  const tambah = (storeId: string, itemId: string, variantSku: string | null, qty: number) => {
    if (qty <= 0) return;
    const p = hasil.get(storeId);
    if (!p) return;
    const k = kunciStok(itemId, variantSku);
    p.set(k, (p.get(k) ?? 0) + qty);
  };

  const lines = await prisma.fieldSalesOrderLine.findMany({
    where: {
      order: {
        storeId: { in: storeIds },
        OR: [{ status: "PENDING_APPROVAL" }, { status: "APPROVED", orderType: "PUTUS" }],
      },
    },
    select: { itemId: true, variantSku: true, qty: true, deliveredQty: true, cancelledQty: true, order: { select: { storeId: true, status: true } } },
  });
  for (const l of lines) {
    const sisa = l.order.status === "PENDING_APPROVAL" ? l.qty - l.cancelledQty : l.qty - l.deliveredQty - l.cancelledQty;
    tambah(l.order.storeId, l.itemId, l.variantSku, sisa);
  }

  const berbuku = storeIds.filter((id) => sumber.get(id) === "BUKU_TOKO");
  const menunggu = await Promise.all(berbuku.map((id) => kirimanMenunggu(id, sekarang)));
  berbuku.forEach((id, i) => {
    for (const k of menunggu[i]) for (const l of k.lines) if (l.itemId) tambah(id, l.itemId, l.variantSku, l.qty);
  });
  return hasil;
}

/** Stok, target, gudang dan isi ulang untuk beberapa toko sekaligus. */
export async function nilaiStokToko(storeIds: string[], sekarang = new Date()): Promise<Map<string, PenilaianToko>> {
  const hasil = new Map<string, PenilaianToko>();
  if (storeIds.length === 0) return hasil;

  const [stok, target] = await Promise.all([
    muatStokDiToko(storeIds, sekarang),
    prisma.storeStockTarget.findMany({
      where: { storeId: { in: storeIds } },
      select: { storeId: true, itemId: true, variantSku: true, minQty: true, maxQty: true },
    }),
  ]);
  const sumber = new Map([...stok].map(([id, s]) => [id, s.source]));
  const semuaItem = [...new Set([...[...stok.values()].flatMap((s) => s.baris.map((b) => b.itemId)), ...target.map((t) => t.itemId)])];
  const [gudang, dalamProses, barang] = await Promise.all([
    muatTersediaGudang(semuaItem),
    muatDalamProses(storeIds, sumber, sekarang),
    // Nama untuk barang yang hanya punya target (belum pernah ada di toko).
    muatBarang(target.map((t) => t.itemId)),
  ]);

  for (const id of storeIds) {
    const s = stok.get(id) ?? { source: "TITIPAN" as const, baris: [] };
    const n = nilaiIsiUlang({
      stok: s.baris,
      target: target.filter((t) => t.storeId === id),
      tersediaGudang: gudang,
      dalamProses: dalamProses.get(id),
      sekarang,
    });
    const baris: BarisTokoDinilai[] = n.baris
      .map((b) => {
        const st = b.stok;
        const nama = st ?? beriNama(
          { itemId: b.itemId, variantSku: b.variantSku, qty: 0, soldLast30: 0, soldLast60: 0, lastSaleAt: null, firstInAt: null, perkiraan: false },
          s.source,
          barang,
        );
        return {
          itemId: b.itemId,
          variantSku: b.variantSku,
          sku: nama.sku,
          nama: nama.nama,
          varian: nama.varian,
          qty: b.qty,
          soldLast30: st?.soldLast30 ?? 0,
          soldLast60: st?.soldLast60 ?? 0,
          lastSaleAt: st?.lastSaleAt ?? null,
          perkiraan: st?.perkiraan ?? false,
          target: b.target,
          dalamProses: b.dalamProses,
          tersediaGudang: b.tersediaGudang,
          tanda: b.tanda,
          saranQty: b.saranQty,
          kurangGudang: b.kurangGudang,
        };
      })
      .sort((a, b) => a.nama.localeCompare(b.nama) || a.sku.localeCompare(b.sku));
    const urut = urutkanPenilaian(baris);
    hasil.set(id, { source: s.source, baris: urut, ringkas: ringkasPenilaian(urut) });
  }
  return hasil;
}

// ---------------------------------------------------------------------------
// Kartu HP salesman
// ---------------------------------------------------------------------------

/**
 * Bentuk kartu "Stok di toko ini" di HP salesman — hanya jumlah, TIDAK PERNAH
 * harga atau nilai (konsinyasi tidak menunjukkan harga ke salesman). Tanggal
 * sudah diformat di server supaya Node dan Safari tidak berbeda.
 */
export type KartuStokDiToko = {
  source: SumberStokToko;
  ringkas: RingkasanStok;
  adaPerkiraan: boolean;
  baris: {
    kunci: string;
    itemId: string;
    variantSku: string;
    nama: string;
    varian: string | null;
    sku: string;
    qty: number;
    soldLast30: number;
    /** Sudah diformat; null kalau belum pernah laku. */
    terakhirLaku: string | null;
    perkiraan: boolean;
    target: { minQty: number; maxQty: number } | null;
    dalamProses: number;
    tersediaGudang: number;
    tanda: TandaStok[];
    saranQty: number;
    kurangGudang: boolean;
  }[];
};

export async function kartuStokDiToko(storeId: string, sekarang = new Date(), locale = "id-ID"): Promise<KartuStokDiToko> {
  const n = (await nilaiStokToko([storeId], sekarang)).get(storeId);
  if (!n) return { source: "TITIPAN", ringkas: ringkasPenilaian([]), adaPerkiraan: false, baris: [] };
  // Barang yang sudah lama habis tanpa tanda, target, maupun saran adalah
  // sejarah — tidak ada yang perlu dilakukan salesman terhadapnya.
  const relevan = n.baris.filter((b) => b.qty !== 0 || b.tanda.length > 0 || b.target !== null || b.saranQty > 0);
  return {
    source: n.source,
    ringkas: n.ringkas,
    adaPerkiraan: relevan.some((b) => b.perkiraan),
    baris: relevan.map((b) => ({
      kunci: kunciStok(b.itemId, b.variantSku),
      itemId: b.itemId,
      variantSku: b.variantSku,
      nama: b.nama,
      varian: b.varian,
      sku: b.sku,
      qty: b.qty,
      soldLast30: b.soldLast30,
      terakhirLaku: b.lastSaleAt ? formatDisplayDate(b.lastSaleAt, locale) : null,
      perkiraan: b.perkiraan,
      target: b.target,
      dalamProses: b.dalamProses,
      tersediaGudang: b.tersediaGudang,
      tanda: b.tanda,
      saranQty: b.saranQty,
      kurangGudang: b.kurangGudang,
    })),
  };
}
