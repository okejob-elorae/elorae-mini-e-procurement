import { describe, expect, it } from "vitest";
import {
  bagianKurangPerjalanan,
  kalimatBelumDikirimGudang,
  kalimatKurangPerjalanan,
  rangkaiDalamBatas,
  sisaBarisPesanan,
  sisaPesanan,
  teksPembawa,
  teksYangDicek,
  type InfoAntaran,
  type PengirimanAntaran,
} from "./antaran";

/*
 * Kurang di perjalanan vs belum dikirim gudang (keputusan pemilik 2026-11-01).
 * Contoh pemilik: pesanan konsi 100 pcs, antaran pertama 60. Yang tiba 57 →
 * kurang 3 DI PERJALANAN (cek pengantar). 40 sisanya BELUM DIKIRIM GUDANG —
 * tidak pernah kurang dan tidak pernah barang hilang.
 */

const budi: PengirimanAntaran = {
  id: "shp-1",
  docNo: "DLV/2026/11/0001",
  cara: "SALESMAN_CARRY",
  pengantar: "Budi",
  ekspedisi: null,
  resi: null,
  adaBuktiSerahTerima: true,
};

const jne: PengirimanAntaran = {
  id: "shp-2",
  docNo: "DLV/2026/11/0002",
  cara: "EXPEDITION",
  pengantar: null,
  ekspedisi: "JNE",
  resi: "JNE123",
  adaBuktiSerahTerima: false,
};

const info = (pengiriman: PengirimanAntaran | null, belumDikirimGudang = 40): InfoAntaran => ({
  orderId: "o1",
  orderNo: "KONSI/2026/11/0012",
  pengiriman,
  belumDikirimGudang,
  dalamPengirimanLain: 0,
});

describe("sisa pesanan per tempat", () => {
  it("splits what is left into packed, on the road and not yet sent by the warehouse", () => {
    const s = sisaBarisPesanan({ id: "l1", qty: 100, deliveredQty: 60, cancelledQty: 0 }, [
      { status: "IN_TRANSIT", lines: [{ orderLineId: "l1", plannedQty: 30 }] },
      { status: "PACKED", lines: [{ orderLineId: "l1", plannedQty: 5 }, { orderLineId: "lain", plannedQty: 9 }] },
      { status: "DELIVERED", lines: [{ orderLineId: "l1", plannedQty: 60 }] },
    ]);
    expect(s).toEqual({ sisa: 40, dalamPerjalanan: 30, dikemas: 5, belumDikirimGudang: 5 });
  });

  it("a remainder closed by the office leaves nothing anywhere", () => {
    expect(sisaBarisPesanan({ id: "l1", qty: 100, deliveredQty: 60, cancelledQty: 40 }, [])).toEqual({
      sisa: 0,
      dalamPerjalanan: 0,
      dikemas: 0,
      belumDikirimGudang: 0,
    });
  });

  it("never goes negative when a shipment plans more than is left", () => {
    const s = sisaBarisPesanan({ id: "l1", qty: 5, deliveredQty: 0, cancelledQty: 0 }, [
      { status: "IN_TRANSIT", lines: [{ orderLineId: "l1", plannedQty: 4 }] },
      { status: "PACKED", lines: [{ orderLineId: "l1", plannedQty: 4 }] },
    ]);
    expect(s).toEqual({ sisa: 5, dalamPerjalanan: 4, dikemas: 1, belumDikirimGudang: 0 });
  });

  it("a line without an id has no shipments to match — everything left is still at the warehouse", () => {
    expect(sisaBarisPesanan({ qty: 3, deliveredQty: 1, cancelledQty: 0 }, [{ status: "IN_TRANSIT", lines: [{ orderLineId: "x", plannedQty: 2 }] }])).toEqual({
      sisa: 2,
      dalamPerjalanan: 0,
      dikemas: 0,
      belumDikirimGudang: 2,
    });
  });

  it("sums over an order's lines", () => {
    const s = sisaPesanan(
      [
        { id: "a", qty: 10, deliveredQty: 4, cancelledQty: 0 },
        { id: "b", qty: 6, deliveredQty: 0, cancelledQty: 1 },
      ],
      [{ status: "IN_TRANSIT", lines: [{ orderLineId: "a", plannedQty: 6 }, { orderLineId: "b", plannedQty: 2 }] }],
    );
    expect(s).toEqual({ sisa: 11, dalamPerjalanan: 8, dikemas: 0, belumDikirimGudang: 3 });
  });
});

describe("siapa yang dicek", () => {
  it("names the carrier, or the courier with its tracking number", () => {
    expect(teksPembawa(budi)).toBe("Budi");
    expect(teksPembawa(jne)).toBe("JNE resi JNE123");
    expect(teksPembawa({ ...jne, ekspedisi: null })).toBe("resi JNE123");
    expect(teksPembawa({ ...budi, pengantar: "  " })).toBeNull();
    expect(teksYangDicek(budi)).toBe("pengantar Budi");
    expect(teksYangDicek(jne)).toBe("ekspedisi JNE resi JNE123");
    expect(teksYangDicek({ ...jne, ekspedisi: null, resi: null })).toBe("ekspedisinya");
  });
});

describe("kalimat kurang di perjalanan", () => {
  it("says who to check FIRST, then what the warehouse sent in THIS shipment and what arrived — and that the handover photo exists", () => {
    const k = kalimatKurangPerjalanan({ dikirim: 60, diterima: 57, kurang: 3 }, info(budi));
    expect(k).toBe(
      "Kurang di perjalanan — cek ke pengantar Budi. Gudang mengirim 60 pcs di DLV/2026/11/0001, tiba 57. " +
        "Foto serah terima ada di pengiriman itu.",
    );
    // Sisa pesanan yang belum dikirim gudang TIDAK ikut dihitung kurang.
    expect(k).not.toContain("40");
  });

  it("courier: names the courier and tracking number; no photo, no photo claim", () => {
    expect(kalimatKurangPerjalanan({ dikirim: 40, diterima: 38, kurang: 2 }, info(jne))).toBe(
      "Kurang di perjalanan — cek ke ekspedisi JNE resi JNE123. Gudang mengirim 40 pcs di DLV/2026/11/0002, tiba 38.",
    );
  });

  it("the parts come apart for a notice that has to fit 191 characters; the short count is not repeated (the title has it)", () => {
    expect(bagianKurangPerjalanan({ dikirim: 40, diterima: 38, kurang: 2 }, info(jne))).toEqual({
      cek: "Kurang di perjalanan — cek ke ekspedisi JNE resi JNE123.",
      rincian: "Gudang mengirim 40 pcs di DLV/2026/11/0002, tiba 38.",
      bukti: null,
      docNo: "DLV/2026/11/0002",
    });
    expect(bagianKurangPerjalanan({ dikirim: 40, diterima: 38, kurang: 2 }, info(jne))?.cek).not.toMatch(/\b2 pcs/);
  });

  it("nothing short, or no shipment to name, says nothing", () => {
    expect(kalimatKurangPerjalanan({ dikirim: 60, diterima: 60, kurang: 0 }, info(budi))).toBeNull();
    expect(kalimatKurangPerjalanan({ dikirim: 6, diterima: 5, kurang: 1 }, info(null))).toBeNull();
    expect(kalimatKurangPerjalanan({ dikirim: 6, diterima: 5, kurang: 1 }, null)).toBeNull();
    expect(bagianKurangPerjalanan({ dikirim: 6, diterima: 5, kurang: 1 }, null)).toBeNull();
  });

  it("never carries a price", () => {
    const k = kalimatKurangPerjalanan({ dikirim: 60, diterima: 57, kurang: 3 }, info(budi)) ?? "";
    expect(k).not.toMatch(/Rp/);
  });
});

describe("rangkaiDalamBatas", () => {
  it("keeps every part that fits, in order", () => {
    expect(rangkaiDalamBatas(["Satu.", null, "Dua.", undefined, "", "Tiga."], 50)).toBe("Satu. Dua. Tiga.");
  });

  it("skips a part that does not fit WHOLE instead of cutting it, and still takes a later one that does", () => {
    expect(rangkaiDalamBatas(["Cek resi 123.", "Kalimat yang terlalu panjang untuk muat.", "Foto ada."], 25)).toBe("Cek resi 123. Foto ada.");
  });

  it("takes the first alternative that fits", () => {
    expect(rangkaiDalamBatas(["Cek.", ["Toko Melati Jaya: tiba 57 dari 60.", "Tiba 57 dari 60."]], 25)).toBe("Cek. Tiba 57 dari 60.");
  });

  it("the first part always goes in, so the cap shortens it rather than the notice coming out empty", () => {
    expect(rangkaiDalamBatas([["a".repeat(30), "b".repeat(20)], "Foto."], 10)).toBe("b".repeat(20));
  });

  it("counts code points, like the notice cap", () => {
    const emoji = "\u{1F600}";
    expect(rangkaiDalamBatas([emoji.repeat(4), "ab"], 7)).toBe(`${emoji.repeat(4)} ab`);
    expect(rangkaiDalamBatas([emoji.repeat(4), "abc"], 7)).toBe(emoji.repeat(4));
  });
});

describe("kalimat belum dikirim gudang", () => {
  it("names the order's remainder as not a shortfall", () => {
    expect(kalimatBelumDikirimGudang(info(budi, 40))).toBe(
      "Sisa pesanan KONSI/2026/11/0012 sebanyak 40 pcs belum dikirim gudang — itu bukan kekurangan, cek ke gudang.",
    );
    expect(kalimatBelumDikirimGudang(info(budi, 0))).toBeNull();
    expect(kalimatBelumDikirimGudang(null)).toBeNull();
  });
});
