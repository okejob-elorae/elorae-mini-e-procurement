import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Pagar aksi BACA produksi (`app/actions/production.ts`) dan HPP
 * (`app/actions/hpp.ts`). Setiap ekspor `"use server"` adalah titik akhir yang
 * bisa dipanggil siapa pun yang sudah masuk — dulu aksi-aksi ini tidak memeriksa
 * apa pun, jadi akun salesman/SPG bisa membaca perintah kerja, biaya bahan, nota
 * CMT, dan HPP per barang.
 *
 * Tanpa basis data: `prisma` diganti tiruan yang menghitung setiap pembacaan.
 * Yang dibuktikan: yang tidak berhak ditolak SEBELUM satu kueri berjalan, dan
 * yang berhak (termasuk admin wildcard) tetap sampai ke basis data. Aksi yang
 * dengan id fiktif melempar galat domain ("tidak ditemukan") dinilai dari apakah
 * kuerinya sempat berjalan, bukan dari nilai kembaliannya.
 */

const state = vi.hoisted(() => ({
  sesi: null as { user: { id: string; permissions: string[] } } | null,
  dibaca: 0,
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => state.sesi) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

vi.mock("@elorae/db", async (importOriginal) => {
  const asli = await importOriginal<Record<string, unknown>>();
  const hasilKosong = (op: string) =>
    op === "findMany" || op === "groupBy" ? [] : op === "count" ? 0 : op === "aggregate" ? { _sum: {} } : null;
  const model = new Proxy(
    {},
    {
      get: (_t, op) =>
        typeof op === "string" && op !== "then"
          ? async () => {
              state.dibaca += 1;
              return hasilKosong(op);
            }
          : undefined,
    },
  );
  const prisma = new Proxy(
    {},
    {
      get: (_t, nama) => {
        if (typeof nama !== "string" || nama === "then") return undefined;
        if (nama.startsWith("$")) {
          return async () => {
            state.dibaca += 1;
            return [];
          };
        }
        return model;
      },
    },
  );
  return { ...asli, prisma };
});

const produksi = await import("./production");
const hpp = await import("./hpp");

const TIDAK_ADA = "izin-baca-produksi-tidak-ada";

/** Aksi baca perintah kerja beserta izin yang sah untuknya. */
const AKSI: Array<{ nama: string; panggil: () => Promise<unknown>; sah: string[][] }> = [
  {
    nama: "getWorkOrderById",
    panggil: () => produksi.getWorkOrderById(TIDAK_ADA),
    sah: [["work_orders:view"]],
  },
  {
    // Halaman retur pemasok memuat daftar WO untuk pilihannya.
    nama: "getWorkOrders",
    panggil: () => produksi.getWorkOrders(),
    sah: [["work_orders:view"], ["vendor_returns:view"]],
  },
  {
    nama: "getWorkOrderRollAllocationStatus",
    panggil: () => produksi.getWorkOrderRollAllocationStatus(TIDAK_ADA),
    sah: [["work_orders:view"]],
  },
  {
    nama: "getAdditionalMaterialsPreview",
    panggil: () => produksi.getAdditionalMaterialsPreview(TIDAK_ADA, 1),
    sah: [["work_orders:view"], ["work_orders:manage"]],
  },
  {
    nama: "computePlannedQtyFromConsumption",
    panggil: () => produksi.computePlannedQtyFromConsumption(TIDAK_ADA, TIDAK_ADA, 10),
    sah: [["work_orders:view"], ["work_orders:create"]],
  },
  {
    nama: "getMaterialPlan",
    panggil: () => produksi.getMaterialPlan(TIDAK_ADA, 1),
    sah: [["work_orders:view"], ["work_orders:create"]],
  },
  {
    nama: "getAvailableFabricRolls",
    panggil: () => produksi.getAvailableFabricRolls(TIDAK_ADA),
    sah: [["work_orders:view"], ["work_orders:create"], ["work_orders:manage"]],
  },
  {
    nama: "suggestFabricRollAllocation",
    panggil: () => produksi.suggestFabricRollAllocation(TIDAK_ADA, 5),
    sah: [["work_orders:view"], ["work_orders:create"], ["work_orders:manage"]],
  },
  {
    nama: "getBahanWo",
    panggil: () => produksi.getBahanWo(TIDAK_ADA),
    sah: [["work_orders:view"], ["work_orders:manage"]],
  },
  {
    // Pratinjau biaya penerimaan (bahan + ongkos jahit): izin yang sama dengan menerima barang jadi.
    nama: "getDasarBiayaPenerimaan",
    panggil: () => produksi.getDasarBiayaPenerimaan(TIDAK_ADA),
    sah: [["work_orders:manage"]],
  },
  {
    nama: "getReconciliation",
    panggil: () => produksi.getReconciliation(TIDAK_ADA),
    sah: [["work_orders:view"]],
  },
  {
    // Register nota CMT punya izinnya sendiri.
    nama: "getMaterialIssuesForCMTRegister",
    panggil: () => produksi.getMaterialIssuesForCMTRegister({ vendorId: TIDAK_ADA }),
    sah: [["work_orders:view"], ["nota_register:view"]],
  },
  {
    nama: "getMaterialIssueForPrint",
    panggil: () => produksi.getMaterialIssueForPrint(TIDAK_ADA),
    sah: [["work_orders:view"], ["nota_register:view"]],
  },
  {
    nama: "getProductionStats",
    panggil: () => produksi.getProductionStats(),
    sah: [["work_orders:view"]],
  },
  {
    nama: "calculateHPP",
    panggil: () => hpp.calculateHPP(TIDAK_ADA),
    sah: [["reports_hpp:view"]],
  },
  {
    nama: "getHPPList",
    panggil: () => hpp.getHPPList({ finishedGoodId: TIDAK_ADA }),
    sah: [["reports_hpp:view"]],
  },
  {
    nama: "getHPPListLegacy",
    panggil: () => hpp.getHPPListLegacy(),
    sah: [["reports_hpp:view"]],
  },
  {
    // Dipakai penulis retur pemasok untuk menilai barang jadi reject.
    nama: "getEffectiveHPPForItem",
    panggil: () => hpp.getEffectiveHPPForItem(TIDAK_ADA),
    sah: [["reports_hpp:view"], ["vendor_returns:create"], ["vendor_returns:manage"]],
  },
];

/** Bukan orang produksi/HPP. */
const LUAR: Array<[string, string[]]> = [
  ["salesman", ["pwa:access"]],
  ["SPG", ["pwa:access", "spg_sales:record"]],
  ["gudang", ["dashboard:view", "inventory:view", "sales_orders:view"]],
];

/** Galat otorisasi — yang lain (mis. "Work Order not found") berarti pagar sudah dilewati. */
const GALAT_IZIN = /Unauthorized|Forbidden/;

async function jalankan(panggil: () => Promise<unknown>): Promise<unknown> {
  try {
    await panggil();
    return null;
  } catch (e) {
    return e;
  }
}

beforeEach(() => {
  state.sesi = null;
  state.dibaca = 0;
});

describe("aksi baca produksi & HPP — pagar izin", () => {
  for (const a of AKSI) {
    describe(a.nama, () => {
      it("menolak tanpa sesi sebelum membaca data", async () => {
        await expect(a.panggil()).rejects.toThrow(/Unauthorized/);
        expect(state.dibaca).toBe(0);
      });

      for (const [peran, izin] of LUAR) {
        it(`menolak ${peran} sebelum membaca data`, async () => {
          state.sesi = { user: { id: "u1", permissions: izin } };
          await expect(a.panggil()).rejects.toThrow(/Forbidden/);
          expect(state.dibaca).toBe(0);
        });
      }

      for (const izin of [...a.sah, ["*"]]) {
        it(`tetap boleh untuk ${izin.join("+")}`, async () => {
          state.sesi = { user: { id: "u1", permissions: izin } };
          const galat = await jalankan(a.panggil);
          expect(String(galat ?? "")).not.toMatch(GALAT_IZIN);
          expect(state.dibaca).toBeGreaterThan(0);
        });
      }
    });
  }
});
