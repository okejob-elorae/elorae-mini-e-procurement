import { prisma, type Prisma } from "@elorae/db";
import { sisaKirimBalik, type StatusRusak } from "./rusak";

/**
 * Bacaan barang rusak dari kiriman ke toko SPG — layar kantor, layar terima
 * di HP, dan formulir nota retur yang diisi dari baris rusak.
 *
 * Hanya untuk server (menarik Prisma). Komponen klien hanya boleh
 * `import type` dari sini; nilai yang aman ada di `rusak.ts`.
 */

type Klien = Prisma.TransactionClient | typeof prisma;

const HARI_MS = 86_400_000;
/** Keputusan yang sudah selesai tetap terlihat di HP selama ini. */
export const HARI_RIWAYAT_HP = 30;
/** Riwayat keputusan di layar kantor. */
export const BATAS_RIWAYAT_KANTOR = 100;

/**
 * Barang rusak yang sudah dikirim balik per baris tanda terima: jumlah baris
 * nota retur yang menunjuknya, dari nota yang TIDAK batal, beserta nomornya.
 */
export async function dikembalikanPerBaris(klien: Klien, lineIds: string[]): Promise<Map<string, { qty: number; nota: string[] }>> {
  const hasil = new Map<string, { qty: number; nota: string[] }>();
  const ids = [...new Set(lineIds.filter(Boolean))];
  if (ids.length === 0) return hasil;
  const rows = await klien.storeReturnItem.findMany({
    where: { storeReceiptLineId: { in: ids }, storeReturn: { status: { not: "BATAL" } } },
    select: { storeReceiptLineId: true, qty: true, storeReturn: { select: { noNrt: true } } },
  });
  for (const r of rows) {
    const k = r.storeReceiptLineId as string;
    const x = hasil.get(k) ?? { qty: 0, nota: [] };
    x.qty += r.qty;
    if (!x.nota.includes(r.storeReturn.noNrt)) x.nota.push(r.storeReturn.noNrt);
    hasil.set(k, x);
  }
  return hasil;
}

const PILIH_BARIS = {
  id: true,
  itemId: true,
  variantSku: true,
  productName: true,
  qtyReceived: true,
  qtyDamaged: true,
  damageNote: true,
  damagePhotoUrl: true,
  damageStatus: true,
  damageDecidedById: true,
  damageDecidedAt: true,
  damageDecisionNote: true,
  receipt: {
    select: {
      id: true,
      storeId: true,
      sourceType: true,
      sourceDocNo: true,
      receivedById: true,
      receivedAt: true,
      store: { select: { name: true } },
    },
  },
} satisfies Prisma.StoreReceiptLineSelect;

type BarisMentah = Prisma.StoreReceiptLineGetPayload<{ select: typeof PILIH_BARIS }>;

export type BarisRusakKantor = {
  id: string;
  receiptId: string;
  storeId: string;
  toko: string;
  sourceType: string;
  docNo: string;
  diterimaPada: Date;
  penerima: string;
  itemId: string | null;
  productName: string;
  variantSku: string;
  qtyReceived: number;
  qty: number;
  keterangan: string | null;
  fotoUrl: string | null;
  status: StatusRusak;
  diputuskanOleh: string | null;
  diputuskanPada: Date | null;
  catatanKeputusan: string | null;
  /** KEMBALI_GUDANG: yang sudah dikirim balik lewat nota retur hidup. */
  dikembalikan: number;
  notaRetur: string[];
};

async function namaPengguna(ids: (string | null)[]): Promise<Map<string, string>> {
  const unik = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (unik.length === 0) return new Map();
  const rows = await prisma.user.findMany({ where: { id: { in: unik } }, select: { id: true, name: true, email: true } });
  return new Map(rows.map((u) => [u.id, u.name ?? u.email]));
}

async function bentukKantor(rows: BarisMentah[]): Promise<BarisRusakKantor[]> {
  const [nama, kembali] = await Promise.all([
    namaPengguna(rows.flatMap((r) => [r.receipt.receivedById, r.damageDecidedById])),
    dikembalikanPerBaris(
      prisma,
      rows.filter((r) => r.damageStatus === "KEMBALI_GUDANG").map((r) => r.id),
    ),
  ]);
  return rows.map((r) => ({
    id: r.id,
    receiptId: r.receipt.id,
    storeId: r.receipt.storeId,
    toko: r.receipt.store.name,
    sourceType: r.receipt.sourceType,
    docNo: r.receipt.sourceDocNo,
    diterimaPada: r.receipt.receivedAt,
    penerima: nama.get(r.receipt.receivedById) ?? "—",
    itemId: r.itemId,
    productName: r.productName,
    variantSku: r.variantSku,
    qtyReceived: r.qtyReceived,
    qty: r.qtyDamaged,
    keterangan: r.damageNote,
    fotoUrl: r.damagePhotoUrl,
    status: (r.damageStatus ?? "TERBUKA") as StatusRusak,
    diputuskanOleh: r.damageDecidedById ? (nama.get(r.damageDecidedById) ?? "—") : null,
    diputuskanPada: r.damageDecidedAt,
    catatanKeputusan: r.damageDecisionNote,
    dikembalikan: kembali.get(r.id)?.qty ?? 0,
    notaRetur: kembali.get(r.id)?.nota ?? [],
  }));
}

/** Layar kantor: yang masih terbuka (terlama dulu) + riwayat keputusan terbaru. */
export async function daftarRusakKantor(): Promise<{ terbuka: BarisRusakKantor[]; riwayat: BarisRusakKantor[] }> {
  const [terbuka, riwayat] = await Promise.all([
    prisma.storeReceiptLine.findMany({
      where: { qtyDamaged: { gt: 0 }, damageStatus: "TERBUKA" },
      orderBy: [{ receipt: { receivedAt: "asc" } }, { productName: "asc" }],
      select: PILIH_BARIS,
    }),
    prisma.storeReceiptLine.findMany({
      where: { qtyDamaged: { gt: 0 }, damageStatus: { in: ["LAYAK_JUAL", "KEMBALI_GUDANG", "DIHAPUSKAN"] } },
      orderBy: [{ damageDecidedAt: "desc" }, { id: "asc" }],
      take: BATAS_RIWAYAT_KANTOR,
      select: PILIH_BARIS,
    }),
  ]);
  const [a, b] = await Promise.all([bentukKantor(terbuka), bentukKantor(riwayat)]);
  return { terbuka: a, riwayat: b };
}

export type BarisRusakHp = {
  id: string;
  sourceType: string;
  docNo: string;
  diterimaPada: Date;
  itemId: string | null;
  productName: string;
  variantSku: string;
  qty: number;
  keterangan: string | null;
  status: StatusRusak;
  diputuskanPada: Date | null;
  catatanKeputusan: string | null;
  /** KEMBALI_GUDANG: yang masih harus dikirim balik. */
  sisa: number;
  notaRetur: string[];
};

/**
 * Barang rusak toko ini untuk HP SPG: yang menunggu keputusan, yang masih
 * harus dikirim balik (berapa pun umurnya), dan keputusan 30 hari terakhir.
 * Tanpa harga — layar SPG tidak pernah membawa rupiah barang konsinyasi.
 */
export async function rusakUntukSpg(storeId: string, sekarang = new Date()): Promise<BarisRusakHp[]> {
  const sejak = new Date(sekarang.getTime() - HARI_RIWAYAT_HP * HARI_MS);
  const rows = await prisma.storeReceiptLine.findMany({
    where: {
      qtyDamaged: { gt: 0 },
      receipt: { storeId },
      OR: [{ damageStatus: "TERBUKA" }, { damageStatus: "KEMBALI_GUDANG" }, { damageDecidedAt: { gte: sejak } }],
    },
    orderBy: [{ receipt: { receivedAt: "desc" } }, { productName: "asc" }],
    select: PILIH_BARIS,
  });
  const kembali = await dikembalikanPerBaris(
    prisma,
    rows.filter((r) => r.damageStatus === "KEMBALI_GUDANG").map((r) => r.id),
  );
  return rows
    .map((r) => {
      const k = kembali.get(r.id);
      return {
        id: r.id,
        sourceType: r.receipt.sourceType,
        docNo: r.receipt.sourceDocNo,
        diterimaPada: r.receipt.receivedAt,
        itemId: r.itemId,
        productName: r.productName,
        variantSku: r.variantSku,
        qty: r.qtyDamaged,
        keterangan: r.damageNote,
        status: (r.damageStatus ?? "TERBUKA") as StatusRusak,
        diputuskanPada: r.damageDecidedAt,
        catatanKeputusan: r.damageDecisionNote,
        sisa: r.damageStatus === "KEMBALI_GUDANG" ? sisaKirimBalik(r.qtyDamaged, k?.qty ?? 0) : 0,
        notaRetur: k?.nota ?? [],
      };
    })
    .filter(
      // Kirim-balik yang sudah tuntas (atau bukan barang katalog — dikembalikan
      // lewat salesman/kantor, bukan lewat nota SPG) dan sudah lama tidak perlu dibawa terus.
      (r) =>
        !(
          r.status === "KEMBALI_GUDANG" &&
          (r.sisa === 0 || r.itemId === null) &&
          (r.diputuskanPada?.getTime() ?? 0) < sejak.getTime()
        ),
    );
}

export type BarisRusakRetur = {
  receiptLineId: string;
  itemId: string;
  variantSku: string;
  productName: string;
  docNo: string;
  sisa: number;
};

/**
 * Baris rusak yang boleh mengisi nota retur SPG (`/pwa/retur/baru?dariRusak=`):
 * milik toko ini, diputuskan KEMBALI_GUDANG, barang katalog, dan masih bersisa.
 * Penulis nota retur memeriksa ulang semuanya di dalam transaksinya.
 */
export async function barisRusakUntukRetur(storeId: string, ids: string[]): Promise<BarisRusakRetur[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.storeReceiptLine.findMany({
    where: { id: { in: ids }, receipt: { storeId }, damageStatus: "KEMBALI_GUDANG", itemId: { not: null }, qtyDamaged: { gt: 0 } },
    orderBy: { productName: "asc" },
    select: { id: true, itemId: true, variantSku: true, productName: true, qtyDamaged: true, receipt: { select: { sourceDocNo: true } } },
  });
  const kembali = await dikembalikanPerBaris(
    prisma,
    rows.map((r) => r.id),
  );
  return rows
    .map((r) => ({
      receiptLineId: r.id,
      itemId: r.itemId as string,
      variantSku: r.variantSku,
      productName: r.productName,
      docNo: r.receipt.sourceDocNo,
      sisa: sisaKirimBalik(r.qtyDamaged, kembali.get(r.id)?.qty ?? 0),
    }))
    .filter((r) => r.sisa > 0);
}
