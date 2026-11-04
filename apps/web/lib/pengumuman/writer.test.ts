import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

const kabar = vi.hoisted(() => ({ kirim: vi.fn() }));
vi.mock("@/lib/notifications/kabar-pengguna", async (asli) => {
  const m = await asli<typeof import("@/lib/notifications/kabar-pengguna")>();
  return { ...m, kabariPengguna: kabar.kirim };
});

import {
  AKSI,
  arsipkanPengumuman,
  hapusPengumuman,
  kirimPengumumanTerjadwal,
  konfirmasiPengumuman,
  pulihkanPengumuman,
  simpanPengumuman,
  tandaiPengumumanDibaca,
} from "./writer";
import { daftarPengumumanHp, kartuPengumumanBeranda, pengumumanHp, rincianPengumumanKantor } from "./queries";
import { keInputWib } from "./aturan";

/* Menulis pengguna, peran, dan pengumuman — tidak pernah dijalankan terhadap basis data produksi. */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const JAM = 60 * 60 * 1000;

d("pengumuman: simpan, kabar, baca, konfirmasi, arsip (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let roleId = "";
  let storeId = "";
  let kantorId = "";
  let salesId = "";
  let spgId = "";
  let ids: string[] = [];

  const isian = (o: Record<string, unknown> = {}) => ({
    title: `TEST-PENG-${token} Rapat`,
    body: "Rapat bulanan hari Senin jam 08.00.",
    audience: "SALESMAN",
    pinned: false,
    requireAck: false,
    publishedAt: "",
    expiresAt: "",
    ...o,
  });

  async function buat(o: Record<string, unknown> = {}, sekarang?: Date) {
    const r = await simpanPengumuman({ isian: isian(o), userId: kantorId, sekarang });
    if (!r.ok) throw new Error(`simpan gagal: ${JSON.stringify(r)}`);
    ids.push(r.id);
    return r;
  }

  const penerimaKabar = () => kabar.kirim.mock.calls.map((c) => c[0] as string);

  beforeEach(async () => {
    roleId = ""; storeId = ""; kantorId = ""; salesId = ""; spgId = ""; ids = [];
    kabar.kirim.mockReset();

    const izin = await prisma.permission.upsert({
      where: { code: "pwa:access" },
      create: { code: "pwa:access", module: "pwa", action: "access" },
      update: {},
    });
    roleId = (await prisma.roleDefinition.create({ data: { name: `TEST-PENG-ROLE-${token}`, isSystem: false } })).id;
    await prisma.rolePermission.create({ data: { roleId, permissionId: izin.id } });
    storeId = (await prisma.store.create({ data: { code: `TEST-PENG-S-${token}`, name: "Toko Pengumuman", address: "x", termsType: "PUTUS", isActive: true } })).id;
    kantorId = (await prisma.user.create({ data: { email: `test-peng-kantor-${token}@example.com`, name: "Kantor" } })).id;
    salesId = (await prisma.user.create({ data: { email: `test-peng-sales-${token}@example.com`, name: "Sales Uji", roleId } })).id;
    spgId = (await prisma.user.create({ data: { email: `test-peng-spg-${token}@example.com`, name: "SPG Uji", roleId, assignedStoreId: storeId } })).id;
  });

  afterEach(async () => {
    // Pengumuman yang dibuat penulis tapi idnya tidak sempat tercatat (tes gagal di tengah) — judulnya unik per token.
    const sisa = await prisma.announcement.findMany({ where: { title: { contains: `TEST-PENG-${token}` } }, select: { id: true } });
    const semua = [...new Set([...ids, ...sisa.map((s) => s.id)])];
    const users = [kantorId, salesId, spgId].filter(Boolean);
    await prisma.announcementRead.deleteMany({ where: { announcementId: { in: seededIds(semua) } } });
    await prisma.auditLog.deleteMany({ where: { entityType: "Announcement", entityId: { in: seededIds(semua) } } });
    await prisma.announcement.deleteMany({ where: { id: { in: seededIds(semua) } } });
    await prisma.notificationQueue.deleteMany({ where: { userId: { in: seededIds(users) } } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds(users) } } });
    if (roleId) await prisma.roleDefinition.delete({ where: { id: seededId(roleId) } });
    if (storeId) await prisma.store.delete({ where: { id: seededId(storeId) } });
  });

  it("terbit sekarang: jejak dibuat + dikabarkan, kabar hanya ke audiensnya", async () => {
    const r = await buat({ audience: "SALESMAN" });
    expect(r.dikabarkan).toBeGreaterThanOrEqual(1);
    expect(penerimaKabar()).toContain(salesId);
    expect(penerimaKabar()).not.toContain(spgId);
    expect(penerimaKabar()).not.toContain(kantorId);
    const [arg] = kabar.kirim.mock.calls.filter((c) => c[0] === salesId).map((c) => c[1]);
    expect(arg).toMatchObject({ jenis: "PENGUMUMAN", data: { announcementId: r.id } });

    const jejak = await prisma.auditLog.findMany({ where: { entityType: "Announcement", entityId: seededId(r.id) }, select: { action: true, metadata: true } });
    expect(jejak.map((j) => j.action).sort()).toEqual([AKSI.DIBUAT, AKSI.DIKABARKAN].sort());
    expect((jejak.find((j) => j.action === AKSI.DIKABARKAN)?.metadata as { penerima: number }).penerima).toBe(r.dikabarkan);
  });

  it("audiens SPG mengabari SPG, bukan salesman", async () => {
    await buat({ audience: "SPG" });
    expect(penerimaKabar()).toContain(spgId);
    expect(penerimaKabar()).not.toContain(salesId);
  });

  it("terjadwal: tidak dikabarkan saat disimpan; penyapu mengabarkan SEKALI begitu waktunya tiba", async () => {
    const t0 = new Date();
    const r = await buat({ publishedAt: keInputWib(new Date(t0.getTime() + 2 * JAM)) }, t0);
    expect(r.dikabarkan).toBe(0);
    expect(kabar.kirim).not.toHaveBeenCalled();

    expect(await kirimPengumumanTerjadwal(new Date(t0.getTime() + JAM), { ids: [r.id] })).toEqual({ pengumuman: 0, orang: 0 });
    const tiba = new Date(t0.getTime() + 3 * JAM);
    const pertama = await kirimPengumumanTerjadwal(tiba, { ids: [r.id] });
    expect(pertama.pengumuman).toBe(1);
    expect(penerimaKabar()).toContain(salesId);
    kabar.kirim.mockReset();
    expect(await kirimPengumumanTerjadwal(tiba, { ids: [r.id] })).toEqual({ pengumuman: 0, orang: 0 });
    expect(kabar.kirim).not.toHaveBeenCalled();
  });

  it("menggeser jadwal ke sekarang mengabarkan saat itu juga, sekali", async () => {
    const t0 = new Date();
    const r = await buat({ publishedAt: keInputWib(new Date(t0.getTime() + 5 * JAM)) }, t0);
    const u = await simpanPengumuman({ id: r.id, isian: isian({ publishedAt: "" }), userId: kantorId, sekarang: t0 });
    expect(u.ok && u.dikabarkan).toBeGreaterThanOrEqual(1);
    kabar.kirim.mockReset();
    const lagi = await simpanPengumuman({ id: r.id, isian: isian({ title: `TEST-PENG-${token} Rapat (ralat)` }), userId: kantorId, sekarang: t0 });
    expect(lagi.ok && lagi.dikabarkan).toBe(0);
    expect(kabar.kirim).not.toHaveBeenCalled();
  });

  it("dibaca idempoten: satu baris, readAt tidak bergeser", async () => {
    const r = await buat();
    const t1 = new Date(Date.now() + 1000);
    const a = await tandaiPengumumanDibaca({ id: r.id, userId: salesId, sekarang: t1 });
    expect(a).toMatchObject({ ok: true, baru: true });
    const b = await tandaiPengumumanDibaca({ id: r.id, userId: salesId, sekarang: new Date(t1.getTime() + JAM) });
    expect(b).toMatchObject({ ok: true, baru: false });
    const rows = await prisma.announcementRead.findMany({ where: { announcementId: seededId(r.id) } });
    expect(rows).toHaveLength(1);
    expect(rows[0].readAt.getTime()).toBe(t1.getTime());
  });

  it("membaca menandai kabar PENGUMUMAN miliknya dibaca — hanya untuk pengumuman itu", async () => {
    const r = await buat();
    const lain = await buat({ title: `TEST-PENG-${token} Lain` });
    await prisma.notificationQueue.createMany({
      data: [
        { userId: salesId, type: "PENGUMUMAN", title: "x", body: "x", data: { announcementId: r.id } },
        { userId: salesId, type: "PENGUMUMAN", title: "y", body: "y", data: { announcementId: lain.id } },
      ],
    });
    const h = await tandaiPengumumanDibaca({ id: r.id, userId: salesId });
    expect(h).toMatchObject({ ok: true, kabarDitandai: 1 });
    const q = await prisma.notificationQueue.findMany({ where: { userId: seededId(salesId) }, select: { data: true, readAt: true } });
    const status = Object.fromEntries(q.map((x) => [(x.data as { announcementId: string }).announcementId, x.readAt !== null]));
    expect(status).toEqual({ [r.id]: true, [lain.id]: false });
  });

  it("audiens lain dan yang tidak aktif tidak bisa dibaca dari HP", async () => {
    const r = await buat({ audience: "SALESMAN" });
    expect(await tandaiPengumumanDibaca({ id: r.id, userId: spgId })).toEqual({ ok: false, kode: "TIDAK_ADA" });
    expect(await pengumumanHp(r.id, spgId)).toBeNull();
    const t0 = new Date();
    const jadwal = await buat({ publishedAt: keInputWib(new Date(t0.getTime() + 2 * JAM)) }, t0);
    expect(await tandaiPengumumanDibaca({ id: jadwal.id, userId: salesId })).toEqual({ ok: false, kode: "TIDAK_ADA" });
    expect(await pengumumanHp(jadwal.id, salesId)).toEqual({ ada: false, alasan: "TERJADWAL" });
  });

  it("konfirmasi idempoten, sekaligus membaca; yang tidak wajib menolak", async () => {
    const r = await buat({ requireAck: true });
    const t1 = new Date(Date.now() + 1000);
    expect(await konfirmasiPengumuman({ id: r.id, userId: salesId, sekarang: t1 })).toEqual({ ok: true, baru: true });
    expect(await konfirmasiPengumuman({ id: r.id, userId: salesId, sekarang: new Date(t1.getTime() + JAM) })).toEqual({ ok: true, baru: false });
    const row = await prisma.announcementRead.findUniqueOrThrow({
      where: { announcementId_userId: { announcementId: seededId(r.id), userId: seededId(salesId) } },
    });
    expect(row.ackAt?.getTime()).toBe(t1.getTime());
    expect(row.readAt.getTime()).toBe(t1.getTime());

    const biasa = await buat({ requireAck: false, title: `TEST-PENG-${token} Biasa` });
    expect(await konfirmasiPengumuman({ id: biasa.id, userId: salesId })).toEqual({ ok: false, kode: "TIDAK_PERLU" });
  });

  it("dibaca dulu, dikonfirmasi kemudian: readAt tetap, ackAt terisi", async () => {
    const r = await buat({ requireAck: true });
    const t1 = new Date(Date.now() + 1000);
    await tandaiPengumumanDibaca({ id: r.id, userId: salesId, sekarang: t1 });
    expect(await konfirmasiPengumuman({ id: r.id, userId: salesId, sekarang: new Date(t1.getTime() + JAM) })).toEqual({ ok: true, baru: true });
    const row = await prisma.announcementRead.findUniqueOrThrow({
      where: { announcementId_userId: { announcementId: seededId(r.id), userId: seededId(salesId) } },
    });
    expect(row.readAt.getTime()).toBe(t1.getTime());
    expect(row.ackAt?.getTime()).toBe(t1.getTime() + JAM);
  });

  it("mengubah isi yang wajib dikonfirmasi menghapus konfirmasi — kecuali diminta tidak", async () => {
    const r = await buat({ requireAck: true });
    await konfirmasiPengumuman({ id: r.id, userId: salesId });
    const ubah = await simpanPengumuman({ id: r.id, isian: isian({ requireAck: true, body: "Isi baru." }), userId: kantorId });
    expect(ubah).toMatchObject({ ok: true, konfirmasiDireset: 1 });
    const row = await prisma.announcementRead.findFirstOrThrow({ where: { announcementId: seededId(r.id), userId: seededId(salesId) } });
    expect(row.ackAt).toBeNull();

    await konfirmasiPengumuman({ id: r.id, userId: salesId });
    const tanpaReset = await simpanPengumuman({
      id: r.id,
      isian: { ...isian({ requireAck: true, body: "Isi lebih baru." }), mintaKonfirmasiUlang: false },
      userId: kantorId,
    });
    expect(tanpaReset).toMatchObject({ ok: true, konfirmasiDireset: 0 });
    const tetap = await prisma.announcementRead.findFirstOrThrow({ where: { announcementId: seededId(r.id), userId: seededId(salesId) } });
    expect(tetap.ackAt).not.toBeNull();

    // Menyematkan saja (isi tidak berubah) tidak menyentuh konfirmasi.
    const semat = await simpanPengumuman({ id: r.id, isian: isian({ requireAck: true, body: "Isi lebih baru.", pinned: true }), userId: kantorId });
    expect(semat).toMatchObject({ ok: true, konfirmasiDireset: 0 });
  });

  it("arsip: hilang dari HP, idempoten, tidak bisa diubah; pulihkan mengembalikannya", async () => {
    const r = await buat({ pinned: true });
    expect((await daftarPengumumanHp(salesId)).map((x) => x.id)).toContain(r.id);

    expect(await arsipkanPengumuman({ id: r.id, userId: kantorId })).toEqual({ ok: true, sudah: false });
    expect(await arsipkanPengumuman({ id: r.id, userId: kantorId })).toEqual({ ok: true, sudah: true });
    expect((await daftarPengumumanHp(salesId)).map((x) => x.id)).not.toContain(r.id);
    expect(await pengumumanHp(r.id, salesId)).toEqual({ ada: false, alasan: "DIARSIPKAN" });
    expect(await simpanPengumuman({ id: r.id, isian: isian(), userId: kantorId })).toEqual({ ok: false, kode: "DIARSIPKAN" });

    expect(await pulihkanPengumuman({ id: r.id, userId: kantorId })).toEqual({ ok: true, sudah: false });
    expect((await daftarPengumumanHp(salesId)).map((x) => x.id)).toContain(r.id);

    const jejak = await prisma.auditLog.findMany({ where: { entityType: "Announcement", entityId: seededId(r.id) }, select: { action: true } });
    expect(jejak.filter((j) => j.action === AKSI.DIARSIPKAN)).toHaveLength(1);
    expect(jejak.filter((j) => j.action === AKSI.DIPULIHKAN)).toHaveLength(1);
    // Sudah dikabarkan saat dibuat — memulihkan tidak mengabarkan lagi.
    expect(jejak.filter((j) => j.action === AKSI.DIKABARKAN)).toHaveLength(1);
  });

  it("hapus hanya selama belum dibaca", async () => {
    const r = await buat();
    await tandaiPengumumanDibaca({ id: r.id, userId: salesId });
    expect(await hapusPengumuman({ id: r.id, userId: kantorId })).toEqual({ ok: false, kode: "SUDAH_DIBACA" });

    const belum = await buat({ title: `TEST-PENG-${token} Salah ketik` });
    expect(await hapusPengumuman({ id: belum.id, userId: kantorId })).toEqual({ ok: true });
    expect(await prisma.announcement.findUnique({ where: { id: seededId(belum.id) } })).toBeNull();
    const jejak = await prisma.auditLog.findFirst({ where: { entityType: "Announcement", entityId: seededId(belum.id), action: AKSI.DIHAPUS } });
    expect(jejak).not.toBeNull();
  });

  it("laporan baca kantor: penerima, siapa sudah membaca/konfirmasi, siapa belum", async () => {
    const r = await buat({ audience: "SEMUA", requireAck: true });
    await konfirmasiPengumuman({ id: r.id, userId: salesId });
    const rinci = await rincianPengumumanKantor(r.id);
    expect(rinci).not.toBeNull();
    const per = new Map(rinci!.laporan.baris.map((b) => [b.userId, b]));
    expect(per.get(salesId)).toMatchObject({ status: "DIKONFIRMASI", peran: "SALESMAN", bukanPenerima: false });
    expect(per.get(spgId)).toMatchObject({ status: "BELUM", peran: "SPG", tokoNama: "Toko Pengumuman" });
    expect(per.has(kantorId)).toBe(false);
    expect(rinci!.bolehHapus).toBe(false);
    // Urutan: yang belum membaca di atas.
    const urutan = rinci!.laporan.baris.map((b) => b.status);
    expect(urutan.indexOf("BELUM")).toBeLessThan(urutan.indexOf("DIKONFIRMASI"));
  });

  it("kartu beranda: hanya muncul bila ada yang perlu dilihat", async () => {
    const r = await buat({ audience: "SPG" });
    const kartu = await kartuPengumumanBeranda(spgId);
    expect(kartu?.baris.map((b) => b.id)).toContain(r.id);
    await tandaiPengumumanDibaca({ id: r.id, userId: spgId });
    const sesudah = await kartuPengumumanBeranda(spgId);
    expect(sesudah?.baris.map((b) => b.id) ?? []).not.toContain(r.id);
  });
});
