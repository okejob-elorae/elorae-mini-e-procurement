import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededIds } from "@elorae/db";
import { hapusCatatanToko, sematCatatanToko, tambahCatatanToko, tokoDariCatatan, ubahCatatanToko } from "./catatan-writer";
import { aksesCatatanToko, catatanTersematPerToko, catatanTokoUntuk } from "./catatan-queries";

/* Menulis toko, pengguna, dan catatan — tidak pernah dijalankan terhadap basis data produksi. */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("catatan toko: tulis, hak, urutan, tersemat (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let tokoA = "";
  let tokoB = "";
  let penulisId = "";
  let lainId = "";
  let spgId = "";

  beforeEach(async () => {
    tokoA = ""; tokoB = ""; penulisId = ""; lainId = ""; spgId = "";
    tokoA = (await prisma.store.create({ data: { code: `TEST-CAT-A-${token}`, name: "Toko A", address: "x", termsType: "PUTUS", isActive: true } })).id;
    tokoB = (await prisma.store.create({ data: { code: `TEST-CAT-B-${token}`, name: "Toko B", address: "x", termsType: "PUTUS", isActive: true } })).id;
    penulisId = (await prisma.user.create({ data: { email: `test-cat-penulis-${token}@example.com`, name: "Penulis" } })).id;
    lainId = (await prisma.user.create({ data: { email: `test-cat-lain-${token}@example.com`, name: "Orang Lain" } })).id;
    spgId = (await prisma.user.create({ data: { email: `test-cat-spg-${token}@example.com`, name: "SPG", assignedStoreId: tokoA } })).id;
    await prisma.store.update({ where: { id: tokoA }, data: { salesmanId: penulisId } });
  });

  afterEach(async () => {
    const stores = [tokoA, tokoB].filter(Boolean);
    const users = [penulisId, lainId, spgId].filter(Boolean);
    await prisma.storeNote.deleteMany({ where: { storeId: { in: seededIds(stores) } } });
    // Toko dulu: `Store.salesmanId` menunjuk pengguna penulis.
    await prisma.store.deleteMany({ where: { id: { in: seededIds(stores) } } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds(users) } } });
  });

  async function catat(body: string, storeId = tokoA, authorId = penulisId) {
    const r = await tambahCatatanToko({ storeId, authorId, body });
    if (!r.ok) throw new Error(`tambah gagal: ${r.kode}`);
    return r.id;
  }

  it("tambah: dirapikan, ditolak bila kosong/terlalu panjang atau tokonya tidak ada", async () => {
    const id = await catat("  Pemilik libur Jumat  ");
    expect((await prisma.storeNote.findUniqueOrThrow({ where: { id } })).body).toBe("Pemilik libur Jumat");
    expect(await tambahCatatanToko({ storeId: tokoA, authorId: penulisId, body: "  " })).toEqual({ ok: false, kode: "KOSONG" });
    expect(await tambahCatatanToko({ storeId: tokoA, authorId: penulisId, body: "x".repeat(1001) })).toEqual({ ok: false, kode: "TERLALU_PANJANG" });
    expect(await tambahCatatanToko({ storeId: `tidak-ada-${token}`, authorId: penulisId, body: "x" })).toEqual({ ok: false, kode: "TIDAK_ADA" });
  });

  it("ubah, hapus, sematkan: penulis boleh; orang lain ditolak; stores:manage boleh semua", async () => {
    const id = await catat("Asli");
    const lain = { noteId: id, userId: lainId, kelolaSemua: false };
    expect(await ubahCatatanToko({ ...lain, body: "Dibajak" })).toEqual({ ok: false, kode: "BUKAN_MILIK" });
    expect(await sematCatatanToko({ ...lain, pinned: true })).toEqual({ ok: false, kode: "BUKAN_MILIK" });
    expect(await hapusCatatanToko(lain)).toEqual({ ok: false, kode: "BUKAN_MILIK" });
    expect((await prisma.storeNote.findUniqueOrThrow({ where: { id } })).body).toBe("Asli");

    expect(await ubahCatatanToko({ noteId: id, userId: penulisId, kelolaSemua: false, body: "Diubah penulis" })).toMatchObject({ ok: true, storeId: tokoA });
    expect(await sematCatatanToko({ noteId: id, userId: penulisId, kelolaSemua: false, pinned: true })).toMatchObject({ ok: true });
    expect(await ubahCatatanToko({ noteId: id, userId: lainId, kelolaSemua: true, body: "Diubah kantor" })).toMatchObject({ ok: true });
    const row = await prisma.storeNote.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ body: "Diubah kantor", pinned: true, authorId: penulisId });
  });

  it("hapus lunak: barisnya tetap, tidak tampil, dan tidak bisa diubah lagi", async () => {
    const id = await catat("Akan dihapus");
    expect(await hapusCatatanToko({ noteId: id, userId: penulisId, kelolaSemua: false })).toMatchObject({ ok: true });
    expect((await prisma.storeNote.findUniqueOrThrow({ where: { id } })).deletedAt).not.toBeNull();
    expect(await catatanTokoUntuk(tokoA, { userId: penulisId, kelolaSemua: false })).toEqual([]);
    expect(await tokoDariCatatan(id)).toBeNull();
    expect(await ubahCatatanToko({ noteId: id, userId: penulisId, kelolaSemua: false, body: "x" })).toEqual({ ok: false, kode: "TIDAK_ADA" });
    expect(await hapusCatatanToko({ noteId: id, userId: penulisId, kelolaSemua: true })).toEqual({ ok: false, kode: "TIDAK_ADA" });
  });

  it("daftar: tersemat di atas lalu terbaru, dengan hak per baris", async () => {
    const lama = await catat("Lama");
    await prisma.storeNote.update({ where: { id: lama }, data: { createdAt: new Date(Date.now() - 3 * 86_400_000) } });
    const semat = await catat("Tersemat");
    await prisma.storeNote.update({ where: { id: semat }, data: { pinned: true, createdAt: new Date(Date.now() - 5 * 86_400_000) } });
    const baru = await catat("Baru dari orang lain", tokoA, lainId);

    const daftar = await catatanTokoUntuk(tokoA, { userId: penulisId, kelolaSemua: false });
    expect(daftar.map((c) => c.id)).toEqual([semat, baru, lama]);
    const per = new Map(daftar.map((c) => [c.id, c]));
    expect(per.get(lama)).toMatchObject({ milikSaya: true, bolehKelola: true, penulis: "Penulis" });
    expect(per.get(baru)).toMatchObject({ milikSaya: false, bolehKelola: false, penulis: "Orang Lain" });

    const kantor = await catatanTokoUntuk(tokoA, { userId: spgId, kelolaSemua: true });
    expect(kantor.every((c) => c.bolehKelola)).toBe(true);
  });

  it("tersemat per toko: yang terbaru, ringkas, toko tanpa semat tidak ada", async () => {
    const lama = await catat("Semat lama");
    await prisma.storeNote.update({ where: { id: lama }, data: { pinned: true, createdAt: new Date(Date.now() - 86_400_000) } });
    const baru = await catat(`Semat baru\n${"panjang ".repeat(30)}`);
    await prisma.storeNote.update({ where: { id: baru }, data: { pinned: true } });
    const terhapus = await catat("Semat terhapus");
    await prisma.storeNote.update({ where: { id: terhapus }, data: { pinned: true, deletedAt: new Date() } });
    await catat("Tidak tersemat", tokoB);

    const peta = await catatanTersematPerToko([tokoA, tokoB]);
    expect(peta.has(tokoB)).toBe(false);
    const a = peta.get(tokoA);
    expect(a?.noteId).toBe(baru);
    expect(a?.jumlahTersemat).toBe(2);
    expect(a?.teks.startsWith("Semat baru panjang")).toBe(true);
    expect(a!.teks.length).toBeLessThanOrEqual(80);
    expect(a!.teks.endsWith("…")).toBe(true);
  });

  it("akses: kantor stores:view, SPG hanya toko tetapnya, pemegang toko selalu boleh", async () => {
    expect(await aksesCatatanToko({ id: lainId, permissions: ["stores:view"] }, tokoB)).toEqual({ boleh: true, kelolaSemua: false });
    expect(await aksesCatatanToko({ id: lainId, permissions: ["stores:view", "stores:manage"] }, tokoB)).toEqual({ boleh: true, kelolaSemua: true });
    expect(await aksesCatatanToko({ id: lainId, permissions: ["*"] }, tokoB)).toEqual({ boleh: true, kelolaSemua: true });
    expect(await aksesCatatanToko({ id: lainId, permissions: [] }, tokoA)).toEqual({ boleh: false, kelolaSemua: false });

    expect((await aksesCatatanToko({ id: spgId, permissions: ["pwa:access"] }, tokoA)).boleh).toBe(true);
    expect((await aksesCatatanToko({ id: spgId, permissions: ["pwa:access"] }, tokoB)).boleh).toBe(false);
    // Pemegang toko boleh, apa pun keadaan kunci "hanya toko sendiri".
    expect((await aksesCatatanToko({ id: penulisId, permissions: ["pwa:access"] }, tokoA)).boleh).toBe(true);
    // Orang lapangan tidak pernah mendapat hak kelola semua catatan.
    expect((await aksesCatatanToko({ id: penulisId, permissions: ["pwa:access"] }, tokoA)).kelolaSemua).toBe(false);
    expect(await aksesCatatanToko({ id: lainId, permissions: ["stores:view"] }, `tidak-ada-${token}`)).toEqual({ boleh: false, kelolaSemua: false });
  });
});
