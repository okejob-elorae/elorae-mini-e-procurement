import type { Prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { catatJejak, JEJAK } from "@/lib/receivables/jejak";
import { kunciDokumenHutang } from "@/lib/purchasing/pembayaran-aturan";
import { grnLineKey } from "./bill-paid-rule";
import { EPS_QTY, JENIS_SUMBER_TAGIH, type JenisSumberTagih } from "./belum-ditagih-aturan";
import { bacaTagihanSumber } from "./belum-ditagih-queries";
import { bukaLagiPermintaanTerdampak } from "./permintaan-invoice-writer";

/*
 * "Tidak perlu invoice" (keputusan pemilik 2026-11-02, P52: tombol dengan alasan wajib — setuju): untuk
 * penerimaan yang memang tidak akan pernah ditagih (mis. kerja sendiri Rp 0). Menghapus pcs-nya dari
 * "Invoice belum ditagih", lencana "Invoice belum diterima" dan hitungan Beranda — TANPA mengubah utang:
 * penerimaannya tetap bisa dibayar, dan invoice yang datang kemudian tetap bisa menagihnya (batas qty
 * tagihan tidak melihat pembebasan). Bisa dibatalkan, dengan alasan. Pcs yang diterima kemudian pada
 * langkah WO tampil lagi. KHUSUS SERVER; izinnya (`vendor_bills:manage`) diperiksa aksinya. Semua
 * penolakan sebelum tulisan pertama; jejaknya di transaksi yang sama.
 */

type Tx = Prisma.TransactionClient;

export type KodeGalatTidakPerlu =
  | "SUMBER_KOSONG"
  | "SUMBER_TIDAK_DITEMUKAN"
  | "BUKAN_PEMASOK_INI"
  | "TIDAK_ADA_SISA"
  | "MENUNGGU_PEMILIK"
  | "MENUNGGU_KONFIRMASI"
  | "ALASAN_WAJIB"
  | "TEKS_TERLALU_PANJANG"
  | "TIDAK_DITEMUKAN"
  | "SUDAH_DIBATALKAN";

const MAKS_ALASAN = 500;

class TolakTidakPerlu extends Error {
  constructor(public kode: KodeGalatTidakPerlu) {
    super(kode);
  }
}

function bacaAlasan(v: unknown): { ok: true; alasan: string } | { ok: false; kode: KodeGalatTidakPerlu } {
  const alasan = typeof v === "string" ? v.trim() : "";
  if (!alasan) return { ok: false, kode: "ALASAN_WAJIB" };
  if (alasan.length > MAKS_ALASAN) return { ok: false, kode: "TEKS_TERLALU_PANJANG" };
  return { ok: true, alasan };
}

export type HasilTidakPerlu = { ok: true; ids: string[] } | { ok: false; kode: KodeGalatTidakPerlu; detail?: string };

export async function tandaiTidakPerluInvoice(i: {
  supplierId: string;
  sumber: Array<{ jenis: JenisSumberTagih; id: string; itemId?: string | null; variantSku?: string | null }>;
  alasan: unknown;
  olehUserId: string;
}): Promise<HasilTidakPerlu> {
  const a = bacaAlasan(i.alasan);
  if (!a.ok) return a;
  const sumber = (Array.isArray(i.sumber) ? i.sumber : []).filter(
    (s) => s && (JENIS_SUMBER_TAGIH as readonly string[]).includes(s.jenis) && typeof s.id === "string" && s.id.length > 0 && s.id.length <= 64,
  );
  if (sumber.length === 0 || sumber.length > 200) return { ok: false, kode: "SUMBER_KOSONG" };
  try {
    return await runSerializable(async (tx): Promise<HasilTidakPerlu> => {
      const keadaan = await bacaTagihanSumber(tx, sumber);
      const rencana: Array<{ jenis: JenisSumberTagih; id: string; itemId: string | null; variantSku: string | null; qty: number }> = [];
      for (const s of sumber) {
        const k = keadaan.get(kunciDokumenHutang(s.jenis, s.id));
        if (!k || k.mati) return { ok: false, kode: "SUMBER_TIDAK_DITEMUKAN", detail: s.id };
        if (k.supplierId !== i.supplierId) return { ok: false, kode: "BUKAN_PEMASOK_INI", detail: k.nomor };
        if (k.terhalang === "MENUNGGU_PEMILIK") return { ok: false, kode: "MENUNGGU_PEMILIK", detail: k.nomor };
        if (k.terhalang === "MENUNGGU_KONFIRMASI") return { ok: false, kode: "MENUNGGU_KONFIRMASI", detail: k.nomor };
        const variantSku = s.variantSku?.trim() || null;
        const baris = s.jenis === "GRN" ? k.kunci.find((x) => x.key === grnLineKey(s.itemId ?? "", variantSku)) : k.kunci[0];
        if (!baris || baris.belum <= EPS_QTY) return { ok: false, kode: "TIDAK_ADA_SISA", detail: k.nomor };
        rencana.push({ jenis: s.jenis, id: s.id, itemId: s.jenis === "GRN" ? s.itemId ?? null : null, variantSku: s.jenis === "GRN" ? variantSku : null, qty: baris.belum });
      }
      const ids: string[] = [];
      for (const r of rencana) {
        const w = await tx.supplierInvoiceWaiver.create({
          data: { supplierId: i.supplierId, sourceType: r.jenis, sourceId: r.id, itemId: r.itemId, variantSku: r.variantSku, qty: r.qty, reason: a.alasan, createdById: i.olehUserId },
          select: { id: true },
        });
        ids.push(w.id);
        await catatJejak(tx, {
          userId: i.olehUserId,
          action: JEJAK.INVOICE_TIDAK_PERLU,
          entityType: "SupplierInvoiceWaiver",
          entityId: w.id,
          changes: { after: { sumber: `${r.jenis}|${r.id}`, itemId: r.itemId, variantSku: r.variantSku, qty: r.qty } },
          reason: a.alasan,
        });
      }
      return { ok: true, ids };
    });
  } catch (e) {
    if (e instanceof TolakTidakPerlu) return { ok: false, kode: e.kode };
    throw e;
  }
}

/** Batalkan pembebasan; pcs-nya kembali ke "Invoice belum ditagih" dan permintaan yang ditutupnya dibuka lagi. */
export async function batalkanTidakPerluInvoice(i: { waiverId: string; alasan: unknown; olehUserId: string }): Promise<HasilTidakPerlu> {
  const a = bacaAlasan(i.alasan);
  if (!a.ok) return a;
  try {
    return await runSerializable(async (tx: Tx): Promise<HasilTidakPerlu> => {
      const w = await tx.supplierInvoiceWaiver.findUnique({ where: { id: i.waiverId }, select: { id: true, sourceType: true, sourceId: true, cancelledAt: true } });
      if (!w) return { ok: false, kode: "TIDAK_DITEMUKAN" };
      if (w.cancelledAt) return { ok: false, kode: "SUDAH_DIBATALKAN" };
      const kini = new Date();
      const cas = await tx.supplierInvoiceWaiver.updateMany({
        where: { id: w.id, cancelledAt: null },
        data: { cancelledAt: kini, cancelledById: i.olehUserId, cancelReason: a.alasan },
      });
      if (cas.count !== 1) throw new TolakTidakPerlu("SUDAH_DIBATALKAN");
      await catatJejak(tx, {
        userId: i.olehUserId,
        action: JEJAK.INVOICE_TIDAK_PERLU_DIBATALKAN,
        entityType: "SupplierInvoiceWaiver",
        entityId: w.id,
        changes: { before: { berlaku: true }, after: { berlaku: false } },
        reason: a.alasan,
      });
      await bukaLagiPermintaanTerdampak(tx, { sumber: [{ jenis: w.sourceType as JenisSumberTagih, id: w.sourceId }] });
      return { ok: true, ids: [w.id] };
    });
  } catch (e) {
    if (e instanceof TolakTidakPerlu) return { ok: false, kode: e.kode };
    throw e;
  }
}
