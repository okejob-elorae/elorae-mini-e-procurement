import { describe, expect, it } from "vitest";
import { qtySudahAdaPoPerKategori, totalSudahAdaPo, type SimpulKategori } from "./sudah-ada-po";

const simpul = (id: string, children: SimpulKategori[] = []): SimpulKategori => ({ id, children });

describe("qtySudahAdaPoPerKategori", () => {
  // KAOS (induk) → KAOS-PDK, KAOS-PJG; CELANA tanpa anak; JAKET tanpa tahap ber-PO.
  const pohon = [simpul("kaos", [simpul("kaos-pdk"), simpul("kaos-pjg", [simpul("kaos-pjg-anak")])]), simpul("celana"), simpul("jaket")];

  it("menjumlah per kategori; induk = jumlah semua turunan (berapa pun dalamnya)", () => {
    const hasil = qtySudahAdaPoPerKategori(pohon, [
      { planCategoryId: "kaos-pdk", targetQty: 1200 },
      { planCategoryId: "kaos-pdk", targetQty: 300 },
      { planCategoryId: "kaos-pjg-anak", targetQty: 500 },
      { planCategoryId: "celana", targetQty: 800 },
    ]);
    expect(Object.fromEntries(hasil)).toEqual({
      kaos: 2000,
      "kaos-pdk": 1500,
      "kaos-pjg": 500,
      "kaos-pjg-anak": 500,
      celana: 800,
      jaket: 0,
    });
    expect(totalSudahAdaPo(pohon, hasil)).toBe(2800);
  });

  it("tahap langsung di induk ikut terhitung; tanpa tahap ber-PO semuanya 0", () => {
    const hasil = qtySudahAdaPoPerKategori(pohon, [
      { planCategoryId: "kaos", targetQty: 100 },
      { planCategoryId: "kaos-pjg", targetQty: 50 },
    ]);
    expect(hasil.get("kaos")).toBe(150);
    expect(hasil.get("kaos-pjg")).toBe(50);
    const kosong = qtySudahAdaPoPerKategori(pohon, []);
    expect([...kosong.values()].every((n) => n === 0)).toBe(true);
    expect(totalSudahAdaPo(pohon, kosong)).toBe(0);
  });

  it("tahap di kategori di luar pohon tidak ikut total", () => {
    const hasil = qtySudahAdaPoPerKategori(pohon, [{ planCategoryId: "lain", targetQty: 999 }]);
    expect(hasil.has("lain")).toBe(false);
    expect(totalSudahAdaPo(pohon, hasil)).toBe(0);
  });
});
