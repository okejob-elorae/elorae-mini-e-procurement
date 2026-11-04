import { describe, it, expect } from "vitest";
import type { DataBayarInvoice, PenerimaanInvoice, InvoiceUntukBayar } from "@/lib/vendor-billing/invoice-bayar-queries";
import { catatanDariInvoice, isiDariInvoice, ringkasInvoiceTerpilih, terapkanPilihanInvoice } from "./bayar-dari-invoice";

const inv = (id: string, no: string, penerimaan: string[], over: Partial<InvoiceUntukBayar> = {}): InvoiceUntukBayar => ({
  id,
  docNumber: `VB-${id}`,
  vendorInvoiceNo: no,
  billDate: "2026-11-03",
  createdAt: "2026-11-03T00:00:00.000Z",
  total: 0,
  paidAmount: 0,
  status: "UNPAID",
  penerimaan,
  koreksi: [],
  ...over,
});

const pen = (kunci: string, over: Partial<PenerimaanInvoice> = {}): PenerimaanInvoice => ({
  kunci,
  jenis: kunci.startsWith("GRN") ? "GRN" : "WO_STEP",
  id: kunci.slice(kunci.indexOf("|") + 1),
  nomor: kunci,
  poNomor: null,
  adaHutang: true,
  hutangSen: 0,
  lunasSen: 0,
  sisaSen: 0,
  baris: [],
  koreksiMenunggu: [],
  poDitandaiLunas: false,
  qtyBelumDitagih: 0,
  ...over,
});

describe("isiDariInvoice", () => {
  it("INV-77 billing the Jahit step of two WOs fills both steps", () => {
    const d: DataBayarInvoice = {
      invoice: [inv("b77", "INV-77", ["WO_STEP|s1", "WO_STEP|s2"])],
      penerimaan: [
        pen("WO_STEP|s1", { hutangSen: 70_000_000, sisaSen: 70_000_000, baris: [{ billId: "b77", urutan: 0, tercatatSen: 70_000_000 }] }),
        pen("WO_STEP|s2", { hutangSen: 35_000_000, sisaSen: 35_000_000, baris: [{ billId: "b77", urutan: 0, tercatatSen: 35_000_000 }] }),
      ],
      nomorInvoice: { b77: "INV-77" },
    };
    const r = isiDariInvoice(d, new Set(["b77"]));
    expect(r.get("WO_STEP|s1")?.isiSen).toBe(70_000_000);
    expect(r.get("WO_STEP|s2")?.isiSen).toBe(35_000_000);
  });

  // R8's example: GRN-1 holds A (INV-11, accepted +50.000 → 850.000) and B (INV-12, 200.000), 1.050.000 owed in all.
  const grn1 = (lunasSen: number, urut: [string, string]) =>
    pen("GRN|g1", {
      hutangSen: 105_000_000,
      sisaSen: 105_000_000 - lunasSen,
      lunasSen,
      baris: [
        { billId: urut[0], urutan: 0, tercatatSen: urut[0] === "b11" ? 85_000_000 : 20_000_000 },
        { billId: urut[1], urutan: 1, tercatatSen: urut[1] === "b11" ? 85_000_000 : 20_000_000 },
      ],
    });

  it("ticking only INV-11 with nothing paid fills 850.000, never item B", () => {
    const d: DataBayarInvoice = { invoice: [inv("b11", "INV-11", ["GRN|g1"]), inv("b12", "INV-12", ["GRN|g1"])], penerimaan: [grn1(0, ["b11", "b12"])], nomorInvoice: { b11: "INV-11", b12: "INV-12" } };
    expect(isiDariInvoice(d, new Set(["b11"])).get("GRN|g1")).toEqual({ isiSen: 85_000_000, ikutInvoiceLebihDulu: [], terhalang: null });
  });

  it("an older unpaid invoice on the same receipt is included and named; two ticked invoices fill once", () => {
    const d: DataBayarInvoice = { invoice: [inv("b11", "INV-11", ["GRN|g1"]), inv("b12", "INV-12", ["GRN|g1"])], penerimaan: [grn1(0, ["b12", "b11"])], nomorInvoice: { b11: "INV-11", b12: "INV-12" } };
    expect(isiDariInvoice(d, new Set(["b11"])).get("GRN|g1")).toEqual({ isiSen: 105_000_000, ikutInvoiceLebihDulu: ["INV-12"], terhalang: null });
    expect(isiDariInvoice(d, new Set(["b11", "b12"])).get("GRN|g1")?.isiSen).toBe(105_000_000);
  });

  it("holds rows it must not fill", () => {
    const base = { invoice: [inv("b1", "INV-1", ["GRN|g1"])], nomorInvoice: { b1: "INV-1" } };
    const satu = (over: Partial<PenerimaanInvoice>) =>
      isiDariInvoice({ ...base, penerimaan: [pen("GRN|g1", { hutangSen: 100, sisaSen: 100, baris: [{ billId: "b1", urutan: 0, tercatatSen: 100 }], ...over })] }, new Set(["b1"])).get("GRN|g1");
    expect(satu({ koreksiMenunggu: [{ billId: "b1", vendorInvoiceNo: "INV-1" }] })?.terhalang).toBe("KOREKSI_MENUNGGU");
    expect(satu({ poDitandaiLunas: true })?.terhalang).toBe("PO_DITANDAI_LUNAS");
    expect(satu({ adaHutang: false })?.terhalang).toBe("BELUM_JADI_HUTANG");
    expect(satu({ lunasSen: 100, sisaSen: 0 })?.terhalang).toBe("LUNAS");
    expect(satu({ sisaSen: 40 })).toEqual({ isiSen: 40, ikutInvoiceLebihDulu: [], terhalang: "DIBATASI_SISA" });
    expect(satu({ koreksiMenunggu: [{ billId: "b1", vendorInvoiceNo: "INV-1" }] })?.isiSen).toBe(0);
  });
});

describe("terapkanPilihanInvoice", () => {
  it("fills empty rows, keeps typed rows, and unticking clears only untouched rows", () => {
    const pertama = terapkanPilihanInvoice({ bayar: { a: "", b: "5000" }, isiSebelum: {}, isiBaru: new Map([["a", 1_000_000], ["b", 2_000_000]]) });
    expect(pertama.bayar).toEqual({ a: "10000", b: "5000" });
    expect(pertama.isi).toEqual({ a: "10000" });
    const kosong = terapkanPilihanInvoice({ bayar: pertama.bayar, isiSebelum: pertama.isi, isiBaru: new Map() });
    expect(kosong.bayar).toEqual({ a: "", b: "5000" });
    const diubah = terapkanPilihanInvoice({ bayar: { a: "9000" }, isiSebelum: { a: "10000" }, isiBaru: new Map() });
    expect(diubah.bayar).toEqual({ a: "9000" });
  });
});

describe("ringkasInvoiceTerpilih / catatanDariInvoice", () => {
  it("sums the ticked invoices on the payable basis and prefills the note", () => {
    const d: DataBayarInvoice = {
      invoice: [inv("b1", "INV-1", ["GRN|g1"], { total: 8_000, koreksi: [{ id: "k", status: "MENUNGGU", jumlahSen: 50_000 }] }), inv("b2", "INV-2", ["GRN|g2"], { total: 1_000 })],
      penerimaan: [pen("GRN|g1", { baris: [{ billId: "b1", urutan: 0, tercatatSen: 888_000 }] }), pen("GRN|g2", { baris: [{ billId: "b2", urutan: 0, tercatatSen: 100_000 }] })],
      nomorInvoice: {},
    };
    const r = ringkasInvoiceTerpilih(d, new Set(["b1", "b2"]), { "GRN|g1": "8880", "GRN|g2": "" });
    expect(r).toMatchObject({ totalInvoiceDicatatSen: 900_000, utangTercatatSen: 988_000, selisihMenungguSen: 50_000, diisiSen: 888_000 });
    expect(catatanDariInvoice(d, new Set(["b1", "b2"]))).toBe("Pembayaran invoice INV-1, INV-2");
  });
});
