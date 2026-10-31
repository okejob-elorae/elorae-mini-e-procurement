import {
  consumeFieldSalesOrderPartial,
  releaseFieldSalesOrder,
  PartialConsumeError,
  prisma,
  type Prisma,
  type PrismaClient,
} from "@elorae/db";
import { buildOfflineSalesHistoryRows } from "@elorae/db/field-sales";
import { roundCents, roundToWholeRupiah } from "@elorae/db/pricing";
import { generateDocNumber } from "@/lib/docNumber";
import { runSerializable } from "@/lib/db/tx-retry";
import { antrekanPushStok } from "@/lib/jubelio/antre-push-stok";
import { DeliveryError, type DeliveryErrorCode, type DeliveryReplayDetail } from "../errors";
import { IndenBelumRilisError } from "../inden";
import { outstandingQty, nextDeliveryStatus, allocateDeliveryDiscounts } from "./plan";

/**
 * Nomor nota sudah dipegang piutang lain (impor atau faktur manual), jadi piutang nota ini tidak
 * bisa dibuat dengan nomornya sendiri. Pengiriman ikut DIBATALKAN: nota yang tercatat tanpa
 * piutang justru keadaan yang dicegah aturan ini, dan dua tagihan tidak ditumpuk pada satu nomor.
 * Pengiriman baru hampir tidak pernah sampai ke sini — `nomorNotaBebas` melompati nomor yang
 * dipegang piutang; yang tersisa adalah backfill nota lama (dilaporkan, tidak dibuat).
 */
export class NomorPiutangDipakaiError extends Error {
  constructor(readonly invoiceNo: string, readonly receivableId: string) {
    super(`Nomor ${invoiceNo} sudah dipakai piutang ${receivableId}`);
    this.name = "NomorPiutangDipakaiError";
  }
}

/**
 * Cadangan stok baris pesanan tidak bisa dikonsumsi sebanyak yang diminta walau sisa pesanannya
 * cukup (`PartialConsumeError` OVER_CONSUME): cadangannya sudah CONSUMED atau tidak ada. Bentuk
 * nyatanya: pesanan yang disetujui image lama sesudah migrasi backfill (stok sudah keluar saat
 * disetujui, tanpa pengiriman `bf_`). Kode sendiri — bukan OVER_DELIVER ("melebihi sisa"), yang
 * tidak benar dan menyembunyikan jalan keluarnya (backfill pesanan itu dengan tangan).
 */
export class CadanganTidakCocokError extends DeliveryError {
  constructor() {
    super("RESERVATION_MISMATCH");
    this.name = "CadanganTidakCocokError";
  }
}

/** Rupiah → sen bulat; kolom uang 2 desimal. */
const sen = (n: number) => Math.round(n * 100);

/**
 * Piutang untuk satu nota tagihan pengiriman putus (keputusan pemilik: setiap nota tagihan
 * otomatis menjadi piutang). Dipanggil DI DALAM transaksi pengiriman, jadi nota dan piutangnya
 * lahir atau batal bersama.
 *
 * - Nota bernilai 0 atau kurang (hanya barang bonus) tidak menjadi piutang: tidak ada yang ditagih.
 * - Nota yang sudah punya piutang dilewati (`deliveryId` unik) — aman dipanggil ulang oleh backfill.
 * - `outstanding` = `amount`: piutang baru belum disentuh klaim apa pun. Kolom itu cache; sisa
 *   yang benar selalu dihitung ulang dari klaim oleh pembacanya (`hitungUlangPiutang`).
 * - `salesmanId` = sales pemilik pesanan, bukan orang yang mencatat pengiriman.
 * - Konsinyasi tidak pernah sampai ke sini: pengiriman hanya ada untuk pesanan PUTUS.
 */
export async function buatPiutangNota(
  tx: Prisma.TransactionClient,
  nota: {
    deliveryId: string;
    docNo: string;
    storeId: string;
    salesmanId: string | null;
    invoiceDate: Date;
    dueDate: Date;
    total: number;
  },
): Promise<{ dibuat: true; receivableId: string } | { dibuat: false; alasan: "NOL" | "SUDAH_ADA" }> {
  // Dibandingkan dalam sen: sisa pembulatan float (mis. 1e-11) bukan tagihan, dan kolomnya 2 desimal.
  if (!(sen(nota.total) > 0)) return { dibuat: false, alasan: "NOL" };

  const sudah = await tx.receivable.findUnique({ where: { deliveryId: nota.deliveryId }, select: { id: true } });
  if (sudah) return { dibuat: false, alasan: "SUDAH_ADA" };

  const bentrok = await tx.receivable.findUnique({ where: { invoiceNo: nota.docNo }, select: { id: true } });
  if (bentrok) throw new NomorPiutangDipakaiError(nota.docNo, bentrok.id);

  const piutang = await tx.receivable.create({
    data: {
      invoiceNo: nota.docNo,
      storeId: nota.storeId,
      salesmanId: nota.salesmanId,
      invoiceDate: nota.invoiceDate,
      dueDate: nota.dueDate,
      amount: nota.total,
      outstanding: nota.total,
      originalAmount: nota.total,
      outstandingAmount: nota.total,
      source: "DELIVERY",
      deliveryId: nota.deliveryId,
    },
    select: { id: true },
  });
  return { dibuat: true, receivableId: piutang.id };
}

/**
 * Nomor nota juga nomor piutangnya, jadi nomor yang sudah dipegang piutang lain (faktur manual
 * atau impor yang kebetulan berformat DLV) ikut dilompati — `generateDocNumber` hanya tahu nomor
 * yang dipakai NOTA. Tanpa ini nota tersebut ditolak, penghitung ikut ter-rollback, dan setiap
 * pengiriman sesudahnya di bulan itu ditolak dengan nomor yang sama: tidak ada layar untuk
 * mengganti nomor piutang. Kalau sampai batas masih bentrok, `buatPiutangNota` yang menolak.
 */
const BATAS_LOMPAT_NOMOR_PIUTANG = 20;

async function nomorNotaBebas(tx: Prisma.TransactionClient): Promise<string> {
  let docNo = await generateDocNumber("DELIVERY", tx);
  for (let i = 0; i < BATAS_LOMPAT_NOMOR_PIUTANG; i++) {
    const dipegang = await tx.receivable.findUnique({ where: { invoiceNo: docNo }, select: { id: true } });
    if (!dipegang) return docNo;
    docNo = await generateDocNumber("DELIVERY", tx);
  }
  return docNo;
}

export type LaporanPiutangNotaLama = {
  /** Nota yang diperiksa (dalam cakupan). */
  diperiksa: number;
  /** Sudah punya piutang — tidak disentuh. */
  sudahPunya: number;
  /** Akan dibuat (mode kering) / dicoba dibuat (mode terapkan). */
  akanDibuat: number;
  nilaiAkanDibuat: number;
  /** Benar-benar dibuat (hanya mode terapkan). */
  dibuat: number;
  nilaiDibuat: number;
  /** Bernilai 0 atau kurang: tidak ada yang ditagih. */
  nol: Array<{ docNo: string; total: number }>;
  /** Pesanannya bukan PUTUS — seharusnya tidak pernah ada; dilaporkan, tidak dibuat. */
  bukanPutus: Array<{ docNo: string; orderType: string }>;
  /** Nomornya sudah dipegang piutang lain — butuh keputusan orang, tidak dibuat. */
  nomorDipakai: Array<{ docNo: string; receivableId: string; source: string }>;
  /**
   * Mungkin sudah ditagih dengan nomor lain: ada piutang impor/manual tanpa nota di toko yang sama,
   * bernilai sama persis, bertanggal berdekatan. Tidak dibuat kecuali `sertakanDugaanGanda`.
   */
  dugaanGanda: Array<{ docNo: string; total: number; receivableId: string; invoiceNo: string; source: string }>;
};

/** Jarak tanggal faktur (hari) yang masih dianggap "tagihan yang sama" untuk dugaan ganda. */
const JENDELA_DUGAAN_GANDA_HARI = 31;

/**
 * Backfill: piutang untuk nota tagihan yang tercatat sebelum aturan "nota = piutang" ada.
 * Mode kering (`terapkan: false`) tidak menulis apa pun. Mode terapkan membuat tiap piutang di
 * transaksinya sendiri dengan aturan yang sama persis dengan penulis pengiriman
 * (`buatPiutangNota`), jadi aman dijalankan ulang.
 *
 * Sebelum aturan ini kantor mencatat nota ke piutang dengan tangan atau lewat impor SSG, dengan
 * nomor LAIN — tidak bisa dicocokkan lewat nomor. Nota yang punya pasangan seperti itu (toko sama,
 * nilai sama sampai sen, tanggal faktur ≤ 31 hari) dilaporkan sebagai dugaan ganda dan TIDAK
 * dibuat: menagih toko dua kali lebih buruk daripada satu nota yang belum menjadi piutang. Setiap
 * piutang lain hanya bisa "menjelaskan" satu nota. Setelah diperiksa orang, `sertakanDugaanGanda`
 * membuatnya juga.
 *
 * `deliveryIds` membatasi cakupan — tes WAJIB memakainya (basis data uji dipakai bersama data
 * dev sungguhan; fungsi selebar basis data tidak boleh dipanggil tes tanpa batas).
 */
export async function isiPiutangNotaLama(opsi: {
  terapkan: boolean;
  deliveryIds?: string[];
  sertakanDugaanGanda?: boolean;
}): Promise<LaporanPiutangNotaLama> {
  const laporan: LaporanPiutangNotaLama = {
    diperiksa: 0,
    sudahPunya: 0,
    akanDibuat: 0,
    nilaiAkanDibuat: 0,
    dibuat: 0,
    nilaiDibuat: 0,
    nol: [],
    bukanPutus: [],
    nomorDipakai: [],
    dugaanGanda: [],
  };

  const nota = await prisma.fieldSalesDelivery.findMany({
    where: opsi.deliveryIds ? { id: { in: opsi.deliveryIds } } : {},
    orderBy: { deliveredAt: "asc" },
    select: {
      id: true,
      docNo: true,
      invoiceDate: true,
      dueDate: true,
      total: true,
      receivable: { select: { id: true } },
      order: { select: { storeId: true, salesmanId: true, orderType: true } },
    },
  });

  const nomorSemua = nota.map((n) => n.docNo);
  const pemegangNomor = new Map(
    (
      await prisma.receivable.findMany({
        where: { invoiceNo: { in: nomorSemua } },
        select: { id: true, invoiceNo: true, deliveryId: true, source: true },
      })
    ).map((r) => [r.invoiceNo, r]),
  );

  // Calon pasangan dugaan ganda: piutang impor/manual tanpa nota di toko-toko dalam cakupan,
  // kecuali yang memegang nomor nota itu sendiri (sudah dilaporkan sebagai `nomorDipakai`).
  const idPemegang = new Set([...pemegangNomor.values()].map((r) => r.id));
  const calonGanda = (
    await prisma.receivable.findMany({
      where: {
        storeId: { in: [...new Set(nota.map((n) => n.order.storeId))] },
        source: { in: ["IMPORT", "MANUAL"] },
        deliveryId: null,
      },
      select: { id: true, storeId: true, invoiceNo: true, invoiceDate: true, amount: true, source: true },
    })
  ).filter((r) => !idPemegang.has(r.id));
  const sudahDipasangkan = new Set<string>();
  const jendelaMs = JENDELA_DUGAAN_GANDA_HARI * 24 * 60 * 60 * 1000;
  const cariPasanganGanda = (n: (typeof nota)[number], total: number) => {
    let terbaik: (typeof calonGanda)[number] | null = null;
    for (const r of calonGanda) {
      if (sudahDipasangkan.has(r.id) || r.storeId !== n.order.storeId) continue;
      if (sen(Number(r.amount)) !== sen(total)) continue;
      const jarak = Math.abs(r.invoiceDate.getTime() - n.invoiceDate.getTime());
      if (jarak > jendelaMs) continue;
      if (!terbaik || jarak < Math.abs(terbaik.invoiceDate.getTime() - n.invoiceDate.getTime())) terbaik = r;
    }
    return terbaik;
  };

  for (const n of nota) {
    laporan.diperiksa += 1;
    if (n.receivable) {
      laporan.sudahPunya += 1;
      continue;
    }
    const total = Number(n.total);
    if (n.order.orderType !== "PUTUS") {
      laporan.bukanPutus.push({ docNo: n.docNo, orderType: n.order.orderType });
      continue;
    }
    if (!(sen(total) > 0)) {
      laporan.nol.push({ docNo: n.docNo, total });
      continue;
    }
    const pemegang = pemegangNomor.get(n.docNo);
    if (pemegang && pemegang.deliveryId !== n.id) {
      laporan.nomorDipakai.push({ docNo: n.docNo, receivableId: pemegang.id, source: pemegang.source });
      continue;
    }
    const ganda = cariPasanganGanda(n, total);
    if (ganda) {
      sudahDipasangkan.add(ganda.id);
      laporan.dugaanGanda.push({ docNo: n.docNo, total, receivableId: ganda.id, invoiceNo: ganda.invoiceNo, source: ganda.source });
      if (!opsi.sertakanDugaanGanda) continue;
    }

    laporan.akanDibuat += 1;
    laporan.nilaiAkanDibuat += total;
    if (!opsi.terapkan) continue;

    try {
      const hasil = await runSerializable((tx) =>
        buatPiutangNota(tx, {
          deliveryId: n.id,
          docNo: n.docNo,
          storeId: n.order.storeId,
          salesmanId: n.order.salesmanId,
          invoiceDate: n.invoiceDate,
          dueDate: n.dueDate,
          total,
        }),
      );
      if (hasil.dibuat) {
        laporan.dibuat += 1;
        laporan.nilaiDibuat += total;
      } else if (hasil.alasan === "SUDAH_ADA") {
        laporan.sudahPunya += 1;
      }
    } catch (e) {
      // Nomor baru saja dipakai orang lain di antara pembacaan dan penulisan.
      if (e instanceof NomorPiutangDipakaiError) {
        laporan.nomorDipakai.push({ docNo: n.docNo, receivableId: e.receivableId, source: "?" });
        continue;
      }
      throw e;
    }
  }

  return laporan;
}

/**
 * Every `PartialConsumeError` code mapped by construction: a code added to that union without an
 * entry here is a type error, never a silent fallback onto some unrelated delivery code.
 * `OVER_CONSUME` is not a quantity error — see the consume call below.
 */
const PARTIAL_CONSUME_CODE: Record<PartialConsumeError["code"], DeliveryErrorCode> = {
  INSUFFICIENT_STOCK: "INSUFFICIENT_STOCK",
  OVER_CONSUME: "RESERVATION_MISMATCH",
};

/**
 * The delivery already recorded under `idempotencyKey`, as the `REPLAY_MISMATCH` detail carries
 * it: lines summed per `orderLineId`. Shared by `recordFieldSalesDelivery`'s replay compare and by
 * `completeDeliveryShipment`'s all-zero retry, which never reaches that compare, so both refuse
 * with the same recorded values.
 */
export async function findRecordedDelivery(
  client: PrismaClient | Prisma.TransactionClient,
  idempotencyKey: string,
  orderId: string,
): Promise<DeliveryReplayDetail | null> {
  const existing = await client.fieldSalesDelivery.findUnique({
    where: { idempotencyKey },
    select: {
      id: true,
      orderId: true,
      docNo: true,
      invoiceDate: true,
      dueDate: true,
      lines: { select: { orderLineId: true, qty: true } },
    },
  });
  if (!existing) return null;
  /* A key is only a replay of THIS order's delivery; another order's must never hand back its values or post its journals. */
  if (existing.orderId !== orderId) throw new DeliveryError("INVALID_STATE");
  const recorded = new Map<string, number>();
  for (const l of existing.lines) recorded.set(l.orderLineId, (recorded.get(l.orderLineId) ?? 0) + l.qty);
  return {
    deliveryId: existing.id,
    docNo: existing.docNo,
    invoiceDate: existing.invoiceDate,
    dueDate: existing.dueDate,
    lines: Array.from(recorded, ([orderLineId, qty]) => ({ orderLineId, qty })),
  };
}

/**
 * `idempotencyKey` is kept across a failed submit on purpose, so a genuine retry — including one
 * after a lost success response — cannot ship twice. A matching key therefore returns the
 * recorded delivery, but only when the retry asks for the SAME thing: same per-`orderLineId`
 * quantity totals and, under the default `replayCompare`, the same invoice/due dates (exact
 * instants). A retry that differs is REFUSED with `REPLAY_MISMATCH` carrying the recorded values,
 * because returning the original would report success while silently discarding the operator's
 * correction. The key is never rotated to get around this: after a lost-response success a fresh
 * key would ship the order twice. Checked before any write, so the refusal leaves nothing behind.
 *
 * `replayCompare: "linesOnly"` is for `completeDeliveryShipment` on a `SALESMAN_CARRY` shipment
 * only, whose `shipment-<id>` key is replayed with dates the caller does not own: that completion
 * always sends the frozen shipment row's dates, so once Edit nota dates corrected the recorded
 * delivery in the crash window, a dates compare would refuse every retry forever. There the
 * recorded delivery's dates are the accounting truth, corrected only through Edit nota dates, and
 * the quantities are what desync the shipment from it. Every caller that owns its dates keeps the
 * strict default — a hand-entered delivery, and an `EXPEDITION` shipment completion, whose operator
 * types the dates into the completion dialog — because a changed date there is a correction the
 * replay must not swallow.
 */
export async function recordFieldSalesDelivery(input: {
  orderId: string;
  deliveredById: string;
  lines: Array<{ orderLineId: string; qty: number }>;
  note?: string;
  invoiceDate: Date;
  dueDate: Date;
  idempotencyKey?: string;
  replayCompare?: "datesAndLines" | "linesOnly";
  deliveredAt?: Date;
}): Promise<{ deliveryId: string; docNo: string }> {
  if (input.lines.length === 0) throw new DeliveryError("NO_LINES");

  if (input.dueDate.getTime() < input.invoiceDate.getTime()) {
    throw new DeliveryError("INVALID_DATES");
  }

  // Barang yang stoknya keluar di percobaan yang COMMIT (diulang dari nol tiap percobaan;
  // kiriman ulang dengan kunci yang sama tidak menggerakkan apa pun).
  let barangKeluar: string[] = [];
  const hasil = await runSerializable(async (tx) => {
    barangKeluar = [];
    if (input.idempotencyKey) {
      const recorded = await findRecordedDelivery(tx, input.idempotencyKey, input.orderId);
      if (recorded) {
        const recordedQty = new Map(recorded.lines.map((l) => [l.orderLineId, l.qty]));
        const asked = new Map<string, number>();
        for (const l of input.lines) asked.set(l.orderLineId, (asked.get(l.orderLineId) ?? 0) + l.qty);
        const sameLines =
          Array.from(recordedQty.keys()).every((id) => asked.get(id) === recordedQty.get(id)) &&
          Array.from(asked.keys()).every((id) => recordedQty.get(id) === asked.get(id));
        const sameDates =
          input.replayCompare === "linesOnly" ||
          (recorded.invoiceDate.getTime() === input.invoiceDate.getTime() &&
            recorded.dueDate.getTime() === input.dueDate.getTime());
        if (!sameLines || !sameDates) throw new DeliveryError("REPLAY_MISMATCH", [], recorded);
        return { deliveryId: recorded.deliveryId, docNo: recorded.docNo };
      }
    }

    const order = await tx.fieldSalesOrder.findUnique({
      where: { id: input.orderId },
      include: {
        lines: { include: { item: { select: { sku: true, category: { select: { name: true } } } } } },
        deliveries: { select: { discountAmount: true, lines: { select: { orderLineId: true, discountAmount: true } } } },
      },
    });
    if (!order) throw new DeliveryError("NOT_FOUND");
    if (order.status !== "APPROVED" || order.orderType !== "PUTUS") throw new DeliveryError("INVALID_STATE");

    /*
     * Pre-order: stoknya baru dicadangkan saat jendela dirilis (barang datang).
     * Sebelum itu tidak ada reservasi untuk dikonsumsi — tanpa penjaga ini
     * pengiriman jatuh ke OVER_DELIVER, pesan yang keliru dan tidak menunjukkan
     * jalan keluarnya. Jendela yang hilang dianggap belum dirilis (tidak ada
     * yang pernah mencadangkan pesanan itu).
     */
    if (order.preorderWindowId) {
      const jendela = await tx.preorderWindow.findUnique({ where: { id: order.preorderWindowId }, select: { releasedAt: true } });
      if (!jendela?.releasedAt) throw new IndenBelumRilisError(order.id);
    }

    const lineById = new Map(order.lines.map((l) => [l.id, l]));
    const requested = new Map<string, number>();
    for (const l of input.lines) {
      if (!Number.isInteger(l.qty) || l.qty <= 0) throw new DeliveryError("OVER_DELIVER");
      const orderLine = lineById.get(l.orderLineId);
      if (!orderLine) throw new DeliveryError("NOT_FOUND");
      const outstanding = outstandingQty({
        orderLineId: orderLine.id,
        qty: orderLine.qty,
        deliveredQty: orderLine.deliveredQty,
        cancelledQty: orderLine.cancelledQty,
      });
      const total = (requested.get(l.orderLineId) ?? 0) + l.qty;
      if (total > outstanding) throw new DeliveryError("OVER_DELIVER");
      requested.set(l.orderLineId, total);
    }

    const closesOrder = order.lines.every((ol) => {
      const delivered = ol.deliveredQty + (requested.get(ol.id) ?? 0);
      return ol.qty - delivered - ol.cancelledQty === 0;
    });

    const lineDiscountAllocated = new Map<string, number>();
    for (const d of order.deliveries) {
      for (const dl of d.lines) {
        lineDiscountAllocated.set(dl.orderLineId, (lineDiscountAllocated.get(dl.orderLineId) ?? 0) + Number(dl.discountAmount));
      }
    }
    const orderDiscountAllocated = order.deliveries.reduce((s, d) => s + Number(d.discountAmount), 0);

    const deliveredLines = Array.from(requested, ([orderLineId, qty]) => {
      const ol = lineById.get(orderLineId)!;
      return { ol, qty, deliveredSubtotal: qty * Number(ol.unitPrice) };
    });

    const allocation = allocateDeliveryDiscounts({
      closesOrder,
      orderSubtotal: Number(order.subtotal),
      orderDiscount: Number(order.orderDiscountAmount),
      orderDiscountAllocated,
      /**
       * Every order line, not just the ones in this delivery: a line that finished in an earlier
       * delivery can still be holding rounding residue that only the closing delivery can absorb.
       */
      lines: order.lines.map((ol) => {
        const qty = requested.get(ol.id) ?? 0;
        return {
          orderLineId: ol.id,
          lineDiscount: Number(ol.discountAmount),
          orderedQty: ol.qty,
          deliveredQty: qty,
          lineDiscountAllocated: lineDiscountAllocated.get(ol.id) ?? 0,
          deliveredSubtotal: qty * Number(ol.unitPrice),
        };
      }),
    });
    const lineDiscountByOrderLine = new Map(allocation.lineDiscounts.map((l) => [l.orderLineId, l.discountAmount]));

    /**
     * `subtotal`, the discounts and every line figure stay exact 2dp; `total` is the whole-rupiah
     * CHARGED figure, the same cash-boundary rule as `VanSale.total`/`SpgSale.total`. A store pays
     * a nota tagihan in whole rupiah, so a total carrying sen left its receivable at a sub-rupiah
     * `PARTIAL` that no real payment could clear. Rounding here, once, is what makes every figure
     * downstream agree: the receivable is created from `total`, the revenue journal posts `total` on
     * both its AR and SALES_REVENUE sides, and the nota prints it. The exact figure stays derivable
     * as `subtotal - discountAmount - Σ line discountAmount`, which is what the undelivered-residual
     * readers measure against the order. `roundCents` first so a float sum that lands a hair under
     * a half rupiah (`x.4999999`) still rounds half-up as its 2dp value would.
     */
    const subtotal = deliveredLines.reduce((s, d) => s + d.deliveredSubtotal, 0);
    const lineDiscountTotal = allocation.lineDiscounts.reduce((s, l) => s + l.discountAmount, 0);
    const total = roundToWholeRupiah(roundCents(subtotal - lineDiscountTotal - allocation.orderDiscountAmount));

    const docNo = await nomorNotaBebas(tx);
    const now = input.deliveredAt ?? new Date();

    const delivery = await tx.fieldSalesDelivery.create({
      data: {
        docNo,
        orderId: order.id,
        deliveredAt: now,
        deliveredById: input.deliveredById,
        invoiceDate: input.invoiceDate,
        dueDate: input.dueDate,
        subtotal,
        discountAmount: allocation.orderDiscountAmount,
        total,
        note: input.note,
        idempotencyKey: input.idempotencyKey ?? null,
        lines: {
          create: deliveredLines.map((d) => ({
            orderLineId: d.ol.id,
            itemId: d.ol.itemId,
            variantSku: d.ol.variantSku,
            productName: d.ol.productName,
            qty: d.qty,
            unitPrice: Number(d.ol.unitPrice),
            discountAmount: lineDiscountByOrderLine.get(d.ol.id) ?? 0,
            lineTotal: d.deliveredSubtotal,
          })),
        },
      },
      select: { id: true, docNo: true },
    });

    await tx.taxInvoice.create({
      data: { deliveryId: delivery.id },
    });

    /*
     * Nota tagihan = piutang, di transaksi yang sama: cek kredit toko membaca piutang, jadi nota
     * yang keluar tanpa piutang membuat toko tampak bersih padahal sudah berutang. Kiriman ulang
     * dengan kunci idempoten yang sama sudah kembali di atas sebelum sampai ke sini.
     */
    await buatPiutangNota(tx, {
      deliveryId: delivery.id,
      docNo: delivery.docNo,
      storeId: order.storeId,
      salesmanId: order.salesmanId,
      invoiceDate: input.invoiceDate,
      dueDate: input.dueDate,
      total,
    });

    /**
     * `OVER_CONSUME` is not a quantity error — the quantities were checked against the order lines
     * above. It means a line's `StockReservation` is missing, no longer `RESERVED` (released, or
     * already consumed), or would be over-consumed, i.e. the reservation disagrees with the
     * deliveries recorded against it. The most likely cause is the delivery-rollout deploy race: an
     * order the OLD image approved after the backfill migration ran was consumed with no backfilled
     * delivery. It surfaces as `RESERVATION_MISMATCH`; the remedy is an admin repair of the order
     * (for the deploy race, the per-order hand-run of that migration's statements,
     * `20260809130000_backfill_field_sales_deliveries`), never a retry.
     *
     * Consume AFTER the delivery row exists so the audit adjustment can key on the real delivery
     * id. Everything here is one serializable transaction, so a short-stock throw rolls the
     * delivery back with it.
     */
    let consumeResult: Awaited<ReturnType<typeof consumeFieldSalesOrderPartial>>;
    try {
      consumeResult = await consumeFieldSalesOrderPartial(tx, {
        orderNo: order.orderNo,
        deliveryId: delivery.id,
        lines: deliveredLines.map((d) => ({
          fieldSalesLineId: d.ol.id,
          itemId: d.ol.itemId,
          variantSku: d.ol.variantSku,
          qty: d.qty,
        })),
      });
    } catch (e) {
      if (e instanceof PartialConsumeError) {
        if (e.code === "OVER_CONSUME") throw new CadanganTidakCocokError();
        throw new DeliveryError(
          PARTIAL_CONSUME_CODE[e.code],
          e.shortLines.map((s) => ({ orderLineId: s.fieldSalesLineId, requested: s.requested, onHand: s.onHand, available: s.available })),
        );
      }
      throw e;
    }

    const cogsAmount = consumeResult.lines.reduce((s, l) => s + l.qty * l.avgCost, 0);
    await tx.fieldSalesDelivery.update({
      where: { id: delivery.id },
      data: { cogsAmount },
    });

    for (const d of deliveredLines) {
      await tx.fieldSalesOrderLine.update({
        where: { id: d.ol.id },
        data: { deliveredQty: { increment: d.qty } },
      });
      barangKeluar.push(d.ol.itemId);
    }

    const settled = order.lines.map((ol) => ({
      orderLineId: ol.id,
      qty: ol.qty,
      deliveredQty: ol.deliveredQty + (requested.get(ol.id) ?? 0),
      cancelledQty: ol.cancelledQty,
    }));
    await tx.fieldSalesOrder.update({
      where: { id: order.id },
      data: { deliveryStatus: nextDeliveryStatus(settled) },
    });

    /**
     * SalesHistory is keyed (channel, orderId, variantSku), so each delivery files under its own
     * docNo — an order number would collide on the second delivery of the same variant.
     */
    const rows = buildOfflineSalesHistoryRows({
      orderNo: delivery.docNo,
      orderTotal: total,
      lines: deliveredLines.map((d) => {
        const disc = lineDiscountByOrderLine.get(d.ol.id) ?? 0;
        const net = d.deliveredSubtotal - disc;
        return {
          itemId: d.ol.itemId,
          variantSku: d.ol.variantSku,
          parentSku: d.ol.item.sku,
          productName: d.ol.productName,
          qty: d.qty,
          unitPrice: d.qty > 0 ? net / d.qty : 0,
          lineTotal: net,
          productCategory: d.ol.item.category?.name ?? null,
        };
      }),
    }).map((row) => ({ ...row, orderDate: now, completedDate: now }));
    await tx.salesHistory.createMany({ data: rows });

    return { deliveryId: delivery.id, docNo: delivery.docNo };
  });

  /*
   * Sesudah commit. Selama cadangannya cukup, onHand dan reserved turun bersama
   * sehingga available tetap — tapi pesanan yang dicadangkan kurang (oversell
   * diperingatkan, tidak ditolak) memang menurunkan available. Push mengirim
   * angka mutlak, jadi mengirimnya pada setiap pengiriman selalu aman.
   */
  if (barangKeluar.length > 0) {
    await antrekanPushStok(barangKeluar, { sumber: "ADJUSTMENT", ref: `kirim putus ${hasil.docNo}`, userId: input.deliveredById });
  }
  return hasil;
}

export async function closeFieldSalesOrderRemainder(input: {
  orderId: string;
  closedById: string;
  reason: string;
}): Promise<{ ok: true }> {
  let barangDilepas: string[] = [];
  let nomorPesanan = "";
  const hasil = await runSerializable(async (tx) => {
    barangDilepas = [];
    const order = await tx.fieldSalesOrder.findUnique({
      where: { id: input.orderId },
      include: { lines: true },
    });
    if (!order) throw new DeliveryError("NOT_FOUND");
    if (order.status !== "APPROVED") throw new DeliveryError("INVALID_STATE");

    const openLines = order.lines.filter((l) => outstandingQty(l) > 0);
    if (openLines.length === 0) throw new DeliveryError("INVALID_STATE");

    /**
     * Refused, not netted, while a shipment is still PACKED or IN_TRANSIT. The release below flips
     * each line's whole reservation — a partial release per reservation is not expressible — so
     * the in-flight shipment would then complete against nothing, and netting its planned qty out
     * would still let the admin close units that are physically on a truck. Checked before any
     * write, for putus as well as konsi.
     */
    const inFlight = await tx.deliveryShipment.count({
      where: { orderId: order.id, status: { in: ["PACKED", "IN_TRANSIT"] } },
    });
    if (inFlight > 0) throw new DeliveryError("SHIPMENT_IN_FLIGHT");

    for (const l of openLines) {
      await tx.fieldSalesOrderLine.update({
        where: { id: l.id },
        data: { cancelledQty: { increment: outstandingQty(l) } },
      });
    }

    await releaseFieldSalesOrder(tx, { fieldSalesLineIds: openLines.map((l) => l.id) });
    barangDilepas = openLines.map((l) => l.itemId);
    nomorPesanan = order.orderNo;

    const settled = order.lines.map((l) => ({
      orderLineId: l.id,
      qty: l.qty,
      deliveredQty: l.deliveredQty,
      cancelledQty: l.cancelledQty + outstandingQty(l),
    }));
    /**
     * The reason lands in its own column, never in `note` — that field is the salesman's PWA note
     * and is rendered as "Catatan" on the detail page, so appending to it would blend an admin's
     * cancellation reason into user-authored text with no way to separate them later.
     */
    await tx.fieldSalesOrder.update({
      where: { id: order.id },
      data: {
        deliveryStatus: nextDeliveryStatus(settled),
        closedAt: new Date(),
        closedById: input.closedById,
        closeReason: input.reason,
      },
    });

    return { ok: true as const };
  });

  // Sesudah commit: sisa cadangan dilepas, available naik — teruskan ke Jubelio.
  await antrekanPushStok(barangDilepas, { sumber: "ADJUSTMENT", ref: `tutup sisa pesanan putus ${nomorPesanan}`, userId: input.closedById });
  return hasil;
}
