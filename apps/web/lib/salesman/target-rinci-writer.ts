import type { Prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { daftarSalesman, daftarSpg } from "./queries";
import { acuanDikenal } from "./target-rinci-queries";
import {
  bulanSah,
  bulanSebelumnya,
  periksaTargetRinci,
  salinDariBulanLalu,
  samaIsiTarget,
  type BarisTarget,
  type KodeTolakTarget,
  type LingkupTarget,
  type UkuranTarget,
} from "./target-rinci";

/**
 * Penulis target per kategori/barang (`SalesTarget`).
 *
 * Satu sales satu bulan disimpan sebagai SATU SET: menyimpan mengganti seluruh
 * baris bulan itu (hapus + tulis ulang) di satu transaksi, bersama satu baris
 * `AuditLog` `SALES_TARGET_UPDATED` yang membawa set sebelum dan sesudahnya —
 * barisnya sendiri hanya menyimpan keadaan terakhir, jadi target yang diganti
 * hanya hidup di jejak itu. Menyimpan set yang sama persis tidak menulis apa
 * pun (dan tidak meninggalkan jejak kosong).
 *
 * Izin (`field_sales_orders:approve`) diperiksa aksi servernya, bukan di sini.
 */

export const JEJAK_TARGET_SALES = "SALES_TARGET_UPDATED";
export const ENTITAS_TARGET_SALES = "SalesTarget";

type Klien = Prisma.TransactionClient;

export type KodeTolakSimpanTarget = KodeTolakTarget | "BULAN_TIDAK_SAH" | "SALESMAN_TIDAK_DIKENAL";

export type HasilSimpanTarget =
  | { ok: true; jumlah: number; berubah: boolean }
  | { ok: false; kode: KodeTolakSimpanTarget; indeks?: number };

export type HasilSalinTarget =
  | { ok: true; jumlah: number; dibuang: number }
  | { ok: false; kode: "BULAN_TIDAK_SAH" | "SALESMAN_TIDAK_DIKENAL" | "BULAN_LALU_KOSONG" | "SUDAH_ADA" | "SEMUA_TIDAK_BERLAKU" };

/**
 * Pemilik target = sales (`daftarSalesman`: peran membuka HP, bukan peran
 * sistem) ATAU SPG (`daftarSpg`: punya toko tetap) — definisi yang sama dengan
 * pemilih di layar, supaya target tidak bisa ditempelkan ke admin lewat id yang
 * disunting tangan. Capaian SPG dihitung dari nota penjualannya sendiri.
 */
async function salesmanDikenal(salesmanId: string): Promise<boolean> {
  const [sales, spg] = await Promise.all([daftarSalesman(), daftarSpg()]);
  return sales.some((s) => s.id === salesmanId) || spg.some((s) => s.id === salesmanId);
}

async function setBulan(tx: Klien, salesmanId: string, bulan: string): Promise<BarisTarget[]> {
  const rows = await tx.salesTarget.findMany({
    where: { salesmanId, month: bulan },
    select: { scope: true, refId: true, measure: true, value: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map((r) => ({
    scope: r.scope as LingkupTarget,
    refId: r.refId,
    measure: r.measure as UkuranTarget,
    value: Number(r.value),
  }));
}

/** Ganti set satu sales satu bulan + jejaknya, di transaksi pemanggil. */
async function gantiSet(
  tx: Klien,
  args: {
    salesmanId: string;
    bulan: string;
    sebelum: BarisTarget[];
    sesudah: BarisTarget[];
    olehUserId: string;
    metadata: Prisma.InputJsonObject;
  },
): Promise<boolean> {
  const { salesmanId, bulan, sebelum, sesudah, olehUserId } = args;
  if (samaIsiTarget(sebelum, sesudah)) return false;
  // salesmanId dan bulan sudah diperiksa tidak kosong: filter ini tidak pernah melebar.
  await tx.salesTarget.deleteMany({ where: { salesmanId, month: bulan } });
  if (sesudah.length > 0) {
    await tx.salesTarget.createMany({
      data: sesudah.map((b) => ({
        salesmanId,
        month: bulan,
        scope: b.scope,
        refId: b.refId,
        measure: b.measure,
        value: b.value,
        createdById: olehUserId,
      })),
    });
  }
  await tx.auditLog.create({
    data: {
      userId: olehUserId,
      action: JEJAK_TARGET_SALES,
      entityType: ENTITAS_TARGET_SALES,
      entityId: `${salesmanId}:${bulan}`,
      changes: { before: sebelum, after: sesudah },
      metadata: { salesmanId, bulan, ...args.metadata },
    },
  });
  return true;
}

/** Simpan seluruh target satu sales satu bulan (mengganti set lama). Daftar kosong = hapus semua. */
export async function simpanTargetRinci(input: {
  salesmanId: string;
  bulan: string;
  baris: unknown;
  olehUserId: string;
}): Promise<HasilSimpanTarget> {
  if (!bulanSah(input.bulan)) return { ok: false, kode: "BULAN_TIDAK_SAH" };
  if (!input.salesmanId || !(await salesmanDikenal(input.salesmanId))) return { ok: false, kode: "SALESMAN_TIDAK_DIKENAL" };
  const masuk = input.baris;

  return runSerializable(async (tx) => {
    // Bentuk dan batas dulu, tanpa basis data; acuannya sesudah itu.
    const awal = periksaTargetRinci(masuk, null);
    if (!awal.ok) return awal;
    const dikenal = await acuanDikenal(tx, awal.baris);
    const cek = periksaTargetRinci(masuk, dikenal);
    if (!cek.ok) return cek;

    const sebelum = await setBulan(tx, input.salesmanId, input.bulan);
    const berubah = await gantiSet(tx, {
      salesmanId: input.salesmanId,
      bulan: input.bulan,
      sebelum,
      sesudah: cek.baris,
      olehUserId: input.olehUserId,
      metadata: { sumber: "SIMPAN" },
    });
    return { ok: true as const, jumlah: cek.baris.length, berubah };
  });
}

/**
 * Salin target bulan lalu ke `bulan`. Bulan tujuan yang sudah berisi ditolak
 * (`SUDAH_ADA`) kecuali `timpa` — layar meminta konfirmasi dulu, supaya satu
 * klik tidak menghapus target yang sudah disusun. Acuan yang sudah nonaktif
 * atau hilang tidak ikut tersalin dan dihitung di `dibuang`.
 */
export async function salinTargetBulanLalu(input: {
  salesmanId: string;
  bulan: string;
  olehUserId: string;
  timpa?: boolean;
}): Promise<HasilSalinTarget> {
  if (!bulanSah(input.bulan)) return { ok: false, kode: "BULAN_TIDAK_SAH" };
  if (!input.salesmanId || !(await salesmanDikenal(input.salesmanId))) return { ok: false, kode: "SALESMAN_TIDAK_DIKENAL" };
  const dariBulan = bulanSebelumnya(input.bulan);

  return runSerializable(async (tx) => {
    const lalu = await setBulan(tx, input.salesmanId, dariBulan);
    if (lalu.length === 0) return { ok: false as const, kode: "BULAN_LALU_KOSONG" as const };
    const sebelum = await setBulan(tx, input.salesmanId, input.bulan);
    if (sebelum.length > 0 && !input.timpa) return { ok: false as const, kode: "SUDAH_ADA" as const };

    const salin = salinDariBulanLalu(lalu, await acuanDikenal(tx, lalu, { hanyaAktif: true }));
    if (salin.baris.length === 0) return { ok: false as const, kode: "SEMUA_TIDAK_BERLAKU" as const };

    await gantiSet(tx, {
      salesmanId: input.salesmanId,
      bulan: input.bulan,
      sebelum,
      sesudah: salin.baris,
      olehUserId: input.olehUserId,
      metadata: { sumber: "SALIN_BULAN_LALU", dariBulan, dibuang: salin.dibuang },
    });
    return { ok: true as const, jumlah: salin.baris.length, dibuang: salin.dibuang };
  });
}
