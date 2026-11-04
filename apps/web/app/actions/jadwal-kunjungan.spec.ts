import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { kunciHariWib } from "@/lib/dashboard/tren";
import { geserHari } from "@/lib/salesman/jadwal";

/**
 * Aksi jadwal kunjungan terhadap basis data sungguhan (sesi ditiru).
 * Yang dibuktikan: izin mengatur = `field_sales_orders:approve` (melihat saja
 * tidak cukup), kabar ke sales SATU per simpan — bukan per baris — dengan
 * tanggal hari pertama yang berubah, dan simpan yang tidak mengubah apa pun
 * tidak mengabari siapa pun.
 */

const sesi = { id: "", permissions: ["field_sales_orders:approve"] as string[] };
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: sesi.id, permissions: sesi.permissions } })) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const kabar = vi.hoisted(() => ({ dikirim: [] as { userId: string; data: Record<string, string>; jenis: string; isi: string }[] }));
vi.mock("@/lib/notifications/kabar-pengguna", async (asli) => ({
  ...(await asli<typeof import("@/lib/notifications/kabar-pengguna")>()),
  kabariPengguna: vi.fn(async (userId: string, k: { jenis: string; isi: string; data: Record<string, string> }) => {
    kabar.dikirim.push({ userId, data: k.data, jenis: k.jenis, isi: k.isi });
  }),
}));

const { ubahJadwalAction, salinMingguLaluAction, cariTokoJadwalAction } = await import("./jadwal-kunjungan");

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const tag = `JWA-${Math.random().toString(36).slice(2, 8)}`;
// Aksi memakai jam sungguhan: hari depan dekat selalu "belum lewat".
const BESOK = geserHari(kunciHariWib(new Date()), 1);
const LUSA = geserHari(BESOK, 1);

d("aksi jadwal kunjungan (test bed only)", () => {
  let sales = "";
  let admin = "";
  let tokoA = "";
  let tokoB = "";

  beforeAll(async () => {
    sales = "";
    admin = "";
    tokoA = "";
    tokoB = "";
    const peran = await prisma.roleDefinition.findFirst({
      where: { isSystem: false, permissions: { some: { permission: { code: "pwa:access" } } } },
      select: { id: true },
    });
    if (!peran) throw new Error("Basis data uji tidak punya peran lapangan (pwa:access).");
    sales = (await prisma.user.create({ data: { email: `${tag}-s@uji.local`, name: `${tag} Sales`, roleId: peran.id } })).id;
    admin = (await prisma.user.create({ data: { email: `${tag}-a@uji.local`, name: `${tag} Admin` } })).id;
    tokoA = (await prisma.store.create({ data: { code: `${tag}-A`, name: `${tag} Toko Alfa`, address: "Jl. Uji", termsType: "PUTUS", salesmanId: sales } })).id;
    tokoB = (await prisma.store.create({ data: { code: `${tag}-B`, name: `${tag} Toko Beta`, address: "Jl. Uji", termsType: "PUTUS" } })).id;
    sesi.id = admin;
  });

  beforeEach(async () => {
    sesi.permissions = ["field_sales_orders:approve"];
    kabar.dikirim = [];
    await prisma.visitSchedule.deleteMany({ where: { salesmanId: seededId(sales) } });
    await prisma.auditLog.deleteMany({ where: { entityType: "VisitSchedule", entityId: seededId(sales) } });
  });

  afterAll(async () => {
    await prisma.visitSchedule.deleteMany({ where: { salesmanId: seededId(sales) } });
    await prisma.auditLog.deleteMany({ where: { entityType: "VisitSchedule", entityId: seededId(sales) } });
    await prisma.store.deleteMany({ where: { id: { in: seededIds([tokoA, tokoB].filter(Boolean)) } } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds([sales, admin].filter(Boolean)) } } });
  });

  it("menolak tanpa field_sales_orders:approve — melihat saja tidak cukup — tanpa menulis apa pun", async () => {
    sesi.permissions = ["field_sales_orders:view"];
    expect(
      await ubahJadwalAction({ salesmanId: sales, perubahan: { tambah: [{ dayKey: BESOK, storeId: tokoA }] } }),
    ).toEqual({ ok: false, code: "TANPA_AKSES" });
    expect(await salinMingguLaluAction({ salesmanId: sales, minggu: BESOK })).toEqual({ ok: false, code: "TANPA_AKSES" });
    expect(await cariTokoJadwalAction({ salesmanId: sales, q: tag })).toEqual({ ok: false, code: "TANPA_AKSES" });
    expect(await prisma.visitSchedule.count({ where: { salesmanId: seededId(sales) } })).toBe(0);
    expect(kabar.dikirim).toEqual([]);
  });

  it("wildcard admin boleh mengatur", async () => {
    sesi.permissions = ["*"];
    expect(await ubahJadwalAction({ salesmanId: sales, perubahan: { tambah: [{ dayKey: BESOK, storeId: tokoA }] } })).toEqual({
      ok: true,
      hariBerubah: [BESOK],
    });
  });

  it("satu simpan beberapa toko dan hari = SATU kabar, bertanggal hari pertama yang berubah", async () => {
    const r = await ubahJadwalAction({
      salesmanId: sales,
      perubahan: {
        tambah: [
          { dayKey: LUSA, storeId: tokoA },
          { dayKey: BESOK, storeId: tokoA },
          { dayKey: BESOK, storeId: tokoB, note: "Bawa katalog" },
        ],
      },
    });
    expect(r).toEqual({ ok: true, hariBerubah: [BESOK, LUSA] });
    expect(kabar.dikirim).toHaveLength(1);
    expect(kabar.dikirim[0]).toMatchObject({ userId: sales, jenis: "JADWAL_KUNJUNGAN", data: { tanggal: BESOK } });

    // Simpan ulang yang tidak mengubah apa pun: tidak ada kabar baru.
    await ubahJadwalAction({ salesmanId: sales, perubahan: { tambah: [{ dayKey: BESOK, storeId: tokoA }] } });
    expect(kabar.dikirim).toHaveLength(1);
  });

  it("toko yang ditolak disebut NAMANYA, bukan id", async () => {
    const r = await ubahJadwalAction({
      salesmanId: sales,
      perubahan: { tambah: [{ dayKey: BESOK, storeId: "bukan-toko" }] },
    });
    expect(r).toEqual({ ok: false, code: "TOKO_TIDAK_DITEMUKAN", toko: ["bukan-toko"] });
    await prisma.store.update({ where: { id: tokoB }, data: { isActive: false } });
    try {
      expect(
        await ubahJadwalAction({ salesmanId: sales, perubahan: { tambah: [{ dayKey: BESOK, storeId: tokoB }] } }),
      ).toEqual({ ok: false, code: "TOKO_TIDAK_AKTIF", toko: [`${tag} Toko Beta`] });
    } finally {
      await prisma.store.update({ where: { id: tokoB }, data: { isActive: true } });
    }
  });

  it("isian rusak dari klien ditolak sebagai INPUT_TIDAK_SAH atau dinilai oleh aturan, tidak melempar", async () => {
    expect(await ubahJadwalAction({ salesmanId: "", perubahan: {} })).toEqual({ ok: false, code: "INPUT_TIDAK_SAH" });
    expect(
      await ubahJadwalAction({ salesmanId: sales, perubahan: { tambah: "x" } as unknown as never }),
    ).toEqual({ ok: false, code: "KOSONG" });
    expect(
      await ubahJadwalAction({ salesmanId: sales, perubahan: { tambah: [{ dayKey: "besok", storeId: tokoA }] } }),
    ).toEqual({ ok: false, code: "TANGGAL_TIDAK_SAH", dayKey: "besok" });
  });

  it("cari toko: toko yang dipegang sales tampil lebih dulu, toko tanpa pemegang tetap muncul (kunci mati)", async () => {
    const r = await cariTokoJadwalAction({ salesmanId: sales, q: tag });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Kunci "hanya toko sendiri" menyala di basis data ini: hanya toko yang ia pegang.
    const harapan: [string, boolean, string | null][] = [[`${tag} Toko Alfa`, true, `${tag} Sales`]];
    if (!r.terkunci) harapan.push([`${tag} Toko Beta`, false, null]);
    expect(r.toko.map((t) => [t.nama, t.milikSales, t.pemegang])).toEqual(harapan);
  });
});
