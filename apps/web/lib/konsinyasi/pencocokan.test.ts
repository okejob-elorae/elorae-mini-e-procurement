import { describe, expect, it } from "vitest";
import {
  buatPenyelesaiKunci,
  kunciNama,
  penandaDariTerjual,
  pilihTerjualBulan,
  susunPencocokan,
  titipanPerBarang,
  type BahanStok,
} from "./pencocokan";

const nama = new Map([
  ["A", { nama: "Blus", sku: "BLS", itemId: "A" }],
  ["B", { nama: "Rok", sku: "ROK", itemId: "B" }],
]);
const kosongStok: BahanStok = { buku: [], titipan: [], kirimanBelumDiterima: [], returBelumDihitung: [], rusakBelumMasukBuku: [] };

describe("pilihTerjualBulan", () => {
  it("resmi lebih dulu, lalu laporan toko, laporan SPG, buku", () => {
    const x = [{ kunci: "A", qty: 1 }];
    expect(pilihTerjualBulan({ resmi: x, laporanToko: [], laporanSpg: [], buku: [] }).dasar).toBe("RESMI");
    expect(pilihTerjualBulan({ resmi: null, laporanToko: x, laporanSpg: [], buku: [] }).dasar).toBe("LAPORAN_TOKO");
    expect(pilihTerjualBulan({ resmi: null, laporanToko: null, laporanSpg: x, buku: [] }).dasar).toBe("LAPORAN_SPG");
    expect(pilihTerjualBulan({ resmi: null, laporanToko: null, laporanSpg: null, buku: x }).dasar).toBe("BUKU");
    expect(pilihTerjualBulan({ resmi: null, laporanToko: null, laporanSpg: null, buku: null })).toEqual({ dasar: null, baris: [] });
  });
});

describe("titipanPerBarang", () => {
  it("masuk − terjual − diretur; sisa negatif dipertahankan", () => {
    const r = titipanPerBarang({
      masuk: [{ kunci: "A", qty: 10 }, { kunci: "A", qty: 2 }],
      terjual: [{ kunci: "A", qty: 4 }, { kunci: "B", qty: 1 }],
      retur: [{ kunci: "A", qty: 3 }],
    });
    expect(r).toEqual(expect.arrayContaining([{ kunci: "A", qty: 5 }, { kunci: "B", qty: -1 }]));
  });
});

describe("buatPenyelesaiKunci", () => {
  const kunci = buatPenyelesaiKunci({
    terlibat: [{ id: "A", nameId: "Blus Linen" }],
    semua: [
      { id: "A", nameId: "Blus Linen" },
      { id: "X", nameId: "Kemeja" },
      { id: "Y", nameId: "kemeja" },
      { id: "Z", nameId: "Celana" },
    ],
  });
  it("itemId selalu menang", () => {
    expect(kunci("Q", "apa pun")).toBe("Q");
  });
  it("nama dicocokkan tanpa peduli huruf besar dan spasi", () => {
    expect(kunci(null, "  blus   LINEN ")).toBe("A");
    expect(kunci(null, "Celana")).toBe("Z");
  });
  it("nama yang ganda atau tidak dikenal tetap barisnya sendiri", () => {
    expect(kunci(null, "Kemeja")).toBe(kunciNama("Kemeja"));
    expect(kunci(null, "Jaket")).toBe("nama:jaket");
  });
});

describe("susunPencocokan — terjual", () => {
  it("cocok kalau semua sumber yang ada sama; nota tidak ikut menentukan", () => {
    const h = susunPencocokan({
      nama,
      terjual: {
        buku: [{ kunci: "A", qty: 3 }],
        nota: [{ kunci: "A", qty: 4 }],
        laporanSpg: [{ kunci: "A", qty: 3 }],
        laporanToko: [{ kunci: "A", qty: 3 }],
        resmi: null,
      },
      stok: null,
    });
    expect(h.baris).toEqual([expect.objectContaining({ kunci: "A", nama: "Blus", terjualBerselisih: false })]);
    expect(h.ringkas).toMatchObject({ sumberTerjual: 3, barangBerselisih: 0, cocok: true });
  });

  it("sumber yang ada tapi tidak menyebut barang = 0 dan berselisih", () => {
    const h = susunPencocokan({
      nama,
      terjual: {
        buku: [{ kunci: "A", qty: 2 }, { kunci: "B", qty: 1 }],
        nota: null,
        laporanSpg: [{ kunci: "A", qty: 2 }],
        laporanToko: null,
        resmi: null,
      },
      stok: null,
    });
    const b = h.baris.find((x) => x.kunci === "B")!;
    expect(b.terjual).toEqual({ buku: 1, nota: null, laporanSpg: 0, laporanToko: null, resmi: null });
    expect(b.terjualBerselisih).toBe(true);
    expect(h.baris[0].kunci).toBe("B");
    expect(h.ringkas).toMatchObject({ barangTerjualBerselisih: 1, cocok: false });
  });

  it("tanpa buku dan baru satu laporan: belum ada yang bisa dibandingkan", () => {
    const h = susunPencocokan({
      nama,
      terjual: { buku: null, nota: null, laporanSpg: [{ kunci: "A", qty: 2 }], laporanToko: null, resmi: null },
      stok: null,
    });
    expect(h.ringkas.cocok).toBeNull();
  });

  it("angka resmi ikut dibandingkan setelah dikunci", () => {
    const h = susunPencocokan({
      nama,
      terjual: { buku: [{ kunci: "A", qty: 5 }], nota: null, laporanSpg: null, laporanToko: [{ kunci: "A", qty: 5 }], resmi: [{ kunci: "A", qty: 4 }] },
      stok: null,
    });
    expect(h.baris[0].terjualBerselisih).toBe(true);
  });
});

describe("susunPencocokan — stok", () => {
  it("buku kurang dari titipan = kemungkinan hilang", () => {
    const h = susunPencocokan({
      nama,
      terjual: { buku: [], nota: null, laporanSpg: null, laporanToko: null, resmi: null },
      stok: { ...kosongStok, buku: [{ kunci: "A", qty: 7 }], titipan: [{ kunci: "A", qty: 10 }] },
    });
    expect(h.baris[0].stok).toEqual({ buku: 7, titipan: 10, dalamProses: 0, hilangTercatat: 0, seharusnya: 10, selisih: -3, kemungkinanHilang: 3 });
    expect(h.ringkas).toMatchObject({ barangKemungkinanHilang: 1, pcsKemungkinanHilang: 3, barangStokBerselisih: 1, cocok: false });
  });

  it("barang yang sudah dicatat hilang tidak dihitung lagi; sisanya tetap kemungkinan hilang", () => {
    const h = susunPencocokan({
      nama,
      terjual: { buku: [], nota: null, laporanSpg: null, laporanToko: null, resmi: null },
      stok: {
        ...kosongStok,
        buku: [
          { kunci: "A", qty: 7 },
          { kunci: "B", qty: 1 },
        ],
        titipan: [
          { kunci: "A", qty: 10 },
          { kunci: "B", qty: 4 },
        ],
        hilangTercatat: [
          { kunci: "A", qty: 3 },
          { kunci: "B", qty: 1 },
        ],
      },
    });
    const per = new Map(h.baris.map((b) => [b.kunci, b.stok]));
    expect(per.get("A")).toMatchObject({ hilangTercatat: 3, seharusnya: 7, selisih: 0, kemungkinanHilang: 0 });
    expect(per.get("B")).toMatchObject({ hilangTercatat: 1, seharusnya: 3, selisih: -2, kemungkinanHilang: 2 });
    expect(h.ringkas).toMatchObject({ barangKemungkinanHilang: 1, pcsKemungkinanHilang: 2 });
  });

  it("barang dalam proses tidak dianggap hilang", () => {
    const h = susunPencocokan({
      nama,
      terjual: { buku: [], nota: null, laporanSpg: null, laporanToko: null, resmi: null },
      stok: {
        buku: [{ kunci: "A", qty: 4 }],
        titipan: [{ kunci: "A", qty: 10 }],
        kirimanBelumDiterima: [{ kunci: "A", qty: 3 }],
        returBelumDihitung: [{ kunci: "A", qty: 2 }],
        rusakBelumMasukBuku: [{ kunci: "A", qty: 1 }],
      },
    });
    expect(h.baris[0].stok).toMatchObject({ dalamProses: 6, seharusnya: 4, selisih: 0, kemungkinanHilang: 0 });
    expect(h.ringkas.cocok).toBe(true);
  });

  it("buku lebih dari titipan berselisih tapi bukan hilang", () => {
    const h = susunPencocokan({
      nama,
      terjual: { buku: [], nota: null, laporanSpg: null, laporanToko: null, resmi: null },
      stok: { ...kosongStok, buku: [{ kunci: "B", qty: 5 }], titipan: [{ kunci: "B", qty: 3 }] },
    });
    expect(h.baris[0]).toMatchObject({ stokBerselisih: true, stok: { selisih: 2, kemungkinanHilang: 0 } });
    expect(h.ringkas.barangKemungkinanHilang).toBe(0);
  });

  it("barang yang semuanya nol tidak ditampilkan", () => {
    const h = susunPencocokan({
      nama,
      terjual: { buku: [{ kunci: "A", qty: 0 }], nota: null, laporanSpg: null, laporanToko: null, resmi: null },
      stok: { ...kosongStok, buku: [{ kunci: "A", qty: 0 }], titipan: [{ kunci: "A", qty: 0 }] },
    });
    expect(h.baris).toEqual([]);
    expect(h.ringkas.cocok).toBe(true);
  });

  it("baris bernama tanpa master barang tetap muncul dengan namanya", () => {
    const h = susunPencocokan({
      nama: new Map(),
      terjual: { buku: null, nota: null, laporanSpg: [{ kunci: "nama:jaket", qty: 1 }], laporanToko: [{ kunci: "nama:jaket", qty: 1 }], resmi: null },
      stok: null,
    });
    expect(h.baris[0]).toMatchObject({ itemId: null, nama: "jaket", terjualBerselisih: false });
  });
});

describe("penandaDariTerjual", () => {
  it("null kalau kurang dari dua sumber; jumlah berselisih kalau cukup", () => {
    expect(penandaDariTerjual({ buku: null, laporanSpg: [{ kunci: "A", qty: 1 }], laporanToko: null })).toBeNull();
    expect(penandaDariTerjual({ buku: [{ kunci: "A", qty: 1 }], laporanSpg: [{ kunci: "A", qty: 1 }], laporanToko: null })).toEqual({ berselisih: 0 });
    expect(
      penandaDariTerjual({ buku: [{ kunci: "A", qty: 2 }], laporanSpg: [{ kunci: "A", qty: 1 }], laporanToko: [{ kunci: "B", qty: 1 }] }),
    ).toEqual({ berselisih: 2 });
  });
});
