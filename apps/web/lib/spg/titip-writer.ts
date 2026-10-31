import { Prisma, prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { parseItemVariants } from "@/lib/items/variants";
import { bacaVarian } from "@/lib/salesman/analisa-toko";
import { bacaTitipPesan, KUNCI_TITIP_PESAN } from "./pengaturan";
import { periksaIsianPelanggan, type KodeTolakPelanggan } from "./pelanggan";
import { catatPelangganTx } from "./pelanggan-writer";
import {
  BATAS_ALASAN_TITIP,
  BATAS_KETERANGAN_TITIP,
  batasSimpanDari,
  bolehDikabari,
  ENTITAS_TITIP,
  JEJAK_TITIP,
  labelVarian,
  MAKS_QTY_TITIP,
  stokUntukPermintaan,
} from "./titip";
import { saldoBarangToko } from "./titip-saldo";

/**
 * Penulis "titip pesan" (`CustomerRequest`) dari HP SPG.
 *
 * - Toko SELALU dari pemanggil (toko tetap SPG). Pelanggan, permintaan, dan
 *   barang dicari yang menyertainya hanya pernah menyentuh toko itu.
 * - Kunci idempotensi dibuat HP sekali per formulir dan diperiksa PALING DULU:
 *   kiriman ulang mengembalikan permintaan yang sudah ada, tidak membuat yang
 *   kedua (dan tidak mencatat barang dicari dua kali).
 * - Setiap perubahan status adalah bandingkan-lalu-tukar di dalam
 *   `runSerializable`, dan jejaknya ditulis di transaksi yang sama.
 */

type Tx = Prisma.TransactionClient;

export type PembeliTitip = { id: string } | { nama: string; hp: string; setuju: boolean };

export type KodeTolakTitip =
  | "KUNCI_WAJIB"
  | "KUNCI_DIPAKAI"
  | "JUMLAH_TIDAK_VALID"
  | "KETERANGAN_WAJIB"
  | "KETERANGAN_TERLALU_PANJANG"
  | "BARANG_TIDAK_DITEMUKAN"
  | "VARIAN_TIDAK_DIKENAL"
  | "PELANGGAN_TIDAK_VALID"
  | KodeTolakPelanggan;

export type HasilBuatTitipan =
  | { ok: true; id: string; customerId: string; ulang: boolean; lostSaleId: string | null }
  | { ok: false; code: KodeTolakTitip };

export type KodeTolakKeputusanTitip =
  | "TIDAK_DITEMUKAN"
  | "SUDAH_DITUTUP"
  | "BELUM_ADA"
  | "SUDAH_BERUBAH"
  | "ALASAN_WAJIB"
  | "ALASAN_TERLALU_PANJANG";

export type HasilKabariTitipan = { ok: true; holdUntil: string; ulang: boolean } | { ok: false; code: KodeTolakKeputusanTitip };
export type HasilTutupTitipan = { ok: true } | { ok: false; code: KodeTolakKeputusanTitip };

const KUNCI_MAKS = 100;

type IsianBarang = { itemId?: string | null; variantSku?: string | null; keterangan?: string | null; qty: number };

/**
 * Periksa barang + keterangan + jumlah dan susun keterangan akhirnya. Barang
 * katalog tanpa keterangan diketik → keterangannya nama barang (+ varian).
 */
async function periksaBarang(
  tx: Tx,
  isi: IsianBarang,
): Promise<{ ok: true; itemId: string | null; variantSku: string; keterangan: string } | { ok: false; code: KodeTolakTitip }> {
  if (!Number.isInteger(isi.qty) || isi.qty < 1 || isi.qty > MAKS_QTY_TITIP) return { ok: false, code: "JUMLAH_TIDAK_VALID" };
  const diketik = (isi.keterangan ?? "").replace(/\s+/g, " ").trim();
  if (diketik.length > BATAS_KETERANGAN_TITIP) return { ok: false, code: "KETERANGAN_TERLALU_PANJANG" };
  const variantSku = (isi.variantSku ?? "").trim();

  if (!isi.itemId) {
    if (!diketik) return { ok: false, code: "KETERANGAN_WAJIB" };
    // Varian tanpa barang tidak berarti apa-apa.
    if (variantSku) return { ok: false, code: "VARIAN_TIDAK_DIKENAL" };
    return { ok: true, itemId: null, variantSku: "", keterangan: diketik };
  }

  const item = await tx.item.findUnique({ where: { id: isi.itemId }, select: { id: true, sku: true, nameId: true, variants: true } });
  if (!item) return { ok: false, code: "BARANG_TIDAK_DITEMUKAN" };
  if (variantSku) {
    const dikenal = parseItemVariants(item.variants).some((v) => String(v.sku ?? "").trim() === variantSku);
    if (!dikenal) return { ok: false, code: "VARIAN_TIDAK_DIKENAL" };
  }
  const varian = variantSku ? labelVarian(bacaVarian(item.variants, variantSku, item.sku), variantSku) : null;
  const otomatis = varian ? `${item.nameId} (${varian})` : item.nameId;
  return { ok: true, itemId: item.id, variantSku, keterangan: (diketik || otomatis).slice(0, BATAS_KETERANGAN_TITIP) };
}

async function pembeliTx(
  tx: Tx,
  input: { storeId: string; userId: string; pembeli: PembeliTitip; sekarang: Date },
): Promise<{ ok: true; id: string } | { ok: false; code: KodeTolakTitip }> {
  if ("id" in input.pembeli) {
    const ada = await tx.storeCustomer.findFirst({ where: { id: input.pembeli.id, storeId: input.storeId }, select: { id: true } });
    return ada ? { ok: true, id: ada.id } : { ok: false, code: "PELANGGAN_TIDAK_VALID" };
  }
  const cek = periksaIsianPelanggan(input.pembeli, true);
  if (!cek.ok) return cek;
  const p = await catatPelangganTx(tx, { storeId: input.storeId, userId: input.userId, data: cek.data, sekarang: input.sekarang });
  return { ok: true, id: p.id };
}

async function buatTitipanTx(
  tx: Tx,
  input: {
    storeId: string;
    userId: string;
    pembeli: PembeliTitip;
    barang: { itemId: string | null; variantSku: string; keterangan: string };
    qty: number;
    idempotencyKey: string;
    lostSaleId: string | null;
    sekarang: Date;
  },
): Promise<HasilBuatTitipan> {
  const pembeli = await pembeliTx(tx, input);
  if (!pembeli.ok) return pembeli;
  const req = await tx.customerRequest.create({
    data: {
      storeId: input.storeId,
      customerId: pembeli.id,
      itemId: input.barang.itemId,
      variantSku: input.barang.variantSku,
      description: input.barang.keterangan,
      qty: input.qty,
      status: "MENUNGGU",
      lostSaleId: input.lostSaleId,
      createdById: input.userId,
      idempotencyKey: input.idempotencyKey,
      createdAt: input.sekarang,
    },
    select: { id: true },
  });
  await tx.auditLog.create({
    data: {
      userId: input.userId,
      action: JEJAK_TITIP.DIBUAT,
      entityType: ENTITAS_TITIP,
      entityId: req.id,
      changes: {
        before: null,
        after: {
          status: "MENUNGGU",
          customerId: pembeli.id,
          itemId: input.barang.itemId,
          variantSku: input.barang.variantSku,
          keterangan: input.barang.keterangan,
          qty: input.qty,
        },
      } as Prisma.InputJsonValue,
      metadata: { storeId: input.storeId, lostSaleId: input.lostSaleId } as Prisma.InputJsonValue,
    },
  });
  return { ok: true, id: req.id, customerId: pembeli.id, ulang: false, lostSaleId: input.lostSaleId };
}

async function ulangDariKunci(tx: Tx, storeId: string, idempotencyKey: string): Promise<HasilBuatTitipan | null> {
  const ada = await tx.customerRequest.findUnique({
    where: { idempotencyKey },
    select: { id: true, storeId: true, customerId: true, lostSaleId: true },
  });
  if (!ada) return null;
  if (ada.storeId !== storeId) return { ok: false, code: "KUNCI_DIPAKAI" };
  return { ok: true, id: ada.id, customerId: ada.customerId, ulang: true, lostSaleId: ada.lostSaleId };
}

const kunciBentrok = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

/** Kunci yang sama dikirim dua kali bersamaan: yang kalah membaca permintaan yang menang. */
async function setelahBentrok(e: unknown, storeId: string, idempotencyKey: string): Promise<HasilBuatTitipan> {
  if (!kunciBentrok(e)) throw e;
  const ulang = await ulangDariKunci(prisma, storeId, idempotencyKey);
  if (!ulang) throw e;
  return ulang;
}

/** Titip pesan baru dari layar Titip pesan (atau dari Info produk). */
export async function buatTitipan(input: {
  storeId: string;
  userId: string;
  pembeli: PembeliTitip;
  itemId?: string | null;
  variantSku?: string | null;
  keterangan?: string | null;
  qty: number;
  idempotencyKey: string;
  sekarang?: Date;
}): Promise<HasilBuatTitipan> {
  const kunci = input.idempotencyKey?.trim() ?? "";
  if (!kunci || kunci.length > KUNCI_MAKS) return { ok: false, code: "KUNCI_WAJIB" };
  const sekarang = input.sekarang ?? new Date();
  try {
    return await runSerializable(async (tx): Promise<HasilBuatTitipan> => {
      const ulang = await ulangDariKunci(tx, input.storeId, kunci);
      if (ulang) return ulang;
      const barang = await periksaBarang(tx, input);
      if (!barang.ok) return barang;
      return buatTitipanTx(tx, { ...input, barang, idempotencyKey: kunci, lostSaleId: null, sekarang });
    });
  } catch (e) {
    return setelahBentrok(e, input.storeId, kunci);
  }
}

/**
 * Barang dicari + titip pesan sekaligus: pembeli menanyakan barang yang tidak
 * ada dan minta dikabari kalau datang. Catatan barang dicari (`LostSale`) dan
 * permintaannya tercatat bersama atau tidak sama sekali, dan permintaannya
 * menunjuk catatan itu (`lostSaleId`). Aturan catatan barang dicari sama
 * dengan `catatBarangDicari`: keterangan wajib, jumlah 1–999, barang (kalau
 * dipilih) harus ada.
 */
export async function catatDicariDenganTitip(input: {
  storeId: string;
  userId: string;
  pembeli: PembeliTitip;
  itemId?: string | null;
  variantSku?: string | null;
  description: string;
  qty: number;
  idempotencyKey: string;
  sekarang?: Date;
}): Promise<HasilBuatTitipan> {
  const kunci = input.idempotencyKey?.trim() ?? "";
  if (!kunci || kunci.length > KUNCI_MAKS) return { ok: false, code: "KUNCI_WAJIB" };
  const sekarang = input.sekarang ?? new Date();
  if (!input.description.trim()) return { ok: false, code: "KETERANGAN_WAJIB" };
  try {
    return await runSerializable(async (tx): Promise<HasilBuatTitipan> => {
      const ulang = await ulangDariKunci(tx, input.storeId, kunci);
      if (ulang) return ulang;
      const barang = await periksaBarang(tx, { ...input, keterangan: input.description });
      if (!barang.ok) return barang;
      // Pembeli diperiksa SEBELUM barang dicari dicatat: isian pembeli yang
      // salah tidak boleh meninggalkan catatan barang dicari tanpa permintaannya.
      if (!("id" in input.pembeli)) {
        const cek = periksaIsianPelanggan(input.pembeli, true);
        if (!cek.ok) return cek;
      } else if (!(await tx.storeCustomer.findFirst({ where: { id: input.pembeli.id, storeId: input.storeId }, select: { id: true } }))) {
        return { ok: false, code: "PELANGGAN_TIDAK_VALID" };
      }
      const lost = await tx.lostSale.create({
        data: {
          storeId: input.storeId,
          userId: input.userId,
          itemId: barang.itemId,
          variantSku: barang.variantSku,
          description: barang.keterangan,
          qty: input.qty,
          createdAt: sekarang,
        },
        select: { id: true },
      });
      return buatTitipanTx(tx, { ...input, barang, idempotencyKey: kunci, lostSaleId: lost.id, sekarang });
    });
  } catch (e) {
    return setelahBentrok(e, input.storeId, kunci);
  }
}

/**
 * Tandai pembeli sudah dikabari (SPG membuka WhatsApp dengan pesannya). Barang
 * disimpankan sampai hari WIB ini + `hariSimpan` (Pengaturan → SPG). Permintaan
 * yang sudah DIKABARI tidak diubah — masa simpannya tidak diperpanjang oleh
 * kiriman ulang pesan.
 */
export async function tandaiDikabari(input: { storeId: string; userId: string; requestId: string; sekarang?: Date }): Promise<HasilKabariTitipan> {
  const sekarang = input.sekarang ?? new Date();
  return runSerializable(async (tx): Promise<HasilKabariTitipan> => {
    const req = await tx.customerRequest.findFirst({
      where: { id: input.requestId, storeId: input.storeId },
      select: { id: true, status: true, itemId: true, variantSku: true, holdUntil: true, availableAt: true },
    });
    if (!req) return { ok: false, code: "TIDAK_DITEMUKAN" };
    if (req.status === "DIKABARI") return { ok: true, holdUntil: req.holdUntil ?? "", ulang: true };
    if (req.status !== "MENUNGGU" && req.status !== "TERSEDIA") return { ok: false, code: "SUDAH_DITUTUP" };
    if (req.status === "MENUNGGU") {
      const saldo = await saldoBarangToko(tx, input.storeId, req.itemId ? [req.itemId] : []);
      if (!bolehDikabari(req.status, stokUntukPermintaan(req.itemId, req.variantSku, saldo), req.itemId !== null)) {
        return { ok: false, code: "BELUM_ADA" };
      }
    }
    const setelan = await tx.systemSetting.findUnique({ where: { key: KUNCI_TITIP_PESAN }, select: { value: true } });
    const holdUntil = batasSimpanDari(sekarang, bacaTitipPesan(setelan?.value).hariSimpan);
    const r = await tx.customerRequest.updateMany({
      where: { id: req.id, status: req.status },
      data: {
        status: "DIKABARI",
        notifiedAt: sekarang,
        notifiedById: input.userId,
        holdUntil,
        availableAt: req.availableAt ?? sekarang,
      },
    });
    if (r.count !== 1) return { ok: false, code: "SUDAH_BERUBAH" };
    await tx.auditLog.create({
      data: {
        userId: input.userId,
        action: JEJAK_TITIP.DIKABARI,
        entityType: ENTITAS_TITIP,
        entityId: req.id,
        changes: { before: { status: req.status, holdUntil: req.holdUntil }, after: { status: "DIKABARI", holdUntil } } as Prisma.InputJsonValue,
        metadata: { storeId: input.storeId } as Prisma.InputJsonValue,
      },
    });
    return { ok: true, holdUntil, ulang: false };
  });
}

/**
 * Tutup permintaan: SELESAI ("sudah diambil" pembeli) atau BATAL (alasan
 * wajib — pembeli tidak jadi, barang tidak akan datang, salah catat).
 */
export async function tutupTitipan(input: {
  storeId: string;
  userId: string;
  requestId: string;
  hasil: "SELESAI" | "BATAL";
  alasan?: string | null;
  sekarang?: Date;
}): Promise<HasilTutupTitipan> {
  const alasan = (input.alasan ?? "").trim();
  if (input.hasil === "BATAL" && !alasan) return { ok: false, code: "ALASAN_WAJIB" };
  if (alasan.length > BATAS_ALASAN_TITIP) return { ok: false, code: "ALASAN_TERLALU_PANJANG" };
  const sekarang = input.sekarang ?? new Date();
  return runSerializable(async (tx): Promise<HasilTutupTitipan> => {
    const req = await tx.customerRequest.findFirst({ where: { id: input.requestId, storeId: input.storeId }, select: { id: true, status: true } });
    if (!req) return { ok: false, code: "TIDAK_DITEMUKAN" };
    if (req.status !== "MENUNGGU" && req.status !== "TERSEDIA" && req.status !== "DIKABARI") return { ok: false, code: "SUDAH_DITUTUP" };
    const r = await tx.customerRequest.updateMany({
      where: { id: req.id, status: req.status },
      data: { status: input.hasil, closedAt: sekarang, closedById: input.userId, closeReason: alasan || null },
    });
    if (r.count !== 1) return { ok: false, code: "SUDAH_BERUBAH" };
    await tx.auditLog.create({
      data: {
        userId: input.userId,
        action: input.hasil === "SELESAI" ? JEJAK_TITIP.SELESAI : JEJAK_TITIP.DIBATALKAN,
        entityType: ENTITAS_TITIP,
        entityId: req.id,
        changes: { before: { status: req.status }, after: { status: input.hasil } } as Prisma.InputJsonValue,
        metadata: { storeId: input.storeId } as Prisma.InputJsonValue,
        reason: alasan || null,
      },
    });
    return { ok: true };
  });
}
