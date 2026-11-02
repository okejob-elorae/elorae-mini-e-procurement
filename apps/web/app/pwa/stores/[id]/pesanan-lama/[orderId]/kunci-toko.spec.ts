import { isValidElement, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Halaman "konfirmasi barang pesanan lama sampai" untuk salesman (`/pwa/stores/<id>/pesanan-lama/<orderId>`).
 *
 * Kunci "hanya toko sendiri" (`salesman.tokoTerkunci`) berlaku di sini seperti di halaman toko dan
 * subhalamannya: saat menyala, salesman yang bukan pemegang toko melihat BukanTokoSaya dan baris
 * pesanannya (nama barang, varian, pcs) TIDAK dibaca. SPG toko ini diarahkan ke layarnya sendiri
 * di bawah Terima kiriman. Tanpa basis data — semua tiruan.
 */

const state = vi.hoisted(() => ({
  sesi: null as { user: { id: string; permissions: string[] } } | null,
  tokoTetap: null as string | null,
  terkunci: false,
  pemegang: "sales-1" as string | null,
  jumlahSpg: 0,
  aktifDi: null as string | null,
  pesananToko: "toko-1",
  dibaca: [] as string[],
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => state.sesi) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  },
  notFound: () => {
    throw new Error("__NOT_FOUND__");
  },
}));
vi.mock("@elorae/db", () => ({
  prisma: {
    storeOpname: {
      findFirst: vi.fn(async () => {
        state.dibaca.push("storeOpname");
        return null;
      }),
    },
  },
}));
vi.mock("@/lib/pwa/peran", () => ({ ambilTokoTetap: vi.fn(async () => state.tokoTetap) }));
vi.mock("@/lib/salesman/queries", () => ({ tokoTerkunci: vi.fn(async () => state.terkunci) }));
vi.mock("@/lib/stores/queries", () => ({
  getStore: vi.fn(async (id: string) =>
    id === "toko-1" ? { id, name: "Toko Satu", salesmanId: state.pemegang, termsType: "KONSI" as const } : null,
  ),
  getActiveVisit: vi.fn(async () => (state.aktifDi ? { id: "v-1", storeId: state.aktifDi } : null)),
}));
vi.mock("@/lib/field-sales/konsi-transfer/pesanan-lama", () => ({
  muatPesananKonsiCadanganLama: vi.fn(async (_klien: unknown, orderId: string) => {
    state.dibaca.push(`pesanan:${orderId}`);
    return {
      orderId,
      orderNo: "KONSI/2026/0007",
      storeId: state.pesananToko,
      salesmanId: "sales-1",
      approvedAt: new Date("2026-08-10T03:00:00.000Z"),
      createdAt: new Date("2026-08-09T03:00:00.000Z"),
      baris: [{ lineId: "l-1", itemId: "i-1", variantSku: "KAOS-M", productName: "Kaos Uji", sisa: 6 }],
      jumlahPcs: 6,
    };
  }),
  muatPenerimaToko: vi.fn(async () => {
    state.dibaca.push("penerima");
    return {
      penerima: state.jumlahSpg > 0 ? "SPG" : state.pemegang ? "SALESMAN" : "TANPA_PENERIMA",
      pemegangTokoId: state.pemegang,
      namaPemegang: null,
      jumlahSpg: state.jumlahSpg,
    };
  }),
}));

// Komponen klien tidak dirender — yang diuji hanya pagar dan isi props-nya.
vi.mock("@/app/pwa/stores/[id]/BukanTokoSaya", () => ({
  BukanTokoSaya: function BukanTokoSaya() {
    return null;
  },
}));
vi.mock("@/app/pwa/stores/[id]/pesanan-lama/[orderId]/FormSampaiPesananLama", () => ({
  FormSampaiPesananLama: function FormSampaiPesananLama() {
    return null;
  },
}));

const halaman = (await import("@/app/pwa/stores/[id]/pesanan-lama/[orderId]/page")).default;
const buka = (id: string, orderId: string) => halaman({ params: Promise.resolve({ id, orderId }) });

function namaKomponen(node: unknown): string | null {
  if (!isValidElement(node)) return null;
  const tipe = (node as ReactElement).type as { name?: string } | string;
  return typeof tipe === "string" ? null : (tipe?.name ?? null);
}

beforeEach(() => {
  state.sesi = { user: { id: "sales-1", permissions: ["pwa:access"] } };
  state.tokoTetap = null;
  state.terkunci = false;
  state.pemegang = "sales-1";
  state.jumlahSpg = 0;
  state.aktifDi = null;
  state.pesananToko = "toko-1";
  state.dibaca = [];
});

describe("konfirmasi pesanan lama oleh salesman — kunci toko sendiri", () => {
  it("kunci menyala, salesman bukan pemegang: BukanTokoSaya, baris pesanan tidak dibaca", async () => {
    state.sesi = { user: { id: "sales-9", permissions: ["pwa:access"] } };
    state.terkunci = true;
    const hasil = await buka("toko-1", "o-1");
    expect(namaKomponen(hasil)).toBe("BukanTokoSaya");
    expect(state.dibaca).toEqual([]);
  });

  it("kunci menyala, toko tanpa pemegang tertutup untuk semua salesman", async () => {
    state.terkunci = true;
    state.pemegang = null;
    const hasil = await buka("toko-1", "o-1");
    expect(namaKomponen(hasil)).toBe("BukanTokoSaya");
    expect(state.dibaca).toEqual([]);
  });

  it("kunci menyala, pemegang toko tanpa SPG: formulir hitung tanpa harga, tanpa penghalang", async () => {
    state.terkunci = true;
    state.aktifDi = "toko-1";
    const hasil = await buka("toko-1", "o-1");
    expect(namaKomponen(hasil)).toBe("FormSampaiPesananLama");
    const props = (hasil as ReactElement<Record<string, unknown>>).props;
    expect(props).toMatchObject({ peran: "SALESMAN", sudahCheckIn: true, penghalang: null, kembaliKe: "/pwa/stores/toko-1" });
    expect(props.pesanan).toMatchObject({
      orderId: "o-1",
      orderNo: "KONSI/2026/0007",
      baris: [{ lineId: "l-1", productName: "Kaos Uji", variantSku: "KAOS-M", sisa: 6 }],
    });
    expect(JSON.stringify(props.pesanan)).not.toMatch(/harga|price|total|subtotal/i);
  });

  it("kunci mati: salesman lain boleh membuka (seperti halaman toko), tetapi diberi tahu bukan pemegang", async () => {
    state.sesi = { user: { id: "sales-9", permissions: ["pwa:access"] } };
    const hasil = await buka("toko-1", "o-1");
    expect(namaKomponen(hasil)).toBe("FormSampaiPesananLama");
    expect((hasil as ReactElement<Record<string, unknown>>).props.penghalang).toBe("BUKAN_PEMEGANG");
  });

  it("toko ber-SPG: pemegang pun diberi tahu bahwa SPG yang mengonfirmasi", async () => {
    state.jumlahSpg = 1;
    const hasil = await buka("toko-1", "o-1");
    expect((hasil as ReactElement<Record<string, unknown>>).props.penghalang).toBe("TOKO_BER_SPG");
  });

  it("pesanan milik toko lain tidak dibuka lewat alamat toko ini", async () => {
    state.pesananToko = "toko-lain";
    const hasil = await buka("toko-1", "o-1");
    expect((hasil as ReactElement<Record<string, unknown>>).props.pesanan).toBeNull();
    expect(state.dibaca).not.toContain("storeOpname");
  });

  it("SPG toko ini diarahkan ke layarnya sendiri sebelum apa pun dibaca", async () => {
    state.sesi = { user: { id: "spg-1", permissions: ["pwa:access", "spg_sales:record"] } };
    state.tokoTetap = "toko-1";
    await expect(buka("toko-1", "o-1")).rejects.toThrow("__REDIRECT__:/pwa/spg/terima/pesanan-lama/o-1");
    expect(state.dibaca).toEqual([]);
  });

  it("toko yang tidak ada: tidak ditemukan", async () => {
    await expect(buka("toko-hilang", "o-1")).rejects.toThrow("__NOT_FOUND__");
    expect(state.dibaca).toEqual([]);
  });
});
