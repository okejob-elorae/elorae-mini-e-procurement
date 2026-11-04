import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatIDR } from "@/lib/sales-orders/format";

/**
 * Kabar ke pemegang toko bahwa BKM memotong nota retur yang selisihnya DITETAPKAN ditanggung TOKO
 * (P84, keputusan 1 2026-10-29: "sales dikabari untuk menagih kekurangannya"). Kabar saat
 * diputuskan berjanji "kalau nanti dipotong … tagih saat itu" — `kabarBebanTokoDariKlaim` adalah
 * "saat itu". KAPAN aksi BKM memanggilnya diuji di `app/actions/receivables-klaim.spec.ts`.
 *
 * Tanpa basis data — semua tiruan.
 */

type Nota = {
  noNrt: string;
  storeId: string;
  store: { name: string; salesmanId: string | null };
  charges: { id: string; amount: number }[];
};

const state = {
  /** Potongan BKM yang lolos saringan kueri (DITETAPKAN + TOKO). */
  potongan: [] as { storeReturnId: string | null }[],
  saringan: [] as unknown[],
  nota: new Map<string, Nota>(),
  beban: new Map<string, { tertahan: number; sisaFaktur: number; tampil: number }>(),
  gagalBaca: false,
};

const kabar = vi.hoisted(() => ({ kirim: vi.fn(async (_userId: string, _isi: Record<string, unknown>) => {}) }));

vi.mock("@elorae/db", () => ({
  prisma: {
    paymentClaimDeduction: {
      findMany: vi.fn(async (args: unknown) => {
        if (state.gagalBaca) throw new Error("basis data putus");
        state.saringan.push(args);
        return state.potongan;
      }),
    },
    storeReturn: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => state.nota.get(where.id) ?? null),
    },
  },
}));
vi.mock("@/lib/notifications/kabar-pengguna", () => ({
  JENIS_KABAR: { RETUR_DITANGGUNG_TOKO: "RETUR_DITANGGUNG_TOKO" },
  kabariPengguna: kabar.kirim,
}));
vi.mock("./return-writer", () => ({
  bebanTokoDiNota: vi.fn(async (_klien: unknown, id: string) => state.beban.get(id) ?? { tertahan: 0, sisaFaktur: 0, tampil: 0 }),
}));

const { kabarBebanTokoDariKlaim } = await import("./kabar-beban-toko");

const nota = (id: string, pemegang: string | null): Nota => ({
  noNrt: `NRT-${id}`,
  storeId: "s1",
  store: { name: "Toko Uji", salesmanId: pemegang },
  charges: [{ id: `beban-${id}`, amount: 40_000 }],
});

beforeEach(() => {
  state.potongan = [];
  state.saringan = [];
  state.nota = new Map();
  state.beban = new Map();
  state.gagalBaca = false;
  kabar.kirim.mockClear();
});

describe("kabarBebanTokoDariKlaim", () => {
  it("hanya membaca potongan BKM ini yang menunjuk nota retur bersisa beban DITETAPKAN ditanggung TOKO", async () => {
    await kabarBebanTokoDariKlaim("bkm1", "keu");
    expect(state.saringan).toEqual([
      {
        where: {
          paymentClaimId: "bkm1",
          storeReturnId: { not: null },
          storeReturn: { charges: { some: { status: "DITETAPKAN", bearer: "TOKO" } } },
        },
        select: { storeReturnId: true },
      },
    ]);
    expect(kabar.kirim).not.toHaveBeenCalled();
  });

  it("mengabari pemegang toko sebesar yang tidak dikurangkan, satu kabar per nota retur", async () => {
    state.potongan = [{ storeReturnId: "r1" }, { storeReturnId: "r1" }, { storeReturnId: "r2" }];
    state.nota.set("r1", nota("r1", "sales-a"));
    state.nota.set("r2", nota("r2", "sales-a"));
    state.beban.set("r1", { tertahan: 40_000, sisaFaktur: 100_000, tampil: 40_000 });
    state.beban.set("r2", { tertahan: 25_000, sisaFaktur: 10_000, tampil: 10_000 });

    await kabarBebanTokoDariKlaim("bkm1", "keu");

    expect(kabar.kirim).toHaveBeenCalledTimes(2);
    expect(kabar.kirim).toHaveBeenNthCalledWith(1, "sales-a", {
      jenis: "RETUR_DITANGGUNG_TOKO",
      judul: "Selisih retur NRT-r1 ditanggung Toko Uji",
      isi: `${formatIDR(40_000)} tidak dikurangkan dari tagihannya; tagih saat berkunjung.`,
      data: { chargeId: "beban-r1", returnId: "r1", storeId: "s1" },
    });
    // Yang ditagih dibatasi sisa fakturnya (`tampil`), bukan seluruh yang tertahan.
    expect(kabar.kirim.mock.calls[1][1]).toMatchObject({ isi: `${formatIDR(10_000)} tidak dikurangkan dari tagihannya; tagih saat berkunjung.` });
  });

  it("dilewati bila pemegang toko sendiri yang bertindak, atau toko tanpa pemegang", async () => {
    state.potongan = [{ storeReturnId: "r1" }, { storeReturnId: "r2" }];
    state.nota.set("r1", nota("r1", "sales-a"));
    state.nota.set("r2", nota("r2", null));
    state.beban.set("r1", { tertahan: 40_000, sisaFaktur: 100_000, tampil: 40_000 });
    state.beban.set("r2", { tertahan: 40_000, sisaFaktur: 100_000, tampil: 40_000 });

    await kabarBebanTokoDariKlaim("bkm1", "sales-a");

    expect(kabar.kirim).not.toHaveBeenCalled();
  });

  it("tidak mengabari bila tidak ada lagi yang bisa ditagih di fakturnya", async () => {
    state.potongan = [{ storeReturnId: "r1" }];
    state.nota.set("r1", nota("r1", "sales-a"));
    state.beban.set("r1", { tertahan: 40_000, sisaFaktur: 0, tampil: 0 });

    await kabarBebanTokoDariKlaim("bkm1", "keu");

    expect(kabar.kirim).not.toHaveBeenCalled();
  });

  it("tidak pernah melempar: keputusan uang sudah tersimpan sebelum kabar dikirim", async () => {
    state.gagalBaca = true;
    const galat = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(kabarBebanTokoDariKlaim("bkm1", "keu")).resolves.toBeUndefined();
    expect(galat).toHaveBeenCalled();
    galat.mockRestore();
  });
});
