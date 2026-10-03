import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/**
 * Penulis usulan toko baru, terhadap basis data sungguhan — yang dijaga hidup
 * di kueri dan transaksinya: kunci idempoten, compare-and-swap status, toko
 * yang ikut batal saat usulan kalah balapan, dan jejak audit di transaksi yang
 * sama. Kabar ke salesman dipalsukan: ia menulis `NotificationQueue`.
 */

const kabar = vi.hoisted(() => ({ panggilan: [] as { userId: string; jenis: string; data: Record<string, string> }[] }));
vi.mock("@/lib/notifications/kabar-pengguna", async (asli) => {
  const modul = await asli<typeof import("@/lib/notifications/kabar-pengguna")>();
  return {
    ...modul,
    kabariPengguna: vi.fn(async (userId: string, k: { jenis: string; data: Record<string, string> }) => {
      kabar.panggilan.push({ userId, jenis: k.jenis, data: k.data });
    }),
  };
});

const { ajukanUsulanToko, setujuiUsulanToko, tolakUsulanToko, AKSI_USULAN_TOKO, KATEGORI_NOTIF_USULAN_TOKO } = await import(
  "./usulan-writer"
);
const { daftarUsulan, usulanSaya } = await import("./usulan-queries");

// Tengah Samudra Pasifik: tidak ada toko sungguhan dalam 150 m dari sini.
const TITIK = { lat: -45.1234567, lng: -120.4567891 };

let token = "";
let pengusulId = "";
let adminId = "";
let tokoLamaId = "";
const usulanIds: string[] = [];
const tokoIds: string[] = [];

/** Token untuk saringan teardown — tidak pernah kosong, karena "memuat ''" cocok dengan semuanya. */
function tokenUji(): string {
  if (token.length < 6) throw new Error("token uji belum diisi");
  return token;
}

function masukan(lain: Record<string, unknown> = {}) {
  return {
    name: `Toko Uji ${token}`,
    address: "Jl. Uji 1",
    phone: "0812 3456 7890",
    photoUrl: "/api/foto/uji",
    ...TITIK,
    ...lain,
  };
}

beforeEach(async () => {
  token = "";
  pengusulId = "";
  adminId = "";
  tokoLamaId = "";
  usulanIds.length = 0;
  tokoIds.length = 0;
  kabar.panggilan.length = 0;

  token = Math.random().toString(36).slice(2, 10).toUpperCase();
  pengusulId = (await prisma.user.create({ data: { email: `usulan-${token}@uji.local`, name: `Pengusul ${token}` }, select: { id: true } })).id;
  adminId = (await prisma.user.create({ data: { email: `admin-${token}@uji.local`, name: `Admin ${token}` }, select: { id: true } })).id;
});

afterEach(async () => {
  const semuaUsulan = await prisma.storeProposal.findMany({
    where: { proposedById: seededId(pengusulId) },
    select: { id: true, storeId: true },
  });
  const ids = [...new Set([...usulanIds, ...semuaUsulan.map((u) => u.id)])];
  const toko = [...new Set([...tokoIds, ...semuaUsulan.map((u) => u.storeId).filter((s): s is string => !!s), tokoLamaId].filter(Boolean))];
  await prisma.auditLog.deleteMany({ where: { entityId: { in: seededIds([...ids, ...toko]) } } });
  await prisma.storeProposal.deleteMany({ where: { id: { in: seededIds(ids) } } });
  await prisma.store.deleteMany({ where: { id: { in: seededIds(toko) } } });
  // Token acak di judul: tidak ada notifikasi lain yang memuatnya. Token kosong
  // akan cocok dengan SEMUA judul, jadi dijaga dulu.
  if (token.length >= 6) {
    await prisma.adminNotification.deleteMany({ where: { category: "STORE_PROPOSAL", title: { contains: tokenUji() } } });
  }
  await prisma.user.deleteMany({ where: { id: { in: [seededId(pengusulId), seededId(adminId)] } } });
});

async function ajukan(lain: Record<string, unknown> = {}, kunci = `kunci-${token}`) {
  const hasil = await ajukanUsulanToko({ userId: pengusulId, masukan: masukan(lain), idempotencyKey: kunci, tetapAjukan: true });
  if (hasil.ok) usulanIds.push(hasil.id);
  return hasil;
}

const SETUJU = {
  code: "",
  termsType: "PUTUS",
  groupId: null,
  salesmanId: null as string | null,
  paymentTempo: 30,
  isPkp: true,
  marginPercent: null,
};

describe("ajukanUsulanToko", () => {
  it("stores a pending proposal with the cleaned fields and flags the admins", async () => {
    expect(KATEGORI_NOTIF_USULAN_TOKO).toBe("STORE_PROPOSAL");
    const hasil = await ajukan({ name: `  Toko  Uji ${token} `, note: "  dekat pasar " });
    expect(hasil).toMatchObject({ ok: true, ulang: false });
    if (!hasil.ok) return;
    const baris = await prisma.storeProposal.findUniqueOrThrow({ where: { id: hasil.id } });
    expect(baris).toMatchObject({
      name: `Toko Uji ${token}`,
      status: "PENDING",
      proposedById: pengusulId,
      note: "dekat pasar",
      photoUrl: "/api/foto/uji",
    });
    expect(baris.lat?.toNumber()).toBeCloseTo(TITIK.lat, 6);
    const notif = await prisma.adminNotification.findMany({
      where: { category: KATEGORI_NOTIF_USULAN_TOKO, title: { contains: token } },
    });
    expect(notif).toHaveLength(1);
    expect(notif[0].metadata).toEqual({ storeProposalId: hasil.id });
  });

  it("returns the same proposal when the phone resends with the same key", async () => {
    const pertama = await ajukan();
    const kedua = await ajukan({ name: "Nama lain sama sekali" });
    expect(pertama.ok && kedua.ok).toBe(true);
    if (!pertama.ok || !kedua.ok) return;
    expect(kedua).toEqual({ ok: true, id: pertama.id, ulang: true });
    expect(await prisma.storeProposal.count({ where: { proposedById: pengusulId } })).toBe(1);
  });

  it("refuses an incomplete proposal without writing anything", async () => {
    expect(await ajukan({ name: " " })).toEqual({ ok: false, code: "NAMA_WAJIB" });
    expect(await ajukan({ photoUrl: null })).toEqual({ ok: false, code: "FOTO_WAJIB" });
    expect(await prisma.storeProposal.count({ where: { proposedById: pengusulId } })).toBe(0);
  });

  it("refuses an area that does not exist", async () => {
    expect(await ajukan({ groupId: `tidak-ada-${token}` })).toEqual({ ok: false, code: "AREA_TIDAK_ADA" });
  });

  it("holds back a proposal that looks like an existing store until the salesman confirms", async () => {
    tokoLamaId = (
      await prisma.store.create({
        data: { code: `UJI-L-${token}`, name: `Uji ${token}`, address: "Jl. Lama", termsType: "PUTUS", lat: TITIK.lat + 0.0004, lng: TITIK.lng },
        select: { id: true },
      })
    ).id;

    const ditahan = await ajukanUsulanToko({
      userId: pengusulId,
      masukan: masukan(),
      idempotencyKey: `kunci-${token}`,
      tetapAjukan: false,
    });
    expect(ditahan.ok).toBe(false);
    if (ditahan.ok || ditahan.code !== "MUNGKIN_DUPLIKAT") throw new Error("seharusnya ditahan");
    expect(ditahan.kandidat).toEqual([
      expect.objectContaining({ jenis: "TOKO", id: tokoLamaId, namaMirip: true, jarakMeter: 40 }),
    ]);
    expect(await prisma.storeProposal.count({ where: { proposedById: pengusulId } })).toBe(0);

    // "Tetap ajukan" dengan kunci formulir yang sama.
    expect((await ajukan()).ok).toBe(true);
  });
});

describe("setujuiUsulanToko", () => {
  it("creates the store from the proposal and the admin's fields, in one go with its audit trail", async () => {
    const usulan = await ajukan();
    if (!usulan.ok) throw new Error("gagal mengajukan");
    const hasil = await setujuiUsulanToko({
      proposalId: usulan.id,
      reviewerId: adminId,
      masukan: { ...SETUJU, ...masukan({ name: `Toko Uji ${token} Rapi` }), code: `UJI-${token}`, salesmanId: pengusulId },
    });
    expect(hasil.ok).toBe(true);
    if (!hasil.ok) return;
    tokoIds.push(hasil.storeId);

    const toko = await prisma.store.findUniqueOrThrow({ where: { id: hasil.storeId } });
    expect(toko).toMatchObject({
      code: `UJI-${token}`,
      name: `Toko Uji ${token} Rapi`,
      termsType: "PUTUS",
      paymentTempo: 30,
      isPkp: true,
      salesmanId: pengusulId,
      marginPercent: null,
      isActive: true,
    });
    expect(toko.lat?.toNumber()).toBeCloseTo(TITIK.lat, 6);

    const baris = await prisma.storeProposal.findUniqueOrThrow({ where: { id: usulan.id } });
    expect(baris).toMatchObject({ status: "APPROVED", storeId: hasil.storeId, reviewedById: adminId });

    const jejak = await prisma.auditLog.findMany({
      where: { entityId: { in: [hasil.storeId, usulan.id] } },
      select: { action: true, entityId: true, metadata: true },
    });
    expect(jejak.map((j) => j.action).sort()).toEqual(
      [AKSI_USULAN_TOKO.DISETUJUI, AKSI_USULAN_TOKO.TOKO_DIBUAT, "STORE_SALESMAN_CHANGED"].sort(),
    );
    const disetujui = jejak.find((j) => j.action === AKSI_USULAN_TOKO.DISETUJUI);
    expect(disetujui?.metadata).toEqual({
      dirapikan: { name: { usulan: `Toko Uji ${token}`, toko: `Toko Uji ${token} Rapi` } },
    });

    expect(kabar.panggilan).toEqual([
      { userId: pengusulId, jenis: "TOKO_BARU_DISETUJUI", data: { storeId: hasil.storeId, proposalId: usulan.id } },
    ]);
  });

  it("never makes a second store from the same proposal", async () => {
    const usulan = await ajukan();
    if (!usulan.ok) throw new Error("gagal mengajukan");
    const pertama = await setujuiUsulanToko({ proposalId: usulan.id, reviewerId: adminId, masukan: { ...SETUJU, ...masukan(), code: `UJI-${token}` } });
    if (pertama.ok) tokoIds.push(pertama.storeId);
    const kedua = await setujuiUsulanToko({ proposalId: usulan.id, reviewerId: adminId, masukan: { ...SETUJU, ...masukan(), code: `UJI2-${token}` } });
    expect(kedua).toEqual({ ok: false, code: "SUDAH_DIPUTUSKAN" });
    expect(await prisma.store.count({ where: { code: `UJI2-${token}` } })).toBe(0);
  });

  it("refuses a code that is already taken and leaves the proposal waiting", async () => {
    tokoLamaId = (
      await prisma.store.create({
        data: { code: `UJI-${token}`, name: `Lain ${token}`, address: "Jl. Lain", termsType: "PUTUS" },
        select: { id: true },
      })
    ).id;
    const usulan = await ajukan();
    if (!usulan.ok) throw new Error("gagal mengajukan");
    expect(
      await setujuiUsulanToko({ proposalId: usulan.id, reviewerId: adminId, masukan: { ...SETUJU, ...masukan(), code: `UJI-${token}` } }),
    ).toEqual({ ok: false, code: "KODE_DIPAKAI" });
    expect((await prisma.storeProposal.findUniqueOrThrow({ where: { id: usulan.id } })).status).toBe("PENDING");
    expect(kabar.panggilan).toEqual([]);
  });

  it("refuses a holder that does not exist, without leaving a store behind", async () => {
    const usulan = await ajukan();
    if (!usulan.ok) throw new Error("gagal mengajukan");
    expect(
      await setujuiUsulanToko({
        proposalId: usulan.id,
        reviewerId: adminId,
        masukan: { ...SETUJU, ...masukan(), code: `UJI-${token}`, salesmanId: `hantu-${token}` },
      }),
    ).toEqual({ ok: false, code: "PEMEGANG_TIDAK_ADA" });
    expect(await prisma.store.count({ where: { code: `UJI-${token}` } })).toBe(0);
  });

  it("keeps the margin only for a consignment store", async () => {
    const usulan = await ajukan();
    if (!usulan.ok) throw new Error("gagal mengajukan");
    const hasil = await setujuiUsulanToko({
      proposalId: usulan.id,
      reviewerId: adminId,
      masukan: { ...SETUJU, ...masukan(), code: `UJI-${token}`, termsType: "KONSI", marginPercent: 27.5 },
    });
    if (!hasil.ok) throw new Error(hasil.code);
    tokoIds.push(hasil.storeId);
    const toko = await prisma.store.findUniqueOrThrow({ where: { id: hasil.storeId } });
    expect(toko.termsType).toBe("KONSI");
    expect(toko.marginPercent?.toNumber()).toBe(27.5);
  });
});

describe("tolakUsulanToko", () => {
  it("requires a reason", async () => {
    const usulan = await ajukan();
    if (!usulan.ok) throw new Error("gagal mengajukan");
    expect(await tolakUsulanToko({ proposalId: usulan.id, reviewerId: adminId, alasan: "  " })).toEqual({
      ok: false,
      code: "ALASAN_WAJIB",
    });
  });

  it("records the reason, audits it, tells the salesman, and closes the proposal for good", async () => {
    const usulan = await ajukan();
    if (!usulan.ok) throw new Error("gagal mengajukan");
    expect(await tolakUsulanToko({ proposalId: usulan.id, reviewerId: adminId, alasan: " Sudah terdaftar sebagai TK-001 " })).toEqual({
      ok: true,
    });
    const baris = await prisma.storeProposal.findUniqueOrThrow({ where: { id: usulan.id } });
    expect(baris).toMatchObject({ status: "REJECTED", reviewNote: "Sudah terdaftar sebagai TK-001", reviewedById: adminId });
    const jejak = await prisma.auditLog.findMany({ where: { entityId: usulan.id } });
    expect(jejak).toEqual([expect.objectContaining({ action: AKSI_USULAN_TOKO.DITOLAK, reason: "Sudah terdaftar sebagai TK-001" })]);
    expect(kabar.panggilan).toEqual([{ userId: pengusulId, jenis: "TOKO_BARU_DITOLAK", data: { proposalId: usulan.id } }]);

    expect(
      await setujuiUsulanToko({ proposalId: usulan.id, reviewerId: adminId, masukan: { ...SETUJU, ...masukan(), code: `UJI-${token}` } }),
    ).toEqual({ ok: false, code: "SUDAH_DIPUTUSKAN" });
    expect(await tolakUsulanToko({ proposalId: usulan.id, reviewerId: adminId, alasan: "lagi" })).toEqual({
      ok: false,
      code: "SUDAH_DIPUTUSKAN",
    });
  });
});

describe("daftarUsulan / usulanSaya", () => {
  it("puts waiting proposals first under 'all', across page boundaries", async () => {
    const tunggu = () => new Promise((r) => setTimeout(r, 5));
    const a = await ajukan({ name: `Toko A ${token}` }, `kunci-a-${token}`);
    await tunggu();
    const b = await ajukan({ name: `Toko B ${token}` }, `kunci-b-${token}`);
    await tunggu();
    const c = await ajukan({ name: `Toko C ${token}` }, `kunci-c-${token}`);
    if (!a.ok || !b.ok || !c.ok) throw new Error("gagal mengajukan");
    // Yang pertama diajukan lalu ditolak: di "Semua" ia turun ke bawah yang menunggu.
    await tolakUsulanToko({ proposalId: a.id, reviewerId: adminId, alasan: "uji" });

    // Pencarian token menyempitkan ke baris uji ini saja.
    const hal1 = await daftarUsulan({ status: "SEMUA", cari: tokenUji(), page: 1, pageSize: 2 });
    const hal2 = await daftarUsulan({ status: "SEMUA", cari: tokenUji(), page: 2, pageSize: 2 });
    expect(hal1.total).toBe(3);
    expect(hal1.items.map((i) => i.id)).toEqual([b.id, c.id]);
    expect(hal2.items.map((i) => [i.id, i.status])).toEqual([[a.id, "REJECTED"]]);
    expect(hal1.items[0]).toMatchObject({ pengusul: `Pengusul ${token}`, adaLokasi: true, status: "PENDING" });

    const menunggu = await daftarUsulan({ status: "PENDING", cari: tokenUji(), page: 1, pageSize: 10 });
    expect(menunggu.items.map((i) => i.id)).toEqual([b.id, c.id]);

    const saya = await usulanSaya(pengusulId);
    expect(saya.map((s) => [s.id, s.status])).toEqual([
      [c.id, "PENDING"],
      [b.id, "PENDING"],
      [a.id, "REJECTED"],
    ]);
    expect(saya[2].reviewNote).toBe("uji");
  });

  it("links an approved proposal to its store on the phone", async () => {
    const u = await ajukan();
    if (!u.ok) throw new Error("gagal mengajukan");
    const hasil = await setujuiUsulanToko({ proposalId: u.id, reviewerId: adminId, masukan: { ...SETUJU, ...masukan(), code: `UJI-${token}` } });
    if (!hasil.ok) throw new Error(hasil.code);
    tokoIds.push(hasil.storeId);
    const [baris] = await usulanSaya(pengusulId);
    expect(baris).toMatchObject({ status: "APPROVED", storeId: hasil.storeId, storeCode: `UJI-${token}` });
  });
});
