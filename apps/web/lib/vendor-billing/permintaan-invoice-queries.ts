import { prisma, type Prisma } from "@elorae/db";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { hariIniWib } from "@/lib/tanggal-isian";
import { kunciDokumenHutang } from "@/lib/purchasing/pembayaran-aturan";
import {
  adalahTerlambat,
  statusBarisPermintaan,
  statusPermintaan,
  type JenisSumberTagih,
  type StatusBarisPermintaan,
  type StatusPermintaan,
} from "./belum-ditagih-aturan";
import { bacaTagihanSumber, type KeadaanSumberTagih } from "./belum-ditagih-queries";

/*
 * Pembaca permintaan invoice ke pemasok (Q18, P19). Statusnya SELALU diturunkan dari keadaan sumbernya
 * sekarang (`statusBarisPermintaan`/`statusPermintaan`); `closedAt` hanya simpanan untuk saringan.
 * KHUSUS SERVER.
 */

type Db = Prisma.TransactionClient | typeof prisma;

const PILIH_PERMINTAAN = {
  id: true,
  supplierId: true,
  channel: true,
  note: true,
  requestedById: true,
  requestedAt: true,
  lastRequestedById: true,
  lastRequestedAt: true,
  askCount: true,
  remindedAt: true,
  closedAt: true,
  closedByBillId: true,
  cancelledAt: true,
  cancelReason: true,
  lines: { select: { id: true, sourceType: true, sourceId: true, label: true, receivedQty: true, billedQty: true, qty: true, amount: true, amountUnknown: true } },
} as const;

type BarisPermintaanDb = Prisma.SupplierInvoiceRequestGetPayload<{ select: typeof PILIH_PERMINTAAN }>;

export type EvaluasiPermintaan = {
  id: string;
  status: StatusPermintaan;
  terlambat: boolean;
  baris: Array<{ id: string; sourceType: JenisSumberTagih; sourceId: string; status: StatusBarisPermintaan }>;
};

/** Perlu tertutup: neto diterima GRN; untuk langkah WO, qty yang diterima saat diminta. */
function keadaanBaris(line: { sourceType: string; receivedQty: Prisma.Decimal }, k: KeadaanSumberTagih | undefined) {
  if (!k) return null;
  return { mati: k.mati, perlu: k.jenis === "GRN" ? k.neto : Number(line.receivedQty), ditagih: k.ditagih, dibebaskan: k.dibebaskan };
}

/** Status setiap permintaan dan barisnya, dari sumbernya sekarang. */
export async function evaluasiPermintaan(db: Db, rows: readonly BarisPermintaanDb[], hariIni: string = hariIniWib()): Promise<Map<string, EvaluasiPermintaan>> {
  const sumber = rows.flatMap((r) => r.lines.map((l) => ({ jenis: l.sourceType as JenisSumberTagih, id: l.sourceId })));
  const keadaan = sumber.length > 0 ? await bacaTagihanSumber(db, sumber) : new Map<string, KeadaanSumberTagih>();
  const out = new Map<string, EvaluasiPermintaan>();
  for (const r of rows) {
    const baris = r.lines.map((l) => ({
      id: l.id,
      sourceType: l.sourceType as JenisSumberTagih,
      sourceId: l.sourceId,
      status: statusBarisPermintaan({ billedQty: Number(l.billedQty) }, keadaanBaris(l, keadaan.get(kunciDokumenHutang(l.sourceType, l.sourceId)))),
    }));
    const status = statusPermintaan({ dibatalkan: r.cancelledAt != null, baris: baris.map((b) => b.status) });
    out.set(r.id, { id: r.id, status, baris, terlambat: adalahTerlambat(status, formatDateOnlyJakarta(r.lastRequestedAt), hariIni) });
  }
  return out;
}

/**
 * Per sumber (`kunciDokumenHutang`), permintaan TERBUKA yang barisnya untuk sumber itu belum terpenuhi —
 * yang terbaru bila lebih dari satu. Untuk status baris "Belum ditagih" dan penolakan `SUDAH_DIMINTA`.
 */
export async function permintaanTerbukaPerSumber(
  db: Db,
  kunci: string[],
  hariIni: string = hariIniWib(),
): Promise<Map<string, { requestId: string; tanggal: string; oleh: string; terlambat: boolean }>> {
  const out = new Map<string, { requestId: string; tanggal: string; oleh: string; terlambat: boolean }>();
  const perJenis = new Map<string, string[]>();
  for (const k of new Set(kunci)) {
    const i = k.indexOf("|");
    if (i <= 0) continue;
    const daftar = perJenis.get(k.slice(0, i)) ?? [];
    daftar.push(k.slice(i + 1));
    perJenis.set(k.slice(0, i), daftar);
  }
  if (perJenis.size === 0) return out;
  const rows = await db.supplierInvoiceRequest.findMany({
    where: {
      cancelledAt: null,
      closedAt: null,
      lines: { some: { OR: [...perJenis].map(([jenis, ids]) => ({ sourceType: jenis, sourceId: { in: ids } })) } },
    },
    select: PILIH_PERMINTAAN,
    orderBy: [{ lastRequestedAt: "desc" }, { id: "desc" }],
  });
  if (rows.length === 0) return out;
  const evaluasi = await evaluasiPermintaan(db, rows, hariIni);
  const nama = new Map(
    (await db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.lastRequestedById))] } }, select: { id: true, name: true, email: true } })).map((u) => [
      u.id,
      u.name || u.email || u.id,
    ]),
  );
  for (const r of rows) {
    const e = evaluasi.get(r.id);
    if (!e || e.status !== "TERBUKA") continue;
    for (const b of e.baris) {
      if (b.status !== "BELUM" && b.status !== "SEBAGIAN") continue;
      const k = kunciDokumenHutang(b.sourceType, b.sourceId);
      if (out.has(k)) continue;
      out.set(k, { requestId: r.id, tanggal: formatDateOnlyJakarta(r.lastRequestedAt), oleh: nama.get(r.lastRequestedById) ?? "", terlambat: e.terlambat });
    }
  }
  return out;
}

export type BarisPermintaanInvoice = {
  id: string;
  supplierId: string;
  supplierName: string;
  supplierPhone: string | null;
  channel: string;
  note: string | null;
  requestedAt: string;
  requestedBy: string;
  lastRequestedAt: string;
  lastRequestedBy: string;
  askCount: number;
  remindedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  closedByBillId: string | null;
  status: StatusPermintaan;
  terlambat: boolean;
  lines: Array<{ id: string; sourceType: JenisSumberTagih; sourceId: string; label: string; qty: number; amount: number; amountUnknown: boolean; status: StatusBarisPermintaan }>;
};

/** Daftar permintaan invoice, terbaru dulu (paling banyak 500). */
export async function daftarPermintaanInvoice(
  o: { supplierId?: string; status?: "terbuka" | "terlambat" | "selesai"; hariIni?: string },
  db: Db = prisma,
): Promise<BarisPermintaanInvoice[]> {
  const hariIni = o.hariIni ?? hariIniWib();
  const rows = await db.supplierInvoiceRequest.findMany({
    where: {
      ...(o.supplierId ? { supplierId: o.supplierId } : {}),
      ...(o.status === "terbuka" || o.status === "terlambat" ? { cancelledAt: null } : {}),
    },
    select: PILIH_PERMINTAAN,
    orderBy: [{ lastRequestedAt: "desc" }, { id: "desc" }],
    take: 500,
  });
  const evaluasi = await evaluasiPermintaan(db, rows, hariIni);
  const userIds = [...new Set(rows.flatMap((r) => [r.requestedById, r.lastRequestedById]))];
  const [users, pemasok] = await Promise.all([
    db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }),
    db.supplier.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.supplierId))] } }, select: { id: true, name: true, phone: true } }),
  ]);
  const nama = new Map(users.map((u) => [u.id, u.name || u.email || u.id]));
  const sup = new Map(pemasok.map((p) => [p.id, p]));
  return rows
    .map((r) => {
      const e = evaluasi.get(r.id)!;
      const statusBaris = new Map(e.baris.map((b) => [b.id, b.status]));
      return {
        id: r.id,
        supplierId: r.supplierId,
        supplierName: sup.get(r.supplierId)?.name ?? "",
        supplierPhone: sup.get(r.supplierId)?.phone ?? null,
        channel: r.channel,
        note: r.note,
        requestedAt: r.requestedAt.toISOString(),
        requestedBy: nama.get(r.requestedById) ?? "",
        lastRequestedAt: r.lastRequestedAt.toISOString(),
        lastRequestedBy: nama.get(r.lastRequestedById) ?? "",
        askCount: r.askCount,
        remindedAt: r.remindedAt?.toISOString() ?? null,
        cancelledAt: r.cancelledAt?.toISOString() ?? null,
        cancelReason: r.cancelReason,
        closedByBillId: r.closedByBillId,
        status: e.status,
        terlambat: e.terlambat,
        lines: r.lines.map((l) => ({
          id: l.id,
          sourceType: l.sourceType as JenisSumberTagih,
          sourceId: l.sourceId,
          label: l.label,
          qty: Number(l.qty),
          amount: Number(l.amount),
          amountUnknown: l.amountUnknown,
          status: statusBaris.get(l.id) ?? "BELUM",
        })),
      };
    })
    .filter((r) => (o.status === "terbuka" ? r.status === "TERBUKA" : o.status === "terlambat" ? r.terlambat : o.status === "selesai" ? r.status !== "TERBUKA" : true));
}

/** Beranda: permintaan yang masih TERBUKA 7 hari kalender WIB sesudah diminta terakhir (P19). */
export async function hitungPermintaanInvoiceTerlambat(asOf?: Date): Promise<number> {
  return (await daftarPermintaanInvoice({ status: "terlambat", hariIni: asOf ? formatDateOnlyJakarta(asOf) : undefined })).length;
}

export { PILIH_PERMINTAAN };
