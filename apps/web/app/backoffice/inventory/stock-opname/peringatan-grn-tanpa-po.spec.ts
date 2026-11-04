import { describe, expect, it } from "vitest";
import { peringatanGrnTanpaPoTampil } from "./peringatan-grn-tanpa-po";

// GRN tanpa PO yang menunggu konfirmasi: barangnya di rak tetapi belum masuk stok, jadi
// penyetuju harus melihat peringatannya SEBELUM menyetujui surplus opname.

describe("peringatan GRN tanpa PO di rincian opname", () => {
  it("tampil selama opname masih bisa disetujui", () => {
    for (const status of ["CREATED", "COUNTING", "SUBMITTED"]) {
      expect(peringatanGrnTanpaPoTampil(status)).toBe(true);
    }
  });

  it("hilang sesudah opname disetujui atau dibatalkan", () => {
    expect(peringatanGrnTanpaPoTampil("APPROVED")).toBe(false);
    expect(peringatanGrnTanpaPoTampil("CANCELLED")).toBe(false);
  });
});
