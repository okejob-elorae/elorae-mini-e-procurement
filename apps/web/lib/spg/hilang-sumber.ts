import { prisma } from "@elorae/db";
import { kurangDariOpname, kurangDariTerima } from "./hilang";
import { bacaAturanHilang } from "./hilang-db";
import { bukaCatatanHilang, type HasilBukaHilang } from "./hilang-writer";

/**
 * Pembuka catatan barang hilang dari dokumen sumbernya. Dipanggil SESUDAH
 * transaksi dokumen itu; idempoten per dokumen (kunci `<sumber>:<id>`), dan
 * TIDAK PERNAH melempar — kegagalan hanya berarti catatan dibuka oleh pemicu
 * berikutnya atau dicatat manual oleh kantor.
 *
 * Kait publik (`catatHilangDari*`) dilewati saat VITEST: pemanggilnya
 * (`catatOpname`, `terimaKiriman`, `putuskanSelisihMutasi`) memanggilnya tanpa
 * menunggu (`void`), jadi di tes milik penulis-penulis itu ia akan berlomba
 * dengan teardown dan meninggalkan catatan serta catatan kantor di basis data
 * bersama. Isinya diuji langsung lewat `bukaHilangDari*` (yang mengembalikan
 * hasilnya) — sama dengan penjaga di `kabariPengguna`/`fanOutAdminNotification`.
 */

export type HasilSumberHilang = HasilBukaHilang | { ok: false; kode: "TIDAK_DITEMUKAN" | "BUKAN_KONSINYASI" | "DIMATIKAN" | "BUKAN_HILANG" | "SUMBER_MUTASI" };

/**
 * Opname toko KONSINYASI: setiap baris yang dihitung kurang dari saldo buku.
 * Toko putus tidak — barangnya milik toko. Dimatikan oleh `dariOpname`.
 */
export async function bukaHilangDariOpname(opnameId: string, userId: string): Promise<HasilSumberHilang> {
  const aturan = await bacaAturanHilang(prisma);
  if (!aturan.dariOpname) return { ok: false, kode: "DIMATIKAN" };
  const opname = await prisma.storeOpname.findUnique({
    where: { id: opnameId },
    select: {
      id: true,
      storeId: true,
      countedAt: true,
      store: { select: { termsType: true } },
      lines: { select: { itemId: true, variantSku: true, productName: true, qtySystem: true, qtyCounted: true } },
    },
  });
  if (!opname) return { ok: false, kode: "TIDAK_DITEMUKAN" };
  if (opname.store.termsType !== "KONSI") return { ok: false, kode: "BUKAN_KONSINYASI" };
  return bukaCatatanHilang({
    storeId: opname.storeId,
    source: "OPNAME",
    sourceId: opname.id,
    sourceDocNo: null,
    baris: kurangDariOpname(opname.lines),
    note: null,
    createdById: userId,
    idempotencyKey: `opname:${opname.id}`,
  });
}

/**
 * Mutasi antar toko yang selisih kurangnya DIPUTUSKAN HILANG: setiap baris
 * tanda terima (di toko tujuan, atau toko asal untuk mutasi yang dikembalikan)
 * yang tiba kurang dari yang dikirim. Catatan dipasang pada toko ASAL — buku
 * toko itulah yang sudah dikurangi saat barang dikirim.
 */
export async function bukaHilangDariMutasi(transferId: string, userId: string): Promise<HasilSumberHilang> {
  const m = await prisma.storeTransfer.findUnique({
    where: { id: transferId },
    select: { id: true, docNo: true, status: true, fromStoreId: true, selisihStatus: true },
  });
  if (!m) return { ok: false, kode: "TIDAK_DITEMUKAN" };
  if (m.selisihStatus !== "HILANG") return { ok: false, kode: "BUKAN_HILANG" };
  const sumber = m.status === "DIKEMBALIKAN" ? "MUTASI_KEMBALI" : "MUTASI";
  const terima = await prisma.storeReceipt.findUnique({
    where: { sourceType_sourceId: { sourceType: sumber, sourceId: m.id } },
    select: { lines: { select: { itemId: true, variantSku: true, productName: true, qtySent: true, qtyReceived: true } } },
  });
  if (!terima) return { ok: false, kode: "TIDAK_DITEMUKAN" };
  return bukaCatatanHilang({
    storeId: m.fromStoreId,
    source: "MUTASI",
    sourceId: m.id,
    sourceDocNo: m.docNo,
    baris: kurangDariTerima(terima.lines),
    note: null,
    createdById: userId,
    idempotencyKey: `mutasi:${m.id}`,
  });
}

/**
 * Kiriman ke toko (pesanan putus, konsinyasi, kiriman konsinyasi) yang TIBA
 * kurang dari yang dikirim. Tanda terima mutasi diabaikan — kekurangannya
 * diputuskan kantor lebih dulu (HILANG → `bukaHilangDariMutasi`, KEMBALI →
 * bukan hilang).
 */
export async function bukaHilangDariPenerimaan(receiptId: string, userId: string): Promise<HasilSumberHilang> {
  const r = await prisma.storeReceipt.findUnique({
    where: { id: receiptId },
    select: {
      id: true,
      storeId: true,
      sourceType: true,
      sourceDocNo: true,
      lines: { select: { itemId: true, variantSku: true, productName: true, qtySent: true, qtyReceived: true } },
    },
  });
  if (!r) return { ok: false, kode: "TIDAK_DITEMUKAN" };
  if (r.sourceType === "MUTASI" || r.sourceType === "MUTASI_KEMBALI") return { ok: false, kode: "SUMBER_MUTASI" };
  return bukaCatatanHilang({
    storeId: r.storeId,
    source: "PENERIMAAN",
    sourceId: r.id,
    sourceDocNo: r.sourceDocNo,
    baris: kurangDariTerima(r.lines),
    note: null,
    createdById: userId,
    idempotencyKey: `penerimaan:${r.id}`,
  });
}

async function aman(nama: string, id: string, jalan: () => Promise<unknown>): Promise<void> {
  if (process.env.VITEST) return;
  try {
    await jalan();
  } catch (err) {
    console.error(`${nama} gagal`, id, err);
  }
}

export async function catatHilangDariOpname(opnameId: string, userId: string): Promise<void> {
  await aman("catatHilangDariOpname", opnameId, () => bukaHilangDariOpname(opnameId, userId));
}

export async function catatHilangDariMutasi(transferId: string, userId: string): Promise<void> {
  await aman("catatHilangDariMutasi", transferId, () => bukaHilangDariMutasi(transferId, userId));
}

export async function catatHilangDariPenerimaan(receiptId: string, userId: string): Promise<void> {
  await aman("catatHilangDariPenerimaan", receiptId, () => bukaHilangDariPenerimaan(receiptId, userId));
}
