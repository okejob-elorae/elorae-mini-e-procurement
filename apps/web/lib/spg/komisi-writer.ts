import type { Prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { formatIDR } from "@/lib/sales-orders/format";
import { bulanWib } from "@/lib/salesman/pengaturan";
import { JENIS_KABAR, kabariPengguna, type Kabar } from "@/lib/notifications/kabar-pengguna";
import {
  bulanSudahSelesai,
  hitungKomisiToko,
  JEJAK_KOMISI_SPG,
  periodeSah,
  rencanaTetapkan,
  type IsiResmi,
  type NamaJejakKomisiSpg,
} from "./komisi";
import { aturanKomisiPutus, bahanKomisiToko, keBarisResmi, potonganKomisiToko } from "./komisi-queries";
import { REF_KOMISI_SPG_PUTUS } from "./hilang";
import { lepasPotonganHilang, potongBebanHilang } from "./hilang-potong";

/**
 * Penetapan dan pembayaran komisi SPG toko putus (`SpgCommission`).
 *
 * - Hanya bulan WIB yang SUDAH SELESAI yang boleh ditetapkan: bulan berjalan
 *   masih bertambah nota.
 * - Menetapkan ulang boleh selama belum ada baris toko × bulan itu yang
 *   dibayar; setiap baris yang tergantikan hidup di jejaknya (before/after).
 * - Membayar adalah penjaga `paidAt = null` di dalam `runSerializable` — dua
 *   klik bersamaan tidak membayar dua kali.
 * - Kabar `KOMISI_SPG` ke SPG yang bersangkutan SESUDAH transaksi.
 * - Beban barang hilang milik SPG itu dipotong SAAT komisi ditetapkan dan
 *   dibekukan di `deduction` (`StockLossDeduction` dengan `refId` baris ini).
 *   `commission` tetap komisi kotor — itulah yang dibandingkan dengan hitungan
 *   ulang (`sudahBerbeda`); yang diterima SPG = `commission − deduction`.
 *   Menetapkan ulang melepas potongan lama lalu memotong lagi, jadi angkanya
 *   sama selama bebannya tidak berubah; baris yang dihapus melepas potongannya.
 */

export type KodeTolakTetapkan =
  | "PERIODE_TIDAK_SAH"
  | "BULAN_BELUM_SELESAI"
  | "TOKO_TIDAK_DITEMUKAN"
  | "BUKAN_TOKO_PUTUS"
  | "KOMISI_MATI"
  | "TANPA_SPG"
  | "SUDAH_DIBAYAR";

export type HasilTetapkanKomisi =
  | { ok: true; ulang: boolean; ditulis: number; dihapus: number; totalToko: number }
  | { ok: false; code: KodeTolakTetapkan };

export type HasilBayarKomisi = { ok: true } | { ok: false; code: "TIDAK_DITEMUKAN" | "SUDAH_DIBAYAR" | "CATATAN_TERLALU_PANJANG" };

const BATAS_CATATAN = 500;

type KabarTertunda = { userId: string; kabar: Kabar };

async function kirimKabar(daftar: KabarTertunda[]): Promise<void> {
  for (const k of daftar) await kabariPengguna(k.userId, k.kabar);
}

/** "2026-09" → "September 2026" — diformat di server, kabar dibaca apa adanya. */
export function labelBulanKomisi(periode: string): string {
  return new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${periode}-01T00:00:00Z`));
}

async function jejak(
  tx: Prisma.TransactionClient,
  isi: {
    userId: string;
    action: NamaJejakKomisiSpg;
    entityId: string;
    before: unknown;
    after: unknown;
    metadata: Record<string, unknown>;
    reason?: string | null;
  },
): Promise<void> {
  await tx.auditLog.create({
    data: {
      userId: isi.userId,
      action: isi.action,
      entityType: "SpgCommission",
      entityId: isi.entityId,
      changes: { before: isi.before, after: isi.after } as Prisma.InputJsonValue,
      metadata: isi.metadata as Prisma.InputJsonValue,
      reason: isi.reason?.trim() || null,
    },
  });
}

const samaRupiah = (a: number, b: number) => Math.round(a * 100) === Math.round(b * 100);

/**
 * Kalimat komisi di kabar SPG. Dengan potongan beban barang hilang, yang
 * disebut dulu adalah yang DITERIMA — itu yang dicocokkan SPG dengan uangnya.
 */
export function kalimatKomisi(komisi: number, potongan: number): string {
  if (potongan <= 0) return `komisi Anda ${formatIDR(komisi)}.`;
  return `komisi Anda ${formatIDR(komisi)}, dipotong beban barang hilang ${formatIDR(potongan)} — diterima ${formatIDR(Math.max(0, komisi - potongan))}.`;
}

const samaIsi = (a: IsiResmi, b: IsiResmi) =>
  a.unitsSold === b.unitsSold && Math.round(a.commission * 100) === Math.round(b.commission * 100) && a.basis === b.basis;

export async function tetapkanKomisiToko(input: {
  storeId: string;
  periode: string;
  olehUserId: string;
  sekarang?: Date;
}): Promise<HasilTetapkanKomisi> {
  if (!periodeSah(input.periode)) return { ok: false, code: "PERIODE_TIDAK_SAH" };
  if (!bulanSudahSelesai(input.periode, bulanWib(input.sekarang ?? new Date()))) return { ok: false, code: "BULAN_BELUM_SELESAI" };

  let kabar: KabarTertunda[] = [];
  const hasil = await runSerializable(async (tx): Promise<HasilTetapkanKomisi> => {
    // Callback ini bisa diulang: kabar dari percobaan yang gagal tidak boleh ikut terkirim.
    kabar = [];
    const toko = await tx.store.findUnique({ where: { id: input.storeId }, select: { id: true, name: true, termsType: true } });
    if (!toko) return { ok: false, code: "TOKO_TIDAK_DITEMUKAN" };
    if (toko.termsType !== "PUTUS") return { ok: false, code: "BUKAN_TOKO_PUTUS" };
    const aturan = await aturanKomisiPutus(tx);
    if (!aturan.aktif) return { ok: false, code: "KOMISI_MATI" };

    const [bahan, potongan, ada] = await Promise.all([
      bahanKomisiToko(tx, [toko.id], input.periode),
      potonganKomisiToko({ db: tx, storeIds: [toko.id], periode: input.periode }),
      tx.spgCommission.findMany({
        where: { storeId: toko.id, period: input.periode },
        select: { id: true, userId: true, unitsSold: true, commission: true, deduction: true, basis: true, paidAt: true },
      }),
    ]);
    const potonganLama = new Map(ada.map((b) => [b.id, Number(b.deduction)]));
    const hitung = hitungKomisiToko({ dasar: aturan.dasar, ...bahan.get(toko.id)!, potongan: potongan.get(toko.id) ?? [] });
    const rencana = rencanaTetapkan(hitung, ada.map(keBarisResmi));
    if (!rencana.ok) return { ok: false, code: rencana.code };

    const waktu = new Date();
    const bulan = labelBulanKomisi(input.periode);
    const meta = (spgUserId: string) => ({ storeId: toko.id, period: input.periode, spgUserId, dasar: aturan.dasar });
    for (const t of rencana.tulis) {
      const baris = await tx.spgCommission.upsert({
        where: { userId_storeId_period: { userId: t.userId, storeId: toko.id, period: input.periode } },
        create: {
          userId: t.userId,
          storeId: toko.id,
          period: input.periode,
          unitsSold: t.isi.unitsSold,
          commission: t.isi.commission,
          basis: t.isi.basis,
          lockedById: input.olehUserId,
          lockedAt: waktu,
        },
        update: {
          unitsSold: t.isi.unitsSold,
          commission: t.isi.commission,
          basis: t.isi.basis,
          lockedById: input.olehUserId,
          lockedAt: waktu,
        },
        select: { id: true },
      });
      const lama = potonganLama.get(baris.id) ?? 0;
      await lepasPotonganHilang(tx, { refType: REF_KOMISI_SPG_PUTUS, refId: baris.id, userId: input.olehUserId });
      const potong = await potongBebanHilang(tx, {
        userId: t.userId,
        bruto: t.isi.commission,
        refType: REF_KOMISI_SPG_PUTUS,
        refId: baris.id,
        createdById: input.olehUserId,
        note: `Komisi ${bulan} · ${toko.name}`,
      });
      await tx.spgCommission.update({ where: { id: baris.id }, data: { deduction: potong } });
      await jejak(tx, {
        userId: input.olehUserId,
        action: t.sebelum ? JEJAK_KOMISI_SPG.DITETAPKAN_ULANG : JEJAK_KOMISI_SPG.DITETAPKAN,
        entityId: baris.id,
        before: t.sebelum ? { unitsSold: t.sebelum.unitsSold, commission: t.sebelum.commission, basis: t.sebelum.basis, deduction: lama } : null,
        after: { ...t.isi, deduction: potong },
        metadata: { ...meta(t.userId), ...t.rincian },
      });
      if (!t.sebelum || !samaIsi(t.sebelum, t.isi) || !samaRupiah(lama, potong)) {
        kabar.push({
          userId: t.userId,
          kabar: {
            jenis: JENIS_KABAR.KOMISI_SPG,
            judul: t.sebelum ? `Komisi ${bulan} diperbarui` : `Komisi ${bulan} ditetapkan`,
            isi: `${toko.name}: ${kalimatKomisi(t.isi.commission, potong)} Dibayar setelah kantor menandainya.`,
            data: { period: input.periode },
          },
        });
      }
    }
    for (const h of rencana.hapus) {
      // Potongan beban yang menempel di baris ini kembali menjadi sisa beban SPG-nya.
      await lepasPotonganHilang(tx, { refType: REF_KOMISI_SPG_PUTUS, refId: h.id, userId: input.olehUserId });
      await tx.spgCommission.delete({ where: { id: h.id } });
      await jejak(tx, {
        userId: input.olehUserId,
        action: JEJAK_KOMISI_SPG.DITETAPKAN_ULANG,
        entityId: h.id,
        before: { ...h.sebelum, deduction: potonganLama.get(h.id) ?? 0 },
        after: null,
        metadata: { ...meta(h.userId), dihapus: true },
      });
    }
    return { ok: true, ulang: ada.length > 0, ditulis: rencana.tulis.length, dihapus: rencana.hapus.length, totalToko: hitung.totalToko };
  });

  if (hasil.ok) await kirimKabar(kabar);
  return hasil;
}

export async function tandaiKomisiDibayar(input: { commissionId: string; olehUserId: string; catatan?: unknown }): Promise<HasilBayarKomisi> {
  const catatan = typeof input.catatan === "string" ? input.catatan.trim() : "";
  if (catatan.length > BATAS_CATATAN) return { ok: false, code: "CATATAN_TERLALU_PANJANG" };

  let kabar: KabarTertunda[] = [];
  const hasil = await runSerializable(async (tx): Promise<HasilBayarKomisi> => {
    kabar = [];
    const b = await tx.spgCommission.findUnique({
      where: { id: input.commissionId },
      select: { id: true, userId: true, storeId: true, period: true, commission: true, deduction: true, paidAt: true },
    });
    if (!b) return { ok: false, code: "TIDAK_DITEMUKAN" };
    const waktu = new Date();
    const r = await tx.spgCommission.updateMany({
      where: { id: b.id, paidAt: null },
      data: { paidAt: waktu, paidById: input.olehUserId, ...(catatan ? { note: catatan } : {}) },
    });
    if (r.count !== 1) return { ok: false, code: "SUDAH_DIBAYAR" };
    await jejak(tx, {
      userId: input.olehUserId,
      action: JEJAK_KOMISI_SPG.DIBAYAR,
      entityId: b.id,
      before: { paidAt: null },
      after: { paidAt: waktu.toISOString() },
      metadata: { storeId: b.storeId, period: b.period, spgUserId: b.userId, commission: Number(b.commission), deduction: Number(b.deduction) },
      reason: catatan || null,
    });
    const toko = await tx.store.findUnique({ where: { id: b.storeId }, select: { name: true } });
    kabar.push({
      userId: b.userId,
      kabar: {
        jenis: JENIS_KABAR.KOMISI_SPG,
        judul: `Komisi ${labelBulanKomisi(b.period)} dibayar`,
        isi:
          Number(b.deduction) > 0
            ? `${toko?.name ?? "Toko"}: ${formatIDR(Math.max(0, Number(b.commission) - Number(b.deduction)))} sudah dibayar (komisi ${formatIDR(Number(b.commission))} dipotong beban barang hilang ${formatIDR(Number(b.deduction))}).`
            : `${toko?.name ?? "Toko"}: komisi ${formatIDR(Number(b.commission))} sudah dibayar.`,
        data: { period: b.period },
      },
    });
    return { ok: true };
  });

  if (hasil.ok) await kirimKabar(kabar);
  return hasil;
}
