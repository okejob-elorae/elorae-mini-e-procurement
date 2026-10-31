import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, seededId } from "@elorae/db";
import { PERMISSIONS } from "@/lib/rbac";

/*
 * GET /api/foto/[id] terhadap basis data sungguhan (sesi ditiru).
 *
 * `route.spec.ts` meniru Prisma, jadi tidak bisa membuktikan bahwa bentuk kueri
 * pencariannya — `contains` di kolom teks, saringan relasi `order.salesmanId`,
 * jendela waktu kolom JSON — benar-benar diterima basis data. Di sini setiap
 * kueri model `KOLOM_FOTO` dijalankan sungguhan: penonton dengan semua izin
 * (bukan `*`) memaksa semua model dicari, sales memaksa semua saringan pemilik.
 */

const sesi = vi.hoisted(() => ({ id: "", permissions: [] as string[] }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: sesi.id, permissions: sesi.permissions } })) }));

const { GET } = await import("./route");

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const tag = `FOTO-${Math.random().toString(36).slice(2, 8)}`;

d("GET /api/foto/[id] — kueri sungguhan (test bed only)", () => {
  let fotoId = "";
  let panduanId = "";
  let spgId = "";
  let tutupId = "";
  const toko = `${tag}-toko`;

  const minta = () =>
    GET(new NextRequest(`http://localhost/api/foto/${fotoId}`), { params: Promise.resolve({ id: fotoId }) });

  beforeAll(async () => {
    fotoId = "";
    panduanId = "";
    spgId = "";
    tutupId = "";
    fotoId = (
      await prisma.foto.create({
        data: { mime: "image/jpeg", bytes: Buffer.from([0xff, 0xd8, 0xff]), sizeBytes: 3, caption: tag },
        select: { id: true },
      })
    ).id;
  });

  beforeEach(async () => {
    await prisma.displayGuide.deleteMany({ where: { id: seededId(panduanId) } });
    panduanId = "";
    sesi.id = `${tag}-penonton`;
    sesi.permissions = [];
  });

  afterAll(async () => {
    await prisma.displayGuide.deleteMany({ where: { id: seededId(panduanId) } });
    await prisma.spgDailyClose.deleteMany({ where: { id: seededId(tutupId) } });
    await prisma.user.deleteMany({ where: { id: seededId(spgId) } });
    await prisma.foto.deleteMany({ where: { id: seededId(fotoId) } });
  });

  it("semua izin (bukan *) tanpa dokumen yang menunjuk → 403; setiap kueri model diterima basis data", async () => {
    sesi.permissions = [...Object.values(PERMISSIONS), "pwa:access"].filter((k) => k !== "*");
    expect((await minta()).status).toBe(403);
  });

  it("sales tanpa izin kantor: saringan pemilik dijalankan sungguhan → 403", async () => {
    sesi.permissions = ["pwa:access"];
    expect((await minta()).status).toBe(403);
  });

  it("panduan display yang menunjuk foto → sales boleh melihatnya", async () => {
    panduanId = (
      await prisma.displayGuide.create({
        data: { title: `${tag} panduan`, body: "uji", imageUrl: `/api/foto/${fotoId}`, createdById: `${tag}-kantor` },
        select: { id: true },
      })
    ).id;
    sesi.permissions = ["pwa:access"];
    const res = await minta();
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  });
  it("tutup hari: kueri toko tetap sungguhan — rekan satu toko boleh, toko lain tidak", async () => {
    // Tanpa FK di kedua kolom toko, jadi id toko buatan cukup.
    tutupId = (
      await prisma.spgDailyClose.create({
        data: {
          storeId: toko,
          day: `uji-${tag}`,
          closedById: `${tag}-spg-lain`,
          notaCount: 1,
          pcs: 1,
          grossTotal: 150000,
          netTotal: 150000,
          photoUrls: [`/api/foto/${fotoId}`],
        },
        select: { id: true },
      })
    ).id;
    spgId = (
      await prisma.user.create({
        data: { email: `${tag.toLowerCase()}-spg@uji.local`, name: `${tag} SPG`, assignedStoreId: toko },
        select: { id: true },
      })
    ).id;
    sesi.id = spgId;
    sesi.permissions = ["pwa:access"];
    expect((await minta()).status).toBe(200);

    await prisma.user.update({ where: { id: seededId(spgId) }, data: { assignedStoreId: `${tag}-toko-lain` } });
    expect((await minta()).status).toBe(403);
  });
});
