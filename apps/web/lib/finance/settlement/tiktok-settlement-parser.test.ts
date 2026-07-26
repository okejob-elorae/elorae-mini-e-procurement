import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseTiktokSettlement } from "./tiktok-settlement-parser";

// Synthetic fixture only — never read/commit the real gitignored income excel
// (reference/finance/*). Columns mirror the spec's confirmed findings; the
// "Waktu" column is a stand-in for whatever date-typed column the real
// export carries (unconfirmed name) so the period-derivation heuristic has
// something to scan.
const DETAIL_HEADER = [
  "ID Pesanan/Penyesuaian",
  "Jumlah penyelesaian pembayaran",
  "Total Pendapatan",
  "Total Biaya",
  "Jumlah penyesuaian",
  "ID pesanan terkait",
  "Sumber pesanan",
  "Waktu",
];

function buildWorkbook(detailRows: unknown[][], includeLaporan = false): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(detailRows), "Detail pesanan");
  if (includeLaporan) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([["Total Pendapatan", 100000], ["Total Biaya", 40000]]),
      "Laporan",
    );
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("parseTiktokSettlement (synthetic workbook)", () => {
  it("parses per-order lines from Detail pesanan and derives aggregated totals", () => {
    const buf = buildWorkbook([
      DETAIL_HEADER,
      [
        "584771788142839379",
        18000,
        20000,
        -2000,
        0,
        "584771788142839379",
        "TikTok Shop",
        new Date(Date.UTC(2026, 5, 3)),
      ],
      [
        "584771788142839380",
        9000,
        10000,
        -1000,
        0,
        "584771788142839380",
        "TikTok Shop",
        new Date(Date.UTC(2026, 5, 10)),
      ],
      [
        "584771788142839381",
        4500,
        5000,
        -500,
        0,
        "584771788142839381",
        "TikTok Shop",
        new Date(Date.UTC(2026, 5, 20)),
      ],
    ]);

    const res = parseTiktokSettlement(buf);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const d = res.data;

    expect(d.incomeLines).toHaveLength(3);
    expect(d.incomeLines.map((l) => l.orderNo)).toEqual([
      "584771788142839379",
      "584771788142839380",
      "584771788142839381",
    ]);
    // netIncome is the only Shopee-shaped column TikTok populates — the rest stay 0.
    expect(d.incomeLines[0]).toMatchObject({
      netIncome: 18000,
      hargaAsliProduk: 0,
      totalDiskonProduk: 0,
      biayaAdministrasi: 0,
      biayaLayanan: 0,
      biayaKomisiAms: 0,
      biayaProsesPesanan: 0,
    });
    // full row preserved in raw for audit, including the fee-breakdown columns
    // not mapped onto the shared shape.
    expect(d.incomeLines[0].raw["Total Pendapatan"]).toBe(20000);
    expect(d.incomeLines[0].raw["Sumber pesanan"]).toBe("TikTok Shop");

    // derived totals
    expect(d.summary.totalDilepas).toBe(18000 + 9000 + 4500);
    expect(d.summary.totalPendapatan).toBe(20000 + 10000 + 5000);
    expect(d.summary.totalPengeluaran).toBe(-2000 + -1000 + -500);

    // checksum: parsedNetTotal == totalDilepas (persist.ts:16)
    expect(d.parsedNetTotal).toBe(d.summary.totalDilepas);

    // period derived from the date-typed cells found in the data rows
    expect(d.periodFrom).toBe("2026-06-03");
    expect(d.periodTo).toBe("2026-06-20");
    expect(d.seller).toBe("TikTok Shop");
  });

  it("is unaffected by an optional Laporan sheet (per-order aggregation is authoritative)", () => {
    const buf = buildWorkbook(
      [
        DETAIL_HEADER,
        [
          "111",
          1000,
          1200,
          -200,
          0,
          "111",
          "TikTok Shop",
          new Date(Date.UTC(2026, 6, 1)),
        ],
      ],
      true,
    );

    const res = parseTiktokSettlement(buf);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.summary.totalDilepas).toBe(1000);
    expect(res.data.parsedNetTotal).toBe(1000);
  });

  it("returns ok:false when the Detail pesanan sheet is missing", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["x"]]), "Some Other Sheet");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

    const res = parseTiktokSettlement(buf);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors[0].sheet).toBe("Detail pesanan");
  });

  it("returns ok:false when the header row is present but has no order rows", () => {
    const buf = buildWorkbook([DETAIL_HEADER]);
    const res = parseTiktokSettlement(buf);
    expect(res.ok).toBe(false);
  });

  it("returns ok:false when the net-income column is missing from the header", () => {
    const wb = XLSX.utils.book_new();
    const badHeader = DETAIL_HEADER.filter((h) => h !== "Jumlah penyelesaian pembayaran");
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([badHeader, ["111", 20000, -2000, 0, "111", "TikTok Shop"]]),
      "Detail pesanan",
    );
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

    const res = parseTiktokSettlement(buf);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors.some((e) => e.message.includes("Jumlah penyelesaian pembayaran"))).toBe(true);
  });
});
