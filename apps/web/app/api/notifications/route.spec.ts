import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@elorae/db", () => ({
  prisma: {
    notificationQueue: { findMany: vi.fn(), count: vi.fn() },
    vanLoad: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { GET } from "./route";

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;
const mockFindMany = prisma.notificationQueue.findMany as unknown as ReturnType<typeof vi.fn>;
const mockCount = prisma.notificationQueue.count as unknown as ReturnType<typeof vi.fn>;
const mockVanLoad = prisma.vanLoad.findMany as unknown as ReturnType<typeof vi.fn>;

const T0 = Date.UTC(2026, 9, 6, 3, 0, 0);

function baris(i: number, extra: Partial<{ type: string; data: unknown; createdAt: Date; id: string }> = {}) {
  return {
    id: `n${String(i).padStart(3, "0")}`,
    type: "PO_CREATED",
    title: `Judul ${i}`,
    body: "isi",
    data: { poId: `po-${i}` },
    readAt: null,
    createdAt: new Date(T0 - i * 1000),
    ...extra,
  };
}

function minta(qs = "") {
  return new Request(`http://localhost/api/notifications${qs}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "user-1" } });
  mockCount.mockResolvedValue(0);
  mockVanLoad.mockResolvedValue([]);
});

describe("GET /api/notifications — halaman", () => {
  it("401 tanpa sesi, tanpa kueri", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET(minta());
    expect(res.status).toBe(401);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("halaman pertama: milik pengguna, urut createdAt lalu id turun, mengambil satu lebih untuk tahu ada lanjutan", async () => {
    mockFindMany.mockResolvedValue([baris(1), baris(2)]);
    await GET(minta());
    expect(mockFindMany).toHaveBeenCalledTimes(1);
    const args = mockFindMany.mock.calls[0][0];
    expect(args.where).toEqual({ userId: "user-1" });
    expect(args.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
    expect(args.take).toBe(51);
  });

  it("51 baris terbaca → 50 dikirim dan nextCursor menunjuk baris ke-50", async () => {
    const rows = Array.from({ length: 51 }, (_, i) => baris(i + 1));
    mockFindMany.mockResolvedValue(rows);
    mockCount.mockResolvedValue(51);
    const res = await GET(minta());
    const json = await res.json();
    expect(json.items).toHaveLength(50);
    expect(json.items[49].id).toBe("n050");
    expect(json.nextCursor).toBe(`${rows[49].createdAt.getTime()}_n050`);
  });

  it("50 baris atau kurang → nextCursor null", async () => {
    mockFindMany.mockResolvedValue(Array.from({ length: 50 }, (_, i) => baris(i + 1)));
    const json = await (await GET(minta())).json();
    expect(json.items).toHaveLength(50);
    expect(json.nextCursor).toBeNull();
  });

  it("dengan kursor: hanya yang lebih lama, seri createdAt diputus id", async () => {
    mockFindMany.mockResolvedValue([]);
    const ms = T0 - 50_000;
    await GET(minta(`?cursor=${encodeURIComponent(`${ms}_n050`)}`));
    const args = mockFindMany.mock.calls[0][0];
    expect(args.where).toEqual({
      userId: "user-1",
      OR: [{ createdAt: { lt: new Date(ms) } }, { createdAt: new Date(ms), id: { lt: "n050" } }],
    });
  });

  it.each(["abc", "_n1", "12x_n1", "123_", "9999999999999999_n1"])("kursor rusak %s → 400 tanpa kueri", async (k) => {
    const res = await GET(minta(`?cursor=${encodeURIComponent(k)}`));
    expect(res.status).toBe(400);
    expect(mockFindMany).not.toHaveBeenCalled();
    expect(mockCount).not.toHaveBeenCalled();
  });

  it("unreadCount menghitung SEMUA yang belum dibaca milik pengguna, bukan yang termuat", async () => {
    mockFindMany.mockResolvedValue([baris(1)]);
    mockCount.mockResolvedValue(137);
    const json = await (await GET(minta())).json();
    expect(json.unreadCount).toBe(137);
    expect(mockCount).toHaveBeenCalledWith({ where: { userId: "user-1", readAt: null } });
  });

  it("unreadCount juga dikirim di halaman lanjutan (lencana tetap segar)", async () => {
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(9);
    const json = await (await GET(minta(`?cursor=${T0}_n001`))).json();
    expect(json.unreadCount).toBe(9);
    // Kursor membatasi baris yang dimuat, BUKAN hitungan lencana.
    expect(mockCount).toHaveBeenCalledWith({ where: { userId: "user-1", readAt: null } });
    expect(json.items).toEqual([]);
    expect(json.nextCursor).toBeNull();
  });

  it("500 bila kueri gagal", async () => {
    mockFindMany.mockRejectedValue(new Error("db down"));
    const res = await GET(minta());
    expect(res.status).toBe(500);
  });
});

describe("GET /api/notifications — melengkapi jurnal muat van", () => {
  const muatVan = (i: number, docId: string) =>
    baris(i, {
      type: "JOURNAL_PENDING",
      data: { adminNotificationId: `a${i}`, docId, kind: "van_load", reason: "UNMAPPED_ROLE" },
    });

  it("kanvaser muatan ditambahkan ke data, satu kueri untuk semua muatan di halaman", async () => {
    mockFindMany.mockResolvedValue([muatVan(1, "load-1"), baris(2), muatVan(3, "load-2"), muatVan(4, "load-1")]);
    mockVanLoad.mockResolvedValue([
      { id: "load-1", canvasserId: "cv-1" },
      { id: "load-2", canvasserId: "cv-2" },
    ]);
    const json = await (await GET(minta())).json();
    expect(mockVanLoad).toHaveBeenCalledTimes(1);
    expect(mockVanLoad.mock.calls[0][0].where).toEqual({ id: { in: ["load-1", "load-2"] } });
    expect(json.items[0].data.canvasserId).toBe("cv-1");
    expect(json.items[2].data.canvasserId).toBe("cv-2");
    expect(json.items[3].data.canvasserId).toBe("cv-1");
    expect(json.items[1].data).toEqual({ poId: "po-2" });
    expect(json.items[0].data.docId).toBe("load-1");
  });

  it("data berupa teks JSON (kolom JSON di MariaDB) juga dilengkapi", async () => {
    mockFindMany.mockResolvedValue([
      baris(1, {
        type: "JOURNAL_PENDING",
        data: JSON.stringify({ adminNotificationId: "a1", docId: "load-7", kind: "van_load" }),
      }),
    ]);
    mockVanLoad.mockResolvedValue([{ id: "load-7", canvasserId: "cv-7" }]);
    const json = await (await GET(minta())).json();
    expect(mockVanLoad.mock.calls[0][0].where).toEqual({ id: { in: ["load-7"] } });
    expect(json.items[0].data).toEqual({ adminNotificationId: "a1", docId: "load-7", kind: "van_load", canvasserId: "cv-7" });
  });

  it("tanpa jurnal muat van → tidak ada kueri tambahan", async () => {
    mockFindMany.mockResolvedValue([
      baris(1),
      baris(2, { type: "JOURNAL_PENDING", data: { docId: "s1", kind: "van_sale" } }),
    ]);
    await GET(minta());
    expect(mockVanLoad).not.toHaveBeenCalled();
  });

  it("pencarian kanvaser gagal → lonceng tetap tampil tanpa pelengkapan", async () => {
    mockFindMany.mockResolvedValue([muatVan(1, "load-1")]);
    mockVanLoad.mockRejectedValue(new Error("boom"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await GET(minta());
    err.mockRestore();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.items[0].data.canvasserId).toBeUndefined();
  });
});
