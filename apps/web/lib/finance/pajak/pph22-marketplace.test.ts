import { describe, expect, it } from "vitest";
import { kolomPph22, pph22DariSettlement } from "./pph22-marketplace";

describe("PPh 22 marketplace dari berkas settlement", () => {
  it("mengenali nama kolom PPh 22 dalam berbagai ejaan, bukan kolom lain", () => {
    expect(kolomPph22({ "PPh Pasal 22": -500 })).toBe("PPh Pasal 22");
    expect(kolomPph22({ "Pajak PPh 22 (0,5%)": -500 })).toBe("Pajak PPh 22 (0,5%)");
    expect(kolomPph22({ "pph22": 1 })).toBe("pph22");
    expect(kolomPph22({ "PPh 23": 1, "Biaya Layanan": 2 })).toBeNull();
    expect(kolomPph22({ "PPh 221": 1 })).toBeNull();
    expect(kolomPph22("bukan objek")).toBeNull();
  });

  it("menjumlah besaran dari baris Income (negatif di berkas → positif), mengutamakan baris", () => {
    const r = pph22DariSettlement(
      [{ "No. Pesanan": "A", "PPh Pasal 22": -500 }, { "No. Pesanan": "B", "PPh Pasal 22": "-250.5" }, { "No. Pesanan": "C" }],
      { "Total PPh 22": -99999 },
    );
    expect(r).toEqual({ nilai: 750.5, sumber: "BARIS", kolom: "PPh Pasal 22" });
  });

  it("jatuh ke ringkasan bila baris tidak punya kolomnya; tanpa kolom sama sekali → 0", () => {
    expect(pph22DariSettlement([{ a: 1 }], JSON.stringify({ "PPh 22": -1200 }))).toEqual({ nilai: 1200, sumber: "RINGKASAN", kolom: "PPh 22" });
    expect(pph22DariSettlement([{ a: 1 }], { b: 2 })).toEqual({ nilai: 0, sumber: null, kolom: null });
  });
});
