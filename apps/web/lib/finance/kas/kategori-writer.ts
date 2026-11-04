import { prisma, Prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { bacaJenisPotongPemasok } from "@/lib/finance/pajak/pemotongan";
import { KATEGORI_BAWAAN, tebakAkunKategori, type KodeGalatKategori } from "./aturan";
import { catatJejakKas, JEJAK_KAS } from "./jejak";

/**
 * Kategori biaya/penerimaan kas (`CashCategory`) — KHUSUS SERVER. Setiap
 * kategori menunjuk SATU akun (BEBAN/PENDAPATAN/ASET daun aktif — aset untuk
 * mis. sewa dibayar di muka) dan boleh membawa jenis potongan PPh bawaan.
 * Kategori dinonaktifkan, tidak pernah dihapus: voucher lama menunjuknya.
 */

export type HasilKategori = { ok: true; id: string } | { ok: false; kode: KodeGalatKategori };

const TIPE_AKUN_KATEGORI = ["BEBAN", "PENDAPATAN", "HPP", "ASET", "LIABILITAS"];

export async function simpanKategori(input: {
  id?: string | null;
  nama: unknown;
  jenis: unknown;
  akunId: unknown;
  jenisPotong?: unknown;
  aktif?: unknown;
  urutan?: unknown;
  olehUserId: string;
}): Promise<HasilKategori> {
  const nama = typeof input.nama === "string" ? input.nama.trim().replace(/\s+/g, " ") : "";
  if (nama.length < 2 || nama.length > 100) return { ok: false, kode: "NAMA_WAJIB" };
  if (input.jenis !== "OUT" && input.jenis !== "IN") return { ok: false, kode: "JENIS_TIDAK_SAH" };
  const jenis = input.jenis;
  const akunId = typeof input.akunId === "string" ? input.akunId : "";
  let potong: string | null = null;
  if (input.jenisPotong != null && input.jenisPotong !== "") {
    potong = bacaJenisPotongPemasok(input.jenisPotong);
    if (!potong || jenis !== "OUT") return { ok: false, kode: "POTONG_TIDAK_SAH" };
  }
  const urutan = Number.isInteger(input.urutan) ? (input.urutan as number) : 0;
  try {
    return await runSerializable(async (tx): Promise<HasilKategori> => {
      const akun = akunId
        ? await tx.chartAccount.findFirst({ where: { id: akunId, isActive: true, children: { none: {} } }, select: { id: true, type: true } })
        : null;
      if (!akun || !TIPE_AKUN_KATEGORI.includes(akun.type)) return { ok: false, kode: "AKUN_TIDAK_SAH" };
      const kembar = await tx.cashCategory.findFirst({ where: { name: nama, ...(input.id ? { NOT: { id: input.id } } : {}) }, select: { id: true } });
      if (kembar) return { ok: false, kode: "NAMA_SUDAH_ADA" };
      const data = { name: nama, type: jenis, chartAccountId: akun.id, withholdingType: potong, isActive: input.aktif !== false, sortOrder: urutan };
      let id: string;
      let sebelum: unknown = null;
      if (input.id) {
        const lama = await tx.cashCategory.findUnique({ where: { id: input.id } });
        if (!lama) return { ok: false, kode: "TIDAK_DITEMUKAN" };
        sebelum = { nama: lama.name, jenis: lama.type, akunId: lama.chartAccountId, potong: lama.withholdingType, aktif: lama.isActive };
        id = (await tx.cashCategory.update({ where: { id: input.id }, data, select: { id: true } })).id;
      } else {
        id = (await tx.cashCategory.create({ data, select: { id: true } })).id;
      }
      await catatJejakKas(tx, {
        userId: input.olehUserId,
        action: JEJAK_KAS.KATEGORI_DISIMPAN,
        entityType: "CashCategory",
        entityId: id,
        changes: { before: sebelum ?? undefined, after: { nama, jenis, akunId: akun.id, potong, aktif: data.isActive } },
      });
      return { ok: true, id };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { ok: false, kode: "NAMA_SUDAH_ADA" };
    throw e;
  }
}

/**
 * Pasang kategori bawaan yang namanya belum ada. Akunnya ditebak dari nama
 * akun BEBAN/PENDAPATAN aktif (`tebakAkunKategori`); kategori yang tidak punya
 * akun bertipe itu dilewati. Tidak mengubah kategori yang sudah ada.
 */
export async function pasangKategoriBawaan(olehUserId: string): Promise<{ ok: true; dibuat: number; dilewati: number } | { ok: false; kode: "TANPA_AKUN" }> {
  return runSerializable(async (tx) => {
    const akun = await tx.chartAccount.findMany({
      where: { isActive: true, children: { none: {} }, type: { in: ["BEBAN", "PENDAPATAN"] } },
      select: { id: true, code: true, name: true, type: true },
    });
    if (akun.length === 0) return { ok: false as const, kode: "TANPA_AKUN" as const };
    const ada = new Set((await tx.cashCategory.findMany({ select: { name: true } })).map((k) => k.name.toLowerCase()));
    let dibuat = 0;
    let dilewati = 0;
    for (const [i, k] of KATEGORI_BAWAAN.entries()) {
      if (ada.has(k.nama.toLowerCase())) {
        dilewati++;
        continue;
      }
      const akunId = tebakAkunKategori(k, akun);
      if (!akunId) {
        dilewati++;
        continue;
      }
      await tx.cashCategory.create({ data: { name: k.nama, type: k.jenis, chartAccountId: akunId, withholdingType: k.potong, sortOrder: i } });
      dibuat++;
    }
    await catatJejakKas(tx, { userId: olehUserId, action: JEJAK_KAS.KATEGORI_BAWAAN, entityType: "CashCategory", entityId: "bawaan", metadata: { dibuat, dilewati } });
    return { ok: true as const, dibuat, dilewati };
  });
}

export type KategoriTampil = { id: string; nama: string; jenis: "OUT" | "IN"; akunId: string; akunKode: string; akunNama: string; jenisPotong: string | null; aktif: boolean; urutan: number; dipakai: number };

export async function daftarKategori(klien: Prisma.TransactionClient | typeof prisma = prisma): Promise<KategoriTampil[]> {
  const k = await klien.cashCategory.findMany({ orderBy: [{ type: "desc" }, { sortOrder: "asc" }, { name: "asc" }] });
  if (k.length === 0) return [];
  const [akun, pakai] = await Promise.all([
    klien.chartAccount.findMany({ where: { id: { in: [...new Set(k.map((x) => x.chartAccountId))] } }, select: { id: true, code: true, name: true } }),
    klien.cashVoucherLine.groupBy({ by: ["categoryId"], where: { categoryId: { in: k.map((x) => x.id) } }, _count: { _all: true } }),
  ]);
  const a = new Map(akun.map((x) => [x.id, x]));
  const p = new Map(pakai.map((x) => [x.categoryId, x._count._all]));
  return k.map((x) => ({
    id: x.id,
    nama: x.name,
    jenis: x.type === "IN" ? "IN" : "OUT",
    akunId: x.chartAccountId,
    akunKode: a.get(x.chartAccountId)?.code ?? "?",
    akunNama: a.get(x.chartAccountId)?.name ?? "(akun tidak ditemukan)",
    jenisPotong: x.withholdingType,
    aktif: x.isActive,
    urutan: x.sortOrder,
    dipakai: p.get(x.id) ?? 0,
  }));
}
