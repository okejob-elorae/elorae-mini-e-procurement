import { describe, expect, it } from "vitest";
import type { AuditLabelTranslator } from "./action-label";
import { barisPerubahan, labelKolomAudit, nilaiTampil } from "./rincian-perubahan";

function fakeTranslator(messages: Record<string, string>): AuditLabelTranslator {
  const t = ((key: string) => {
    const message = messages[key];
    if (message === undefined) throw new Error(`missing key ${key}`);
    return message;
  }) as AuditLabelTranslator;
  t.has = (key: string) => key in messages;
  return t;
}

describe("barisPerubahan", () => {
  it("returns nothing for an empty log", () => {
    expect(barisPerubahan(null)).toEqual([]);
    expect(barisPerubahan(undefined)).toEqual([]);
  });

  it("splits the after-only shape from the audit report into one row per field", () => {
    // Bentuk persis dari temuan audit: hanya "after", dengan id cuid di dalamnya.
    const rows = barisPerubahan({
      after: { amount: 200000, storeId: "cmuw5d3qp003hdq1nddtzyax1", invoiceNo: "BEBAN/BTP-6ipnht-NRT-18" },
    });
    expect(rows.map((r) => r.kunci)).toEqual(["amount", "storeId", "invoiceNo"]);
    expect(rows.every((r) => !r.adaSebelum && r.adaSesudah && !r.berubah)).toBe(true);
    expect(rows[0].sesudah).toBe(200000);
  });

  it("pairs before and after field by field and marks what changed", () => {
    const rows = barisPerubahan({
      before: { status: "DRAFT", qty: 5 },
      after: { status: "SUBMITTED", qty: 5, note: "ok" },
    });
    expect(rows).toEqual([
      { kunci: "status", sebelum: "DRAFT", sesudah: "SUBMITTED", adaSebelum: true, adaSesudah: true, berubah: true },
      { kunci: "qty", sebelum: 5, sesudah: 5, adaSebelum: true, adaSesudah: true, berubah: false },
      { kunci: "note", sebelum: undefined, sesudah: "ok", adaSebelum: false, adaSesudah: true, berubah: false },
    ]);
  });

  it("keeps a scalar before/after as a single row", () => {
    expect(barisPerubahan({ before: "A", after: "B" })).toEqual([
      { kunci: "", sebelum: "A", sesudah: "B", adaSebelum: true, adaSesudah: true, berubah: true },
    ]);
  });

  it("flattens one nesting level with a dotted key", () => {
    const rows = barisPerubahan({ after: { dates: { invoiceDate: "2026-10-01", dueDate: "2026-10-31" } } });
    expect(rows.map((r) => r.kunci)).toEqual(["dates.invoiceDate", "dates.dueDate"]);
  });

  it("reads the { field: { from, to } } shape", () => {
    const rows = barisPerubahan({ price: { from: 100, to: 120 }, name: { old: "A", new: "B" } });
    expect(rows.map((r) => [r.kunci, r.sebelum, r.sesudah, r.berubah])).toEqual([
      ["price", 100, 120, true],
      ["name", "A", "B", true],
    ]);
  });

  it("treats any other object as after-only rows, and a bare value as one row", () => {
    expect(barisPerubahan({ a: 1 })).toEqual([
      { kunci: "a", sebelum: undefined, sesudah: 1, adaSebelum: false, adaSesudah: true, berubah: false },
    ]);
    expect(barisPerubahan("x")[0]).toMatchObject({ kunci: "", sesudah: "x", adaSesudah: true });
  });
});

describe("nilaiTampil", () => {
  it("classifies values so the screen never prints raw JSON for simple fields", () => {
    expect(nilaiTampil(null)).toEqual({ jenis: "kosong" });
    expect(nilaiTampil("")).toEqual({ jenis: "kosong" });
    expect(nilaiTampil(true)).toEqual({ jenis: "yaTidak", nilai: true });
    expect(nilaiTampil(200000)).toEqual({ jenis: "angka", nilai: 200000 });
    expect(nilaiTampil("cmuw5d3qp003hdq1nddtzyax1")).toEqual({ jenis: "id", teks: "cmuw5d3qp003hdq1nddtzyax1" });
    expect(nilaiTampil("2026-10-01")).toEqual({ jenis: "tanggal", teks: "2026-10-01", denganJam: false });
    expect(nilaiTampil("2026-10-01T03:00:00.000Z")).toMatchObject({ jenis: "tanggal", denganJam: true });
    expect(nilaiTampil("BEBAN/BTP-6ipnht-NRT-18")).toEqual({ jenis: "teks", teks: "BEBAN/BTP-6ipnht-NRT-18" });
    expect(nilaiTampil(["a", 1])).toEqual({ jenis: "daftar", isi: ["a", "1"] });
    expect(nilaiTampil([{ a: 1 }])).toEqual({ jenis: "json", teks: '[{"a":1}]' });
  });

  it("does not mistake an ordinary lowercase word for an id", () => {
    expect(nilaiTampil("catatan").jenis).toBe("teks");
  });
});

describe("labelKolomAudit", () => {
  const t = fakeTranslator({ "fields.storeId": "Toko", "fields.value": "Nilai", "fields.dates": "Tanggal" });

  it("uses the translated field name, else a humanised one", () => {
    expect(labelKolomAudit(t, "storeId")).toBe("Toko");
    expect(labelKolomAudit(t, "invoiceNo")).toBe("Invoice no");
    expect(labelKolomAudit(t, "")).toBe("Nilai");
  });

  it("labels each segment of a dotted key", () => {
    expect(labelKolomAudit(t, "dates.storeId")).toBe("Tanggal › Toko");
  });
});
