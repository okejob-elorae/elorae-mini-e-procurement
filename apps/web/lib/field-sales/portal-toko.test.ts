import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { prisma, seededId, seededIds } from "@elorae/db";
import {
  AKSI_TAUTAN_DIBUAT,
  AKSI_TAUTAN_DICABUT,
  bukaTautanPortal,
  buatTautanPortal,
  buatTokenPortal,
  cabutTautanPortal,
  daftarTautanPortal,
  ENTITAS_TAUTAN,
  hashTokenPortal,
  rapikanLabel,
} from "./portal-toko";
import { ATURAN_PORTAL_BAWAAN, bentukTokenSah, MAKS_TAUTAN_AKTIF } from "./portal-toko-aturan";

describe("token portal (murni)", () => {
  it("is 32 random bytes in base64url, stored only as its sha256 hex", () => {
    const a = buatTokenPortal();
    const b = buatTokenPortal();
    expect(bentukTokenSah(a.token)).toBe(true);
    expect(Buffer.from(a.token, "base64url")).toHaveLength(32);
    expect(a.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.tokenHash).toBe(createHash("sha256").update(a.token).digest("hex"));
    expect(a.tokenHash).not.toContain(a.token);
    expect(a.token).not.toBe(b.token);
    expect(hashTokenPortal(a.token)).toBe(a.tokenHash);
  });

  it("labels are trimmed, collapsed and capped", () => {
    expect(rapikanLabel("  Pemilik   toko ")).toBe("Pemilik toko");
    expect(rapikanLabel("")).toBeNull();
    expect(rapikanLabel(42)).toBeNull();
    expect(rapikanLabel("x".repeat(100))).toHaveLength(60);
  });
});

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("tautan portal — buat, buka, cabut (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  const aturan = { ...ATURAN_PORTAL_BAWAAN };
  let salesmanId = "";
  let storeId = "";
  let storeTanpaPemegangId = "";

  beforeEach(async () => {
    salesmanId = "";
    storeId = "";
    storeTanpaPemegangId = "";
    const user = await prisma.user.findFirst({ where: { email: "salesman@elorae.com" }, select: { id: true } });
    salesmanId = user!.id;
    const s = await prisma.store.create({
      data: { code: `PTL-${token}-A`, name: "Toko Portal Uji", address: "Uji", termsType: "PUTUS", isActive: true, salesmanId },
    });
    storeId = s.id;
    const s2 = await prisma.store.create({
      data: { code: `PTL-${token}-B`, name: "Toko Tanpa Pemegang", address: "Uji", termsType: "PUTUS", isActive: true, salesmanId: null },
    });
    storeTanpaPemegangId = s2.id;
  });

  afterEach(async () => {
    const tokoIds = [storeId, storeTanpaPemegangId].filter((x) => x !== "");
    const tautan = await prisma.storePortalLink.findMany({ where: { storeId: { in: seededIds(tokoIds) } }, select: { id: true } });
    const linkIds = tautan.map((t) => t.id);
    await prisma.auditLog.deleteMany({ where: { entityType: "StorePortalLink", entityId: { in: seededIds(linkIds) } } });
    await prisma.storePortalLink.deleteMany({ where: { id: { in: seededIds(linkIds) } } });
    await prisma.store.deleteMany({ where: { id: { in: seededIds(tokoIds) } } });
  });

  it("stores only the hash — the raw token is nowhere in the row or the audit trail", async () => {
    const r = await buatTautanPortal({ storeId, createdById: salesmanId, label: "Bu Ani", hari: 30, aturan });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const baris = await prisma.storePortalLink.findUniqueOrThrow({ where: { id: seededId(r.linkId) } });
    expect(baris.tokenHash).toBe(hashTokenPortal(r.token));
    expect(JSON.stringify(baris)).not.toContain(r.token);
    expect(baris.label).toBe("Bu Ani");
    expect(baris.createdById).toBe(salesmanId);

    const jejak = await prisma.auditLog.findMany({ where: { entityType: ENTITAS_TAUTAN, entityId: seededId(r.linkId) } });
    expect(jejak.map((j) => j.action)).toEqual([AKSI_TAUTAN_DIBUAT]);
    expect(jejak[0].userId).toBe(salesmanId);
    const teksJejak = JSON.stringify(jejak);
    expect(teksJejak).not.toContain(r.token);
    expect(teksJejak).not.toContain(baris.tokenHash);

    const daftar = await daftarTautanPortal(storeId);
    expect(daftar).toHaveLength(1);
    expect(daftar[0]).toMatchObject({ id: r.linkId, label: "Bu Ani", keadaan: "AKTIF" });
    expect(Object.keys(daftar[0])).not.toContain("tokenHash");
    expect(JSON.stringify(daftar)).not.toContain(baris.tokenHash);
  });

  it("opens a valid link to its own store and holder", async () => {
    const r = await buatTautanPortal({ storeId, createdById: salesmanId, aturan });
    if (!r.ok) throw new Error(r.code);
    const b = await bukaTautanPortal(r.token, { aturan });
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    expect(b.akses.linkId).toBe(r.linkId);
    expect(b.akses.toko).toMatchObject({ id: storeId, termsType: "PUTUS", salesmanId, name: "Toko Portal Uji" });
  });

  it("default expiry is the owner's setting", async () => {
    const sekarang = new Date();
    const r = await buatTautanPortal({ storeId, createdById: salesmanId, aturan: { ...aturan, masaBerlakuHari: 7 }, sekarang });
    if (!r.ok) throw new Error(r.code);
    expect(r.expiresAt.getTime() - sekarang.getTime()).toBe(7 * 86_400_000);
  });

  it("an unknown or malformed token is refused without touching any store", async () => {
    const asing = buatTokenPortal().token;
    expect(await bukaTautanPortal(asing, { aturan })).toEqual({ ok: false, code: "TIDAK_DIKENAL" });
    expect(await bukaTautanPortal("../../etc/passwd", { aturan })).toEqual({ ok: false, code: "TIDAK_DIKENAL" });
    expect(await bukaTautanPortal({ token: "x" }, { aturan })).toEqual({ ok: false, code: "TIDAK_DIKENAL" });
    // Hash tersimpan dipakai sebagai token: tetap tidak dikenal (hash dari hash).
    const r = await buatTautanPortal({ storeId, createdById: salesmanId, aturan });
    if (!r.ok) throw new Error(r.code);
    expect(await bukaTautanPortal(hashTokenPortal(r.token), { aturan })).toEqual({ ok: false, code: "TIDAK_DIKENAL" });
  });

  it("a revoked link dies immediately; revoking twice writes one audit row", async () => {
    const r = await buatTautanPortal({ storeId, createdById: salesmanId, aturan });
    if (!r.ok) throw new Error(r.code);
    expect(await cabutTautanPortal({ linkId: r.linkId, userId: salesmanId })).toEqual({ ok: true, sudahDicabut: false });
    expect(await bukaTautanPortal(r.token, { aturan })).toEqual({ ok: false, code: "DICABUT" });
    expect(await cabutTautanPortal({ linkId: r.linkId, userId: salesmanId })).toEqual({ ok: true, sudahDicabut: true });
    const jejak = await prisma.auditLog.findMany({
      where: { entityType: ENTITAS_TAUTAN, entityId: seededId(r.linkId), action: AKSI_TAUTAN_DICABUT },
    });
    expect(jejak).toHaveLength(1);
    expect(jejak[0].changes).toMatchObject({ sebelum: { revokedAt: null } });
    expect((await daftarTautanPortal(storeId))[0].keadaan).toBe("DICABUT");
    expect(await cabutTautanPortal({ linkId: "tidak-ada", userId: salesmanId })).toEqual({ ok: false, code: "TIDAK_ADA" });
  });

  it("an expired link is refused", async () => {
    const lalu = new Date(Date.now() - 10 * 86_400_000);
    const r = await buatTautanPortal({ storeId, createdById: salesmanId, hari: 3, sekarang: lalu, aturan });
    if (!r.ok) throw new Error(r.code);
    expect(await bukaTautanPortal(r.token, { aturan })).toEqual({ ok: false, code: "KEDALUWARSA" });
  });

  it("a store without a holder gets no link, and an existing link dies when the holder is removed", async () => {
    expect(await buatTautanPortal({ storeId: storeTanpaPemegangId, createdById: salesmanId, aturan })).toEqual({
      ok: false,
      code: "TANPA_PEMEGANG",
    });
    const r = await buatTautanPortal({ storeId, createdById: salesmanId, aturan });
    if (!r.ok) throw new Error(r.code);
    await prisma.store.update({ where: { id: seededId(storeId) }, data: { salesmanId: null } });
    expect(await bukaTautanPortal(r.token, { aturan })).toEqual({ ok: false, code: "TANPA_PEMEGANG" });
  });

  it("an inactive store's link is refused", async () => {
    const r = await buatTautanPortal({ storeId, createdById: salesmanId, aturan });
    if (!r.ok) throw new Error(r.code);
    await prisma.store.update({ where: { id: seededId(storeId) }, data: { isActive: false } });
    expect(await bukaTautanPortal(r.token, { aturan })).toEqual({ ok: false, code: "TOKO_NONAKTIF" });
    expect(await buatTautanPortal({ storeId, createdById: salesmanId, aturan })).toEqual({ ok: false, code: "TOKO_NONAKTIF" });
  });

  it("switching the portal off kills every link and refuses new ones", async () => {
    const r = await buatTautanPortal({ storeId, createdById: salesmanId, aturan });
    if (!r.ok) throw new Error(r.code);
    const mati = { ...aturan, aktif: false };
    expect(await bukaTautanPortal(r.token, { aturan: mati })).toEqual({ ok: false, code: "PORTAL_NONAKTIF" });
    expect(await buatTautanPortal({ storeId, createdById: salesmanId, aturan: mati })).toEqual({ ok: false, code: "PORTAL_NONAKTIF" });
  });

  it("refuses an out-of-range expiry and more than the active-link cap", async () => {
    expect(await buatTautanPortal({ storeId, createdById: salesmanId, hari: 0, aturan })).toEqual({ ok: false, code: "TIDAK_SAH" });
    expect(await buatTautanPortal({ storeId, createdById: salesmanId, hari: 400, aturan })).toEqual({ ok: false, code: "TIDAK_SAH" });
    for (let i = 0; i < MAKS_TAUTAN_AKTIF; i++) {
      const r = await buatTautanPortal({ storeId, createdById: salesmanId, aturan });
      expect(r.ok).toBe(true);
    }
    expect(await buatTautanPortal({ storeId, createdById: salesmanId, aturan })).toEqual({ ok: false, code: "TERLALU_BANYAK" });
  });
});
