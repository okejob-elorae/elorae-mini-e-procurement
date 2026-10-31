import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { FORMAT_RUPIAH, bukuKerjaLaporan, formatAngkaLembar, lembarLaporan } from "./excel";

describe("lembarLaporan", () => {
  it("rupiah memakai format negatif dalam kurung; persen disimpan sebagai pecahan", () => {
    const ws = lembarLaporan([["Akun", "Jumlah", "%"], ["Kas", -350000, { persen: 12.5 }], ["Lain", null, { persen: null }]]);
    expect(ws.B2).toMatchObject({ t: "n", v: -350000, z: FORMAT_RUPIAH });
    expect(ws.C2).toMatchObject({ t: "n", v: 0.125 });
    expect(ws.B3).toBeUndefined();
    expect(ws.C3).toMatchObject({ t: "s", v: "—" });
    expect(ws["!ref"]).toBe("A1:C3");
  });

  it("rasio dan hari", () => {
    const ws = lembarLaporan([[{ rasio: 1.5 }, { hari: 44.6 }, { rasio: null }]]);
    expect(ws.A1).toMatchObject({ t: "n", v: 1.5 });
    expect(ws.B1).toMatchObject({ t: "n", v: 45 });
    expect(ws.C1).toMatchObject({ t: "s", v: "—" });
  });
});

describe("formatAngkaLembar", () => {
  it("memberi format rupiah pada sel angka lembar biasa", () => {
    const ws = XLSX.utils.aoa_to_sheet([["a", 1, -2]]);
    formatAngkaLembar(ws);
    expect((ws.B1 as XLSX.CellObject).z).toBe(FORMAT_RUPIAH);
    expect((ws.A1 as XLSX.CellObject).z).toBeUndefined();
  });
});

describe("bukuKerjaLaporan", () => {
  it("menghasilkan xlsx yang bisa dibaca kembali dengan format angka", () => {
    const { base64, filename } = bukuKerjaLaporan([{ nama: "Uji", baris: [["Kas", -1000]] }], "uji.xlsx");
    expect(filename).toBe("uji.xlsx");
    const wb = XLSX.read(Buffer.from(base64, "base64"), { type: "buffer", cellNF: true });
    const sel = wb.Sheets.Uji.B1 as XLSX.CellObject;
    expect(sel.v).toBe(-1000);
    expect(sel.z).toBe(FORMAT_RUPIAH);
  });
});
