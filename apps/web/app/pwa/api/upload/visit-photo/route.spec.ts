import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Unggah foto kunjungan: foto dari kunjungan yang check-in-nya dicatat tanpa
 * sinyal datang dengan id check-in HP (`visitClientId`) — server mencari
 * kunjungannya MILIK orang ini dan mengembalikan id-nya. Tanpa basis data dan
 * tanpa R2: semua tiruan.
 */

const h = vi.hoisted(() => ({
  userId: "u1",
  kunjungan: null as { id: string } | null,
  sudah: null as { id: string; url: string; visitId: string } | null,
  cariKunjungan: vi.fn(),
  lampirkan: vi.fn(async () => ({ id: "p1", url: "https://r2/x.jpg" })),
  unggah: vi.fn<(key: string, body: unknown, type: string) => Promise<string>>(async () => "https://r2/x.jpg"),
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: h.userId, permissions: ["pwa:access"] } })) }));
vi.mock("@/lib/pwa/guard", () => ({ pwaAccessGuard: () => "render" }));
vi.mock("@/lib/r2", () => ({ isConfigured: () => true, uploadToR2: h.unggah }));
vi.mock("@/lib/field-sales/visit-photo-writer", () => ({ attachVisitPhoto: h.lampirkan, VisitOwnershipError: class extends Error {} }));
vi.mock("@elorae/db", () => ({
  prisma: {
    visitPhoto: { findUnique: vi.fn(async () => h.sudah) },
    storeVisit: {
      findFirst: h.cariKunjungan.mockImplementation(async () => h.kunjungan),
    },
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb({})),
  },
}));

const { POST } = await import("./route");

function kirim(isi: Record<string, string>) {
  const form = new FormData();
  form.set("file", new File([new Uint8Array([1, 2, 3])], "f.jpg", { type: "image/jpeg" }));
  for (const [k, v] of Object.entries(isi)) form.set(k, v);
  return POST(new Request("http://localhost/pwa/api/upload/visit-photo", { method: "POST", body: form }) as never);
}

beforeEach(() => {
  h.kunjungan = null;
  h.sudah = null;
  h.cariKunjungan.mockClear();
  h.lampirkan.mockClear();
  h.unggah.mockClear();
});

describe("POST /pwa/api/upload/visit-photo", () => {
  it("finds the visit of an offline check-in by the phone's id, only among this person's visits", async () => {
    h.kunjungan = { id: "v-server" };
    const res = await kirim({ visitClientId: "hp-1", clientId: "foto-1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "p1", url: "https://r2/x.jpg", visitId: "v-server" });
    expect(h.cariKunjungan).toHaveBeenCalledWith({ where: { clientId: "hp-1", userId: "u1" }, select: { id: true } });
    expect(h.lampirkan).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ visitId: "v-server", clientId: "foto-1" }));
    expect(h.unggah.mock.calls[0][0]).toBe("visit-photos/v-server/foto-1.jpg");
  });

  it("refuses an offline check-in id that is not one of this person's visits", async () => {
    const res = await kirim({ visitClientId: "hp-orang-lain", clientId: "foto-1" });
    expect(res.status).toBe(404);
    expect(h.unggah).not.toHaveBeenCalled();
  });

  it("still takes a server visit id exactly as before", async () => {
    h.kunjungan = { id: "v1" };
    const res = await kirim({ visitId: "v1", clientId: "foto-2" });
    expect(res.status).toBe(200);
    expect(h.cariKunjungan).toHaveBeenCalledWith({ where: { id: "v1", userId: "u1" }, select: { id: true } });
  });

  it("needs a visit id or an offline check-in id", async () => {
    expect((await kirim({ clientId: "foto-3" })).status).toBe(400);
  });

  it("a resent photo returns the stored one, with its visit", async () => {
    h.sudah = { id: "p9", url: "u", visitId: "v1" };
    const res = await kirim({ visitClientId: "hp-1", clientId: "foto-4" });
    expect(await res.json()).toEqual({ id: "p9", url: "u", visitId: "v1" });
    expect(h.unggah).not.toHaveBeenCalled();
  });
});
