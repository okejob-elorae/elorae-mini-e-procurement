import { describe, expect, it } from "vitest";
import { ringkasAktivitasPemasok, type PoAktivitas, type SpkAktivitas } from "./aktivitas";

const HARI_INI = new Date("2026-10-07T00:00:00+07:00");
const tgl = (s: string) => new Date(`${s}T00:00:00+07:00`);

function po(p: Partial<PoAktivitas> & { supplierId: string }): PoAktivitas {
  return {
    id: "po",
    status: "SUBMITTED",
    etaDate: null,
    paymentDueDate: null,
    paidAt: null,
    createdAt: tgl("2026-09-01"),
    grandTotal: 1_000_000,
    ppnRatePercent: null,
    closedAt: null,
    items: [{ qty: 10, receivedQty: 0, price: 100_000, ppnIncluded: true }],
    ...p,
  };
}

function spk(s: Partial<SpkAktivitas> & { vendorId: string }): SpkAktivitas {
  return { status: "IN_PRODUCTION", plannedQty: 100, targetDate: null, createdAt: tgl("2026-09-15"), ...s };
}

const SEMUA = { lihatPo: true, lihatUtang: true, lihatSpk: true };

describe("ringkasAktivitasPemasok", () => {
  it("counts open POs, flags the late ones and gives the nearest upcoming arrival", () => {
    const r = ringkasAktivitasPemasok({
      supplierIds: ["a"],
      po: [
        po({ supplierId: "a", etaDate: tgl("2026-10-01") }),
        po({ supplierId: "a", status: "PARTIAL", etaDate: tgl("2026-10-20") }),
        po({ supplierId: "a", status: "PARTIAL", etaDate: tgl("2026-10-12") }),
        po({ supplierId: "a", status: "CLOSED", etaDate: tgl("2026-09-01") }),
        po({ supplierId: "a", status: "DRAFT", etaDate: tgl("2026-09-01") }),
      ],
      spk: [],
      kredit: new Map(),
      terakhirPembelian: new Map(),
      terakhirSpk: new Map(),
      awalHariIni: HARI_INI,
      ...SEMUA,
    });
    expect(r.a.po).toEqual({ terbuka: 3, terlambat: 1, tibaTerdekat: tgl("2026-10-12").toISOString() });
  });

  it("an arrival due today is not late", () => {
    const r = ringkasAktivitasPemasok({
      supplierIds: ["a"],
      po: [po({ supplierId: "a", etaDate: HARI_INI })],
      spk: [],
      kredit: new Map(),
      terakhirPembelian: new Map(),
      terakhirSpk: new Map(),
      awalHariIni: HARI_INI,
      ...SEMUA,
    });
    expect(r.a.po?.terlambat).toBe(0);
    expect(r.a.po?.tibaTerdekat).toBe(HARI_INI.toISOString());
  });

  it("payable is only goods already received on unpaid POs, minus the return credit", () => {
    const r = ringkasAktivitasPemasok({
      supplierIds: ["a"],
      po: [
        // 4 of 10 received at 100k → 400k received, credit 50k → 350k
        po({
          supplierId: "a",
          id: "p1",
          status: "PARTIAL",
          paymentDueDate: tgl("2026-10-10"),
          items: [{ qty: 10, receivedQty: 4, price: 100_000, ppnIncluded: true }],
        }),
        // paid: never payable
        po({
          supplierId: "a",
          id: "p2",
          status: "CLOSED",
          paidAt: tgl("2026-09-20"),
          items: [{ qty: 5, receivedQty: 5, price: 100_000, ppnIncluded: true }],
          grandTotal: 500_000,
        }),
        // nothing received yet: commitment, not payable
        po({ supplierId: "a", id: "p3" }),
      ],
      spk: [],
      kredit: new Map([["p1", 50_000]]),
      terakhirPembelian: new Map(),
      terakhirSpk: new Map(),
      awalHariIni: HARI_INI,
      ...SEMUA,
    });
    expect(r.a.utang).toEqual({ nilai: 350_000, jatuhTempo: tgl("2026-10-10").toISOString(), lewatTempo: false });
  });

  it("a due date before today on goods still owed is overdue", () => {
    const r = ringkasAktivitasPemasok({
      supplierIds: ["a"],
      po: [
        po({
          supplierId: "a",
          status: "CLOSED",
          paymentDueDate: tgl("2026-10-01"),
          items: [{ qty: 1, receivedQty: 1, price: 250_000, ppnIncluded: true }],
          grandTotal: 250_000,
        }),
      ],
      spk: [],
      kredit: new Map(),
      terakhirPembelian: new Map(),
      terakhirSpk: new Map(),
      awalHariIni: HARI_INI,
      ...SEMUA,
    });
    expect(r.a.utang?.lewatTempo).toBe(true);
  });

  it("counts running work orders at the tailor, their pieces and the late ones", () => {
    const r = ringkasAktivitasPemasok({
      supplierIds: ["j"],
      po: [],
      spk: [
        spk({ vendorId: "j", plannedQty: 240, targetDate: tgl("2026-10-01") }),
        spk({ vendorId: "j", status: "ISSUED", plannedQty: 240.4, targetDate: tgl("2026-10-30") }),
        spk({ vendorId: "j", status: "COMPLETED", plannedQty: 500 }),
        spk({ vendorId: "j", status: "DRAFT", plannedQty: 500 }),
      ],
      kredit: new Map(),
      terakhirPembelian: new Map(),
      terakhirSpk: new Map(),
      awalHariIni: HARI_INI,
      ...SEMUA,
    });
    expect(r.j.spk).toEqual({ berjalan: 2, pcs: 480, terlambat: 1 });
  });

  it("last activity is the newest PO, work order or receipt, ignoring drafts and cancelled ones", () => {
    const r = ringkasAktivitasPemasok({
      supplierIds: ["a", "b"],
      po: [
        po({ supplierId: "a", createdAt: tgl("2026-09-01") }),
        po({ supplierId: "a", status: "CANCELLED", createdAt: tgl("2026-10-05") }),
      ],
      spk: [spk({ vendorId: "a", status: "DRAFT", createdAt: tgl("2026-10-06") })],
      kredit: new Map(),
      terakhirPembelian: new Map([["a", tgl("2026-09-20")]]),
      terakhirSpk: new Map(),
      awalHariIni: HARI_INI,
      ...SEMUA,
    });
    expect(r.a.terakhir).toBe(tgl("2026-09-20").toISOString());
    expect(r.b).toEqual({ po: { terbuka: 0, terlambat: 0, tibaTerdekat: null }, spk: { berjalan: 0, pcs: 0, terlambat: 0 }, utang: { nilai: 0, jatuhTempo: null, lewatTempo: false }, terakhir: null });
  });

  it("hides each part the viewer may not see, and last activity only uses what they may see", () => {
    const r = ringkasAktivitasPemasok({
      supplierIds: ["a"],
      po: [po({ supplierId: "a", createdAt: tgl("2026-10-01"), items: [{ qty: 1, receivedQty: 1, price: 9, ppnIncluded: true }] })],
      spk: [spk({ vendorId: "a", createdAt: tgl("2026-09-01") })],
      kredit: new Map(),
      terakhirPembelian: new Map([["a", tgl("2026-10-02")]]),
      terakhirSpk: new Map([["a", tgl("2026-09-03")]]),
      awalHariIni: HARI_INI,
      lihatPo: false,
      lihatUtang: false,
      lihatSpk: true,
    });
    expect(r.a.po).toBeNull();
    expect(r.a.utang).toBeNull();
    expect(r.a.spk).toEqual({ berjalan: 1, pcs: 100, terlambat: 0 });
    expect(r.a.terakhir).toBe(tgl("2026-09-03").toISOString());
  });
});
