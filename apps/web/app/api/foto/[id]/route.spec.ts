import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { KOLOM_FOTO } from "@/lib/foto/pembersih";
import { PERMISSIONS } from "@/lib/rbac";

/*
 * GET /api/foto/[id] — siapa boleh mengunduh foto.
 *
 * Dulu cukup masuk: siapa pun yang tahu id bisa mengunduh bukti transfer,
 * nota retur, swafoto absen, atau surat sakit orang lain. Kini: pengunggahnya
 * sendiri, admin sistem, atau pemegang izin baca modul dokumen yang
 * merujuknya (kolom dari `KOLOM_FOTO`) — dan untuk dokumen lapangan, sales
 * pemilik dokumennya. Basis data ditiru; yang diuji keputusan dan bentuk kueri.
 */

const db = vi.hoisted(() => {
  const delegasi: Record<string, { findMany: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> }> = {};
  const foto = { findUnique: vi.fn() };
  // Toko tetap penonton (`User.assignedStoreId`) yang dibaca rute untuk laporan tutup hari.
  const penonton = { assignedStoreId: null as string | null };
  const prisma = new Proxy(
    {},
    {
      get: (_t, kunci: string) => {
        if (kunci === "foto") return foto;
        delegasi[kunci] ??= { findMany: vi.fn(async () => []), findUnique: vi.fn() };
        return delegasi[kunci];
      },
    },
  );
  return { prisma, delegasi, foto, penonton };
});
vi.mock("@elorae/db", () => ({ prisma: db.prisma }));

const sesi = vi.hoisted(() => ({ ada: true, id: "penonton", permissions: [] as string[] }));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => (sesi.ada ? { user: { id: sesi.id, permissions: sesi.permissions } } : null)),
}));

const { GET } = await import("./route");

const ID = "ckfoto00000000000000000001";
const URL_FOTO = `/api/foto/${ID}`;
const DIBUAT = new Date("2026-10-01T03:00:00Z");
const BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

const minta = () => GET(new NextRequest(`http://localhost${URL_FOTO}`), { params: Promise.resolve({ id: ID }) });

function adaFoto(uploadedById: string | null) {
  db.foto.findUnique.mockImplementation(async (args: { select: Record<string, boolean> }) => {
    if (args.select.bytes) return { mime: "image/jpeg", bytes: BYTES };
    return { uploadedById, createdAt: DIBUAT };
  });
}

const bytesDibaca = () =>
  db.foto.findUnique.mock.calls.some((c) => (c[0] as { select: Record<string, boolean> }).select.bytes);
const modelDipindai = () => Object.entries(db.delegasi).filter(([, d]) => d.findMany.mock.calls.length > 0).map(([m]) => m);

/** Dokumen model `model` yang kolom pertamanya menunjuk foto ini. */
function dokumenMenunjuk(model: string, nilai: unknown = URL_FOTO) {
  const aturan = KOLOM_FOTO.find((k) => k.model === model)!;
  void (db.prisma as Record<string, unknown>)[model]; // memicu pembuatan delegasinya
  db.delegasi[model].findMany.mockResolvedValue([{ [aturan.kolom[0]]: nilai }]);
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const d of Object.values(db.delegasi)) d.findMany.mockResolvedValue([]);
  db.penonton.assignedStoreId = null;
  void (db.prisma as Record<string, unknown>).user; // memicu pembuatan delegasinya
  db.delegasi.user.findUnique.mockImplementation(async () => ({ assignedStoreId: db.penonton.assignedStoreId }));
  sesi.ada = true;
  sesi.id = "penonton";
  sesi.permissions = [];
  adaFoto("pengunggah");
});

describe("GET /api/foto/[id]", () => {
  it("tanpa sesi → 401", async () => {
    sesi.ada = false;
    expect((await minta()).status).toBe(401);
    expect(db.foto.findUnique).not.toHaveBeenCalled();
  });

  it("id tidak ada → 404", async () => {
    db.foto.findUnique.mockResolvedValue(null);
    expect((await minta()).status).toBe(404);
  });

  it("pengunggahnya sendiri → 200 tanpa memindai tabel apa pun", async () => {
    sesi.id = "pengunggah";
    const res = await minta();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=31536000, immutable");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(BYTES);
    expect(modelDipindai()).toEqual([]);
  });

  it("admin sistem (*) → 200 tanpa memindai", async () => {
    sesi.permissions = ["*"];
    expect((await minta()).status).toBe(200);
    expect(modelDipindai()).toEqual([]);
  });

  it("orang lain tanpa izin dan tanpa dokumen yang menunjuk → 403, bytes tidak dibaca", async () => {
    sesi.permissions = ["dashboard:view"];
    expect((await minta()).status).toBe(403);
    expect(bytesDibaca()).toBe(false);
  });

  it("bukti transfer BKM: sales lain hanya dicari di BKM miliknya sendiri → 403", async () => {
    sesi.permissions = ["pwa:access"];
    expect((await minta()).status).toBe(403);
    const where = JSON.stringify(db.delegasi.paymentClaim.findMany.mock.calls[0][0]);
    expect(where).toContain('"salesmanId":"penonton"');
    expect(where).toContain(URL_FOTO);
  });

  it("bukti transfer BKM: sales yang namanya di BKM itu → 200", async () => {
    sesi.permissions = ["pwa:access"];
    dokumenMenunjuk("paymentClaim");
    expect((await minta()).status).toBe(200);
  });

  it("bukti transfer BKM: keuangan (journals:manage) dicari tanpa saringan pemilik → 200", async () => {
    sesi.permissions = ["journals:manage"];
    dokumenMenunjuk("paymentClaim");
    expect((await minta()).status).toBe(200);
    const where = JSON.stringify(db.delegasi.paymentClaim.findMany.mock.calls[0][0]);
    expect(where).not.toContain("salesmanId");
  });

  it("nota retur: gudang yang menghitung (inventory_opname:count) boleh", async () => {
    sesi.permissions = ["inventory_opname:count"];
    dokumenMenunjuk("storeReturn");
    expect((await minta()).status).toBe(200);
  });

  it("surat sakit (izin cuti) tidak pernah dicari untuk sales biasa", async () => {
    sesi.permissions = ["pwa:access"];
    dokumenMenunjuk("leaveRequest");
    expect((await minta()).status).toBe(403);
    expect(db.delegasi.leaveRequest?.findMany.mock.calls.length ?? 0).toBe(0);
  });

  it("id yang hanya awalan dari foto lain tidak dianggap cocok", async () => {
    sesi.permissions = ["journals:manage"];
    dokumenMenunjuk("paymentClaim", `${URL_FOTO}9`);
    expect((await minta()).status).toBe(403);
  });

  it("kolom berisi daftar URL (GRN.photoUrls) dicocokkan per URL", async () => {
    sesi.permissions = ["inventory:view"];
    dokumenMenunjuk("gRN", `/api/foto/lain,${URL_FOTO}`);
    expect((await minta()).status).toBe(200);
  });

  it("kolom JSON (tutup hari SPG) dibatasi jendela waktu sekitar foto, tidak dibaca utuh", async () => {
    sesi.permissions = ["spg_sales:view"];
    dokumenMenunjuk("spgDailyClose", ["/api/foto/lain", URL_FOTO]);
    expect((await minta()).status).toBe(200);
    const syarat = db.delegasi.spgDailyClose.findMany.mock.calls[0][0].where.AND as Array<Record<string, { gte?: Date; lte?: Date }>>;
    const jendela = syarat.find((s) => s.updatedAt)!;
    expect(jendela.updatedAt.gte!.getTime()).toBeLessThan(DIBUAT.getTime());
    expect(jendela.createdAt.lte!.getTime()).toBeGreaterThan(DIBUAT.getTime());
  });

  // Laporan tutup hari satu per toko per hari, dan HP SPG menampilkan laporan
  // toko itu apa pun SPG yang mengisinya — rekan satu toko harus bisa melihat fotonya.
  it("tutup hari: SPG lain di toko yang sama melihat foto laporan tokonya", async () => {
    sesi.permissions = ["pwa:access"];
    db.penonton.assignedStoreId = "toko-1";
    dokumenMenunjuk("spgDailyClose", [URL_FOTO]);
    expect((await minta()).status).toBe(200);
    const where = JSON.stringify(db.delegasi.spgDailyClose.findMany.mock.calls[0][0]);
    expect(where).toContain('"storeId":"toko-1"');
  });

  it("tutup hari: penonton tanpa toko tetap tidak pernah dicari di laporan toko mana pun", async () => {
    sesi.permissions = ["pwa:access"];
    dokumenMenunjuk("spgDailyClose", [URL_FOTO]);
    expect((await minta()).status).toBe(403);
    expect(db.delegasi.spgDailyClose.findMany).not.toHaveBeenCalled();
  });

  it("toko tetap penonton hanya dibaca bila sampai ke laporan tutup hari", async () => {
    sesi.permissions = ["pwa:access"];
    dokumenMenunjuk("paymentClaim");
    expect((await minta()).status).toBe(200);
    expect(db.delegasi.user.findUnique).not.toHaveBeenCalled();
  });

  it("foto produk dan panduan display boleh dilihat siapa pun yang masuk", async () => {
    sesi.permissions = ["pwa:access"];
    dokumenMenunjuk("displayGuide");
    expect((await minta()).status).toBe(200);
  });

  // Setiap kolom foto WAJIB punya aturan pembaca: model tanpa aturan tidak
  // pernah dicari, jadi fotonya tidak bisa dibuka siapa pun selain pengunggah.
  it.each(KOLOM_FOTO.map((k) => k.model))("%s punya aturan pembaca", async (model) => {
    sesi.permissions = [...Object.values(PERMISSIONS), "pwa:access"];
    dokumenMenunjuk(model);
    expect((await minta()).status).toBe(200);
  });
});
