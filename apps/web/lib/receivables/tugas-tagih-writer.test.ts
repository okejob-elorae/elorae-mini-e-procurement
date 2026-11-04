import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tes penulis tugas tagih tanpa basis data.
 *
 * Yang dijaga: setiap penolakan terjadi SEBELUM ada yang ditulis, jejak ditulis
 * di dalam transaksi yang sama dengan perubahannya, penutupan bertanding-lalu-
 * tukar tidak menulis jejak kalau kalah, dan penutup otomatis tidak pernah
 * menutup tugas yang fakturnya belum lunas atau sudah hilang.
 */

type Tugas = {
  id: string;
  status: string;
  assigneeId: string;
  storeId: string;
  createdById: string;
  receivableIds: unknown;
};

type Piutang = { id: string; storeId: string; isConsignment?: boolean; status?: string };

const state = {
  piutang: [] as Piutang[],
  /** Pemegang toko sekarang (`Store.salesmanId`). */
  pemegang: "s1" as string | null,
  /** Faktur di tugas yang statusnya VOIDED — tidak terhitung oleh `count` yang menyaringnya. */
  jumlahDibatalkan: 0,
  sisa: new Map<string, number>(),
  lapangan: true,
  tugasLain: [] as { receivableIds: unknown }[],
  tugas: null as Tugas | null,
  menang: 1,
  dibuat: [] as Record<string, unknown>[],
  diubah: [] as Record<string, unknown>[],
  jejak: [] as Record<string, unknown>[],
  jumlahAda: 0,
};

/** `where.status.not` yang diminta penulis — penyaring piutang dibatalkan. */
const kecualiStatus = (args?: { where?: { status?: { not?: string } } }) => args?.where?.status?.not;

const tx = {
  receivable: {
    findMany: vi.fn(async (args?: { where?: { status?: { not?: string } } }) =>
      state.piutang
        .filter((p) => !kecualiStatus(args) || p.status !== kecualiStatus(args))
        .map((p) => ({ ...p, isConsignment: p.isConsignment ?? false })),
    ),
    count: vi.fn(async (args?: { where?: { status?: { not?: string } } }) =>
      state.jumlahAda - (kecualiStatus(args) === "VOIDED" ? state.jumlahDibatalkan : 0),
    ),
  },
  store: { findUnique: vi.fn(async () => ({ salesmanId: state.pemegang })) },
  user: { findFirst: vi.fn(async () => (state.lapangan ? { id: "s1" } : null)) },
  collectionTask: {
    findMany: vi.fn(async () => state.tugasLain),
    findUnique: vi.fn(async () => state.tugas),
    create: vi.fn(async (args: { data: Record<string, unknown> }) => {
      state.dibuat.push(args.data);
      return { id: "tg1" };
    }),
    updateMany: vi.fn(async (args: { data: Record<string, unknown> }) => {
      if (state.menang > 0) state.diubah.push(args.data);
      return { count: state.menang };
    }),
  },
  auditLog: {
    create: vi.fn(async (args: { data: Record<string, unknown> }) => {
      state.jejak.push(args.data);
      return {};
    }),
  },
};

vi.mock("@/lib/db/tx-retry", () => ({
  runSerializable: (cb: (client: unknown) => Promise<unknown>) => cb(tx),
}));
vi.mock("./writer", () => ({
  hitungUlangPiutang: async (_c: unknown, id: string) => state.sisa.get(id) ?? 0,
}));

const { batalkanTugasTagih, buatTugasTagih, tandaiSudahDitagih, tutupTugasLunasOtomatis, JEJAK_TUGAS_TAGIH } =
  await import("./tugas-tagih-writer");

const HARI_INI = new Date("2026-10-01T03:00:00Z");
const TENGGAT = new Date("2026-10-08T00:00:00+07:00");

beforeEach(() => {
  state.piutang = [
    { id: "r1", storeId: "t1" },
    { id: "r2", storeId: "t1" },
  ];
  state.sisa = new Map([
    ["r1", 400_000],
    ["r2", 100_000],
  ]);
  state.lapangan = true;
  state.tugasLain = [];
  state.tugas = { id: "tg1", status: "TERBUKA", assigneeId: "s1", storeId: "t1", createdById: "admin", receivableIds: ["r1", "r2"] };
  state.menang = 1;
  state.dibuat = [];
  state.diubah = [];
  state.jejak = [];
  state.jumlahAda = 2;
  state.pemegang = "s1";
  state.jumlahDibatalkan = 0;
});

describe("buatTugasTagih", () => {
  const dasar = {
    storeId: "t1",
    receivableIds: ["r1", "r2"],
    assigneeId: "s1",
    tenggat: TENGGAT,
    catatan: "  Tagih sebelum Jumat  ",
    olehUserId: "admin",
    hariIni: HARI_INI,
  };

  it("mencatat tugas beserta jejaknya, nilai = sisa yang dihitung ulang", async () => {
    const h = await buatTugasTagih(dasar);
    expect(h).toEqual({ ok: true, id: "tg1", storeId: "t1", assigneeId: "s1", nilai: 500_000, jumlahFaktur: 2 });
    expect(state.dibuat[0]).toMatchObject({
      assigneeId: "s1",
      storeId: "t1",
      receivableIds: ["r1", "r2"],
      note: "Tagih sebelum Jumat",
      dueDate: TENGGAT,
      status: "TERBUKA",
      createdById: "admin",
    });
    expect(state.jejak).toHaveLength(1);
    expect(state.jejak[0]).toMatchObject({
      action: JEJAK_TUGAS_TAGIH.DIBUAT,
      entityType: "CollectionTask",
      entityId: "tg1",
      userId: "admin",
    });
  });

  it("faktur yang sudah lunas menolak SELURUHNYA tanpa menulis apa pun", async () => {
    state.sisa.set("r2", 0);
    expect(await buatTugasTagih(dasar)).toEqual({ ok: false, alasan: "SUDAH_LUNAS" });
    expect(state.dibuat).toHaveLength(0);
    expect(state.jejak).toHaveLength(0);
  });

  it("faktur di tugas terbuka lain ditolak", async () => {
    state.tugasLain = [{ receivableIds: ["r2", "r9"] }];
    expect(await buatTugasTagih(dasar)).toEqual({ ok: false, alasan: "SUDAH_DITUGASKAN" });
    expect(state.dibuat).toHaveLength(0);
  });

  it("petugas yang bukan orang lapangan ditolak", async () => {
    state.lapangan = false;
    expect(await buatTugasTagih(dasar)).toEqual({ ok: false, alasan: "BUKAN_PETUGAS_LAPANGAN" });
  });

  it("faktur toko lain / tidak ditemukan ditolak", async () => {
    state.piutang = [{ id: "r1", storeId: "t1" }];
    expect(await buatTugasTagih(dasar)).toEqual({ ok: false, alasan: "FAKTUR_TIDAK_DITEMUKAN" });
    state.piutang = [
      { id: "r1", storeId: "t1" },
      { id: "r2", storeId: "t2" },
    ];
    expect(await buatTugasTagih(dasar)).toEqual({ ok: false, alasan: "BEDA_TOKO" });
  });

  it("faktur yang DIBATALKAN dianggap tidak ada", async () => {
    state.piutang = [
      { id: "r1", storeId: "t1" },
      { id: "r2", storeId: "t1", status: "VOIDED" },
    ];
    expect(await buatTugasTagih(dasar)).toEqual({ ok: false, alasan: "FAKTUR_TIDAK_DITEMUKAN" });
    expect(state.dibuat).toHaveLength(0);
  });

  // P31 ("pemegang toko"): nominal tagihan konsinyasi hanya untuk pemegang toko sekarang.
  describe("tagihan konsinyasi", () => {
    beforeEach(() => {
      state.piutang = [
        { id: "r1", storeId: "t1", isConsignment: true },
        { id: "r2", storeId: "t1" },
      ];
    });

    it("ditugaskan ke pemegang toko: dicatat", async () => {
      const h = await buatTugasTagih(dasar);
      expect(h).toMatchObject({ ok: true, assigneeId: "s1", jumlahFaktur: 2 });
      expect(state.dibuat).toHaveLength(1);
    });

    it("ditugaskan ke orang lapangan yang bukan pemegang: KONSI_HANYA_PEMEGANG tanpa menulis apa pun", async () => {
      state.pemegang = "s9";
      expect(await buatTugasTagih(dasar)).toEqual({ ok: false, alasan: "KONSI_HANYA_PEMEGANG" });
      expect(state.dibuat).toHaveLength(0);
      expect(state.jejak).toHaveLength(0);
    });

    it("toko konsinyasi tanpa pemegang: tidak bisa ditugaskan ke siapa pun", async () => {
      state.pemegang = null;
      expect(await buatTugasTagih(dasar)).toEqual({ ok: false, alasan: "KONSI_HANYA_PEMEGANG" });
      expect(state.dibuat).toHaveLength(0);
    });

    it("faktur putus di toko yang sama tetap boleh ditugaskan ke yang bukan pemegang", async () => {
      state.pemegang = "s9";
      state.piutang = [{ id: "r2", storeId: "t1" }];
      const h = await buatTugasTagih({ ...dasar, receivableIds: ["r2"] });
      expect(h).toMatchObject({ ok: true, jumlahFaktur: 1 });
    });
  });
});

describe("tandaiSudahDitagih", () => {
  it("hanya yang ditugasi; hasilnya hidup di jejak", async () => {
    const h = await tandaiSudahDitagih({ taskId: "tg1", olehUserId: "s1", hasil: "Toko janji transfer Jumat" });
    expect(h).toEqual({ ok: true, storeId: "t1", assigneeId: "s1", createdById: "admin" });
    expect(state.diubah[0]).toMatchObject({ status: "SELESAI" });
    expect(state.jejak[0]).toMatchObject({ action: JEJAK_TUGAS_TAGIH.SELESAI, reason: "Toko janji transfer Jumat" });
  });

  it("orang lain ditolak, catatan kosong ditolak", async () => {
    expect(await tandaiSudahDitagih({ taskId: "tg1", olehUserId: "s2", hasil: "x" })).toEqual({
      ok: false,
      alasan: "BUKAN_PETUGAS",
    });
    expect(await tandaiSudahDitagih({ taskId: "tg1", olehUserId: "s1", hasil: "  " })).toEqual({
      ok: false,
      alasan: "HASIL_WAJIB",
    });
    expect(state.jejak).toHaveLength(0);
  });

  it("kalah bertanding dengan pembatalan → SUDAH_DITUTUP, tanpa jejak", async () => {
    state.menang = 0;
    expect(await tandaiSudahDitagih({ taskId: "tg1", olehUserId: "s1", hasil: "x" })).toEqual({
      ok: false,
      alasan: "SUDAH_DITUTUP",
    });
    expect(state.jejak).toHaveLength(0);
  });

  it("tugas yang tidak ada", async () => {
    state.tugas = null;
    expect(await tandaiSudahDitagih({ taskId: "x", olehUserId: "s1", hasil: "x" })).toEqual({
      ok: false,
      alasan: "TIDAK_DITEMUKAN",
    });
  });
});

describe("batalkanTugasTagih", () => {
  it("alasan wajib dan masuk jejak", async () => {
    expect(await batalkanTugasTagih({ taskId: "tg1", olehUserId: "admin", alasan: "" })).toEqual({
      ok: false,
      alasan: "ALASAN_WAJIB",
    });
    const h = await batalkanTugasTagih({ taskId: "tg1", olehUserId: "admin", alasan: "Salah toko" });
    expect(h.ok).toBe(true);
    expect(state.diubah[0]).toMatchObject({ status: "DIBATALKAN" });
    expect(state.jejak[0]).toMatchObject({ action: JEJAK_TUGAS_TAGIH.DIBATALKAN, reason: "Salah toko" });
  });

  it("tugas yang sudah selesai tidak bisa dibatalkan", async () => {
    state.tugas = { ...state.tugas!, status: "SELESAI" };
    expect(await batalkanTugasTagih({ taskId: "tg1", olehUserId: "admin", alasan: "x" })).toEqual({
      ok: false,
      alasan: "SUDAH_DITUTUP",
    });
  });
});

describe("tutupTugasLunasOtomatis", () => {
  it("menutup tugas yang semua fakturnya lunas, dengan jejak otomatis", async () => {
    state.sisa = new Map([
      ["r1", 0],
      ["r2", 0],
    ]);
    expect(await tutupTugasLunasOtomatis({ taskIds: ["tg1"], olehUserId: "admin" })).toEqual(["tg1"]);
    expect(state.diubah[0]).toMatchObject({ status: "SELESAI" });
    expect(state.jejak[0]).toMatchObject({ action: JEJAK_TUGAS_TAGIH.SELESAI_OTOMATIS });
  });

  it("satu faktur masih bersisa (klaimnya dibatalkan sejak dibaca) → tidak ditutup", async () => {
    state.sisa = new Map([
      ["r1", 0],
      ["r2", 50_000],
    ]);
    expect(await tutupTugasLunasOtomatis({ taskIds: ["tg1"], olehUserId: "admin" })).toEqual([]);
    expect(state.diubah).toHaveLength(0);
    expect(state.jejak).toHaveLength(0);
  });

  it("faktur yang DIBATALKAN tidak pernah dihitung lunas — kantor yang membatalkannya, bukan toko yang membayar", async () => {
    // Piutang VOIDED bersisa nol (`bacaRincianSisa`); tanpa penyaring status, tugas ini
    // akan ditutup "karena semua fakturnya lunas".
    state.sisa = new Map([
      ["r1", 0],
      ["r2", 0],
    ]);
    state.jumlahDibatalkan = 1;
    expect(await tutupTugasLunasOtomatis({ taskIds: ["tg1"], olehUserId: "admin" })).toEqual([]);
    expect(state.diubah).toHaveLength(0);
    expect(state.jejak).toHaveLength(0);
  });

  it("faktur yang hilang tidak pernah dihitung lunas", async () => {
    // hitungUlangPiutang mengembalikan 0 untuk baris yang hilang — itulah jebakannya.
    state.sisa = new Map();
    state.jumlahAda = 1;
    expect(await tutupTugasLunasOtomatis({ taskIds: ["tg1"], olehUserId: "admin" })).toEqual([]);
  });

  it("tugas yang sudah tidak terbuka dilewati; kesalahan tidak melempar", async () => {
    state.tugas = { ...state.tugas!, status: "DIBATALKAN" };
    expect(await tutupTugasLunasOtomatis({ taskIds: ["tg1"], olehUserId: "admin" })).toEqual([]);
    tx.collectionTask.findUnique.mockRejectedValueOnce(new Error("putus"));
    const galat = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await tutupTugasLunasOtomatis({ taskIds: ["tg1"], olehUserId: "admin" })).toEqual([]);
    galat.mockRestore();
  });
});
