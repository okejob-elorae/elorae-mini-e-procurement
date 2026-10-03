import { Prisma, prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { kabariTitipanTersedia } from "./titip-tersedia";
import { catatJejak, JEJAK } from "@/lib/receivables/jejak";

/**
 * Barang kembali dari pembeli di counter SPG (`SpgSaleReturn`).
 *
 * Uangnya dikembalikan KASIR TOKO, jadi tidak ada satu angka uang pun yang
 * dicatat di sini — hanya barang, jumlah, kondisi, dan alasannya. Yang bergerak:
 *
 * - `SpgSaleLine.returnedQty` naik; satu baris nota tidak bisa dikembalikan
 *   melebihi yang terjual (`qty − returnedQty`), dijaga di dalam `runSerializable`
 *   supaya dua HP yang mengembalikan baris yang sama bersamaan tidak sama-sama
 *   lolos.
 * - Buku stok toko: `RETUR_PEMBELI` +qty, HANYA untuk barang LAYAK — itulah yang
 *   kembali ke rak. Barang rusak tercatat di dokumennya, tidak di rak.
 * - `SalesHistory` nota itu: `returnedQuantity` naik, `netQuantity` turun, untuk
 *   setiap kondisi — barang yang kembali tidak terjual, rusak atau tidak.
 * - Jejak (`AuditLog`) di transaksi yang sama.
 *
 * Toko ditetapkan pemanggil dari `User.assignedStoreId`, tidak pernah dari HP;
 * hanya nota milik SPG itu sendiri di toko itu yang bisa diretur.
 */

export type KondisiRetur = "LAYAK" | "RUSAK" | "EXPIRED";
const KONDISI: readonly KondisiRetur[] = ["LAYAK", "RUSAK", "EXPIRED"];

export type BarisReturPembeli = { saleLineId: string; qty: number; condition?: KondisiRetur };

export type AlasanTolakReturPembeli =
  | "TANPA_BARIS"
  | "ALASAN_WAJIB"
  | "JUMLAH_TIDAK_VALID"
  | "NOTA_TIDAK_DITEMUKAN"
  | "BARIS_TIDAK_DITEMUKAN"
  | "MELEBIHI_SISA"
  | "KUNCI_DIPAKAI"
  | "KUNCI_WAJIB";

export type HasilReturPembeli = { ok: true; returnId: string } | { ok: false; alasan: AlasanTolakReturPembeli };

/** Gabungkan per baris nota + kondisi; tolak qty yang bukan bilangan bulat positif. */
export function rapikanBarisReturPembeli(
  baris: BarisReturPembeli[],
): { ok: true; baris: (BarisReturPembeli & { condition: KondisiRetur })[] } | { ok: false; alasan: "TANPA_BARIS" | "JUMLAH_TIDAK_VALID" } {
  const peta = new Map<string, BarisReturPembeli & { condition: KondisiRetur }>();
  for (const b of baris) {
    if (!b.saleLineId) continue;
    if (!Number.isInteger(b.qty) || b.qty < 0) return { ok: false, alasan: "JUMLAH_TIDAK_VALID" };
    if (b.qty === 0) continue;
    const condition = KONDISI.includes(b.condition as KondisiRetur) ? (b.condition as KondisiRetur) : "LAYAK";
    const k = `${b.saleLineId}::${condition}`;
    const ada = peta.get(k);
    if (ada) ada.qty += b.qty;
    else peta.set(k, { saleLineId: b.saleLineId, qty: b.qty, condition });
  }
  if (peta.size === 0) return { ok: false, alasan: "TANPA_BARIS" };
  return { ok: true, baris: [...peta.values()] };
}

export type InputReturPembeli = {
  spgSaleId: string;
  /** Toko tetap SPG — dari server. */
  storeId: string;
  /** SPG yang mencatat; hanya notanya sendiri. */
  userId: string;
  baris: BarisReturPembeli[];
  alasan: string;
  idempotencyKey: string;
  /**
   * Retur yang dicatat TANPA sinyal: jam ia dilakukan di HP (sudah dijepit
   * pemanggil). Dokumen dan baris bukunya bertanggal jam itu, dan barang yang
   * sudah dihitung opname toko SESUDAH jam itu tidak ditambahkan lagi ke buku —
   * opname itu sudah melihatnya di rak (aturan yang sama dengan nota tanpa sinyal).
   */
  waktuTangkap?: Date | null;
};

export async function catatReturPembeli(input: InputReturPembeli): Promise<HasilReturPembeli> {
  const kunci = input.idempotencyKey?.trim();
  if (!kunci) return { ok: false, alasan: "KUNCI_WAJIB" };

  let hasil: HasilReturPembeli;
  try {
    hasil = await simpan(input, kunci);
  } catch (err) {
    // Kiriman kembar yang tiba bersamaan: yang kalah menemukan milik pemenang.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") hasil = await simpan(input, kunci);
    else throw err;
  }
  // Barang LAYAK yang kembali ke rak bisa jadi yang sedang dititip-pesankan pembeli lain.
  if (hasil.ok) void kabariTitipanTersedia(input.storeId);
  return hasil;
}

function simpan(input: InputReturPembeli, kunci: string): Promise<HasilReturPembeli> {
  return runSerializable((tx) => catatReturPembeliTx(tx, input, kunci));
}

/**
 * Badan transaksi `catatReturPembeli`. Pemanggil WAJIB menjalankannya di dalam
 * `runSerializable`; `kunci` sudah dirapikan pemanggil. Kait sesudah transaksi
 * (`kabariTitipanTersedia`) tetap urusan pemanggil.
 *
 * Tukar ukuran TIDAK dilayani di konter (keputusan pemilik 2026-10-03): SPG
 * tidak menerima barang kembali dari pembeli untuk ditukar ukuran, jadi tidak
 * ada nota pengganti yang ditautkan ke retur ini.
 */
export async function catatReturPembeliTx(tx: Prisma.TransactionClient, input: InputReturPembeli, kunci: string): Promise<HasilReturPembeli> {
  // Kiriman ulang dikenali PALING DULU — sebelum memeriksa sisa, karena
  // kiriman pertamanya sendiri sudah memakai sisa itu.
  const ada = await tx.spgSaleReturn.findUnique({
    where: { idempotencyKey: kunci },
    select: { id: true, createdById: true },
  });
  if (ada) return ada.createdById === input.userId ? { ok: true, returnId: ada.id } : { ok: false, alasan: "KUNCI_DIPAKAI" };

  const alasan = input.alasan?.trim();
  if (!alasan) return { ok: false, alasan: "ALASAN_WAJIB" };
  const rapi = rapikanBarisReturPembeli(input.baris);
  if (!rapi.ok) return rapi;

  const nota = await tx.spgSale.findFirst({
    where: { id: input.spgSaleId, salesmanId: input.userId, storeId: input.storeId },
    select: {
      id: true,
      docNo: true,
      createdAt: true,
      lines: {
        select: {
          id: true,
          itemId: true,
          variantSku: true,
          productName: true,
          qty: true,
          returnedQty: true,
          item: { select: { sku: true } },
        },
      },
    },
  });
  if (!nota) return { ok: false, alasan: "NOTA_TIDAK_DITEMUKAN" };
  const perId = new Map(nota.lines.map((l) => [l.id, l]));
  if (rapi.baris.some((b) => !perId.has(b.saleLineId))) return { ok: false, alasan: "BARIS_TIDAK_DITEMUKAN" };

  const mintaPerBaris = new Map<string, number>();
  for (const b of rapi.baris) mintaPerBaris.set(b.saleLineId, (mintaPerBaris.get(b.saleLineId) ?? 0) + b.qty);
  for (const [id, minta] of mintaPerBaris) {
    const l = perId.get(id)!;
    if (minta > l.qty - l.returnedQty) return { ok: false, alasan: "MELEBIHI_SISA" };
  }

  // Penjaga keadaan: naik hanya dari angka yang baru dibaca. Di dalam
  // serializable, penulis kedua yang bersamaan ditolak basis data dan
  // diulang — bacaan ulangnya melihat sisa yang sudah berkurang.
  for (const [id, minta] of mintaPerBaris) {
    const l = perId.get(id)!;
    const ubah = await tx.spgSaleLine.updateMany({
      where: { id, returnedQty: l.returnedQty },
      data: { returnedQty: { increment: minta } },
    });
    if (ubah.count !== 1) throw new Prisma.PrismaClientKnownRequestError("returnedQty berubah", { code: "P2034", clientVersion: "retur-pembeli" });
  }

  // Retur tidak pernah mendahului notanya sendiri, walau jam HP salah.
  const waktu = input.waktuTangkap ? new Date(Math.max(input.waktuTangkap.getTime(), nota.createdAt.getTime())) : null;

  const retur = await tx.spgSaleReturn.create({
    data: {
      ...(waktu ? { createdAt: waktu } : {}),
      spgSaleId: nota.id,
      storeId: input.storeId,
      createdById: input.userId,
      reason: alasan,
      idempotencyKey: kunci,
      lines: {
        create: rapi.baris.map((b) => {
          const l = perId.get(b.saleLineId)!;
          return { spgSaleLineId: l.id, itemId: l.itemId, variantSku: l.variantSku, qty: b.qty, condition: b.condition };
        }),
      },
    },
    select: { id: true },
  });

  let kembaliKeRak = rapi.baris.filter((b) => b.condition === "LAYAK");
  if (waktu && kembaliKeRak.length) {
    const itemIds = [...new Set(kembaliKeRak.map((b) => perId.get(b.saleLineId)!.itemId))];
    const terhitung = await tx.storeOpnameLine.findMany({
      where: { opname: { storeId: input.storeId, countedAt: { gt: waktu } }, itemId: { in: itemIds } },
      select: { itemId: true, variantSku: true },
    });
    const sudah = new Set(terhitung.map((l) => `${l.itemId}::${l.variantSku}`));
    kembaliKeRak = kembaliKeRak.filter((b) => {
      const l = perId.get(b.saleLineId)!;
      return !sudah.has(`${l.itemId}::${l.variantSku}`);
    });
  }
  if (kembaliKeRak.length) {
    await tx.storeStockMovement.createMany({
      data: kembaliKeRak.map((b) => {
        const l = perId.get(b.saleLineId)!;
        return {
          storeId: input.storeId,
          itemId: l.itemId,
          variantSku: l.variantSku,
          qty: b.qty,
          kind: "RETUR_PEMBELI" as const,
          refType: "SpgSaleReturn",
          refId: retur.id,
          createdById: input.userId,
          ...(waktu ? { createdAt: waktu } : {}),
        };
      }),
    });
  }

  // `SalesHistory` nota ini berkunci (OFFLINE, nomor nota, SKU varian — atau
  // SKU barang untuk barang tanpa varian), sama dengan cara `recordSpgSale`
  // menyusunnya. Baris yang tidak ditemukan tidak menggagalkan retur: dicatat
  // di jejak.
  let riwayatTakDitemukan = 0;
  for (const [id, minta] of mintaPerBaris) {
    const l = perId.get(id)!;
    const ubah = await tx.salesHistory.updateMany({
      where: { channel: "OFFLINE", orderId: nota.docNo, variantSku: l.variantSku || l.item.sku },
      data: { returnedQuantity: { increment: minta }, netQuantity: { decrement: minta } },
    });
    if (ubah.count === 0) riwayatTakDitemukan += 1;
  }

  await catatJejak(tx, {
    userId: input.userId,
    action: JEJAK.RETUR_PEMBELI_DICATAT,
    entityType: "SpgSaleReturn",
    entityId: retur.id,
    changes: {
      before: Object.fromEntries([...mintaPerBaris.keys()].map((id) => [id, { returnedQty: perId.get(id)!.returnedQty }])),
      after: Object.fromEntries(
        [...mintaPerBaris.entries()].map(([id, minta]) => [id, { returnedQty: perId.get(id)!.returnedQty + minta }]),
      ),
    },
    metadata: {
      spgSaleId: nota.id,
      docNo: nota.docNo,
      storeId: input.storeId,
      baris: rapi.baris.map((b) => ({ ...b, productName: perId.get(b.saleLineId)!.productName })),
      ...(riwayatTakDitemukan > 0 ? { riwayatTakDitemukan } : {}),
    },
    reason: alasan,
  });

  return { ok: true, returnId: retur.id };
}

/* ------------------------------------------------------------------ bacaan */

export type BarisNotaKembali = {
  saleLineId: string;
  productName: string;
  variantSku: string;
  qty: number;
  returnedQty: number;
  sisa: number;
};

export type NotaUntukKembali = {
  id: string;
  docNo: string;
  waktu: string;
  baris: BarisNotaKembali[];
};

/** Nota SPG untuk layar "barang kembali" — hanya milik SPG itu, di tokonya. Tanpa harga. */
export async function notaUntukKembali(spgSaleId: string, userId: string, storeId: string): Promise<NotaUntukKembali | null> {
  const n = await prisma.spgSale.findFirst({
    where: { id: spgSaleId, salesmanId: userId, storeId },
    select: {
      id: true,
      docNo: true,
      createdAt: true,
      lines: { orderBy: { productName: "asc" }, select: { id: true, productName: true, variantSku: true, qty: true, returnedQty: true } },
    },
  });
  if (!n) return null;
  return {
    id: n.id,
    docNo: n.docNo,
    waktu: n.createdAt.toISOString(),
    baris: n.lines.map((l) => ({
      saleLineId: l.id,
      productName: l.productName,
      variantSku: l.variantSku,
      qty: l.qty,
      returnedQty: l.returnedQty,
      sisa: Math.max(0, l.qty - l.returnedQty),
    })),
  };
}

export type ReturPembeliRingkas = {
  id: string;
  waktu: string;
  alasan: string;
  oleh: string;
  baris: { productName: string; variantSku: string; qty: number; condition: KondisiRetur }[];
};

export type KembaliPerNota = {
  /** Qty yang sudah kembali per baris nota (urutan nama barang). */
  perBaris: { saleLineId: string; productName: string; variantSku: string; qty: number; returnedQty: number }[];
  riwayat: ReturPembeliRingkas[];
};

/** Untuk rincian nota di backoffice: barang yang sudah dikembalikan pembeli, per baris dan per kejadian. */
export async function kembaliPerNota(spgSaleId: string): Promise<KembaliPerNota> {
  const [baris, riwayat] = await Promise.all([
    prisma.spgSaleLine.findMany({
      where: { spgSaleId },
      orderBy: { productName: "asc" },
      select: { id: true, productName: true, variantSku: true, qty: true, returnedQty: true },
    }),
    prisma.spgSaleReturn.findMany({
      where: { spgSaleId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        createdAt: true,
        createdById: true,
        reason: true,
        lines: { select: { qty: true, condition: true, saleLine: { select: { productName: true, variantSku: true } } } },
      },
    }),
  ]);
  const orang = riwayat.length
    ? await prisma.user.findMany({
        where: { id: { in: [...new Set(riwayat.map((r) => r.createdById))] } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const nama = new Map(orang.map((o) => [o.id, o.name ?? o.email]));
  return {
    perBaris: baris.map((b) => ({ saleLineId: b.id, productName: b.productName, variantSku: b.variantSku, qty: b.qty, returnedQty: b.returnedQty })),
    riwayat: riwayat.map((r) => ({
      id: r.id,
      waktu: r.createdAt.toISOString(),
      alasan: r.reason,
      oleh: nama.get(r.createdById) ?? "—",
      baris: r.lines.map((l) => ({
        productName: l.saleLine.productName,
        variantSku: l.saleLine.variantSku,
        qty: l.qty,
        condition: l.condition,
      })),
    })),
  };
}
