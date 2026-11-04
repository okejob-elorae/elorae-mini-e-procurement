import { Prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { alokasiPotong, REF_KOMISI_SALESMAN } from "@/lib/spg/hilang";
import { catatJejak, JEJAK } from "./jejak";
import { statusBebanSales } from "./rules";

/**
 * Beban selisih retur yang ditanggung SALES dipotong dari komisinya — mekanisme
 * yang sama dengan potongan beban barang hilang (`tandaiSalesDipotong`):
 * penggajian salesman belum ada di sistem, jadi kantor menandai berapa yang
 * dipotong bulan itu dan jumlahnya dibagikan ke beban-bebannya yang terlama
 * dulu.
 *
 * Jalur kedua di bawah (kelebihan potongan DIKEMBALIKAN ke sales) MENUNGGU
 * JAWABAN P87 dan tidak pernah tercapai hari ini. Yang dijawab pemilik
 * ("setuju") adalah bawaannya: barang yang baru ketemu sesudah komisi sales
 * dipotong TIDAK dicatat sebagai susulan nota itu — penulis susulan menolaknya
 * (`SUDAH_DIPOTONG`/`SUDAH_LUNAS`) dan barangnya diterima gudang sebagai
 * penerimaan tanpa nota. Jadi beban tidak pernah turun di bawah yang sudah
 * dipotong, dan kelebihan selalu nol. Kalau pemilik memilih "potongannya
 * dikembalikan", penolakan di penulis susulan dicabut dan jalur ini dipakai.
 *
 * Idempoten per `kunci` layar (refType `KomisiSalesman`, refId
 * `<sales>:<bulan>:<kunci>`). Setiap beban yang tersentuh ditukar dengan
 * bandingkan-lalu-tukar pada `settledAmount` DI DALAM `runSerializable`
 * (`updateMany` Prisma bukan CAS atomik), dan jejaknya ditulis di transaksi
 * yang sama.
 */

export type KodeTolakPotongRetur =
  | "BULAN_TIDAK_SAH"
  | "JUMLAH_TIDAK_SAH"
  | "KUNCI_WAJIB"
  | "TIDAK_ADA_BEBAN"
  | "MELEBIHI_SISA"
  | "TIDAK_ADA_KELEBIHAN"
  | "MELEBIHI_KELEBIHAN"
  | "TEKS_TERLALU_PANJANG"
  | "BERUBAH";

type Masukan = {
  salesmanId: string;
  bulan: string;
  jumlah: unknown;
  kunci: unknown;
  catatan?: unknown;
  olehUserId: string;
  sekarang?: Date;
};

type Hasil = { ok: true; nilai: number; ulang: boolean } | { ok: false; kode: KodeTolakPotongRetur };

const BATAS_CATATAN = 500;
const keSen = (n: number) => Math.round(n * 100);
const dariSen = (n: number) => n / 100;
const D = (sen: number) => new Prisma.Decimal(dariSen(sen));

/** Kesalahan baca-ulang di dalam transaksi: beban berubah di antara baca dan tulis. */
class BebanBerubah extends Error {}

function periksaMasukan(input: Masukan):
  | { ok: true; jumlahSen: number; kunci: string; catatan: string | null }
  | { ok: false; kode: KodeTolakPotongRetur } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.bulan)) return { ok: false, kode: "BULAN_TIDAK_SAH" };
  const kunci = typeof input.kunci === "string" ? input.kunci.trim() : "";
  if (kunci.length < 8 || kunci.length > 100) return { ok: false, kode: "KUNCI_WAJIB" };
  const j = input.jumlah;
  if (typeof j !== "number" || !Number.isFinite(j) || keSen(j) <= 0 || Math.abs(keSen(j) - j * 100) > 1e-6) {
    return { ok: false, kode: "JUMLAH_TIDAK_SAH" };
  }
  const teks = typeof input.catatan === "string" ? input.catatan.trim() : "";
  if (Array.from(teks).length > BATAS_CATATAN) return { ok: false, kode: "TEKS_TERLALU_PANJANG" };
  return { ok: true, jumlahSen: keSen(j), kunci, catatan: teks || null };
}

/** Beban SALES milik orang ini, terlama dulu, dengan yang sudah dipotong. */
async function bebanSales(tx: Prisma.TransactionClient, salesmanId: string) {
  const rows = await tx.returnCharge.findMany({
    where: { bearer: "SALES", bearerUserId: salesmanId, status: { in: ["DITETAPKAN", "LUNAS"] } },
    orderBy: [{ decidedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: { id: true, amount: true, settledAmount: true, status: true },
  });
  return rows.map((r) => ({
    id: r.id,
    amountSen: keSen(Number(r.amount)),
    settledSen: keSen(Number(r.settledAmount)),
    status: r.status as "DITETAPKAN" | "LUNAS",
  }));
}

async function terapkan(
  tx: Prisma.TransactionClient,
  b: { id: string; amountSen: number; settledSen: number; status: "DITETAPKAN" | "LUNAS" },
  deltaSen: number,
  input: Masukan,
  refId: string,
  catatan: string,
  aksi: typeof JEJAK.BEBAN_DIPOTONG | typeof JEJAK.BEBAN_DIKEMBALIKAN,
  sekarang: Date,
): Promise<void> {
  const baruSen = b.settledSen + deltaSen;
  const status = statusBebanSales(dariSen(b.amountSen), dariSen(baruSen), b.status);
  const ubah = await tx.returnCharge.updateMany({
    where: { id: b.id, settledAmount: D(b.settledSen) },
    data: {
      settledAmount: D(baruSen),
      status,
      settledAt: status === "LUNAS" ? sekarang : null,
    },
  });
  if (ubah.count !== 1) throw new BebanBerubah();
  await tx.returnChargeDeduction.create({
    data: { chargeId: b.id, amount: D(deltaSen), refType: REF_KOMISI_SALESMAN, refId, note: catatan, createdById: input.olehUserId },
  });
  await catatJejak(tx, {
    userId: input.olehUserId,
    action: aksi,
    entityType: "ReturnCharge",
    entityId: b.id,
    changes: {
      before: { settledAmount: dariSen(b.settledSen), status: b.status },
      after: { settledAmount: dariSen(baruSen), status },
    },
    metadata: { salesmanId: input.salesmanId, bulan: input.bulan, refId, jumlah: dariSen(deltaSen) },
    reason: catatan,
  });
}

async function sudahDicatat(tx: Prisma.TransactionClient, refId: string): Promise<number | null> {
  const ada = await tx.returnChargeDeduction.findMany({
    where: { refType: REF_KOMISI_SALESMAN, refId },
    select: { amount: true },
  });
  if (ada.length === 0) return null;
  return Math.abs(ada.reduce((n, d) => n + keSen(Number(d.amount)), 0));
}

/** Kantor menandai beban selisih retur seorang sales sudah dipotong dari komisinya bulan itu. */
export async function tandaiBebanReturDipotong(input: Masukan): Promise<Hasil> {
  const cek = periksaMasukan(input);
  if (!cek.ok) return cek;
  const refId = `${input.salesmanId}:${input.bulan}:${cek.kunci}`;
  const sekarang = input.sekarang ?? new Date();
  const catatan = cek.catatan ?? `Dipotong dari komisi ${input.bulan}`;
  try {
    return await runSerializable(async (tx) => {
      const ulang = await sudahDicatat(tx, refId);
      if (ulang !== null) return { ok: true as const, nilai: dariSen(ulang), ulang: true };
      const beban = await bebanSales(tx, input.salesmanId);
      const terbuka = beban.map((b) => ({ id: b.id, sisaSen: Math.max(0, b.amountSen - b.settledSen) })).filter((b) => b.sisaSen > 0);
      const sisaSen = terbuka.reduce((n, b) => n + b.sisaSen, 0);
      if (sisaSen <= 0) return { ok: false as const, kode: "TIDAK_ADA_BEBAN" as const };
      if (cek.jumlahSen > sisaSen) return { ok: false as const, kode: "MELEBIHI_SISA" as const };
      const peta = new Map(beban.map((b) => [b.id, b]));
      for (const a of alokasiPotong(terbuka, cek.jumlahSen)) {
        await terapkan(tx, peta.get(a.id)!, a.potongSen, input, refId, catatan, JEJAK.BEBAN_DIPOTONG, sekarang);
      }
      return { ok: true as const, nilai: dariSen(cek.jumlahSen), ulang: false };
    });
  } catch (err) {
    if (err instanceof BebanBerubah) return { ok: false, kode: "BERUBAH" };
    throw err;
  }
}

/**
 * Kelebihan potongan dikembalikan ke sales — MENUNGGU JAWABAN P87 ("barang ketemu
 * sesudah komisi sales dipotong"; lihat catatan di atas): beban yang turun di bawah
 * yang sudah dipotong. Hanya sebesar kelebihannya, terlama dulu. Dengan bawaan yang
 * disetujui pemilik, kelebihannya selalu nol (`TIDAK_ADA_KELEBIHAN`).
 */
export async function tandaiKelebihanReturDikembalikan(input: Masukan): Promise<Hasil> {
  const cek = periksaMasukan(input);
  if (!cek.ok) return cek;
  const refId = `kembali:${input.salesmanId}:${input.bulan}:${cek.kunci}`;
  const sekarang = input.sekarang ?? new Date();
  const catatan = cek.catatan ?? `Dikembalikan bersama komisi ${input.bulan}`;
  try {
    return await runSerializable(async (tx) => {
      const ulang = await sudahDicatat(tx, refId);
      if (ulang !== null) return { ok: true as const, nilai: dariSen(ulang), ulang: true };
      const beban = await bebanSales(tx, input.salesmanId);
      const lebih = beban.map((b) => ({ id: b.id, sisaSen: Math.max(0, b.settledSen - b.amountSen) })).filter((b) => b.sisaSen > 0);
      const totalSen = lebih.reduce((n, b) => n + b.sisaSen, 0);
      if (totalSen <= 0) return { ok: false as const, kode: "TIDAK_ADA_KELEBIHAN" as const };
      if (cek.jumlahSen > totalSen) return { ok: false as const, kode: "MELEBIHI_KELEBIHAN" as const };
      const peta = new Map(beban.map((b) => [b.id, b]));
      for (const a of alokasiPotong(lebih, cek.jumlahSen)) {
        await terapkan(tx, peta.get(a.id)!, -a.potongSen, input, refId, catatan, JEJAK.BEBAN_DIKEMBALIKAN, sekarang);
      }
      return { ok: true as const, nilai: dariSen(cek.jumlahSen), ulang: false };
    });
  } catch (err) {
    if (err instanceof BebanBerubah) return { ok: false, kode: "BERUBAH" };
    throw err;
  }
}
