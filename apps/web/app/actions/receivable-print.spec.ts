import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Pagar baca halaman cetak piutang (`/print/bkm|retur|faktur|konsi/[id]`).
 *
 * Halaman cetaknya komponen klien; datanya lewat aksi server di sini. Aksi ini
 * dulu hanya menuntut sudah masuk, jadi siapa pun yang punya akun — salesman,
 * SPG, produksi — mencetak BKM, nota retur, faktur, dan siklus konsinyasi
 * (lengkap dengan harga titipan dan gaji/komisi SPG) toko mana pun cukup dengan
 * mengetik alamatnya. Penolakan mengembalikan `null`, sama seperti dokumen yang
 * tidak ada: halaman cetak menampilkan "tidak ditemukan" dan tidak membocorkan
 * bahwa dokumennya ada.
 *
 * Tanpa basis data — semua tiruan.
 */

const state = {
  sesi: null as { user: { id: string; permissions: string[] } } | null,
  dibaca: 0,
};

const baca = <T,>(nilai: T) =>
  vi.fn(async () => {
    state.dibaca += 1;
    return nilai;
  });

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => state.sesi) }));
vi.mock("@/lib/receivables/return-queries", () => ({ rincianRetur: baca({ id: "nrt1" }) }));
vi.mock("@/lib/receivables/claim-queries", () => ({ rincianKlaim: baca({ id: "bkm1" }) }));
vi.mock("@/lib/konsinyasi/queries", () => ({ rincianSiklus: baca({ id: "sk1" }) }));
vi.mock("@elorae/db", () => ({
  prisma: {
    receivable: {
      findUnique: baca({
        invoiceNo: "INV-1",
        invoiceDate: new Date("2026-09-01T00:00:00Z"),
        dueDate: new Date("2026-10-01T00:00:00Z"),
        amount: 100_000,
        outstanding: 40_000,
        store: { name: "Toko A", address: null },
        salesman: null,
        items: [],
      }),
    },
  },
}));

const { ambilCetakFaktur, ambilCetakKlaim, ambilCetakRetur, ambilCetakSiklus } = await import("./receivable-print");

const LUAR: [string, string[]][] = [
  ["salesman", ["pwa:access"]],
  ["SPG", ["pwa:access", "spg_sales:record"]],
  ["produksi", ["dashboard:view", "work_orders:view", "inventory_opname:view"]],
  ["pembelian", ["dashboard:view", "purchase_orders:view"]],
];

const CETAK: { nama: string; ambil: () => Promise<unknown>; sah: string[][]; tidakSah: string[][] }[] = [
  {
    nama: "BKM",
    ambil: () => ambilCetakKlaim("bkm1"),
    sah: [["receivables:view"], ["receivables:manage"], ["journals:manage"]],
    tidakSah: [["inventory_opname:count"], ["consignment:view"]],
  },
  {
    nama: "nota retur",
    ambil: () => ambilCetakRetur("nrt1"),
    sah: [["receivables:view"], ["inventory_opname:count"], ["journals:manage"]],
    tidakSah: [["consignment:view"]],
  },
  {
    nama: "faktur",
    ambil: () => ambilCetakFaktur("inv1"),
    sah: [["receivables:view"], ["receivables:manage"]],
    tidakSah: [["journals:manage"], ["inventory_opname:count"], ["consignment:view"]],
  },
  {
    // Membuka harga konsinyasi dan gaji/komisi SPG: hanya pemegang izin
    // konsinyasi — BUKAN orang piutang (lihat `bolehMembukaKonsi`).
    nama: "siklus konsinyasi",
    ambil: () => ambilCetakSiklus("sk1"),
    sah: [["consignment:view"]],
    tidakSah: [["receivables:view"], ["receivables:manage"], ["journals:manage"]],
  },
];

beforeEach(() => {
  state.sesi = null;
  state.dibaca = 0;
});

describe("cetak piutang — pagar baca", () => {
  for (const c of CETAK) {
    describe(c.nama, () => {
      it("returns nothing to a signed-out visitor", async () => {
        expect(await c.ambil()).toBeNull();
        expect(state.dibaca).toBe(0);
      });

      for (const [peran, izin] of LUAR) {
        it(`returns nothing to ${peran}, without reading the document`, async () => {
          state.sesi = { user: { id: "u1", permissions: izin } };
          expect(await c.ambil()).toBeNull();
          expect(state.dibaca).toBe(0);
        });
      }

      for (const izin of c.tidakSah) {
        it(`returns nothing to ${izin.join("+")}`, async () => {
          state.sesi = { user: { id: "u1", permissions: izin } };
          expect(await c.ambil()).toBeNull();
          expect(state.dibaca).toBe(0);
        });
      }

      for (const izin of [...c.sah, ["*"]]) {
        it(`returns the document to ${izin.join("+")}`, async () => {
          state.sesi = { user: { id: "u1", permissions: izin } };
          expect(await c.ambil()).not.toBeNull();
          expect(state.dibaca).toBe(1);
        });
      }
    });
  }
});
