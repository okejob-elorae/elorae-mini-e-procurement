import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Antrean foto kunjungan: foto di kunjungan yang check-in-nya masih di HP
 * menunggu check-in itu, berhenti bila check-in itu ditolak, dan sesudahnya
 * diunggah dengan id check-in HP. Foto yang sampai dicatat pada kunjungan
 * server-nya (aturan wajib foto tanpa sinyal). Semua tiruan — tanpa basis data.
 */

const h = vi.hoisted(() => ({
  baris: [] as Record<string, unknown>[],
  update: vi.fn(async () => 1),
  hapus: vi.fn(async () => undefined),
  ikatan: vi.fn<(id: string | null | undefined) => Promise<"kirim" | "tunggu" | "ditolak">>(async () => "kirim"),
  tambah: vi.fn(),
}));

vi.mock("./db", () => ({
  pwaDb: {
    pendingPhotos: {
      where: () => ({ anyOf: () => ({ toArray: async () => h.baris }) }),
      update: h.update,
    },
  },
}));
vi.mock("./photo-queue", () => ({ deletePendingPhoto: h.hapus }));
vi.mock("./luring-tergantung", () => ({ keadaanCheckinTertahan: h.ikatan }));
vi.mock("./foto-kunjungan", () => ({ tambahFotoTerkirim: h.tambah }));

const { flushPendingPhotos } = await import("./photo-sync");

const blob = new Blob(["x"], { type: "image/jpeg" });
const foto = (lain: Record<string, unknown>) => ({ localId: "f1", storeId: "s1", blob, capturedAt: 1, syncState: "pending", attempts: 0, ...lain });

let terkirim: FormData[] = [];
beforeEach(() => {
  h.baris = [];
  h.update.mockClear();
  h.hapus.mockClear();
  h.tambah.mockClear();
  h.ikatan.mockReset();
  h.ikatan.mockResolvedValue("kirim");
  terkirim = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_u: string, init: { body: FormData }) => {
      terkirim.push(init.body);
      return new Response(JSON.stringify({ id: "p1", url: "u", visitId: "v-server" }), { status: 200 });
    }),
  );
});

describe("flushPendingPhotos", () => {
  it("leaves a photo waiting while its check-in is still on the phone, without counting an attempt", async () => {
    h.baris = [foto({ visitId: "", visitClientId: "hp-1" })];
    h.ikatan.mockResolvedValue("tunggu");
    expect(await flushPendingPhotos()).toEqual({ synced: 0, failed: 0, retried: 0 });
    expect(h.update).toHaveBeenCalledWith("f1", { syncState: "pending" });
    expect(terkirim).toHaveLength(0);
  });

  it("stops with the refusal when its check-in was refused", async () => {
    h.baris = [foto({ visitId: "", visitClientId: "hp-1" })];
    h.ikatan.mockResolvedValue("ditolak");
    expect(await flushPendingPhotos()).toEqual({ synced: 0, failed: 1, retried: 0 });
    expect(h.update).toHaveBeenCalledWith("f1", { syncState: "failed", error: "KUNJUNGAN_DITOLAK", attempts: 1 });
    expect(terkirim).toHaveLength(0);
  });

  it("uploads with the phone's check-in id once it arrived, and remembers the photo on the server visit", async () => {
    h.baris = [foto({ visitId: "", visitClientId: "hp-1" })];
    expect(await flushPendingPhotos()).toEqual({ synced: 1, failed: 0, retried: 0 });
    expect(terkirim[0].get("visitId")).toBeNull();
    expect(terkirim[0].get("visitClientId")).toBe("hp-1");
    expect(h.hapus).toHaveBeenCalledWith("f1");
    expect(h.tambah).toHaveBeenCalledWith("v-server");
  });

  it("a photo of a server visit is sent as before and never waits on a check-in", async () => {
    h.baris = [foto({ visitId: "v1" })];
    expect(await flushPendingPhotos()).toEqual({ synced: 1, failed: 0, retried: 0 });
    expect(h.ikatan).not.toHaveBeenCalled();
    expect(terkirim[0].get("visitId")).toBe("v1");
    expect(terkirim[0].get("visitClientId")).toBeNull();
  });
});
