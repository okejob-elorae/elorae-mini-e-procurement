import { JournalError, konsiTransferKeyForLine, postJournal, prisma, type Prisma, type PrismaClient } from "@elorae/db";
import type { PostingRole } from "@/lib/constants/journal-roles";
import { generateAutoJournal, type AutoJournalLine } from "@/lib/finance/journal";
import { resolveAccount, UnmappedRoleError } from "@/lib/finance/journals/mapping";
import { gabungBaris, type BarisBertanda } from "@/lib/finance/lapangan/aturan";
import { bacaBahanRetur } from "@/lib/finance/lapangan/jurnal";
import { selaraskanJurnal, type HasilSelaras, type SasaranDokumen } from "@/lib/finance/lapangan/selaras";
import { bacaPengaturanPpn } from "@/lib/finance/pajak/ppn-pengaturan";
import { readGlCutover } from "@/lib/finance/sales/sweep";
import { gerakStokPerDokumen } from "@/lib/inventory/kartu-stok-queries";
import { hitungKreditRetur } from "@/lib/purchase-orders/kredit-retur";
import { parseVendorReturnLines } from "@/lib/vendor-returns/baris-retur";
import {
  akhirBulanWib,
  bacaIdKomisiSpg,
  bacaPeriode,
  barisBarangHilang,
  barisBayarBiayaPerjalanan,
  barisBayarKomisi,
  barisBayarTokoKonsi,
  barisBiayaPerjalanan,
  barisGudangRusak,
  barisKomisi,
  barisPindahKonsi,
  barisPotongSales,
  barisReturKonsi,
  barisReturPemasok,
  barisSiklusKonsi,
  barisStokManual,
  idKomisiSpg,
  keBarisJurnalOperasional,
  nilaiBiayaKonsi,
  SUMBER_OPERASIONAL,
  tanggalPeriode,
  type KeputusanRusak,
  type SumberOperasional,
} from "./aturan";
import { biayaSatuanKonsi, petaBiaya } from "./biaya-konsi";
import { nilaiKeluarGerak } from "./nilai-rusak-queries";

/*
 * Penulis jurnal OPERASIONAL — KHUSUS SERVER. Aturan barisnya murni di
 * `aturan.ts`. Dipanggil SESUDAH dokumennya di-commit (kait `kait.ts`,
 * sapuan, tombol posting ulang di Keuangan → Rekonsiliasi persediaan);
 * tidak pernah dari dalam transaksi dokumennya, dan tidak pernah mengubah
 * dokumennya — hanya membaca.
 *
 * DUA BENTUK:
 * - SEKALI POSTING (`postSekali`): dokumen yang tidak berubah lagi sesudah
 *   sah (kiriman titipan, pesanan konsinyasi disetujui, pembayaran gaji/komisi,
 *   potongan beban sales, keputusan gudang rusak, penyesuaian stok manual,
 *   retur pemasok selesai, biaya perjalanan disetujui/dibayar).
 * - DISELARASKAN (`selaraskanJurnal`, generasi `<id>`, `<id>#2`, …): dokumen
 *   yang keadaannya bisa berubah sesudah dijurnal — siklus konsinyasi (kunci
 *   dibuka/dikunci ulang), gaji SPG konsinyasi per siklus, pembayaran toko
 *   (dibatalkan), komisi SPG toko putus per toko × bulan (ditetapkan ulang),
 *   barang hilang (keputusan dibatalkan), hitungan retur toko konsinyasi
 *   (dipindah toko). Jurnal TIDAK pernah diubah atau dihapus.
 *
 * GERBANG TANGGAL MULAI sama dengan jurnal lapangan: dokumen sebelum
 * `finance.glCutoverDate` tidak dijurnal (masuk saldo awal); tanpa tanggal
 * mulai tidak ada yang dijurnal. Jurnal yang sudah ada tetap diselaraskan.
 */

type Klien = PrismaClient | Prisma.TransactionClient;

export type KodeGagalOperasional =
  | "UNMAPPED_ROLE"
  | "UNBALANCED"
  /** Nilai nol / dokumen bukan untuk dijurnal — tidak ada yang dijurnal. */
  | "NOTHING_TO_POST"
  /** Belum boleh dijurnal: sebelum tanggal mulai buku besar, atau belum final. */
  | "BELUM_BERLAKU"
  | "GL_CUTOVER_NOT_CONFIGURED"
  /** Nilai barang yang bergerak tidak ditemukan di kartu stok. */
  | "BIAYA_TIDAK_DIKETAHUI";

export type HasilJurnalOperasional =
  | { ok: true; journalId: string | null; created: boolean }
  | { ok: false; code: KodeGagalOperasional; role?: string; detail?: string };

/** Kode yang bukan kegagalan — tidak menulis `JOURNAL_PENDING`. */
export const KODE_BUKAN_GAGAL_OPERASIONAL: ReadonlySet<KodeGagalOperasional> = new Set([
  "NOTHING_TO_POST",
  "BELUM_BERLAKU",
  "GL_CUTOVER_NOT_CONFIGURED",
]);

const angka = (v: unknown): number => Number(v ?? 0);

function bolehMulai(mulai: Date | null, tanggal: Date): boolean {
  return mulai !== null && tanggal.getTime() >= mulai.getTime();
}

function dariSelaras(r: HasilSelaras, adaCutover: boolean): HasilJurnalOperasional {
  if (r.ok) return { ok: true, journalId: r.journalId, created: r.berubah };
  if (r.code === "BELUM_BERLAKU") return { ok: false, code: adaCutover ? "BELUM_BERLAKU" : "GL_CUTOVER_NOT_CONFIGURED" };
  return { ok: false, code: r.code, ...(r.role ? { role: r.role } : {}) };
}

/** Nilai satu penyesuaian stok (qty × harga rata-rata saat itu), selalu positif. */
function nilaiPenyesuaian(a: { qtyChange: unknown; prevAvgCost: unknown }): number {
  return Math.abs(angka(a.qtyChange)) * angka(a.prevAvgCost);
}

// ── Posting ─────────────────────────────────────────────────────────────────

/**
 * Seperti `generateAutoJournal`, tetapi peran tertentu boleh diganti akun
 * pilihan (rekening kas/bank yang dipilih saat membayar). Tanpa pengganti =
 * `generateAutoJournal` persis.
 */
export async function postJurnalOperasional(
  client: Klien,
  sourceType: string,
  sourceId: string,
  lines: AutoJournalLine[],
  meta: { date: Date; description: string; postedById: string },
  akunGanti: Partial<Record<PostingRole, string>> = {},
): Promise<{ ok: true; journalId: string; created: boolean } | { ok: false; code: "UNMAPPED_ROLE" | "UNBALANCED" | "NOTHING_TO_POST"; role?: string }> {
  if (Object.keys(akunGanti).length === 0) return generateAutoJournal(client, sourceType, sourceId, lines, meta);
  if (lines.length === 0) return { ok: false, code: "NOTHING_TO_POST" };
  const akun = new Map<PostingRole, string>();
  try {
    for (const role of new Set(lines.map((l) => l.role))) akun.set(role, akunGanti[role] ?? (await resolveAccount(role, client)));
  } catch (e) {
    if (e instanceof UnmappedRoleError) return { ok: false, code: "UNMAPPED_ROLE", role: e.role };
    throw e;
  }
  try {
    const r = await postJournal(client, {
      source: { type: sourceType, id: sourceId },
      date: meta.date,
      description: meta.description,
      postedById: meta.postedById,
      closedPeriod: "shift",
      lines: lines.map((l) => ({
        chartAccountId: akun.get(l.role)!,
        debit: l.debit,
        credit: l.credit,
        ...(l.memo ? { memo: l.memo } : {}),
        ...(l.channel ? { channel: l.channel } : {}),
        ...(l.storeId ? { storeId: l.storeId } : {}),
      })),
    });
    return { ok: true, journalId: r.journalId, created: r.created };
  } catch (e) {
    if (e instanceof JournalError && e.code === "UNBALANCED") return { ok: false, code: "UNBALANCED" };
    throw e;
  }
}

type BahanSekali = {
  tanggal: Date;
  deskripsi: string;
  baris?: BarisBertanda[];
  /** Dokumen belum bisa dijurnal (biaya tidak diketahui, belum final). */
  gagal?: { code: KodeGagalOperasional; detail?: string };
  dppMasukan?: number;
  akunGanti?: Partial<Record<PostingRole, string>>;
};

/**
 * Jurnal sekali posting, idempoten per (sourceType, id dokumen). `muat`
 * mengembalikan null bila dokumennya tidak ada / bukan untuk dijurnal.
 */
async function postSekali(
  client: Klien,
  sourceType: SumberOperasional,
  id: string,
  postedById: string,
  muat: () => Promise<BahanSekali | null>,
): Promise<HasilJurnalOperasional> {
  const ada = await client.journal.findUnique({ where: { sourceType_sourceId: { sourceType, sourceId: id } }, select: { id: true } });
  if (ada) return { ok: true, journalId: ada.id, created: false };
  const b = await muat();
  if (!b) return { ok: false, code: "NOTHING_TO_POST" };
  const mulai = await readGlCutover();
  if (!mulai) return { ok: false, code: "GL_CUTOVER_NOT_CONFIGURED" };
  if (!bolehMulai(mulai, b.tanggal)) return { ok: false, code: "BELUM_BERLAKU" };
  if (b.gagal) return { ok: false, code: b.gagal.code, ...(b.gagal.detail ? { detail: b.gagal.detail } : {}) };
  const baris = gabungBaris(b.baris ?? []);
  if (baris.length === 0) return { ok: false, code: "NOTHING_TO_POST" };
  const r = await postJurnalOperasional(
    client,
    sourceType,
    id,
    keBarisJurnalOperasional(baris, { dppMasukan: b.dppMasukan }),
    { date: b.tanggal, description: b.deskripsi, postedById },
    b.akunGanti,
  );
  if (r.ok) return { ok: true, journalId: r.journalId, created: r.created };
  return { ok: false, code: r.code, ...(r.role ? { role: r.role } : {}) };
}

async function selaras(
  sourceType: SumberOperasional,
  entityId: string,
  postedById: string,
  susun: (tx: Prisma.TransactionClient, terposting: BarisBertanda[], mulai: Date | null) => Promise<SasaranDokumen>,
): Promise<HasilJurnalOperasional> {
  const mulai = await readGlCutover();
  const r = await selaraskanJurnal({ sourceType, entityId, postedById, susun: (tx, terposting) => susun(tx, terposting, mulai) });
  return dariSelaras(r, mulai !== null);
}

// ── Konsinyasi: barang berangkat ke toko ────────────────────────────────────

/** Kunci penyesuaian stok satu baris kiriman titipan (`kirimTitipan`). */
export function kunciKirimTitipan(shipmentItemId: string): string {
  return `konsi-kirim-${shipmentItemId}`;
}

export function postJurnalKirimKonsi(shipmentId: string, postedById: string, client: Klien = prisma): Promise<HasilJurnalOperasional> {
  return postSekali(client, SUMBER_OPERASIONAL.KIRIM_KONSI, shipmentId, postedById, async () => {
    const s = await client.consignmentShipment.findUnique({
      where: { id: shipmentId },
      select: { noKirim: true, storeId: true, shippedAt: true, store: { select: { name: true } }, items: { select: { id: true } } },
    });
    if (!s) return null;
    const adj = s.items.length
      ? await client.stockAdjustment.findMany({
          where: { source: "KONSI_TRANSFER", idempotencyKey: { in: s.items.map((i) => kunciKirimTitipan(i.id)) } },
          select: { qtyChange: true, prevAvgCost: true, item: { select: { type: true } } },
        })
      : [];
    return {
      tanggal: s.shippedAt,
      deskripsi: `Kiriman titipan ${s.noKirim} ke ${s.store.name}`,
      baris: barisPindahKonsi({ storeId: s.storeId, keluar: adj.map((a) => ({ tipeBarang: a.item.type, nilai: nilaiPenyesuaian(a) })) }),
    };
  });
}

export function postJurnalPesananKonsi(orderId: string, postedById: string, client: Klien = prisma): Promise<HasilJurnalOperasional> {
  return postSekali(client, SUMBER_OPERASIONAL.PESANAN_KONSI, orderId, postedById, async () => {
    const o = await client.fieldSalesOrder.findUnique({
      where: { id: orderId },
      select: { orderNo: true, orderType: true, approvedAt: true, storeId: true, store: { select: { name: true } }, lines: { select: { id: true } } },
    });
    if (!o || o.orderType !== "KONSI" || !o.approvedAt) return null;
    const adj = o.lines.length
      ? await client.stockAdjustment.findMany({
          where: { source: "KONSI_TRANSFER", idempotencyKey: { in: o.lines.map((l) => konsiTransferKeyForLine(l.id)) } },
          select: { qtyChange: true, prevAvgCost: true, item: { select: { type: true } } },
        })
      : [];
    return {
      tanggal: o.approvedAt,
      deskripsi: `Kiriman konsinyasi ${o.orderNo} ke ${o.store.name}`,
      baris: barisPindahKonsi({ storeId: o.storeId, keluar: adj.map((a) => ({ tipeBarang: a.item.type, nilai: nilaiPenyesuaian(a) })) }),
    };
  });
}

// ── Konsinyasi: barang kembali dari toko (NRI) ──────────────────────────────

/** Biaya gudang rusak yang sudah dijurnal untuk dokumen ini (dibekukan sejak jurnal pertama). */
function rusakTerposting(terposting: readonly BarisBertanda[]): number | null {
  const sen = terposting.filter((b) => b.role === "INVENTORY_DAMAGED").reduce((s, b) => s + b.sen, 0);
  return sen === 0 ? null : sen / 100;
}

/**
 * Hitungan gudang (NRI) dari toko KONSINYASI — pasangan jurnal retur toko
 * putus milik `lib/finance/lapangan` (yang menghasilkan sasaran kosong untuk
 * toko konsinyasi, dan sebaliknya di sini). Hitungan yang dipindah toko dari
 * konsinyasi ke putus dibalik di sini dan dijurnal di sana.
 */
export async function selaraskanJurnalReturKonsi(nriId: string, postedById: string): Promise<HasilJurnalOperasional> {
  return selaras(SUMBER_OPERASIONAL.RETUR_KONSI, nriId, postedById, async (tx, terposting, mulai) => {
    const b = await bacaBahanRetur(tx, nriId);
    if (!b) return { sasaran: [], bolehMulai: false, tanggal: new Date(), deskripsi: `Retur toko konsinyasi ${nriId}` };
    const deskripsi = `Retur toko konsinyasi ${b.noNri}${b.noNrt ? ` (${b.noNrt})` : ""}${b.storeName ? ` — ${b.storeName}` : ""}`;
    if (!b.konsinyasi || !b.final) return { sasaran: [], bolehMulai: false, tanggal: b.tanggal, deskripsi };
    const items = await tx.warehouseReturnItem.findMany({ where: { warehouseReturnId: nriId }, select: { itemId: true, qty: true } });
    const biaya = await biayaSatuanKonsi(
      tx,
      items.flatMap((i) => (i.itemId ? [i.itemId] : [])),
      b.tanggal,
    );
    const sasaran = barisReturKonsi({
      storeId: b.storeId,
      stokLayak: b.stokLayak,
      rusak: rusakTerposting(terposting) ?? b.rusak,
      biayaKonsi: nilaiBiayaKonsi(items, petaBiaya(biaya)),
    });
    return { sasaran, bolehMulai: bolehMulai(mulai, b.tanggal), tanggal: b.tanggal, deskripsi };
  });
}

// ── Konsinyasi: siklus dikunci ──────────────────────────────────────────────

export async function selaraskanJurnalSiklusKonsi(cycleId: string, postedById: string): Promise<HasilJurnalOperasional> {
  return selaras(SUMBER_OPERASIONAL.SIKLUS_KONSI, cycleId, postedById, async (tx, _t, mulai) => {
    const c = await tx.consignmentCycle.findUnique({
      where: { id: cycleId },
      select: {
        noKonsi: true,
        storeId: true,
        periodYear: true,
        periodMonth: true,
        lockedAt: true,
        promoBorneByElorae: true,
        lossChargedToStore: true,
        vatApplied: true,
        store: { select: { name: true, consignmentVat: true } },
        sold: { select: { itemId: true, qty: true, amount: true } },
      },
    });
    if (!c) return { sasaran: [], bolehMulai: false, tanggal: new Date(), deskripsi: `Siklus konsinyasi ${cycleId}` };
    const tanggal = tanggalPeriode(c.periodYear, c.periodMonth, c.lockedAt);
    const deskripsi = `Penjualan konsinyasi ${c.noKonsi} — ${c.store.name}`;
    if (!c.lockedAt) return { sasaran: [], bolehMulai: false, tanggal, deskripsi };
    const biaya = await biayaSatuanKonsi(
      tx,
      c.sold.flatMap((s) => (s.itemId ? [s.itemId] : [])),
      c.lockedAt,
    );
    const sasaran = barisSiklusKonsi({
      storeId: c.storeId,
      lakuResmi: c.sold.reduce((n, s) => n + angka(s.amount), 0),
      promoElorae: angka(c.promoBorneByElorae),
      bebanHilang: angka(c.lossChargedToStore),
      hpp: nilaiBiayaKonsi(c.sold, petaBiaya(biaya)),
      pengaturanPpn: await bacaPengaturanPpn(tx),
      // Dibekukan saat dikunci; sakelar toko hanya cadangan untuk baris lama.
      pakaiPpn: c.vatApplied ?? c.store.consignmentVat,
      tanggal,
    });
    return { sasaran, bolehMulai: bolehMulai(mulai, tanggal), tanggal, deskripsi };
  });
}

/** Gaji + komisi SPG satu siklus (semua barisnya), selama siklusnya dikunci. */
export async function selaraskanJurnalKomisiKonsi(cycleId: string, postedById: string): Promise<HasilJurnalOperasional> {
  return selaras(SUMBER_OPERASIONAL.KOMISI_KONSI, cycleId, postedById, async (tx, _t, mulai) => {
    const c = await tx.consignmentCycle.findUnique({
      where: { id: cycleId },
      select: {
        noKonsi: true,
        storeId: true,
        periodYear: true,
        periodMonth: true,
        lockedAt: true,
        store: { select: { name: true } },
        commissions: { select: { total: true, deduction: true } },
      },
    });
    if (!c) return { sasaran: [], bolehMulai: false, tanggal: new Date(), deskripsi: `Gaji SPG konsinyasi ${cycleId}` };
    const tanggal = tanggalPeriode(c.periodYear, c.periodMonth, c.lockedAt);
    const deskripsi = `Gaji & komisi SPG ${c.noKonsi} — ${c.store.name}`;
    if (!c.lockedAt) return { sasaran: [], bolehMulai: false, tanggal, deskripsi };
    const sasaran = barisKomisi({
      peranBeban: "SPG_COMMISSION_EXPENSE",
      bruto: c.commissions.reduce((n, k) => n + angka(k.total), 0),
      potongan: c.commissions.reduce((n, k) => n + angka(k.deduction), 0),
      storeId: c.storeId,
      kanal: "KONSINYASI",
    });
    return { sasaran, bolehMulai: bolehMulai(mulai, tanggal), tanggal, deskripsi };
  });
}

export function postJurnalBayarGajiKonsi(commissionId: string, postedById: string, client: Klien = prisma): Promise<HasilJurnalOperasional> {
  return postSekali(client, SUMBER_OPERASIONAL.BAYAR_GAJI_KONSI, commissionId, postedById, async () => {
    const k = await client.consignmentCommission.findUnique({
      where: { id: commissionId },
      select: { paidAt: true, total: true, deduction: true, spgUser: { select: { name: true } }, cycle: { select: { noKonsi: true } } },
    });
    if (!k?.paidAt) return null;
    return {
      tanggal: k.paidAt,
      deskripsi: `Pembayaran gaji & komisi SPG ${k.spgUser.name ?? ""} — ${k.cycle.noKonsi}`.replace(/\s+—/, " —"),
      baris: barisBayarKomisi(Math.max(0, angka(k.total) - angka(k.deduction))),
    };
  });
}

export async function selaraskanJurnalBayarTokoKonsi(paymentId: string, postedById: string): Promise<HasilJurnalOperasional> {
  return selaras(SUMBER_OPERASIONAL.BAYAR_TOKO_KONSI, paymentId, postedById, async (tx, _t, mulai) => {
    const p = await tx.consignmentPayment.findUnique({
      where: { id: paymentId },
      select: { amount: true, paidOn: true, method: true, cancelledAt: true, cycle: { select: { noKonsi: true, storeId: true, store: { select: { name: true } } } } },
    });
    if (!p) return { sasaran: [], bolehMulai: false, tanggal: new Date(), deskripsi: `Pembayaran toko konsinyasi ${paymentId}` };
    const batal = p.cancelledAt !== null;
    return {
      sasaran: barisBayarTokoKonsi({ storeId: p.cycle.storeId, nilai: angka(p.amount), cara: p.method, batal }),
      bolehMulai: !batal && bolehMulai(mulai, p.paidOn),
      tanggal: p.paidOn,
      deskripsi: `Pembayaran ${p.cycle.store.name} untuk ${p.cycle.noKonsi}`,
    };
  });
}

// ── Komisi SPG toko putus (per toko × bulan) ────────────────────────────────

export async function selaraskanJurnalKomisiSpg(storeId: string, periode: string, postedById: string): Promise<HasilJurnalOperasional> {
  const p = bacaPeriode(periode);
  if (!p) return { ok: false, code: "NOTHING_TO_POST" };
  return selaras(SUMBER_OPERASIONAL.KOMISI_SPG, idKomisiSpg(storeId, periode), postedById, async (tx, _t, mulai) => {
    const [rows, toko] = await Promise.all([
      tx.spgCommission.findMany({ where: { storeId, period: periode }, select: { commission: true, deduction: true } }),
      tx.store.findUnique({ where: { id: storeId }, select: { name: true } }),
    ]);
    const tanggal = akhirBulanWib(p[0], p[1]);
    const sasaran = barisKomisi({
      peranBeban: "SPG_COMMISSION_EXPENSE",
      bruto: rows.reduce((n, r) => n + angka(r.commission), 0),
      potongan: rows.reduce((n, r) => n + angka(r.deduction), 0),
      storeId,
      kanal: "PUTUS",
    });
    return { sasaran, bolehMulai: rows.length > 0 && bolehMulai(mulai, tanggal), tanggal, deskripsi: `Komisi SPG ${periode} — ${toko?.name ?? storeId}` };
  });
}

export function postJurnalBayarKomisiSpg(commissionId: string, postedById: string, client: Klien = prisma): Promise<HasilJurnalOperasional> {
  return postSekali(client, SUMBER_OPERASIONAL.BAYAR_KOMISI_SPG, commissionId, postedById, async () => {
    const k = await client.spgCommission.findUnique({
      where: { id: commissionId },
      select: { paidAt: true, commission: true, deduction: true, period: true, storeId: true, userId: true },
    });
    if (!k?.paidAt) return null;
    const [orang, toko] = await Promise.all([
      client.user.findUnique({ where: { id: k.userId }, select: { name: true } }),
      client.store.findUnique({ where: { id: k.storeId }, select: { name: true } }),
    ]);
    return {
      tanggal: k.paidAt,
      deskripsi: `Pembayaran komisi SPG ${orang?.name ?? ""} ${k.period} — ${toko?.name ?? ""}`.replace(/\s+/g, " ").trim(),
      baris: barisBayarKomisi(Math.max(0, angka(k.commission) - angka(k.deduction))),
    };
  });
}

// ── Barang hilang ───────────────────────────────────────────────────────────

const STATUS_HILANG_DIPUTUSKAN = new Set(["DITETAPKAN", "SELESAI"]);

/**
 * Barang hilang di toko konsinyasi yang sudah diputuskan: barangnya masih
 * milik Elorae, jadi persediaan konsinyasi berkurang sebesar biayanya.
 * Barang hilang di toko putus (barangnya sudah milik toko) dan catatan tanpa
 * toko (gudang utama memakai penyesuaian stok) tidak dijurnal di sini.
 */
export async function selaraskanJurnalBarangHilang(lossId: string, postedById: string): Promise<HasilJurnalOperasional> {
  return selaras(SUMBER_OPERASIONAL.BARANG_HILANG, lossId, postedById, async (tx, _t, mulai) => {
    const l = await tx.stockLoss.findUnique({
      where: { id: lossId },
      select: { status: true, storeId: true, decidedAt: true, createdAt: true, sourceDocNo: true, lines: { select: { itemId: true, qty: true } } },
    });
    if (!l) return { sasaran: [], bolehMulai: false, tanggal: new Date(), deskripsi: `Barang hilang ${lossId}` };
    const toko = l.storeId ? await tx.store.findUnique({ where: { id: l.storeId }, select: { name: true, termsType: true } }) : null;
    const tanggal = l.decidedAt ?? l.createdAt;
    const deskripsi = `Barang hilang${toko ? ` di ${toko.name}` : ""}${l.sourceDocNo ? ` (${l.sourceDocNo})` : ""}`;
    if (!l.storeId || toko?.termsType !== "KONSI" || !STATUS_HILANG_DIPUTUSKAN.has(l.status)) {
      return { sasaran: [], bolehMulai: false, tanggal, deskripsi };
    }
    const biaya = await biayaSatuanKonsi(
      tx,
      l.lines.flatMap((b) => (b.itemId ? [b.itemId] : [])),
      l.createdAt,
    );
    return {
      sasaran: barisBarangHilang({ storeId: l.storeId, biaya: nilaiBiayaKonsi(l.lines, petaBiaya(biaya)) }),
      bolehMulai: bolehMulai(mulai, tanggal),
      tanggal,
      deskripsi,
    };
  });
}

/** `StockLossDeduction.refType` potongan beban SALES (`REF_KOMISI_SALESMAN`). */
const REF_POTONG_SALES = "KomisiSalesman";

export function postJurnalPotongSales(deductionId: string, postedById: string, client: Klien = prisma): Promise<HasilJurnalOperasional> {
  return postSekali(client, SUMBER_OPERASIONAL.POTONG_SALES, deductionId, postedById, async () => {
    const d = await client.stockLossDeduction.findUnique({
      where: { id: deductionId },
      select: { refType: true, refId: true, amount: true, createdAt: true },
    });
    if (!d || d.refType !== REF_POTONG_SALES) return null;
    const bulan = d.refId.split(":")[1] ?? "";
    return {
      tanggal: d.createdAt,
      deskripsi: `Potongan beban barang hilang dari komisi sales${bulan ? ` ${bulan}` : ""}`,
      baris: barisPotongSales(angka(d.amount)),
    };
  });
}

// ── Gudang barang rusak ─────────────────────────────────────────────────────

const KEPUTUSAN_RUSAK = new Set<string>(["PERBAIKI", "JUAL_OBRAL", "MUSNAHKAN"]);

export function postJurnalGudangRusak(gerakId: string, postedById: string, client: Klien = prisma): Promise<HasilJurnalOperasional> {
  return postSekali(client, SUMBER_OPERASIONAL.GUDANG_RUSAK, gerakId, postedById, async () => {
    const g = await client.damagedStockMovement.findUnique({
      where: { id: gerakId },
      select: { kind: true, itemId: true, productName: true, value: true, refType: true, refId: true, createdAt: true },
    });
    if (!g || !KEPUTUSAN_RUSAK.has(g.kind)) return null;
    const keputusan = g.kind as KeputusanRusak;
    const biaya = (await nilaiKeluarGerak(client, gerakId)) ?? 0;
    let masuk: { tipeBarang: string | null; nilai: number } | null = null;
    if (keputusan === "PERBAIKI") {
      const adj = g.refType === "StockAdjustment" && g.refId
        ? await client.stockAdjustment.findUnique({ where: { id: g.refId }, select: { qtyChange: true, prevAvgCost: true, item: { select: { type: true } } } })
        : null;
      if (!adj) {
        return { tanggal: g.createdAt, deskripsi: "", gagal: { code: "BIAYA_TIDAK_DIKETAHUI", detail: g.productName } };
      }
      masuk = { tipeBarang: adj.item.type, nilai: nilaiPenyesuaian(adj) };
    }
    const kata = keputusan === "PERBAIKI" ? "diperbaiki" : keputusan === "JUAL_OBRAL" ? "dijual obral" : "dimusnahkan";
    return {
      tanggal: g.createdAt,
      deskripsi: `Gudang barang rusak ${kata} — ${g.productName}`,
      baris: barisGudangRusak({
        keputusan,
        biaya,
        masuk,
        hasilJual: keputusan === "JUAL_OBRAL" && g.value !== null ? angka(g.value) : null,
        pengaturanPpn: await bacaPengaturanPpn(client),
        tanggal: g.createdAt,
      }),
    };
  });
}

// ── Penyesuaian stok manual ─────────────────────────────────────────────────

/** Awalan alasan impor stok awal UMKM (`lib/reconciliation/umkm-opening-stock.ts`) — bagian saldo awal, bukan penyesuaian. */
export const AWALAN_STOK_AWAL_UMKM = "UMKM opening balance reconciliation (one-time)";

/** Penyesuaian stok yang dibuat orang kantor lewat layar Penyesuaian (sumber `ERP`). */
export function penyesuaianManual(a: { source: string; reason: string }): boolean {
  return a.source === "ERP" && !a.reason.startsWith(AWALAN_STOK_AWAL_UMKM);
}

export function postJurnalStokManual(adjustmentId: string, postedById: string, client: Klien = prisma): Promise<HasilJurnalOperasional> {
  return postSekali(client, SUMBER_OPERASIONAL.STOK_MANUAL, adjustmentId, postedById, async () => {
    const a = await client.stockAdjustment.findUnique({
      where: { id: adjustmentId },
      select: {
        docNumber: true,
        source: true,
        reason: true,
        prevQty: true,
        newQty: true,
        prevAvgCost: true,
        newAvgCost: true,
        createdAt: true,
        item: { select: { type: true, nameId: true } },
      },
    });
    if (!a || !penyesuaianManual(a)) return null;
    // Perubahan nilai kartu stok (penyesuaian manual tidak menggeser harga rata-rata).
    const nilai = angka(a.newQty) * angka(a.newAvgCost) - angka(a.prevQty) * angka(a.prevAvgCost);
    return {
      tanggal: a.createdAt,
      deskripsi: `Penyesuaian stok ${a.docNumber} — ${a.item.nameId}`,
      baris: barisStokManual({ tipeBarang: a.item.type, nilai }),
    };
  });
}

// ── Retur ke pemasok ────────────────────────────────────────────────────────

export function postJurnalReturPemasok(returnId: string, postedById: string, client: Klien = prisma): Promise<HasilJurnalOperasional> {
  return postSekali(client, SUMBER_OPERASIONAL.RETUR_PEMASOK, returnId, postedById, async () => {
    const r = await client.vendorReturn.findUnique({
      where: { id: returnId },
      select: {
        docNumber: true,
        status: true,
        completedAt: true,
        poId: true,
        poCreditAmount: true,
        grnId: true,
        lines: true,
        vendor: { select: { name: true } },
      },
    });
    if (!r || r.status !== "COMPLETED" || !r.completedAt) return null;
    // Persediaan dikredit sebesar yang keluar dari kartu stok; nilai yang tidak tercatat tidak ditebak.
    const gerak = (await gerakStokPerDokumen(client, "VendorReturn", [returnId])).get(returnId);
    if (gerak === null) {
      return { tanggal: r.completedAt, deskripsi: "", gagal: { code: "BIAYA_TIDAK_DIKETAHUI", detail: r.docNumber } };
    }
    const barisGerak = gerak?.baris ?? [];
    // Buku besar stok tidak berelasi ke Item: tipe barangnya dibaca terpisah.
    const tipeBarang = new Map<string, string>();
    if (barisGerak.length) {
      const barang = await client.item.findMany({
        where: { id: { in: [...new Set(barisGerak.map((g) => g.itemId))] } },
        select: { id: true, type: true },
      });
      for (const b of barang) tipeBarang.set(b.id, b.type);
    }
    const kredit = r.poId ? angka(r.poCreditAmount) : 0;
    // PPN masukan GRN-nya dikreditkan (PKP, baris "Exclude PPN") → bagian PPN kredit dibalik.
    let ppn = 0;
    let dpp = 0;
    if (kredit > 0 && r.grnId) {
      const grn = await client.gRN.findUnique({ where: { id: r.grnId }, select: { ppnAmount: true } });
      if (angka(grn?.ppnAmount) > 0 && r.poId) {
        const po = await client.purchaseOrder.findUnique({
          where: { id: r.poId },
          select: { ppnRatePercent: true, items: { select: { itemId: true, variantSku: true, price: true, ppnIncluded: true } } },
        });
        if (po) {
          const h = hitungKreditRetur(
            po.items,
            po.ppnRatePercent == null ? null : Number(po.ppnRatePercent),
            parseVendorReturnLines(r.lines).flatMap((l) => (l.itemId && l.qty != null ? [{ itemId: l.itemId, variantSku: l.variantSku ?? null, qty: l.qty }] : [])),
          );
          ppn = h.ppn;
          dpp = h.dasar;
        }
      }
    }
    return {
      tanggal: r.completedAt,
      deskripsi: `Retur ke pemasok ${r.docNumber} — ${r.vendor.name}`,
      baris: barisReturPemasok({
        kredit,
        ppnMasukan: ppn,
        keluar: barisGerak.map((g) => ({ tipeBarang: tipeBarang.get(g.itemId), nilai: Math.abs(g.totalCost) })),
      }),
      dppMasukan: dpp,
    };
  });
}

// ── Biaya perjalanan ────────────────────────────────────────────────────────

const STATUS_BIAYA_DISETUJUI = new Set(["DISETUJUI", "DIBAYAR"]);

export function postJurnalBiayaPerjalanan(claimId: string, postedById: string, client: Klien = prisma): Promise<HasilJurnalOperasional> {
  return postSekali(client, SUMBER_OPERASIONAL.BIAYA_PERJALANAN, claimId, postedById, async () => {
    const k = await client.expenseClaim.findUnique({
      where: { id: claimId },
      select: { status: true, amount: true, reviewedAt: true, spentAt: true, category: true, userId: true },
    });
    if (!k || !STATUS_BIAYA_DISETUJUI.has(k.status)) return null;
    const orang = await client.user.findUnique({ where: { id: k.userId }, select: { name: true } });
    return {
      tanggal: k.reviewedAt ?? k.spentAt,
      deskripsi: `Biaya perjalanan ${orang?.name ?? ""} (${k.category.toLowerCase()})`.replace(/\s+\(/, " ("),
      baris: barisBiayaPerjalanan(angka(k.amount)),
    };
  });
}

export function postJurnalBayarBiayaPerjalanan(claimId: string, postedById: string, client: Klien = prisma): Promise<HasilJurnalOperasional> {
  return postSekali(client, SUMBER_OPERASIONAL.BAYAR_BIAYA_PERJALANAN, claimId, postedById, async () => {
    const k = await client.expenseClaim.findUnique({
      where: { id: claimId },
      select: { status: true, amount: true, paidAt: true, paidAccountId: true, category: true, userId: true },
    });
    if (!k || k.status !== "DIBAYAR" || !k.paidAt) return null;
    const orang = await client.user.findUnique({ where: { id: k.userId }, select: { name: true } });
    return {
      tanggal: k.paidAt,
      deskripsi: `Pembayaran biaya perjalanan ${orang?.name ?? ""} (${k.category.toLowerCase()})`.replace(/\s+\(/, " ("),
      baris: barisBayarBiayaPerjalanan(angka(k.amount)),
      ...(k.paidAccountId ? { akunGanti: { CASH: k.paidAccountId } } : {}),
    };
  });
}

// ── Satu pintu ──────────────────────────────────────────────────────────────

export function jurnalOperasional(sumber: SumberOperasional, id: string, postedById: string): Promise<HasilJurnalOperasional> {
  switch (sumber) {
    case SUMBER_OPERASIONAL.KIRIM_KONSI:
      return postJurnalKirimKonsi(id, postedById);
    case SUMBER_OPERASIONAL.PESANAN_KONSI:
      return postJurnalPesananKonsi(id, postedById);
    case SUMBER_OPERASIONAL.RETUR_KONSI:
      return selaraskanJurnalReturKonsi(id, postedById);
    case SUMBER_OPERASIONAL.SIKLUS_KONSI:
      return selaraskanJurnalSiklusKonsi(id, postedById);
    case SUMBER_OPERASIONAL.KOMISI_KONSI:
      return selaraskanJurnalKomisiKonsi(id, postedById);
    case SUMBER_OPERASIONAL.BAYAR_GAJI_KONSI:
      return postJurnalBayarGajiKonsi(id, postedById);
    case SUMBER_OPERASIONAL.BAYAR_TOKO_KONSI:
      return selaraskanJurnalBayarTokoKonsi(id, postedById);
    case SUMBER_OPERASIONAL.KOMISI_SPG: {
      const k = bacaIdKomisiSpg(id);
      return k ? selaraskanJurnalKomisiSpg(k.storeId, k.periode, postedById) : Promise.resolve({ ok: false, code: "NOTHING_TO_POST" });
    }
    case SUMBER_OPERASIONAL.BAYAR_KOMISI_SPG:
      return postJurnalBayarKomisiSpg(id, postedById);
    case SUMBER_OPERASIONAL.BARANG_HILANG:
      return selaraskanJurnalBarangHilang(id, postedById);
    case SUMBER_OPERASIONAL.POTONG_SALES:
      return postJurnalPotongSales(id, postedById);
    case SUMBER_OPERASIONAL.GUDANG_RUSAK:
      return postJurnalGudangRusak(id, postedById);
    case SUMBER_OPERASIONAL.STOK_MANUAL:
      return postJurnalStokManual(id, postedById);
    case SUMBER_OPERASIONAL.RETUR_PEMASOK:
      return postJurnalReturPemasok(id, postedById);
    case SUMBER_OPERASIONAL.BIAYA_PERJALANAN:
      return postJurnalBiayaPerjalanan(id, postedById);
    case SUMBER_OPERASIONAL.BAYAR_BIAYA_PERJALANAN:
      return postJurnalBayarBiayaPerjalanan(id, postedById);
  }
}
