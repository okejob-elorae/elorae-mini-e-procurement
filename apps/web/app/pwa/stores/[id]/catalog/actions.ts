"use server";

import { revalidatePath } from "next/cache";
import { tautkanSumberPesanan } from "@/lib/field-sales/isi-keranjang";
import { bacaSumberKeranjang } from "@/lib/field-sales/isi-keranjang-sumber";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { z } from "zod";
import { prisma } from "@elorae/db";
import { applyItemAggregatedPromos } from "@/lib/field-sales/promo-apply";
import { auth } from "@/lib/auth";
import { createFieldSalesOrder } from "@/lib/field-sales/writer";
import { NoActiveVisitError, MinQtyViolationError } from "@/lib/field-sales/errors";
import { KreditDiblokirError } from "@/lib/field-sales/kredit-pesanan";
import type { AlasanKredit } from "@/lib/salesman/kredit";
import { fetchActivePromosForStore } from "@/lib/promos/queries";
import { JarakJauhDitolakError, SALURAN_JARAK_JAUH, type SaluranJarakJauh } from "@/lib/field-sales/jarak-jauh";
import { susunBonusPesanan } from "@/lib/field-sales/bonus";
import { IndenDitolakError, type AlasanIndenDitolak } from "@/lib/field-sales/inden";
import { PesananLamaTidakBisaDigantiError } from "@/lib/field-sales/ganti-pesanan";
import { cariKunjunganAntrean } from "@/lib/pwa/kunjungan-antrean";

const schema = z.object({
  storeId: z.string().min(1),
  visitId: z.string().optional(),
  // Check-in yang dicatat TANPA sinyal (`StoreVisit.clientId`): pesanan dari antrean HP yang dibuat di kunjungan itu.
  visitClientId: z.string().min(1).max(100).nullable().optional(),
  note: z.string().optional(),
  lines: z.array(z.object({
    itemId: z.string().min(1),
    variantSku: z.string(),
    productName: z.string().min(1),
    qty: z.number().int().positive(),
    unitPrice: z.number().nonnegative(),
    requestedUnitPrice: z.number().nonnegative().nullable().optional(),
    appealReason: z.string().max(500).nullable().optional(),
  })).min(1),
  idempotencyKey: z.string().optional(),
  // Pesanan jarak jauh (WA/telepon): tanpa kunjungan. Kosong = pesanan saat kunjungan.
  remoteChannel: z.enum(SALURAN_JARAK_JAUH).nullable().optional(),
  // Pre-order (inden): id jendela. Kosong = pesanan stok siap biasa.
  preorderWindowId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).nullable().optional(),
  // Mengubah pesanan sendiri: id pesanan lama yang diganti. Kosong = pesanan baru biasa.
  gantiOrderId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).nullable().optional(),
});

export type SubmitResult =
  /** `kreditDitahan`: pesanan tercatat tapi menunggu kantor memeriksa tagihan toko (mode TAHAN). */
  | { ok: true; orderId?: string; orderNo: string; kreditDitahan?: boolean }
  | { ok: false; code: "UNAUTHORIZED" | "EMPTY" | "NO_ACTIVE_VISIT" }
  /** Pesanan dari antrean HP: check-in tanpa sinyal yang mengikatnya tidak tercatat (ditolak server, atau dihapus dari HP). */
  | { ok: false; code: "KUNJUNGAN_TIDAK_SAH" }
  /** Pesanan jarak jauh ditolak aturan pemilik (dimatikan, atau toko bukan pegangan salesman ini). */
  | { ok: false; code: "JARAK_JAUH_NONAKTIF" | "BUKAN_TOKO_SENDIRI" }
  | { ok: false; code: "MIN_QTY"; violations: Array<{ itemId: string; requiredMin: number; actualQty: number }> }
  /** Mode BLOKIR: pesanan TIDAK tercatat. `alasan` membawa angkanya untuk layar HP. */
  | { ok: false; code: "KREDIT_DIBLOKIR"; alasan: AlasanKredit[] }
  /** Pre-order ditolak: jendela tidak BUKA, barang di luar jendela, atau toko konsinyasi. Pesanan TIDAK tercatat. */
  | { ok: false; code: "INDEN_DITOLAK"; alasan: AlasanIndenDitolak }
  /**
   * Mengubah pesanan: pesanan lama sudah tidak menunggu (disetujui/ditolak kantor,
   * sudah dibatalkan atau diganti), atau bukan milik salesman ini. Tidak ada yang
   * tercatat — pesanan lama tidak tersentuh, pesanan baru tidak dibuat.
   */
  | { ok: false; code: "PESANAN_LAMA_TIDAK_BISA_DIGANTI" };

export async function submitFieldSalesOrder(input: {
  storeId: string;
  visitId?: string;
  /** Check-in tanpa sinyal yang mengikat pesanan ini (pengganti `visitId` dari antrean HP). */
  visitClientId?: string | null;
  note?: string;
  lines: Array<{
    itemId: string;
    variantSku: string;
    productName: string;
    qty: number;
    unitPrice: number;
    requestedUnitPrice?: number | null;
    appealReason?: string | null;
  }>;
  idempotencyKey?: string;
  remoteChannel?: SaluranJarakJauh | null;
  preorderWindowId?: string | null;
  /** Id pesanan sendiri yang diganti (ubah pesanan). Saluran/kunjungan/jendela dibawa server dari pesanan itu. */
  gantiOrderId?: string | null;
  /** `permintaan:<id>` / `rekomendasi:<id>`: keranjang diisi dari dokumen itu — ditautkan sesudah pesanan tercatat. */
  sumber?: string | null;
}): Promise<SubmitResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, code: "UNAUTHORIZED" };
  // SPG (toko tetap) tidak membuat pesanan — halamannya sudah mengalihkan, ini penjaga servernya.
  if (await ambilTokoTetap(session.user.id)) return { ok: false, code: "UNAUTHORIZED" };

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "EMPTY" };

  // Pesanan yang dibuat di kunjungan tanpa sinyal: kunjungannya dicari lewat
  // id buatan HP. Antrean mengirim check-in lebih dulu, jadi kunjungan itu
  // sudah ada — kecuali check-in-nya ditolak server.
  let visitId = parsed.data.visitId;
  if (parsed.data.visitClientId) {
    const v = await cariKunjunganAntrean({
      userId: session.user.id,
      storeId: parsed.data.storeId,
      visitClientId: parsed.data.visitClientId,
    });
    if (!v) return { ok: false, code: "KUNJUNGAN_TIDAK_SAH" };
    visitId = v;
  }

  try {
    const { orderId, orderNo, kreditDitahan } = await createFieldSalesOrder({
      storeId: parsed.data.storeId,
      salesmanId: session.user.id,
      visitId,
      note: parsed.data.note,
      lines: parsed.data.lines,
      idempotencyKey: parsed.data.idempotencyKey,
      remoteChannel: parsed.data.remoteChannel ?? null,
      preorderWindowId: parsed.data.preorderWindowId ?? null,
      replacesOrderId: parsed.data.gantiOrderId ?? null,
    });
    revalidatePath(`/pwa/stores/${parsed.data.storeId}`);
    // Dibaca dari input mentah dan diperiksa ketat; penautannya best-effort dan
    // tidak pernah membatalkan pesanan yang sudah tercatat.
    const sumber = bacaSumberKeranjang(typeof input.sumber === "string" ? input.sumber : null);
    if (sumber) {
      await tautkanSumberPesanan(sumber, { orderId, orderNo, userId: session.user.id, storeId: parsed.data.storeId });
      revalidatePath(sumber.jenis === "permintaan" ? "/pwa/permintaan" : "/pwa/rekomendasi");
    }
    if (parsed.data.gantiOrderId) {
      revalidatePath("/pwa/orders");
      revalidatePath(`/pwa/orders/${parsed.data.gantiOrderId}`);
    }
    return { ok: true, orderId, orderNo, kreditDitahan };
  } catch (e) {
    if (e instanceof NoActiveVisitError) return { ok: false, code: "NO_ACTIVE_VISIT" };
    if (e instanceof MinQtyViolationError) return { ok: false, code: "MIN_QTY", violations: e.violations };
    if (e instanceof KreditDiblokirError) return { ok: false, code: "KREDIT_DIBLOKIR", alasan: e.alasan };
    if (e instanceof JarakJauhDitolakError) return { ok: false, code: e.code };
    if (e instanceof IndenDitolakError) return { ok: false, code: "INDEN_DITOLAK", alasan: e.alasan };
    if (e instanceof PesananLamaTidakBisaDigantiError) return { ok: false, code: "PESANAN_LAMA_TIDAK_BISA_DIGANTI" };
    throw e;
  }
}

/** Satu baris gratis promo bonus di pratinjau: `qty` yang akan diberikan, `kurang` yang tidak tertutup stok. */
export type BonusPreview = { promoName: string; productName: string; qty: number; kurang: number };
export type PromoPreviewResult = { lineDiscounts: number[]; orderDiscount: number; netTotal: number; bonus: BonusPreview[] };

// Read-only compute (no persist) so the salesman sees the discounted quote before Kirim.
// Reuses the same computeOrderPromos engine as createFieldSalesOrder's honor-at-create promo block.
export async function previewFieldSalesPromos(input: {
  storeId: string;
  lines: Array<{ itemId: string; qty: number; unitPrice: number; variantSku?: string; productName?: string }>;
  /** Keranjang pre-order: barisnya tidak memakai stok siap, jadi tidak dikurangkan dari stok bonus (sama dengan penulis). */
  inden?: boolean;
}): Promise<PromoPreviewResult> {
  const gross = input.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  const zeros: PromoPreviewResult = { lineDiscounts: input.lines.map(() => 0), orderDiscount: 0, netTotal: gross, bonus: [] };

  const session = await auth();
  if (!session?.user?.id) return zeros;
  if (input.lines.length === 0) return zeros;

  const store = await prisma.store.findUnique({ where: { id: input.storeId }, select: { termsType: true } });
  if (!store || store.termsType === "KONSI") return zeros;

  const itemIds = Array.from(new Set(input.lines.map((l) => l.itemId)));
  const invRows = await prisma.inventoryValue.findMany({
    where: { itemId: { in: itemIds } },
    select: { itemId: true, avgCost: true },
  });
  const avgCostById = new Map<string, number>();
  for (const row of invRows) {
    if (!avgCostById.has(row.itemId)) avgCostById.set(row.itemId, Number(row.avgCost));
  }

  const activePromos = await fetchActivePromosForStore(input.storeId, new Date());
  // Per-item aggregate + pro-rate — SAME helper as createFieldSalesOrder so the quote == the recorded order.
  const applied = applyItemAggregatedPromos(
    input.lines.map((l) => ({ itemId: l.itemId, qty: l.qty, unitPrice: l.unitPrice, avgCost: avgCostById.get(l.itemId) ?? 0 })),
    activePromos,
  );
  const lineDiscounts = applied.lineDiscounts;
  const orderDiscount = applied.orderDiscountAmount;
  const netTotal = gross - lineDiscounts.reduce((s, d) => s + d, 0) - orderDiscount;

  /*
   * Bonus barang — helper yang SAMA dengan penulis pesanan. Keranjang belum
   * dicadangkan, jadi pcs keranjang pada varian yang sama dikurangkan dari stok.
   * Gagal di sini hanya menghilangkan baris bonus dari pratinjau, bukan potongannya.
   */
  let bonus: BonusPreview[] = [];
  try {
    const hasil = await susunBonusPesanan(prisma, {
      storeId: input.storeId,
      now: new Date(),
      lines: input.lines.map((l) => ({ itemId: l.itemId, variantSku: l.variantSku ?? "", qty: l.qty, productName: l.productName })),
      pesananBelumDicadangkan: input.inden !== true,
    });
    bonus = hasil.map((b) => ({ promoName: b.promoName, productName: b.productName, qty: b.qty, kurang: b.kurang }));
  } catch {
    bonus = [];
  }

  return { lineDiscounts, orderDiscount, netTotal, bonus };
}
