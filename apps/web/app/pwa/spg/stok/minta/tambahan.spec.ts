import { describe, expect, it } from "vitest";
import type { BarisPilihan } from "../barang-pilihan";
import { ambilTertunda, susunTambahan } from "./tambahan";

const pilihan = (itemId: string, sku: string, variantSku: string | null, nama: string): BarisPilihan => ({
  kunci: `${itemId}::${variantSku ?? ""}`,
  itemId,
  sku,
  variantSku,
  kode: variantSku || sku,
  nama,
  varian: variantSku,
  barcode: null,
  stok: 0,
  dilacak: false,
});

const KAOS_M = pilihan("kaos", "KAOS", "KAOS-M", "Kaos Polos");
const KAOS_L = pilihan("kaos", "KAOS", "KAOS-L", "Kaos Polos");
const TOPI = pilihan("topi", "TOPI", null, "Topi");
const SEMUA = [KAOS_M, KAOS_L, TOPI];

describe("susunTambahan", () => {
  it("an exact size and a simple item land in the list with the recorded quantity and reason", () => {
    const h = susunTambahan(
      SEMUA,
      [
        { itemId: "kaos", variantSku: "KAOS-L", qty: 2, alasan: "TITIP_PEMBELI" },
        { itemId: "topi", variantSku: "", qty: 1, alasan: "DICARI_PEMBELI" },
      ],
      new Set(),
    );
    expect(h.baris.map((b) => [b.barang.kunci, b.qty, b.alasan])).toEqual([
      ["kaos::KAOS-L", "2", "TITIP_PEMBELI"],
      ["topi::", "1", "DICARI_PEMBELI"],
    ]);
    expect(h.tertunda).toEqual([]);
    expect(h.hilang).toBe(0);
  });

  it("a sized product asked for without a size waits for the SPG to pick one, keeping quantity and reason", () => {
    const h = susunTambahan(SEMUA, [{ itemId: "kaos", variantSku: "", qty: 3, alasan: "DICARI_PEMBELI" }], new Set());
    expect(h.baris).toEqual([]);
    expect(h.tertunda).toEqual([{ itemId: "kaos", nama: "Kaos Polos", sku: "KAOS", qty: 3, alasan: "DICARI_PEMBELI" }]);
    expect(h.hilang).toBe(0);
  });

  it("goods no longer in the catalogue are counted, not silently dropped", () => {
    const h = susunTambahan(SEMUA, [{ itemId: "hilang", variantSku: "", qty: 1, alasan: "TITIP_PEMBELI" }], new Set());
    expect(h).toEqual({ baris: [], tertunda: [], hilang: 1 });
  });

  it("goods already in the saved draft are not added twice", () => {
    const h = susunTambahan(SEMUA, [{ itemId: "kaos", variantSku: "KAOS-M", qty: 4, alasan: "TITIP_PEMBELI" }], new Set(["kaos::KAOS-M"]));
    expect(h.baris).toEqual([]);
  });
});

describe("ambilTertunda", () => {
  const tertunda = [{ itemId: "kaos", nama: "Kaos Polos", sku: "KAOS", qty: 3, alasan: "DICARI_PEMBELI" as const }];

  it("picking a size of the waiting product takes its quantity and reason, once", () => {
    const h = ambilTertunda(tertunda, KAOS_M);
    expect(h.isi).toEqual({ qty: "3", alasan: "DICARI_PEMBELI" });
    expect(h.sisa).toEqual([]);
  });

  it("an unrelated pick is a plain manual pick", () => {
    const h = ambilTertunda(tertunda, TOPI);
    expect(h.isi).toEqual({ qty: "1", alasan: "MANUAL" });
    expect(h.sisa).toBe(tertunda);
  });
});
