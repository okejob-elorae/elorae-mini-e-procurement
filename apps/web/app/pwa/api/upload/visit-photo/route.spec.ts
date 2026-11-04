import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Unggah foto kunjungan: foto dari kunjungan yang check-in-nya dicatat tanpa
 * sinyal datang dengan id check-in HP (`visitClientId`) — server mencari
 * kunjungannya MILIK orang ini dan mengembalikan id-nya — dan batas foto per
 * kunjungan ditolak sebelum R2 ditulis. Tanpa basis data dan tanpa R2: semua tiruan.
 */

const h = vi.hoisted(() => ({
  kunjungan: null as { id: string } | null,
  sudah: null as { id: string; url: string; visitId: string } | null,
  lampirkan: vi.fn(async () => ({ id: "p1", url: "https://r2/x.jpg" })),
  unggah: vi.fn<(key: string, body: unknown, type: string) => Promise<string>>(async () => "https://r2/x.jpg"),
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/pwa/guard", () => ({ pwaAccessGuard: () => "render" }));
vi.mock("@/lib/r2", () => ({ isConfigured: () => true, uploadToR2: h.unggah }));
vi.mock("@/lib/field-sales/visit-photo-writer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/field-sales/visit-photo-writer")>()),
  attachVisitPhoto: h.lampirkan,
}));
vi.mock("@elorae/db", () => ({
  prisma: {
    visitPhoto: { findUnique: vi.fn(), count: vi.fn() },
    storeVisit: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { POST } from "./route";
import { MAX_PHOTOS_PER_VISIT, VisitPhotoCapError } from "@/lib/field-sales/visit-photo-writer";

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;
const db = prisma as unknown as {
  visitPhoto: { findUnique: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn> };
  storeVisit: { findFirst: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

function upload() {
  const form = new FormData();
  form.set("file", new File([new Uint8Array([1, 2, 3])], "a.jpg", { type: "image/jpeg" }));
  form.set("visitId", "visit1");
  form.set("clientId", "client1");
  return new Request("http://localhost/pwa/api/upload/visit-photo", { method: "POST", body: form }) as never;
}

function kirim(isi: Record<string, string>) {
  const form = new FormData();
  form.set("file", new File([new Uint8Array([1, 2, 3])], "f.jpg", { type: "image/jpeg" }));
  for (const [k, v] of Object.entries(isi)) form.set(k, v);
  return POST(new Request("http://localhost/pwa/api/upload/visit-photo", { method: "POST", body: form }) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.kunjungan = null;
  h.sudah = null;
  mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["pwa:access"] } });
  db.visitPhoto.findUnique.mockImplementation(async () => h.sudah);
  db.visitPhoto.count.mockResolvedValue(0);
  db.storeVisit.findFirst.mockImplementation(async () => h.kunjungan);
  db.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb({}));
  h.unggah.mockResolvedValue("https://r2/x.jpg");
  h.lampirkan.mockResolvedValue({ id: "p1", url: "https://r2/x.jpg" });
});

describe("POST /pwa/api/upload/visit-photo cap", () => {
  beforeEach(() => {
    h.kunjungan = { id: "visit1" };
  });

  it("refuses the upload past the cap with a typed 409 and writes nothing to R2", async () => {
    db.visitPhoto.count.mockResolvedValue(MAX_PHOTOS_PER_VISIT);
    const res = await POST(upload());
    expect(res.status).toBe(409);
    expect(db.visitPhoto.count).toHaveBeenCalledWith({ where: { visitId: "visit1" } });
    expect(await res.json()).toMatchObject({ code: "PHOTO_CAP_REACHED" });
    expect(h.unggah).not.toHaveBeenCalled();
  });

  it("maps the writer's in-transaction cap refusal to the same 409", async () => {
    db.visitPhoto.count.mockResolvedValue(MAX_PHOTOS_PER_VISIT - 1);
    db.$transaction.mockRejectedValue(new VisitPhotoCapError("visit1"));
    const res = await POST(upload());
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "PHOTO_CAP_REACHED" });
  });

  it("uploads when under the cap", async () => {
    db.visitPhoto.count.mockResolvedValue(MAX_PHOTOS_PER_VISIT - 1);
    db.$transaction.mockResolvedValue({ id: "p1", url: "https://r2/x.jpg" });
    const res = await POST(upload());
    expect(res.status).toBe(200);
    expect(h.unggah).toHaveBeenCalledTimes(1);
  });
});

describe("POST /pwa/api/upload/visit-photo", () => {
  it("finds the visit of an offline check-in by the phone's id, only among this person's visits", async () => {
    h.kunjungan = { id: "v-server" };
    const res = await kirim({ visitClientId: "hp-1", clientId: "foto-1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "p1", url: "https://r2/x.jpg", visitId: "v-server" });
    expect(db.storeVisit.findFirst).toHaveBeenCalledWith({ where: { clientId: "hp-1", userId: "u1" }, select: { id: true } });
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
    expect(db.storeVisit.findFirst).toHaveBeenCalledWith({ where: { id: "v1", userId: "u1" }, select: { id: true } });
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
