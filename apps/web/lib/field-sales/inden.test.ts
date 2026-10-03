import { describe, it, expect } from "vitest";
import {
  keadaanJendela,
  periksaPesananInden,
  validasiJendela,
  rentangTanggal,
  ringkasPesananJendela,
  barisPerluDicadangkan,
  bolehRilis,
  bolehDiubah,
  isianTanggal,
  bacaIdInden,
} from "./inden";

const wib = (s: string) => new Date(`${s}+07:00`);

const jendela = (o: Partial<{ opensAt: Date; closesAt: Date; isActive: boolean; releasedAt: Date | null }> = {}) => ({
  opensAt: wib("2026-10-01T00:00:00.000"),
  closesAt: wib("2026-10-15T23:59:59.999"),
  isActive: true,
  releasedAt: null,
  ...o,
});

describe("keadaanJendela", () => {
  it("BELUM_BUKA sebelum tanggal buka", () => {
    expect(keadaanJendela(jendela(), wib("2026-09-30T23:59:59.000"))).toBe("BELUM_BUKA");
  });
  it("BUKA tepat pada saat buka dan selama rentang", () => {
    expect(keadaanJendela(jendela(), wib("2026-10-01T00:00:00.000"))).toBe("BUKA");
    expect(keadaanJendela(jendela(), wib("2026-10-15T23:00:00.000"))).toBe("BUKA");
  });
  it("TUTUP begitu lewat tanggal tutup (batasnya eksklusif)", () => {
    expect(keadaanJendela(jendela(), wib("2026-10-15T23:59:59.999"))).toBe("TUTUP");
    expect(keadaanJendela(jendela(), wib("2026-10-20T10:00:00.000"))).toBe("TUTUP");
  });
  it("DIRILIS menang atas apa pun, juga atas nonaktif dan tanggal", () => {
    const releasedAt = wib("2026-10-10T08:00:00.000");
    expect(keadaanJendela(jendela({ releasedAt }), wib("2026-10-05T00:00:00.000"))).toBe("DIRILIS");
    expect(keadaanJendela(jendela({ releasedAt, isActive: false }), wib("2026-10-05T00:00:00.000"))).toBe("DIRILIS");
  });
  it("NONAKTIF menang atas tanggal selama belum dirilis", () => {
    expect(keadaanJendela(jendela({ isActive: false }), wib("2026-10-05T00:00:00.000"))).toBe("NONAKTIF");
  });
});

describe("periksaPesananInden", () => {
  const now = wib("2026-10-05T10:00:00.000");
  const barangJendela = new Set(["A", "B"]);
  it("null (boleh) untuk toko PUTUS, jendela BUKA, semua barang di jendela", () => {
    expect(periksaPesananInden({ jendela: jendela(), termsType: "PUTUS", barangJendela, barangPesanan: ["A", "B", "A"], now })).toBeNull();
  });
  it("KONSI ditolak lebih dulu dari apa pun", () => {
    expect(periksaPesananInden({ jendela: null, termsType: "KONSI", barangJendela, barangPesanan: ["A"], now })).toBe("KONSI");
  });
  it("jendela yang tidak ada", () => {
    expect(periksaPesananInden({ jendela: null, termsType: "PUTUS", barangJendela, barangPesanan: ["A"], now })).toBe("TIDAK_ADA");
  });
  it("jendela yang tidak BUKA menolak dengan keadaannya", () => {
    expect(periksaPesananInden({ jendela: jendela(), termsType: "PUTUS", barangJendela, barangPesanan: ["A"], now: wib("2026-10-16T00:00:00.000") })).toBe("TUTUP");
    expect(periksaPesananInden({ jendela: jendela(), termsType: "PUTUS", barangJendela, barangPesanan: ["A"], now: wib("2026-09-01T00:00:00.000") })).toBe("BELUM_BUKA");
    expect(periksaPesananInden({ jendela: jendela({ releasedAt: now }), termsType: "PUTUS", barangJendela, barangPesanan: ["A"], now })).toBe("DIRILIS");
    expect(periksaPesananInden({ jendela: jendela({ isActive: false }), termsType: "PUTUS", barangJendela, barangPesanan: ["A"], now })).toBe("NONAKTIF");
  });
  it("satu barang di luar jendela menolak seluruh pesanan", () => {
    expect(periksaPesananInden({ jendela: jendela(), termsType: "PUTUS", barangJendela, barangPesanan: ["A", "Z"], now })).toBe("BARANG_LUAR");
  });
  it("pesanan tanpa baris ditolak sebagai barang luar, bukan diloloskan", () => {
    expect(periksaPesananInden({ jendela: jendela(), termsType: "PUTUS", barangJendela, barangPesanan: [], now })).toBe("BARANG_LUAR");
  });
});

describe("validasiJendela", () => {
  const sah = {
    name: "  Koleksi Lebaran  ",
    note: "  Gelombang pertama ",
    opensOn: "2026-10-01",
    closesOn: "2026-10-15",
    shipFrom: "2026-11-10",
    shipTo: "2026-11-20",
    isActive: true,
    items: [
      { itemId: "A", plannedQty: 120 },
      { itemId: "B", plannedQty: null },
    ],
  };

  it("menerima masukan yang benar dan menambatkan tanggal ke WIB", () => {
    const r = validasiJendela(sah);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.name).toBe("Koleksi Lebaran");
    expect(r.data.note).toBe("Gelombang pertama");
    expect(r.data.opensAt.toISOString()).toBe(wib("2026-10-01T00:00:00.000").toISOString());
    // Tanggal tutup INKLUSIF: seluruh hari 15 Okt WIB masih menerima pesanan.
    expect(r.data.closesAt.toISOString()).toBe(wib("2026-10-15T23:59:59.999").toISOString());
    expect(r.data.shipFrom!.toISOString()).toBe(wib("2026-11-10T00:00:00.000").toISOString());
    expect(r.data.shipTo!.toISOString()).toBe(wib("2026-11-20T00:00:00.000").toISOString());
    expect(r.data.items).toEqual([
      { itemId: "A", plannedQty: 120 },
      { itemId: "B", plannedQty: null },
    ]);
  });

  it("buka dan tutup pada hari yang sama itu sah (jendela satu hari)", () => {
    const r = validasiJendela({ ...sah, closesOn: "2026-10-01" });
    expect(r.ok).toBe(true);
  });

  it("catatan kosong menjadi null; rentang kirim boleh kosong sebagian atau seluruhnya", () => {
    const r = validasiJendela({ ...sah, note: "   ", shipFrom: "", shipTo: null });
    expect(r.ok && r.data.note).toBe(null);
    expect(r.ok && r.data.shipFrom).toBe(null);
    expect(r.ok && r.data.shipTo).toBe(null);
    const hanyaSampai = validasiJendela({ ...sah, shipFrom: "", shipTo: "2026-11-20" });
    expect(hanyaSampai.ok).toBe(true);
  });

  it("menolak nama kosong dan tanggal yang bukan hari kalender", () => {
    const r = validasiJendela({ ...sah, name: "  ", opensOn: "2026-02-30", closesOn: 20261015 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.galat).toEqual(expect.arrayContaining(["NAMA_KOSONG", "TANGGAL_BUKA", "TANGGAL_TUTUP"]));
  });

  it("menolak tanggal tutup sebelum tanggal buka", () => {
    const r = validasiJendela({ ...sah, closesOn: "2026-09-30" });
    expect(!r.ok && r.galat).toEqual(["TUTUP_SEBELUM_BUKA"]);
  });

  it("menolak rentang kirim terbalik, tapi kirim pada satu hari sah", () => {
    const r = validasiJendela({ ...sah, shipFrom: "2026-11-20", shipTo: "2026-11-10" });
    expect(!r.ok && r.galat).toEqual(["KIRIM_TERBALIK"]);
    expect(validasiJendela({ ...sah, shipFrom: "2026-11-20", shipTo: "2026-11-20" }).ok).toBe(true);
    expect(!validasiJendela({ ...sah, shipFrom: "kemarin" }).ok).toBe(true);
  });

  it("menolak daftar barang kosong, ganda, dan rencana yang bukan bilangan bulat ≥ 0", () => {
    expect(validasiJendela({ ...sah, items: [] })).toEqual({ ok: false, galat: ["BARANG_KOSONG"] });
    expect(validasiJendela({ ...sah, items: [{ itemId: "A", plannedQty: 1 }, { itemId: "A", plannedQty: 2 }] })).toEqual({ ok: false, galat: ["BARANG_GANDA"] });
    for (const plannedQty of [-1, 1.5, "10", Number.NaN]) {
      expect(validasiJendela({ ...sah, items: [{ itemId: "A", plannedQty }] })).toEqual({ ok: false, galat: ["RENCANA_TIDAK_SAH"] });
    }
    expect(validasiJendela({ ...sah, items: [{ itemId: "A", plannedQty: 0 }] }).ok).toBe(true);
    expect(validasiJendela({ ...sah, items: "A" }).ok).toBe(false);
    expect(validasiJendela({ ...sah, items: [{ itemId: "", plannedQty: 1 }] }).ok).toBe(false);
  });

  it("nama terlalu panjang dan catatan terlalu panjang ditolak", () => {
    const r = validasiJendela({ ...sah, name: "x".repeat(121), note: "y".repeat(1001) });
    expect(!r.ok && r.galat).toEqual(["NAMA_PANJANG", "CATATAN_PANJANG"]);
  });

  it("isActive selain true/false jatuh ke aktif", () => {
    const r = validasiJendela({ ...sah, isActive: "ya" });
    expect(r.ok && r.data.isActive).toBe(true);
    const mati = validasiJendela({ ...sah, isActive: false });
    expect(mati.ok && mati.data.isActive).toBe(false);
  });
});

describe("isianTanggal", () => {
  it("instan → YYYY-MM-DD hari WIB-nya, termasuk ujung hari tutup", () => {
    expect(isianTanggal(wib("2026-10-15T23:59:59.999"))).toBe("2026-10-15");
    expect(isianTanggal(wib("2026-10-01T00:00:00.000"))).toBe("2026-10-01");
    expect(isianTanggal(null)).toBe("");
  });
});

describe("rentangTanggal", () => {
  it("bulan sama: 10–20 Nov 2026", () => {
    expect(rentangTanggal(wib("2026-11-10T00:00:00.000"), wib("2026-11-20T00:00:00.000"))).toBe("10–20 Nov 2026");
  });
  it("tahun sama, bulan beda: 28 Nov – 5 Des 2026", () => {
    expect(rentangTanggal(wib("2026-11-28T00:00:00.000"), wib("2026-12-05T00:00:00.000"))).toBe("28 Nov – 5 Des 2026");
  });
  it("tahun beda: tanggal lengkap di kedua sisi", () => {
    expect(rentangTanggal(wib("2026-12-28T00:00:00.000"), wib("2027-01-05T00:00:00.000"))).toBe("28 Des 2026 – 5 Jan 2027");
  });
  it("hari yang sama: satu tanggal", () => {
    expect(rentangTanggal(wib("2026-11-10T00:00:00.000"), wib("2026-11-10T00:00:00.000"))).toBe("10 Nov 2026");
  });
  it("tanggal dibaca di WIB, bukan zona proses (tengah malam WIB = sore UTC hari sebelumnya)", () => {
    expect(rentangTanggal(wib("2026-11-01T00:00:00.000"), wib("2026-11-02T00:00:00.000"))).toBe("1–2 Nov 2026");
  });
  it("bahasa Inggris memakai en-GB", () => {
    expect(rentangTanggal(wib("2026-11-10T00:00:00.000"), wib("2026-11-20T00:00:00.000"), "en")).toBe("10–20 Nov 2026");
  });
});

describe("ringkasPesananJendela", () => {
  const barang = [
    { itemId: "A", plannedQty: 100 },
    { itemId: "B", plannedQty: null },
  ];
  it("menjumlah per barang dan per varian, memisah menunggu vs disetujui, tanpa yang ditolak dan dibatalkan", () => {
    const r = ringkasPesananJendela(barang, [
      { status: "PENDING_APPROVAL", itemId: "A", variantSku: "A-M", qty: 10, cancelledQty: 0 },
      { status: "APPROVED", itemId: "A", variantSku: "A-M", qty: 20, cancelledQty: 5 },
      { status: "APPROVED", itemId: "A", variantSku: "A-L", qty: 6, cancelledQty: 0 },
      { status: "REJECTED", itemId: "A", variantSku: "A-L", qty: 50, cancelledQty: 0 },
      { status: "APPROVED", itemId: "B", variantSku: "", qty: 7, cancelledQty: 0 },
      // Baris bonus barang lain (bukan barang jendela) tidak masuk hitungan jendela.
      { status: "APPROVED", itemId: "Z", variantSku: "", qty: 1, cancelledQty: 0 },
    ]);
    const a = r.perBarang.find((b) => b.itemId === "A")!;
    expect(a).toMatchObject({ rencana: 100, menunggu: 10, disetujui: 21, dipesan: 31, sisa: 69 });
    expect(a.perVarian).toEqual([
      { variantSku: "A-L", menunggu: 0, disetujui: 6, dipesan: 6 },
      { variantSku: "A-M", menunggu: 10, disetujui: 15, dipesan: 25 },
    ]);
    const b = r.perBarang.find((x) => x.itemId === "B")!;
    expect(b).toMatchObject({ rencana: null, dipesan: 7, sisa: null });
    expect(r.total).toEqual({ rencana: 100, dipesan: 38 });
    expect(r.perBarang.map((x) => x.itemId)).toEqual(["A", "B"]);
  });
  it("sisa negatif = melebihi rencana; barang tanpa pesanan tetap tampil nol", () => {
    const r = ringkasPesananJendela([{ itemId: "A", plannedQty: 5 }, { itemId: "C", plannedQty: 3 }], [
      { status: "APPROVED", itemId: "A", variantSku: "", qty: 8, cancelledQty: 0 },
    ]);
    expect(r.perBarang[0]).toMatchObject({ sisa: -3 });
    expect(r.perBarang[1]).toMatchObject({ dipesan: 0, sisa: 3, perVarian: [] });
  });
  it("total rencana null kalau tidak satu barang pun punya rencana", () => {
    expect(ringkasPesananJendela([{ itemId: "A", plannedQty: null }], []).total).toEqual({ rencana: null, dipesan: 0 });
  });
});

describe("barisPerluDicadangkan", () => {
  it("hanya sisa yang masih terbuka, sebesar sisanya", () => {
    expect(
      barisPerluDicadangkan([
        { id: "1", itemId: "A", variantSku: "A-M", qty: 10, deliveredQty: 0, cancelledQty: 0 },
        { id: "2", itemId: "A", variantSku: "A-L", qty: 5, deliveredQty: 0, cancelledQty: 5 },
        { id: "3", itemId: "B", variantSku: "", qty: 4, deliveredQty: 1, cancelledQty: 0 },
      ]),
    ).toEqual([
      { fieldSalesLineId: "1", itemId: "A", variantSku: "A-M", qty: 10 },
      { fieldSalesLineId: "3", itemId: "B", variantSku: "", qty: 3 },
    ]);
  });
});

describe("bolehRilis / bolehDiubah", () => {
  it("rilis dan ubah hanya sebelum dirilis", () => {
    for (const k of ["BELUM_BUKA", "BUKA", "TUTUP", "NONAKTIF"] as const) {
      expect(bolehRilis(k)).toBe(true);
      expect(bolehDiubah(k)).toBe(true);
    }
    expect(bolehRilis("DIRILIS")).toBe(false);
    expect(bolehDiubah("DIRILIS")).toBe(false);
  });
});

describe("bacaIdInden", () => {
  it("menerima id yang wajar, menolak yang lain", () => {
    expect(bacaIdInden("clx123abc")).toBe("clx123abc");
    expect(bacaIdInden(["clx1", "clx2"])).toBe("clx1");
    expect(bacaIdInden("")).toBeNull();
    expect(bacaIdInden(undefined)).toBeNull();
    expect(bacaIdInden("a b")).toBeNull();
    expect(bacaIdInden("x".repeat(65))).toBeNull();
    expect(bacaIdInden(42)).toBeNull();
  });
});
