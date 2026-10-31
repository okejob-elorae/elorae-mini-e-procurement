import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: m.auth }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma, seededId } from "@elorae/db";
import { PERMISSIONS } from "@/lib/rbac";
import { bacaTargetBulan, KUNCI_TARGET, tulisTargetBulan } from "@/lib/salesman/pengaturan";
import { simpanTargetBulan } from "./salesman";

/**
 * Target bulanan semua salesman hidup di SATU baris JSON
 * (`SystemSetting["salesman.targets"]`). Simpanan baca-ubah-tulis tanpa
 * transaksi kehilangan simpanan yang bersamaan: dua admin mengisi target orang
 * berbeda, yang terakhir menulis ulang JSON lama dan target orang lain lenyap.
 *
 * Menyentuh baris pengaturan SUNGGUHAN di basis data dev: hanya bulan 2031-07
 * milik pengguna uji yang ditulis, dan dihapus lagi di teardown.
 */

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const BULAN = "2031-07";
// Tiga admin bersamaan: setiap simpanan paling banyak kalah dua kali, masih di dalam 4 percobaan runSerializable.
const RUPIAH = [15_000_000, 22_500_000, 30_000_000];

d("simpanTargetBulan — simpanan bersamaan (test bed only)", () => {
  let token = "";
  const salesIds: string[] = [];
  let barisDibuatTes = false;

  beforeEach(async () => {
    token = "";
    salesIds.length = 0;
    barisDibuatTes = false;
    token = Math.random().toString(36).slice(2, 10);
    for (let i = 0; i < RUPIAH.length; i += 1) {
      salesIds.push(
        (await prisma.user.create({ data: { email: `target-${i}-${token}@uji.local`, name: `Sales ${i} ${token}` } })).id,
      );
    }
    // Baris pengaturan harus sudah ada: tanpa itu yang diuji adalah balapan INSERT, bukan hilangnya simpanan.
    const ada = await prisma.systemSetting.findUnique({ where: { key: KUNCI_TARGET }, select: { key: true } });
    if (!ada) {
      await prisma.systemSetting.create({ data: { key: KUNCI_TARGET, value: "{}" } });
      barisDibuatTes = true;
    }
    m.auth.mockResolvedValue({ user: { id: "admin-uji", permissions: [PERMISSIONS.FIELD_SALES_ORDERS_APPROVE] } });
  });

  afterEach(async () => {
    const baris = await prisma.systemSetting.findUnique({ where: { key: KUNCI_TARGET }, select: { value: true } });
    if (baris) {
      let nilai = baris.value;
      for (const id of salesIds) nilai = tulisTargetBulan(nilai, id, BULAN, null);
      if (barisDibuatTes && nilai === "{}") await prisma.systemSetting.delete({ where: { key: KUNCI_TARGET } });
      else await prisma.systemSetting.update({ where: { key: KUNCI_TARGET }, data: { value: nilai } });
    }
    for (const id of salesIds) await prisma.user.delete({ where: { id: seededId(id) } });
  });

  async function targetTersimpan(userId: string): Promise<number | null> {
    const baris = await prisma.systemSetting.findUnique({ where: { key: KUNCI_TARGET }, select: { value: true } });
    return bacaTargetBulan(baris?.value, userId, BULAN);
  }

  it("tiga admin menyimpan target orang berbeda bersamaan: tidak ada yang hilang", async () => {
    for (let putaran = 0; putaran < 3; putaran += 1) {
      const jumlah = RUPIAH.map((r) => r + putaran * 1_000_000);
      const hasil = await Promise.all(salesIds.map((id, i) => simpanTargetBulan(BULAN, { [id]: jumlah[i] })));
      expect(hasil.every((h) => h.ok)).toBe(true);
      for (let i = 0; i < salesIds.length; i += 1) {
        expect(await targetTersimpan(salesIds[i])).toBe(jumlah[i]);
      }
    }
  });

  it("simpan dan hapus bersamaan pada orang berbeda: keduanya berlaku", async () => {
    await simpanTargetBulan(BULAN, { [salesIds[0]]: 15_000_000, [salesIds[1]]: 22_500_000 });
    const [a, b] = await Promise.all([
      simpanTargetBulan(BULAN, { [salesIds[0]]: null }),
      simpanTargetBulan(BULAN, { [salesIds[2]]: 30_000_000 }),
    ]);
    expect(a.ok && b.ok).toBe(true);
    expect(await targetTersimpan(salesIds[0])).toBeNull();
    expect(await targetTersimpan(salesIds[1])).toBe(22_500_000);
    expect(await targetTersimpan(salesIds[2])).toBe(30_000_000);
  });

  it("aturan lama tetap: bulan rusak, angka negatif, dan pengguna tak dikenal ditolak tanpa menulis", async () => {
    expect(await simpanTargetBulan("2031-13", { [salesIds[0]]: 1_000_000 })).toEqual({ ok: false, code: "INVALID" });
    expect(await simpanTargetBulan(BULAN, { [salesIds[0]]: -5 })).toEqual({ ok: false, code: "INVALID" });
    expect(await simpanTargetBulan(BULAN, { [`hantu-${token}`]: 1_000_000 })).toEqual({ ok: false, code: "INVALID" });
    expect(await targetTersimpan(salesIds[0])).toBeNull();
  });
});
