import { prisma, Prisma } from "@elorae/db";
import { runSerializable, withRetry } from "@/lib/db/tx-retry";
import type { ParsedSettlement } from "./shopee-settlement-parser";

export type PersistResult = {
  settlementId: string;
  checksumOk: boolean;
  checksumVariance: number;
  lineCount: number;
};

/** Ringkasan unggahan pertama yang disebut saat unggahan kembar ditolak atau ditandai. */
export type UnggahanPertama = {
  id: string;
  fileName: string;
  uploadedAt: Date;
  uploadedByName: string | null;
  status: string;
};

/**
 * Settlement yang sama diunggah kedua kali. Jurnal settlement berkunci id
 * settlement, jadi baris kedua = bank didebit dan piutang dikredit dua kali.
 * Kembar = marketplace, penjual, periode, dan uang dilepas sama persis.
 */
export class SettlementGandaError extends Error {
  readonly code = "SETTLEMENT_GANDA" as const;
  constructor(readonly pertama: UnggahanPertama) {
    super(`Settlement ini sudah diunggah sebagai "${pertama.fileName}" (${pertama.id})`);
    this.name = "SettlementGandaError";
  }
}

export const AKSI_HAPUS_SETTLEMENT = "SETTLEMENT_DELETED";

type KunciSettlement = {
  marketplace: string;
  seller: string;
  periodFrom: Date;
  periodTo: Date;
  totalDilepas: Prisma.Decimal;
};

/** Kolom Decimal(18,2): dibulatkan sama seperti basis data agar perbandingannya persis. */
function sen(n: number | Prisma.Decimal): Prisma.Decimal {
  return new Prisma.Decimal(n).toDecimalPlaces(2);
}

function kunciTeks(k: KunciSettlement): string {
  return [k.marketplace, k.seller, k.periodFrom.getTime(), k.periodTo.getTime(), sen(k.totalDilepas).toFixed(2)].join("|");
}

async function namaPengguna(client: Prisma.TransactionClient, ids: string[]): Promise<Map<string, string | null>> {
  const unik = [...new Set(ids.filter((id) => id.length > 0))];
  if (unik.length === 0) return new Map();
  const rows = await client.user.findMany({ where: { id: { in: unik } }, select: { id: true, name: true } });
  return new Map(rows.map((u) => [u.id, u.name]));
}

export async function persistSettlement(
  input: { parsed: ParsedSettlement; fileName: string; uploadedById: string; marketplace: string },
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<PersistResult> {
  const p = input.parsed;
  const variance = Math.round((p.parsedNetTotal - p.summary.totalDilepas) * 100) / 100;
  const checksumOk = Math.abs(variance) < 1;
  const kunci: KunciSettlement = {
    marketplace: input.marketplace,
    seller: p.seller,
    periodFrom: new Date(`${p.periodFrom}T00:00:00+07:00`),
    periodTo: new Date(`${p.periodTo}T00:00:00+07:00`),
    totalDilepas: sen(p.summary.totalDilepas),
  };

  const run = async (tx: Prisma.TransactionClient) => {
    // Cek kembar DI DALAM transaksi serializable yang sama dengan penyisipannya:
    // dua unggahan bersamaan tidak bisa sama-sama lolos (yang kalah diulang lalu melihat yang menang).
    const ada = await tx.settlement.findFirst({
      where: kunci,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, fileName: true, createdAt: true, uploadedById: true, status: true },
    });
    if (ada) {
      const nama = await namaPengguna(tx, [ada.uploadedById]);
      throw new SettlementGandaError({
        id: ada.id,
        fileName: ada.fileName,
        uploadedAt: ada.createdAt,
        uploadedByName: nama.get(ada.uploadedById) ?? null,
        status: ada.status,
      });
    }

    const s = await tx.settlement.create({
      data: {
        ...kunci,
        fileName: input.fileName,
        uploadedById: input.uploadedById,
        status: "PARSED",
        totalPendapatan: p.summary.totalPendapatan,
        totalPengeluaran: p.summary.totalPengeluaran,
        parsedNetTotal: p.parsedNetTotal,
        checksumOk,
        checksumVariance: variance,
        summaryRaw: p.summary.raw as Prisma.InputJsonValue,
        sellerFeesRaw: p.sellerFeesRaw as Prisma.InputJsonValue,
        adjustmentsRaw: p.adjustmentsRaw as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    // Satu pernyataan untuk semua baris: unggahan ribuan pesanan harus muat di
    // batas waktu transaksi interaktif (nested create = satu INSERT per baris).
    if (p.incomeLines.length > 0) {
      await tx.settlementLine.createMany({
        data: p.incomeLines.map((l) => ({
          settlementId: s.id,
          orderNo: l.orderNo,
          netIncome: l.netIncome,
          hargaAsliProduk: l.hargaAsliProduk,
          totalDiskonProduk: l.totalDiskonProduk,
          biayaAdministrasi: l.biayaAdministrasi,
          biayaLayanan: l.biayaLayanan,
          biayaKomisiAms: l.biayaKomisiAms,
          biayaProsesPesanan: l.biayaProsesPesanan,
          raw: l.raw as Prisma.InputJsonValue,
        })),
      });
    }

    return { settlementId: s.id, checksumOk, checksumVariance: variance, lineCount: p.incomeLines.length };
  };

  // Klien bawaan → transaksi serializable sendiri; transaksi pemanggil → ikut transaksinya.
  // Jangan `"$transaction" in client`: klien Prisma adalah Proxy tanpa perangkap `has`,
  // jadi cek itu selalu false dan unggahan dulu berjalan TANPA transaksi sama sekali.
  // Batas waktu dilonggarkan dari bawaan 5 detik: satu settlement bisa ribuan
  // baris berikut baris mentahnya, dan unggahan yang kehabisan waktu gagal total.
  const punyaTransaksi = typeof (client as { $transaction?: unknown }).$transaction === "function";
  if (!punyaTransaksi) return run(client as Prisma.TransactionClient);
  const klien = client as typeof prisma;
  return withRetry(() =>
    klien.$transaction(run, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 10_000,
      timeout: 60_000,
    }),
  );
}

export type HapusSettlementHasil =
  | { ok: true }
  | { ok: false; code: "ALASAN_WAJIB" | "TIDAK_DITEMUKAN" | "SUDAH_DIJURNAL" };

/**
 * Menghapus unggahan settlement yang BELUM dijurnal (salah unggah, unggahan
 * kembar). Yang sudah punya jurnal — atau berstatus RECONCILED — ditolak: uangnya
 * sudah di buku besar. Barisnya hilang, jadi ringkasannya disimpan di jejak.
 */
export async function hapusSettlementBelumDijurnal(input: {
  settlementId: string;
  userId: string;
  alasan: string;
}): Promise<HapusSettlementHasil> {
  const alasan = input.alasan.trim();
  if (!alasan) return { ok: false, code: "ALASAN_WAJIB" };
  if (!input.settlementId) return { ok: false, code: "TIDAK_DITEMUKAN" };

  return runSerializable(async (tx): Promise<HapusSettlementHasil> => {
    const s = await tx.settlement.findUnique({
      where: { id: input.settlementId },
      select: {
        id: true,
        marketplace: true,
        seller: true,
        periodFrom: true,
        periodTo: true,
        fileName: true,
        uploadedById: true,
        status: true,
        totalPendapatan: true,
        totalPengeluaran: true,
        totalDilepas: true,
        createdAt: true,
        _count: { select: { lines: true } },
      },
    });
    if (!s) return { ok: false, code: "TIDAK_DITEMUKAN" };
    if (s.status === "RECONCILED") return { ok: false, code: "SUDAH_DIJURNAL" };
    const jurnal = await tx.journal.findFirst({
      where: { sourceType: "SETTLEMENT", sourceId: s.id },
      select: { id: true },
    });
    if (jurnal) return { ok: false, code: "SUDAH_DIJURNAL" };

    await tx.settlementLine.deleteMany({ where: { settlementId: s.id } });
    await tx.settlement.delete({ where: { id: s.id } });
    await tx.auditLog.create({
      data: {
        userId: input.userId,
        action: AKSI_HAPUS_SETTLEMENT,
        entityType: "Settlement",
        entityId: s.id,
        reason: alasan,
        changes: {
          before: {
            marketplace: s.marketplace,
            seller: s.seller,
            periodFrom: s.periodFrom.toISOString(),
            periodTo: s.periodTo.toISOString(),
            fileName: s.fileName,
            uploadedById: s.uploadedById,
            uploadedAt: s.createdAt.toISOString(),
            status: s.status,
            totalPendapatan: s.totalPendapatan.toString(),
            totalPengeluaran: s.totalPengeluaran.toString(),
            totalDilepas: s.totalDilepas.toString(),
            lineCount: s._count.lines,
          },
          after: null,
        },
      },
    });
    return { ok: true };
  });
}

/**
 * Penanda untuk daftar dan rincian: dari id yang diberikan, mana yang kembar
 * dengan unggahan lain (tersimpan sebelum penjaga di atas ada). Kunci = id yang
 * kembar, nilai = unggahan "pertama" — yang sudah dijurnal bila ada, selain itu
 * yang paling awal. Unggahan pertama itu sendiri tidak ditandai.
 */
export async function tandaiSettlementGanda(
  settlementIds: string[],
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<Record<string, UnggahanPertama>> {
  const ids = [...new Set(settlementIds.filter((id) => id.length > 0))];
  if (ids.length === 0) return {};

  const pilih = { marketplace: true, seller: true, periodFrom: true, periodTo: true, totalDilepas: true } as const;
  const dicari = await client.settlement.findMany({ where: { id: { in: ids } }, select: { id: true, ...pilih } });
  if (dicari.length === 0) return {};

  const kunciUnik = new Map<string, KunciSettlement>();
  for (const s of dicari) kunciUnik.set(kunciTeks(s), s);
  const sekelompok = await client.settlement.findMany({
    where: {
      OR: [...kunciUnik.values()].map((k) => ({
        marketplace: k.marketplace,
        seller: k.seller,
        periodFrom: k.periodFrom,
        periodTo: k.periodTo,
        totalDilepas: k.totalDilepas,
      })),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, fileName: true, createdAt: true, uploadedById: true, status: true, ...pilih },
  });

  // Yang "pertama" per kunci = yang sudah dijurnal (itulah yang berlaku di buku
  // besar), selain itu yang paling awal. Dengan begitu yang ditandai selalu
  // kembaran yang jurnalnya harus ditahan dan yang boleh dihapus.
  const jurnal = await client.journal.findMany({
    where: { sourceType: "SETTLEMENT", sourceId: { in: sekelompok.map((s) => s.id) } },
    select: { sourceId: true },
  });
  const sudahDijurnal = new Set(jurnal.map((j) => j.sourceId));
  const dijurnal = (s: { id: string; status: string }) => s.status === "RECONCILED" || sudahDijurnal.has(s.id);
  const pertamaPerKunci = new Map<string, (typeof sekelompok)[number]>();
  for (const s of sekelompok) {
    const k = kunciTeks(s);
    const kini = pertamaPerKunci.get(k);
    if (!kini || (!dijurnal(kini) && dijurnal(s))) pertamaPerKunci.set(k, s);
  }

  const kembar = dicari
    .map((s) => ({ id: s.id, pertama: pertamaPerKunci.get(kunciTeks(s)) }))
    .filter((x): x is { id: string; pertama: (typeof sekelompok)[number] } => !!x.pertama && x.pertama.id !== x.id);
  if (kembar.length === 0) return {};

  const nama = await namaPengguna(client as Prisma.TransactionClient, kembar.map((x) => x.pertama.uploadedById));
  const hasil: Record<string, UnggahanPertama> = {};
  for (const { id, pertama } of kembar) {
    hasil[id] = {
      id: pertama.id,
      fileName: pertama.fileName,
      uploadedAt: pertama.createdAt,
      uploadedByName: nama.get(pertama.uploadedById) ?? null,
      status: pertama.status,
    };
  }
  return hasil;
}
