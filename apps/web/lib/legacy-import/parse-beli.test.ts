import { describe, expect, it } from "vitest";
import { excelSerialToWibDate, groupBeliNotas, parseBeliMatrix } from "./parse-beli";

const HEADER = ["", "TRANSAKSI", "PERIODE", "KODETR", "", "NO TR", "TGL", "NO NOTA", "KODE BARANG ", "NAMA BARANG ", "SUPLLIER", "SAT", "SIZE", "QTY BELI", "HARGA BELI", "TOTAL", "NOTED"];
const row = (tgl: unknown, nota: unknown, kode: string, supplier: string, qty: unknown, price: unknown) =>
  ["", "BELI", "", "", "", 1, tgl, nota, kode, `${kode.trim()} NAME`, supplier, "PCS", "0", qty, price, 0, ""];

describe("excelSerialToWibDate", () => {
  it("maps a workbook day to WIB midnight of that day", () => {
    expect(excelSerialToWibDate(45505).toISOString()).toBe("2024-07-31T17:00:00.000Z");
  });
});

describe("parseBeliMatrix", () => {
  it("reads lines by header name, trailing spaces included", () => {
    const { lines, skipped } = parseBeliMatrix([HEADER, row(45505, 4, " LABEL SIZE S ", "WELLWISH ", 1600, 224)]);
    expect(skipped).toEqual([]);
    expect(lines).toEqual([
      {
        excelRow: 2,
        nota: "4",
        date: excelSerialToWibDate(45505),
        kode: "LABEL SIZE S",
        nama: "LABEL SIZE S NAME",
        supplier: "WELLWISH",
        sat: "PCS",
        qty: 1600,
        price: 224,
      },
    ]);
  });

  it("ignores blank rows and reports lines it cannot import", () => {
    const { lines, skipped } = parseBeliMatrix([
      HEADER,
      [],
      row("", "", "", "", "", ""),
      row(45505, 7, "NYLON KHAKY", "SSG", 50, ""),
      row(45505, "", "PLASTIK", "SSG", 10, 387),
      row(45505, 8, "PLASTIK", "SSG", 0, 387),
    ]);
    expect(lines).toEqual([]);
    expect(skipped).toEqual([
      { excelRow: 4, reason: "NO_PRICE" },
      { excelRow: 5, reason: "NO_NOTA" },
      { excelRow: 6, reason: "NO_QTY" },
    ]);
  });
});

describe("groupBeliNotas", () => {
  it("orders notas by date, then nota number, and keeps their lines", () => {
    const { lines } = parseBeliMatrix([
      HEADER,
      row(45510, 10, "A", "SSG", 1, 1),
      row(45505, 9, "B", "SSG", 1, 1),
      row(45505, 2, "C", "WELLWISH", 1, 1),
      row(45505, 2, "D", "WELLWISH", 1, 1),
    ]);
    const { notas, conflicts } = groupBeliNotas(lines);
    expect(conflicts).toEqual([]);
    expect(notas.map((n) => [n.nota, n.supplier, n.lines.map((l) => l.kode)])).toEqual([
      ["2", "WELLWISH", ["C", "D"]],
      ["9", "SSG", ["B"]],
      ["10", "SSG", ["A"]],
    ]);
  });

  it("flags a nota whose lines disagree on supplier or date", () => {
    const { lines } = parseBeliMatrix([HEADER, row(45505, 3, "A", "SSG", 1, 1), row(45506, 3, "B", "JAYA", 1, 1)]);
    const { notas, conflicts } = groupBeliNotas(lines);
    expect(notas).toEqual([]);
    expect(conflicts).toEqual(["3"]);
  });
});
