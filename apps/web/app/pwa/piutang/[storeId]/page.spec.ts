import { isValidElement, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Layar tagihan satu toko di HP salesman membaca kontrabon berjalannya dengan MENYEBUT siapa yang
 * melihat. Kontrabon yang memegang tagihan konsinyasi hanya untuk pemegang toko sekarang (P31,
 * Q13); `janjiBerjalanDiToko` tanpa penonton menyembunyikan semuanya, jadi pemegang toko melihat
 * tagihan konsinya tetapi tidak kontrabon yang menahannya. Aturan kuerinya sendiri dikunci
 * `tagihan-konsi-hp.test.ts`; di sini hanya bahwa halaman meneruskan penggunanya. Tanpa basis data.
 */

const h = vi.hoisted(() => ({
  sesi: null as { user: { id: string; permissions: string[] } } | null,
  tokoTetap: null as string | null,
  fakturToko: vi.fn(),
  janjiBerjalanDiToko: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => h.sesi) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  },
  notFound: () => {
    throw new Error("__NOT_FOUND__");
  },
}));
vi.mock("@/lib/pwa/peran", () => ({ ambilTokoTetap: vi.fn(async () => h.tokoTetap) }));
vi.mock("@/lib/receivables/pwa-queries", () => ({
  fakturToko: h.fakturToko,
  janjiBerjalanDiToko: h.janjiBerjalanDiToko,
}));
vi.mock("./FakturTokoClient", () => ({ FakturTokoClient: () => null }));

import FakturTokoPage from "./page";

const buka = (storeId: string) => FakturTokoPage({ params: Promise.resolve({ storeId }) });

beforeEach(() => {
  vi.clearAllMocks();
  h.sesi = { user: { id: "sales-1", permissions: ["pwa:access"] } };
  h.tokoTetap = null;
  h.fakturToko.mockResolvedValue({ storeName: "Toko Maju", baris: [] });
  h.janjiBerjalanDiToko.mockResolvedValue([
    {
      id: "kb-1",
      docNo: "KB/2026/0001",
      promisedDate: "2026-11-10T00:00:00.000Z",
      receivedBy: "Bu Ani",
      nilai: 1_250_000,
      jumlahFaktur: 2,
      dariLapangan: true,
      dikonfirmasi: false,
    },
  ]);
});

describe("halaman tagihan toko di HP salesman", () => {
  it("membaca kontrabon berjalan atas nama pengguna yang membuka halaman (P31)", async () => {
    const hasil = (await buka("toko-1")) as ReactElement<{ janji: Array<{ docNo: string; nilai: string }> }>;
    expect(h.janjiBerjalanDiToko).toHaveBeenCalledTimes(1);
    expect(h.janjiBerjalanDiToko).toHaveBeenCalledWith("toko-1", "sales-1");
    expect(h.fakturToko).toHaveBeenCalledWith("sales-1", "toko-1");
    expect(isValidElement(hasil)).toBe(true);
    expect(hasil.props.janji.map((j) => j.docNo)).toEqual(["KB/2026/0001"]);
  });

  it("SPG (toko tetap) dikembalikan ke berandanya sebelum tagihan apa pun dibaca", async () => {
    h.tokoTetap = "toko-spg";
    await expect(buka("toko-1")).rejects.toThrow("__REDIRECT__:/pwa");
    expect(h.janjiBerjalanDiToko).not.toHaveBeenCalled();
    expect(h.fakturToko).not.toHaveBeenCalled();
  });
});
