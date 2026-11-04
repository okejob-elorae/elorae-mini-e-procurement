import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/*
 * Balapan check-in SPG × kantor memindah toko SPG itu (Pengaturan → Pengguna), terhadap basis data
 * uji. `nilaiCheckIn` membaca toko tetap SPG SEBELUM transaksi kunjungan; tanpa bacaan ulang di
 * dalam transaksi, kantor bisa memindah SPG ke toko B di sela-selanya dan SPG tetap mendapat
 * kunjungan di toko A yang baru saja dilepas darinya. Dengan bacaan ulang, penulisan `User` kantor
 * dan sisipan kunjungan bertabrakan di transaksi serializable, jadi akhirnya selalu salah satu dari:
 * (a) kunjungan di A, SPG tetap di A, dan pemindahan ditolak `SPG_GUNAKAN_BERHENTI` (sudah ada
 *     riwayat); atau
 * (b) tanpa kunjungan, SPG di B, dan check-in ditolak `STORE_NOT_ASSIGNED`.
 * Tidak pernah kunjungan di A dengan SPG di B.
 *
 * Dua sesi berjalan bersamaan, jadi sesi tiruan dibawa `AsyncLocalStorage` per panggilan — urutan
 * `auth()` tidak menentukan. Penulis absensi ditirukan. Teardown hanya lewat id yang diseed.
 */

type Sesi = { user: { id: string; permissions: string[] } };
const h = vi.hoisted(() => ({ als: null as { getStore: () => unknown } | null }));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => h.als?.getStore() ?? null) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  },
}));
vi.mock("@/lib/salesman/absensi-writer", () => ({
  absenMasukLewatCheckin: vi.fn(async () => "LEWATI"),
  absenPulangLewatCheckout: vi.fn(async () => "LEWATI"),
  absenMasukKunjunganLampau: vi.fn(async () => "LEWATI"),
  absenPulangKoreksi: vi.fn(async () => "LEWATI"),
}));

const als = new AsyncLocalStorage<Sesi>();
h.als = als;

const { checkIn, checkInLuringAction } = await import("./actions");
const { simpanPenggunaAction } = await import("@/app/actions/settings/users");

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;
const tag = `CSB-${Math.random().toString(36).slice(2, 9)}`;
const tagEmail = tag.toLowerCase();

const tunda = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Tunda mulai pihak yang lebih pendek beberapa ms — tanpanya satu pihak bisa selalu menang lebih dulu. */
const JADWAL: [tundaPindah: number, tundaMasuk: number][] = [
  [0, 0],
  [0, 2],
  [0, 5],
  [0, 10],
  [2, 0],
  [5, 0],
  [10, 0],
];

d("check-in SPG berpacu dengan pemindahan tokonya (test bed only)", () => {
  let izinDibuat = "";
  let peranSpg = "";
  let peranBiasa = "";
  let kantor = "";
  let spg = "";
  let tokoA = "";
  let tokoB = "";
  const emailSpg = `${tagEmail}-spg@uji.local`;
  let ke = 0;

  beforeAll(async () => {
    izinDibuat = "";
    peranSpg = "";
    peranBiasa = "";
    kantor = "";
    spg = "";
    tokoA = "";
    tokoB = "";
    let izin = await prisma.permission.findUnique({ where: { code: "spg_sales:record" }, select: { id: true } });
    if (!izin) {
      izin = await prisma.permission.create({ data: { code: "spg_sales:record", module: "spg_sales", action: "record" }, select: { id: true } });
      izinDibuat = izin.id;
    }
    peranSpg = (
      await prisma.roleDefinition.create({ data: { name: `${tag}-SPG`, isSystem: false, permissions: { create: [{ permissionId: izin.id }] } } })
    ).id;
    peranBiasa = (await prisma.roleDefinition.create({ data: { name: `${tag}-BIASA`, isSystem: false } })).id;
    const toko = async (akhiran: string) =>
      (await prisma.store.create({ data: { code: `${tag}-${akhiran}`, name: `${tag} ${akhiran}`, address: "uji", termsType: "KONSI" } })).id;
    tokoA = await toko("A");
    tokoB = await toko("B");
    kantor = (await prisma.user.create({ data: { email: `${tagEmail}-k@uji.local`, name: `${tag} Kantor`, roleId: peranBiasa } })).id;
    spg = (
      await prisma.user.create({
        data: { email: emailSpg, name: `${tag} SPG`, roleId: peranSpg, assignedStoreId: tokoA, spgStartedOn: "2026-10-01" },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.storeVisit.deleteMany({ where: { userId: seededId(spg) } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: seededIds([kantor, spg].filter(Boolean)) } } });
    await prisma.auditLog.deleteMany({ where: { entityId: seededId(spg) } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds([kantor, spg].filter(Boolean)) } } });
    await prisma.rolePermission.deleteMany({ where: { roleId: seededId(peranSpg) } });
    await prisma.roleDefinition.deleteMany({ where: { id: { in: seededIds([peranSpg, peranBiasa].filter(Boolean)) } } });
    await prisma.store.deleteMany({ where: { id: { in: seededIds([tokoA, tokoB].filter(Boolean)) } } });
    if (izinDibuat) await prisma.permission.delete({ where: { id: izinDibuat } });
  });

  /** SPG kembali di toko A tanpa riwayat apa pun — pemindahan boleh selama belum ada kunjungan. */
  const ulang = async () => {
    await prisma.storeVisit.deleteMany({ where: { userId: seededId(spg) } });
    await prisma.auditLog.deleteMany({ where: { entityId: seededId(spg) } });
    await prisma.user.update({
      where: { id: seededId(spg) },
      data: { roleId: peranSpg, assignedStoreId: tokoA, spgStartedOn: "2026-10-01", spgEndedOn: null, spgEndedStoreId: null },
    });
  };

  const sesiKantor = (): Sesi => ({ user: { id: kantor, permissions: ["settings_security:manage"] } });
  const sesiSpg = (): Sesi => ({ user: { id: spg, permissions: ["pwa:access"] } });
  const pindahKeB = () =>
    als.run(sesiKantor(), () =>
      simpanPenggunaAction({ id: spg, nama: `${tag} SPG`, email: emailSpg, roleId: peranSpg, tokoId: tokoB, sandi: "", ulangSandi: "" }),
    );
  /** `checkIn` yang berhasil mengalihkan halaman — dibaca sebagai "REDIRECT". */
  const masukOnline = () =>
    als.run(sesiSpg(), () =>
      checkIn({ storeId: tokoA, lat: -7.78, lng: 110.37, accuracy: 10 }).then(
        (r) => r,
        (e: unknown) => {
          if (e instanceof Error && e.message.startsWith("__REDIRECT__")) return "REDIRECT" as const;
          throw e;
        },
      ),
    );
  const masukLuring = () =>
    als.run(sesiSpg(), () =>
      checkInLuringAction({
        clientId: `${tag}-${ke++}`,
        storeId: tokoA,
        lat: -7.78,
        lng: 110.37,
        accuracy: 10,
        waktu: new Date(Date.now() - 60_000).toISOString(),
      }),
    );

  async function keadaanAkhir() {
    const [u, kunjunganDiA] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: seededId(spg) }, select: { assignedStoreId: true } }),
      prisma.storeVisit.count({ where: { userId: seededId(spg), storeId: seededId(tokoA) } }),
    ]);
    return { toko: u.assignedStoreId, kunjunganDiA };
  }

  it("check-in dengan sinyal: tidak pernah kunjungan di A sementara SPG sudah di B", async () => {
    for (const [tundaPindah, tundaMasuk] of JADWAL) {
      await ulang();
      const [pindah, masuk] = await Promise.all([
        tunda(tundaPindah).then(pindahKeB),
        tunda(tundaMasuk).then(masukOnline),
      ]);
      const akhir = await keadaanAkhir();
      if (akhir.kunjunganDiA > 0) {
        expect(akhir).toEqual({ toko: tokoA, kunjunganDiA: 1 });
        expect(pindah).toEqual({ ok: false, codes: ["SPG_GUNAKAN_BERHENTI"] });
        expect(masuk).toBe("REDIRECT");
      } else {
        expect(akhir).toEqual({ toko: tokoB, kunjunganDiA: 0 });
        expect(pindah).toEqual({ ok: true, id: spg });
        expect(masuk).toEqual({ ok: false, code: "STORE_NOT_ASSIGNED" });
      }
    }
  }, 60_000);

  it("check-in dari antrean HP: aturan yang sama", async () => {
    for (const [tundaPindah, tundaMasuk] of JADWAL) {
      await ulang();
      const [pindah, masuk] = await Promise.all([
        tunda(tundaPindah).then(pindahKeB),
        tunda(tundaMasuk).then(masukLuring),
      ]);
      const akhir = await keadaanAkhir();
      if (akhir.kunjunganDiA > 0) {
        expect(akhir).toEqual({ toko: tokoA, kunjunganDiA: 1 });
        expect(pindah).toEqual({ ok: false, codes: ["SPG_GUNAKAN_BERHENTI"] });
        expect(masuk).toMatchObject({ ok: true, storeId: tokoA });
      } else {
        expect(akhir).toEqual({ toko: tokoB, kunjunganDiA: 0 });
        expect(pindah).toEqual({ ok: true, id: spg });
        expect(masuk).toEqual({ ok: false, code: "STORE_NOT_ASSIGNED" });
      }
    }
  }, 60_000);
});
