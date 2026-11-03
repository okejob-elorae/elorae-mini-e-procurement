import { prisma, type Prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { catatJejak, JEJAK } from "@/lib/receivables/jejak";
import { kunciDokumenHutang } from "@/lib/purchasing/pembayaran-aturan";
import { EPS_QTY, JENIS_SUMBER_TAGIH, type JenisSumberTagih } from "./belum-ditagih-aturan";
import { bacaTagihanSumber, nilaiBelumDitagih } from "./belum-ditagih-queries";
import { evaluasiPermintaan, permintaanTerbukaPerSumber, PILIH_PERMINTAAN } from "./permintaan-invoice-queries";
import { SALURAN_PERMINTAAN } from "./permintaan-invoice-pesan";

/*
 * Penulis permintaan invoice ke pemasok (Q18 "catat kapan diminta, oleh siapa"; P19). KHUSUS SERVER,
 * tanpa `@/lib/auth`: izinnya (`vendor_bills:manage`) diperiksa aksinya. Setiap penolakan diperiksa
 * SEBELUM tulisan pertama; sesudah tulisan, kegagalan MELEMPAR (`runSerializable` menyimpan apa pun yang
 * dikembalikan). Setiap tanda keadaan memakai compare-and-swap `updateMany` + cek jumlah DI DALAM
 * `runSerializable`, dan jejaknya ditulis di transaksi yang sama.
 */

type Tx = Prisma.TransactionClient;

export type KodeGalatPermintaan =
  | "SUMBER_KOSONG"
  | "SUMBER_TERLALU_BANYAK"
  | "SUMBER_TIDAK_DITEMUKAN"
  | "BUKAN_PEMASOK_INI"
  | "SUDAH_DITAGIH"
  | "MENUNGGU_PEMILIK"
  | "MENUNGGU_KONFIRMASI"
  | "SUDAH_DIMINTA"
  | "SALURAN_TIDAK_SAH"
  | "TEKS_TERLALU_PANJANG"
  | "TIDAK_DITEMUKAN"
  | "SUDAH_DITERIMA"
  | "SUDAH_DIBATALKAN"
  | "SUDAH_DITUTUP"
  | "ALASAN_WAJIB";

class TolakPermintaan extends Error {
  constructor(public kode: KodeGalatPermintaan, public detail?: string) {
    super(kode);
  }
}

const MAKS_SUMBER = 200;
const MAKS_CATATAN = 1000;
const MAKS_ALASAN = 500;
const MAKS_LABEL = 191;

function bacaSumber(raw: unknown): Array<{ jenis: JenisSumberTagih; id: string }> | null {
  if (!Array.isArray(raw)) return null;
  const out: Array<{ jenis: JenisSumberTagih; id: string }> = [];
  const lihat = new Set<string>();
  for (const s of raw) {
    if (typeof s !== "object" || s === null) return null;
    const { jenis, id } = s as { jenis?: unknown; id?: unknown };
    if (typeof jenis !== "string" || !(JENIS_SUMBER_TAGIH as readonly string[]).includes(jenis) || typeof id !== "string" || id.length === 0 || id.length > 64) return null;
    const k = `${jenis}|${id}`;
    if (lihat.has(k)) continue;
    lihat.add(k);
    out.push({ jenis: jenis as JenisSumberTagih, id });
  }
  return out;
}

export type HasilPermintaan = { ok: true; id: string; ulang: boolean } | { ok: false; kode: KodeGalatPermintaan; detail?: string };

/**
 * "Minta invoice": satu permintaan untuk satu pemasok, satu baris per penerimaan (GRN atau langkah WO)
 * dengan cuplikan qty dan nilainya. Kunci kiriman diperiksa PALING DULU; kiriman ulang mendapat
 * permintaan yang sama (`ulang: true`).
 */
export async function mintaInvoice(i: {
  supplierId: string;
  sumber: unknown;
  saluran: unknown;
  catatan?: unknown;
  idempotencyKey?: unknown;
  olehUserId: string;
}): Promise<HasilPermintaan> {
  const kunci = typeof i.idempotencyKey === "string" && i.idempotencyKey.trim() ? i.idempotencyKey.trim().slice(0, 100) : null;
  if (kunci) {
    const ada = await prisma.supplierInvoiceRequest.findUnique({ where: { idempotencyKey: kunci }, select: { id: true } });
    if (ada) return { ok: true, id: ada.id, ulang: true };
  }
  if (typeof i.saluran !== "string" || !(SALURAN_PERMINTAAN as readonly string[]).includes(i.saluran)) return { ok: false, kode: "SALURAN_TIDAK_SAH" };
  const catatan = typeof i.catatan === "string" ? i.catatan.trim() : "";
  if (catatan.length > MAKS_CATATAN) return { ok: false, kode: "TEKS_TERLALU_PANJANG" };
  const sumber = bacaSumber(i.sumber);
  if (!sumber || sumber.length === 0) return { ok: false, kode: "SUMBER_KOSONG" };
  if (sumber.length > MAKS_SUMBER) return { ok: false, kode: "SUMBER_TERLALU_BANYAK" };

  // Nilai rupiah membaca jurnal: dihitung di luar transaksi, lalu sumbernya diperiksa ulang di dalamnya.
  const awal = await bacaTagihanSumber(prisma, sumber);
  const nilai = await nilaiBelumDitagih(prisma, [...awal.values()]);

  try {
    return await runSerializable(async (tx): Promise<HasilPermintaan> => {
      if (kunci) {
        const ada = await tx.supplierInvoiceRequest.findUnique({ where: { idempotencyKey: kunci }, select: { id: true } });
        if (ada) return { ok: true, id: ada.id, ulang: true };
      }
      const keadaan = await bacaTagihanSumber(tx, sumber);
      const terbuka = await permintaanTerbukaPerSumber(tx, sumber.map((s) => kunciDokumenHutang(s.jenis, s.id)));
      for (const s of sumber) {
        const k = keadaan.get(kunciDokumenHutang(s.jenis, s.id));
        if (!k || k.mati) return { ok: false, kode: "SUMBER_TIDAK_DITEMUKAN", detail: s.id };
        if (k.supplierId !== i.supplierId) return { ok: false, kode: "BUKAN_PEMASOK_INI", detail: k.nomor };
        if (k.terhalang === "MENUNGGU_PEMILIK") return { ok: false, kode: "MENUNGGU_PEMILIK", detail: k.nomor };
        if (k.terhalang === "MENUNGGU_KONFIRMASI") return { ok: false, kode: "MENUNGGU_KONFIRMASI", detail: k.nomor };
        if (k.belum <= EPS_QTY) return { ok: false, kode: "SUDAH_DITAGIH", detail: k.nomor };
        if (terbuka.has(kunciDokumenHutang(s.jenis, s.id))) return { ok: false, kode: "SUDAH_DIMINTA", detail: k.nomor };
      }
      const kini = new Date();
      const r = await tx.supplierInvoiceRequest.create({
        data: {
          supplierId: i.supplierId,
          channel: i.saluran as string,
          note: catatan || null,
          requestedById: i.olehUserId,
          requestedAt: kini,
          lastRequestedById: i.olehUserId,
          lastRequestedAt: kini,
          idempotencyKey: kunci,
          lines: {
            create: sumber.map((s) => {
              const k = keadaan.get(kunciDokumenHutang(s.jenis, s.id))!;
              const v = nilai.get(kunciDokumenHutang(s.jenis, s.id));
              const label = Array.from(k.kunci.filter((x) => x.belum > EPS_QTY).map((x) => x.label).join(", ") || k.nomor).slice(0, MAKS_LABEL).join("");
              return {
                sourceType: s.jenis,
                sourceId: s.id,
                label,
                receivedQty: k.jenis === "GRN" ? k.neto : k.kunci[0]?.diterima ?? 0,
                billedQty: k.ditagih,
                qty: k.belum,
                amount: (v?.totalSen ?? 0) / 100,
                amountUnknown: v?.adaTakDiketahui ?? false,
              };
            }),
          },
        },
        select: { id: true },
      });
      await catatJejak(tx, {
        userId: i.olehUserId,
        action: JEJAK.PERMINTAAN_INVOICE_DIBUAT,
        entityType: "SupplierInvoiceRequest",
        entityId: r.id,
        changes: { after: { supplierId: i.supplierId, saluran: i.saluran, sumber: sumber.map((s) => `${s.jenis}|${s.id}`) } },
        reason: catatan || null,
      });
      return { ok: true, id: r.id, ulang: false };
    });
  } catch (e) {
    if (e instanceof TolakPermintaan) return { ok: false, kode: e.kode, ...(e.detail ? { detail: e.detail } : {}) };
    throw e;
  }
}

/** Baca permintaan + periksa masih bisa diubah (semua sebelum tulisan). */
async function permintaanTerbuka(tx: Tx, requestId: string): Promise<{ ok: true; lastRequestedAt: Date } | { ok: false; kode: KodeGalatPermintaan }> {
  const r = await tx.supplierInvoiceRequest.findUnique({ where: { id: requestId }, select: PILIH_PERMINTAAN });
  if (!r) return { ok: false, kode: "TIDAK_DITEMUKAN" };
  if (r.cancelledAt) return { ok: false, kode: "SUDAH_DIBATALKAN" };
  if (r.closedAt) return { ok: false, kode: "SUDAH_DITUTUP" };
  const e = (await evaluasiPermintaan(tx, [r])).get(r.id);
  if (e && e.status !== "TERBUKA") return { ok: false, kode: "SUDAH_DITERIMA" };
  return { ok: true, lastRequestedAt: r.lastRequestedAt };
}

/** "Minta ulang": tanggal minta terakhir bergeser (pengingat 7 hari mulai lagi). */
export async function mintaUlangInvoice(i: { requestId: string; saluran: unknown; catatan?: unknown; olehUserId: string }): Promise<HasilPermintaan> {
  if (typeof i.saluran !== "string" || !(SALURAN_PERMINTAAN as readonly string[]).includes(i.saluran)) return { ok: false, kode: "SALURAN_TIDAK_SAH" };
  const catatan = typeof i.catatan === "string" ? i.catatan.trim() : "";
  if (catatan.length > MAKS_CATATAN) return { ok: false, kode: "TEKS_TERLALU_PANJANG" };
  try {
    return await runSerializable(async (tx): Promise<HasilPermintaan> => {
      const cek = await permintaanTerbuka(tx, i.requestId);
      if (!cek.ok) return cek;
      const kini = new Date();
      const cas = await tx.supplierInvoiceRequest.updateMany({
        where: { id: i.requestId, closedAt: null, cancelledAt: null },
        data: {
          lastRequestedAt: kini,
          lastRequestedById: i.olehUserId,
          channel: i.saluran as string,
          ...(catatan ? { note: catatan } : {}),
          askCount: { increment: 1 },
          remindedAt: null,
        },
      });
      if (cas.count !== 1) throw new TolakPermintaan("SUDAH_DITUTUP");
      await catatJejak(tx, {
        userId: i.olehUserId,
        action: JEJAK.PERMINTAAN_INVOICE_DIULANG,
        entityType: "SupplierInvoiceRequest",
        entityId: i.requestId,
        changes: { before: { lastRequestedAt: cek.lastRequestedAt.toISOString() }, after: { lastRequestedAt: kini.toISOString(), saluran: i.saluran } },
        reason: catatan || null,
      });
      return { ok: true, id: i.requestId, ulang: false };
    });
  } catch (e) {
    if (e instanceof TolakPermintaan) return { ok: false, kode: e.kode };
    throw e;
  }
}

/** Batalkan permintaan yang masih terbuka; alasan wajib. */
export async function batalkanPermintaanInvoice(i: { requestId: string; alasan: unknown; olehUserId: string }): Promise<HasilPermintaan> {
  const alasan = typeof i.alasan === "string" ? i.alasan.trim() : "";
  if (alasan.length === 0) return { ok: false, kode: "ALASAN_WAJIB" };
  if (alasan.length > MAKS_ALASAN) return { ok: false, kode: "TEKS_TERLALU_PANJANG" };
  try {
    return await runSerializable(async (tx): Promise<HasilPermintaan> => {
      const cek = await permintaanTerbuka(tx, i.requestId);
      if (!cek.ok) return cek;
      const kini = new Date();
      const cas = await tx.supplierInvoiceRequest.updateMany({
        where: { id: i.requestId, closedAt: null, cancelledAt: null },
        data: { cancelledAt: kini, cancelledById: i.olehUserId, cancelReason: alasan },
      });
      if (cas.count !== 1) throw new TolakPermintaan("SUDAH_DITUTUP");
      await catatJejak(tx, {
        userId: i.olehUserId,
        action: JEJAK.PERMINTAAN_INVOICE_DIBATALKAN,
        entityType: "SupplierInvoiceRequest",
        entityId: i.requestId,
        changes: { before: { status: "TERBUKA" }, after: { status: "DIBATALKAN" } },
        reason: alasan,
      });
      return { ok: true, id: i.requestId, ulang: false };
    });
  } catch (e) {
    if (e instanceof TolakPermintaan) return { ok: false, kode: e.kode };
    throw e;
  }
}

/**
 * Tutup (simpan `closedAt`) permintaan terbuka yang sudah terpenuhi — invoice tercatat, atau sisanya
 * dibebaskan. Diturunkan lagi DI DALAM transaksi, lalu compare-and-swap. Tanpa cakupan = tidak apa-apa.
 * Spec memakai `requestIds`.
 */
export async function tandaiPermintaanTerpenuhi(a: { sumber?: ReadonlyArray<{ jenis: JenisSumberTagih; id: string }>; billId?: string; requestIds?: string[] }): Promise<number> {
  const or: Prisma.SupplierInvoiceRequestWhereInput[] = [];
  if (a.requestIds && a.requestIds.length > 0) or.push({ id: { in: a.requestIds } });
  if (a.sumber && a.sumber.length > 0) {
    or.push({ lines: { some: { OR: a.sumber.map((s) => ({ sourceType: s.jenis, sourceId: s.id })) } } });
  }
  if (or.length === 0) return 0;
  return runSerializable(async (tx) => {
    const rows = await tx.supplierInvoiceRequest.findMany({ where: { closedAt: null, cancelledAt: null, OR: or }, select: PILIH_PERMINTAAN });
    if (rows.length === 0) return 0;
    const evaluasi = await evaluasiPermintaan(tx, rows);
    const kini = new Date();
    let ditutup = 0;
    for (const r of rows) {
      const e = evaluasi.get(r.id);
      if (!e || e.status === "TERBUKA" || e.status === "DIBATALKAN") continue;
      const cas = await tx.supplierInvoiceRequest.updateMany({
        where: { id: r.id, closedAt: null, cancelledAt: null },
        data: { closedAt: kini, closedByBillId: e.status === "DITERIMA" ? a.billId ?? null : null },
      });
      ditutup += cas.count;
    }
    return ditutup;
  });
}

/**
 * Di dalam transaksi yang membatalkan tagihan atau pembebasan: buka lagi permintaan yang sudah ditutup
 * (tidak dibatalkan) dan menyebut penerimaan tagihan / pembebasan itu. Statusnya diturunkan lagi saat
 * dibaca, jadi yang memang masih terpenuhi tertutup lagi pada pemenuhan berikutnya.
 */
export async function bukaLagiPermintaanTerdampak(tx: Tx, a: { billId?: string; sumber?: ReadonlyArray<{ jenis: JenisSumberTagih; id: string }> }): Promise<number> {
  const sumber: Array<{ jenis: JenisSumberTagih; id: string }> = [...(a.sumber ?? [])];
  if (a.billId) {
    const lines = await tx.vendorBillLine.findMany({ where: { billId: a.billId }, select: { grnId: true, woStepId: true } });
    for (const l of lines) {
      if (l.grnId) sumber.push({ jenis: "GRN", id: l.grnId });
      if (l.woStepId) sumber.push({ jenis: "WO_STEP", id: l.woStepId });
    }
  }
  if (sumber.length === 0) return 0;
  const r = await tx.supplierInvoiceRequest.updateMany({
    where: {
      closedAt: { not: null },
      cancelledAt: null,
      lines: { some: { OR: sumber.map((s) => ({ sourceType: s.jenis, sourceId: s.id })) } },
    },
    data: { closedAt: null, closedByBillId: null },
  });
  return r.count;
}
