import { Prisma, type PrismaClient } from "@elorae/db";
import { putarGudangRusak, type GerakRusak } from "./nilai-rusak";

/*
 * Nilai gudang barang rusak dari basis data — KHUSUS SERVER. Aturan
 * pemutarannya murni di `nilai-rusak.ts`.
 */

type Klien = PrismaClient | Prisma.TransactionClient;

/** `AuditLog.action` keputusan gudang rusak (`JEJAK_GUDANG_RUSAK.DIPUTUSKAN`). */
const AKSI_KEPUTUSAN = "DAMAGED_STOCK_DECIDED";

const angka = (v: unknown): number => Number(v ?? 0);

/**
 * Harga rata-rata gudang satu barang × varian, dicari seperti jurnal retur toko:
 * varian persis, lalu baris tanpa varian (`null`/`""`), lalu varian mana pun.
 */
export async function hargaRataBarang(client: Klien, itemId: string, variantSku: string | null | undefined): Promise<number> {
  const varian = variantSku?.trim() ?? "";
  const baris =
    (varian ? await client.inventoryValue.findFirst({ where: { itemId, variantSku: varian }, select: { avgCost: true } }) : null) ??
    (await client.inventoryValue.findFirst({ where: { itemId, OR: [{ variantSku: null }, { variantSku: "" }] }, select: { avgCost: true } })) ??
    (await client.inventoryValue.findFirst({ where: { itemId }, select: { avgCost: true } }));
  return angka(baris?.avgCost);
}

function bacaMetadata(m: unknown): Record<string, unknown> {
  let v = m;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return {};
    }
  }
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Biaya JUAL_OBRAL yang tercatat di jejak keputusannya (`metadata.biaya`), per id gerakan. */
async function biayaObralTercatat(client: Klien, ids: string[]): Promise<Map<string, number>> {
  const hasil = new Map<string, number>();
  if (ids.length === 0) return hasil;
  const jejak = await client.auditLog.findMany({
    where: { action: AKSI_KEPUTUSAN, entityType: "DamagedStockMovement", entityId: { in: ids } },
    select: { entityId: true, metadata: true },
  });
  for (const j of jejak) {
    const b = bacaMetadata(j.metadata).biaya;
    if (typeof b === "number" && Number.isFinite(b) && j.entityId) hasil.set(j.entityId, b);
  }
  return hasil;
}

function keGerak(r: { id: string; kind: string; qty: number; value: Prisma.Decimal | null; createdAt: Date }): GerakRusak {
  return { id: r.id, kind: r.kind, qty: r.qty, value: r.value === null ? null : Number(r.value), createdAt: r.createdAt };
}

/** Putar ulang satu barang × varian, dari basis data. */
export async function putarBarangRusak(client: Klien, itemId: string, variantSku: string) {
  const rows = await client.damagedStockMovement.findMany({
    where: { itemId, variantSku },
    select: { id: true, kind: true, qty: true, value: true, createdAt: true },
  });
  const obral = await biayaObralTercatat(
    client,
    rows.filter((r) => r.kind === "JUAL_OBRAL").map((r) => r.id),
  );
  const adaMasukTanpaNilai = rows.some((r) => r.kind === "MASUK_RETUR" && r.value === null);
  const cadangan = adaMasukTanpaNilai ? await hargaRataBarang(client, itemId, variantSku) : 0;
  return putarGudangRusak(rows.map(keGerak), cadangan, obral);
}

/**
 * Nilai KELUAR satu gerakan keputusan (rupiah), dihitung saat ini dari saldo
 * gudang rusak barang itu SEBELUM gerakan tersebut. Dipanggil penulis
 * keputusan di dalam transaksinya SEBELUM gerakannya ditulis: `qtyKeluar`
 * diperlakukan sebagai gerakan berikutnya.
 */
export async function nilaiKeluarBerikutnya(client: Klien, itemId: string, variantSku: string, qtyKeluar: number): Promise<number> {
  const h = await putarBarangRusak(client, itemId, variantSku);
  const q = Math.abs(qtyKeluar);
  if (h.qty <= 0) return 0;
  const sen = q >= h.qty ? h.sen : Math.round((h.sen * q) / h.qty);
  return sen / 100;
}

/** Nilai keluar satu gerakan yang sudah tertulis (rupiah), atau null bila bukan gerakan keluar. */
export async function nilaiKeluarGerak(client: Klien, gerakId: string): Promise<number | null> {
  const g = await client.damagedStockMovement.findUnique({ where: { id: gerakId }, select: { itemId: true, variantSku: true, kind: true } });
  if (!g || g.kind === "MASUK_RETUR") return null;
  const h = await putarBarangRusak(client, g.itemId, g.variantSku);
  const sen = h.keluarSen.get(gerakId);
  return sen === undefined ? null : sen / 100;
}

/** Nilai MASUK_RETUR yang ditulis untuk baris NRI (qty × harga rata-rata barang itu sekarang). */
export async function nilaiMasukRusak(client: Klien, itemId: string, variantSku: string | null | undefined, qty: number): Promise<number> {
  const harga = await hargaRataBarang(client, itemId, variantSku);
  return Math.round(Math.abs(qty) * harga * 100) / 100;
}

export type NilaiGudangRusak = {
  /** Σ nilai saldo semua barang (rupiah). */
  total: number;
  /** Banyak gerakan MASUK_RETUR lama yang belum bernilai (memakai harga rata-rata sekarang). */
  masukTanpaNilai: number;
  barang: Array<{ itemId: string; variantSku: string; qty: number; nilai: number }>;
};

/** Nilai seluruh gudang barang rusak saat ini (layar rekonsiliasi persediaan). */
export async function nilaiGudangRusak(client: Klien): Promise<NilaiGudangRusak> {
  const rows = await client.damagedStockMovement.findMany({
    select: { id: true, itemId: true, variantSku: true, kind: true, qty: true, value: true, createdAt: true },
  });
  const obral = await biayaObralTercatat(
    client,
    rows.filter((r) => r.kind === "JUAL_OBRAL").map((r) => r.id),
  );
  const per = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = `${r.itemId}\u0000${r.variantSku}`;
    const d = per.get(k) ?? [];
    d.push(r);
    per.set(k, d);
  }
  let totalSen = 0;
  let masukTanpaNilai = 0;
  const barang: NilaiGudangRusak["barang"] = [];
  for (const daftar of per.values()) {
    const { itemId, variantSku } = daftar[0];
    const tanpa = daftar.filter((r) => r.kind === "MASUK_RETUR" && r.value === null).length;
    masukTanpaNilai += tanpa;
    const cadangan = tanpa > 0 ? await hargaRataBarang(client, itemId, variantSku) : 0;
    const h = putarGudangRusak(daftar.map(keGerak), cadangan, obral);
    totalSen += h.sen;
    if (h.qty !== 0 || h.sen !== 0) barang.push({ itemId, variantSku, qty: h.qty, nilai: h.sen / 100 });
  }
  return { total: totalSen / 100, masukTanpaNilai, barang };
}

/**
 * Isi `value` gerakan MASUK_RETUR lama yang masih kosong (qty × harga rata-rata
 * barang itu sekarang). Hanya mengisi yang kosong — tidak pernah menimpa.
 * Mengembalikan banyak baris yang diisi.
 */
export async function lengkapiNilaiMasukRusak(
  client: Klien,
  opsi: { ids?: readonly string[]; barang?: { itemId: string; variantSku: string } } = {},
): Promise<number> {
  const rows = await client.damagedStockMovement.findMany({
    where: {
      kind: "MASUK_RETUR",
      value: null,
      ...(opsi.ids ? { id: { in: [...opsi.ids] } } : {}),
      ...(opsi.barang ? { itemId: opsi.barang.itemId, variantSku: opsi.barang.variantSku } : {}),
    },
    select: { id: true, itemId: true, variantSku: true, qty: true },
  });
  let diisi = 0;
  for (const r of rows) {
    const nilai = await nilaiMasukRusak(client, r.itemId, r.variantSku, r.qty);
    const u = await client.damagedStockMovement.updateMany({ where: { id: r.id, value: null }, data: { value: new Prisma.Decimal(nilai) } });
    diisi += u.count;
  }
  return diisi;
}
