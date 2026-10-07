import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * `getAntreanKantor` hanya menjalankan kueri baris yang boleh dilihat
 * penontonnya. Tanpa basis data: setiap model ditiru dan setiap kueri dicatat.
 */

const catatan = vi.hoisted(() => ({ dipanggil: [] as string[], gagal: new Map<string, "sinkron" | "tolak">() }));

vi.mock("@elorae/db", () => {
  const model = (nama: string) =>
    new Proxy(
      {},
      {
        get: (_t, op: string) => {
          const cara = catatan.gagal.get(nama);
          if (cara === "sinkron") {
            return () => {
              throw new Error(`${nama} rusak`);
            };
          }
          return vi.fn(async () => {
            if (cara === "tolak") throw new Error(`${nama} rusak`);
            catatan.dipanggil.push(`${nama}.${op}`);
            if (op === "count") return 3;
            if (op === "groupBy") return [{ _sum: { qty: 2 } }, { _sum: { qty: 0 } }];
            return [];
          });
        },
      },
    );
  return {
    prisma: new Proxy({}, { get: (_t, nama: string) => model(nama) }),
    // Hitungan jadwal produksi dimuat lewat modul yang juga memuat `runSerializable`,
    // yang membaca tingkat isolasi saat modulnya dimuat.
    Prisma: { TransactionIsolationLevel: { Serializable: "Serializable" } },
  };
});
vi.mock("@/lib/stores/usulan-queries", () => ({
  jumlahUsulanMenunggu: vi.fn(async () => {
    catatan.dipanggil.push("usulan");
    return 4;
  }),
}));
vi.mock("@/lib/spg/shift-queries", () => ({
  jumlahTukarMenungguKantor: vi.fn(async () => {
    catatan.dipanggil.push("shift");
    return 5;
  }),
}));
vi.mock("@/lib/receivables/koreksi", () => ({
  koreksiTertunda: vi.fn(async () => {
    catatan.dipanggil.push("koreksi");
    return new Map([["k1", { pada: "", alasan: "" }]]);
  }),
}));

const { getAntreanKantor, KUNCI_ANTREAN } = await import("./antrean-kantor");

beforeEach(() => {
  catatan.dipanggil = [];
  catatan.gagal.clear();
  vi.restoreAllMocks();
});

describe("getAntreanKantor", () => {
  it("tanpa izin apa pun: tidak satu kueri pun berjalan", async () => {
    expect(await getAntreanKantor(["dashboard:view"])).toEqual({});
    expect(catatan.dipanggil).toEqual([]);
  });

  it("gudang: hanya kueri antrean gudang yang berjalan", async () => {
    const hasil = await getAntreanKantor(["dashboard:view", "inventory:view", "inventory:manage"]);
    expect(Object.keys(hasil).sort()).toEqual([
      "damagedDeliveriesOpen",
      "damagedWarehouseOpen",
      "exchangesPendingCompletion",
    ]);
    expect(catatan.dipanggil.sort()).toEqual([
      "damagedStockMovement.groupBy",
      "storeExchange.count",
      "storeReceiptLine.count",
    ]);
    // Saldo nol tidak menunggu keputusan apa pun.
    expect(hasil.damagedWarehouseOpen).toBe(1);
  });

  it("keuangan: koreksi BKM dan biaya yang menunggu dibayar", async () => {
    const hasil = await getAntreanKantor(["dashboard:view", "journals:manage"]);
    expect(Object.keys(hasil).sort()).toEqual(["claimCorrectionsPending", "expensesPendingPayment"]);
    expect(hasil.claimCorrectionsPending).toBe(1);
    expect(catatan.dipanggil).not.toContain("usulan");
    expect(catatan.dipanggil).not.toContain("shift");
  });

  it("produksi: hanya dua hitungan langkah jadwal produksi (terlambat, hari ini)", async () => {
    const hasil = await getAntreanKantor(["dashboard:view", "production_planning:view"]);
    expect(hasil).toEqual({ productionStepsOverdue: 3, productionStepsDueToday: 3 });
    expect(catatan.dipanggil.sort()).toEqual(["planStageStep.count", "planStageStep.count"]);
  });

  it("admin: setiap antrean dihitung", async () => {
    const hasil = await getAntreanKantor(["*"]);
    expect(Object.keys(hasil).sort()).toEqual([...KUNCI_ANTREAN].sort());
    expect(hasil.storeProposalsPending).toBe(4);
    expect(hasil.shiftSwapsPending).toBe(5);
  });

  it("satu hitungan gagal (ditolak atau galat sinkron) tidak menjatuhkan Beranda: barisnya saja yang hilang", async () => {
    const galat = vi.spyOn(console, "error").mockImplementation(() => {});
    catatan.gagal.set("leaveRequest", "tolak");
    catatan.gagal.set("stockLoss", "sinkron");
    const hasil = await getAntreanKantor(["*"]);
    expect(Object.keys(hasil).sort()).toEqual(
      [...KUNCI_ANTREAN].filter((k) => k !== "leavePending" && k !== "stockLossOpen").sort(),
    );
    expect(hasil.storeProposalsPending).toBe(4);
    expect(galat).toHaveBeenCalledTimes(2);
  });
});
