import { describe, expect, it } from "vitest";
import { PPN_BAWAAN, type PengaturanPpn } from "@/lib/finance/pajak/ppn";
import {
  barisFaktur,
  barisKlaim,
  barisNota,
  barisRetur,
  barisTukar,
  gabungBaris,
  generasiBerikutnya,
  fakturDijurnalSendiri,
  generasiSourceId,
  idGenerasi,
  jumlahSen,
  keBarisJurnal,
  kunciStokPengiriman,
  kunciStokPersetujuan,
  kunciStokReturMasuk,
  nilaiFakturDijurnal,
  nilaiReturBukuBesar,
  peranBawaanJenisPotongan,
  peranIsianJenisBaru,
  peranPotongan,
  potonganReturDiakui,
  selisihBaris,
  tanggalJurnalKlaim,
  type BarisBertanda,
} from "./aturan";

const NON_PKP: PengaturanPpn = { ...PPN_BAWAAN, statusPkp: "NON_PKP" };
const PKP: PengaturanPpn = { ...PPN_BAWAAN, statusPkp: "PKP", tarifPersen: 12, pakaiDppNilaiLain: true, hargaJualTermasukPpn: true, berlakuSejak: null };
const HARI = new Date("2026-09-10T03:00:00.000Z");

/** Ringkas baris menjadi peta "PERAN|toko|kanal" → rupiah bertanda (+ debit, − kredit). */
function peta(baris: BarisBertanda[]): Record<string, number> {
  const hasil: Record<string, number> = {};
  for (const b of gabungBaris(baris)) hasil[`${b.role}|${b.storeId ?? ""}|${b.channel ?? ""}`] = b.sen / 100;
  return hasil;
}

describe("generasi sourceId jurnal yang diselaraskan", () => {
  it("generasi pertama memakai id dokumen apa adanya, berikutnya berakhiran #n", () => {
    expect(idGenerasi("k1", 1)).toBe("k1");
    expect(idGenerasi("k1", 2)).toBe("k1#2");
    expect(generasiSourceId("k1", "k1")).toBe(1);
    expect(generasiSourceId("k1", "k1#3")).toBe(3);
    expect(generasiSourceId("k1", "k10")).toBeNull();
    expect(generasiSourceId("k1", "k1#x")).toBeNull();
  });

  it("generasi berikutnya = generasi terbesar + 1 (lubang tidak diisi ulang)", () => {
    expect(generasiBerikutnya("k1", [])).toBe(1);
    expect(generasiBerikutnya("k1", ["k1"])).toBe(2);
    expect(generasiBerikutnya("k1", ["k1", "k1#3"])).toBe(4);
  });
});

describe("baris bertanda", () => {
  it("menggabung per peran + toko + kanal dan membuang yang nol", () => {
    const g = gabungBaris([
      { role: "AR_STORE", sen: 1000, storeId: "t1" },
      { role: "AR_STORE", sen: -1000, storeId: "t1" },
      { role: "AR_STORE", sen: 500, storeId: "t2" },
      { role: "COGS", sen: 300, channel: "PUTUS", storeId: "t2" },
      { role: "COGS", sen: 200, channel: "PUTUS", storeId: "t2" },
    ]);
    expect(g).toEqual([
      { role: "AR_STORE", sen: 500, storeId: "t2", channel: null },
      { role: "COGS", sen: 500, channel: "PUTUS", storeId: "t2" },
    ]);
  });

  it("selisih = sasaran − yang sudah diposting, per kunci", () => {
    const sudah: BarisBertanda[] = [
      { role: "BANK", sen: 70_000_00 },
      { role: "AR_STORE", sen: -70_000_00, storeId: "t1" },
    ];
    const sasaran: BarisBertanda[] = [];
    expect(peta(selisihBaris(sasaran, sudah))).toEqual({ "BANK||": -70_000, "AR_STORE|t1|": 70_000 });
    expect(selisihBaris(sudah, sudah)).toEqual([]);
  });

  it("baris jurnal: positif = debit, negatif = kredit, memo = nama peran", () => {
    const j = keBarisJurnal([
      { role: "AR_STORE", sen: 123_456, storeId: "t1" },
      { role: "SALES_REVENUE", sen: -123_456, channel: "PUTUS", storeId: "t1" },
    ]);
    expect(j).toEqual([
      { role: "AR_STORE", debit: 1234.56, credit: 0, memo: "AR_STORE", channel: null, storeId: "t1" },
      { role: "SALES_REVENUE", debit: 0, credit: 1234.56, memo: "SALES_REVENUE", channel: "PUTUS", storeId: "t1" },
    ]);
  });

  it("baris PPN membawa DPP (pendapatan/retur di set yang sama) di belakang nama perannya", () => {
    const j = keBarisJurnal([
      { role: "AR_STORE", sen: 11_100_000, storeId: "t1" },
      { role: "SALES_REVENUE", sen: -10_000_000, channel: "PUTUS", storeId: "t1" },
      { role: "PPN_KELUARAN", sen: -1_100_000 },
    ]);
    expect(j.find((b) => b.role === "PPN_KELUARAN")?.memo).toBe("PPN_KELUARAN · DPP 100000.00");
    expect(j.find((b) => b.role === "AR_STORE")?.memo).toBe("AR_STORE");
    const retur = keBarisJurnal([
      { role: "SALES_RETURN", sen: 5_000_000, storeId: "t1" },
      { role: "PPN_KELUARAN", sen: 550_000 },
      { role: "AR_STORE", sen: -5_550_000, storeId: "t1" },
    ]);
    expect(retur.find((b) => b.role === "PPN_KELUARAN")?.memo).toBe("PPN_KELUARAN · DPP 50000.00");
  });
});

describe("nota tagihan putus", () => {
  it("non-PKP: piutang toko = pendapatan, HPP keluar dari persediaan barang jadi", () => {
    const b = barisNota({
      total: 1_000_000,
      storeId: "t1",
      tanggal: HARI,
      pengaturanPpn: NON_PKP,
      hpp: [
        { tipeBarang: "FINISHED_GOOD", nilai: 400_000 },
        { tipeBarang: "FINISHED_GOOD", nilai: 50_000.5 },
      ],
    });
    expect(jumlahSen(b)).toBe(0);
    expect(peta(b)).toEqual({
      "AR_STORE|t1|": 1_000_000,
      "SALES_REVENUE|t1|PUTUS": -1_000_000,
      "COGS|t1|PUTUS": 450_000.5,
      "INVENTORY_FG||": -450_000.5,
    });
  });

  it("PKP: PPN keluaran dipisah dari total termasuk PPN (DPP nilai lain 11/12 × 12%)", () => {
    const b = barisNota({ total: 1_110_000, storeId: "t1", tanggal: HARI, pengaturanPpn: PKP, hpp: [] });
    expect(jumlahSen(b)).toBe(0);
    expect(peta(b)).toEqual({
      "AR_STORE|t1|": 1_110_000,
      "SALES_REVENUE|t1|PUTUS": -1_000_000,
      "PPN_KELUARAN||": -110_000,
    });
  });

  it("nota bernilai nol (hanya bonus) tidak menyentuh piutang — HPP tetap keluar", () => {
    const b = barisNota({ total: 0, storeId: "t1", tanggal: HARI, pengaturanPpn: NON_PKP, hpp: [{ tipeBarang: "FINISHED_GOOD", nilai: 10_000 }] });
    expect(peta(b)).toEqual({ "COGS|t1|PUTUS": 10_000, "INVENTORY_FG||": -10_000 });
    expect(barisNota({ total: 0, storeId: "t1", tanggal: HARI, pengaturanPpn: NON_PKP, hpp: [] })).toEqual([]);
  });

  it("nota bertotal negatif tidak menjadi piutang (penulis nota juga tidak membuatnya)", () => {
    const b = barisNota({ total: -5, storeId: "t1", tanggal: HARI, pengaturanPpn: NON_PKP, hpp: [] });
    expect(b).toEqual([]);
  });
});

describe("pelunasan BKM", () => {
  it("peran potongan: dari jenisnya bila sah, PPh 23 untuk jenis khusus PKP, selain itu potongan penjualan", () => {
    expect(peranPotongan({ postingRole: "PPH23_PREPAID", pkpOnly: false })).toBe("PPH23_PREPAID");
    expect(peranPotongan({ postingRole: null, pkpOnly: true })).toBe("PPH23_PREPAID");
    expect(peranPotongan({ postingRole: null, pkpOnly: false })).toBe("SALES_DISCOUNT");
    expect(peranPotongan({ postingRole: "BUKAN_PERAN", pkpOnly: false })).toBe("SALES_DISCOUNT");
    expect(peranPotongan({ postingRole: "BANK_CHARGES", pkpOnly: true })).toBe("BANK_CHARGES");
    // Peran bersaldo kredit / piutang tidak pernah boleh didebit potongan.
    expect(peranPotongan({ postingRole: "AR_STORE", pkpOnly: false })).toBe("SALES_DISCOUNT");
    expect(peranPotongan({ postingRole: "SALES_REVENUE", pkpOnly: false })).toBe("SALES_DISCOUNT");
    expect(peranPotongan(null)).toBe("SALES_DISCOUNT");
  });

  it("belum terverifikasi = nol (Aturan 1)", () => {
    expect(barisKlaim({ terverifikasi: false, cara: "transfer", diterima: 700_000, storeId: "t1", potongan: [] })).toEqual([]);
  });

  it("terverifikasi: tunai ke kas, potongan non-retur ke perannya, potongan retur TIDAK menyentuh piutang di sini", () => {
    const b = barisKlaim({
      terverifikasi: true,
      cara: "tunai",
      diterima: 600_000,
      storeId: "t1",
      potongan: [
        { nilai: 100_000, retur: false, peran: "SALES_DISCOUNT" },
        { nilai: 20_000, retur: false, peran: "PPH23_PREPAID" },
        { nilai: 280_000, retur: true, peran: "SALES_DISCOUNT" },
      ],
    });
    expect(jumlahSen(b)).toBe(0);
    expect(peta(b)).toEqual({
      "CASH||": 600_000,
      "SALES_DISCOUNT|t1|PUTUS": 100_000,
      "PPH23_PREPAID||": 20_000,
      "AR_STORE|t1|": -720_000,
    });
  });

  it("transfer dan giro masuk bank", () => {
    for (const cara of ["transfer", "giro"]) {
      const b = barisKlaim({ terverifikasi: true, cara, diterima: 5_000, storeId: "t1", potongan: [] });
      expect(peta(b)).toEqual({ "BANK||": 5_000, "AR_STORE|t1|": -5_000 });
    }
  });

  it("tanggal jurnal: tanggal transfer, tidak sebelum tanggal mulai buku besar dan tidak sesudah verifikasi; giro = saat cair", () => {
    const verif = new Date("2026-09-12T05:00:00Z");
    const transfer = new Date("2026-09-08T17:00:00Z");
    const mulai = new Date("2026-09-09T17:00:00Z");
    expect(tanggalJurnalKlaim({ verifiedAt: verif, claimedTransferAt: transfer, giro: false, mulai: null })).toEqual(transfer);
    expect(tanggalJurnalKlaim({ verifiedAt: verif, claimedTransferAt: transfer, giro: false, mulai })).toEqual(mulai);
    expect(tanggalJurnalKlaim({ verifiedAt: verif, claimedTransferAt: new Date("2026-09-20T00:00:00Z"), giro: false, mulai })).toEqual(verif);
    expect(tanggalJurnalKlaim({ verifiedAt: verif, claimedTransferAt: transfer, giro: true, mulai })).toEqual(verif);
  });
});

describe("retur toko — nilai yang diakui buku besar", () => {
  const nota = { nilaiKlaim: 300_000, nilaiFisik: 100_000 as number | null, bebanDiputuskan: false };

  it("potongan retur diakui modul: ditahan penuh sebelum dihitung, sebesar porsi fisik sesudahnya, penuh sesudah beban diputuskan", () => {
    expect(potonganReturDiakui(150_000, { ...nota, nilaiFisik: null })).toBe(0);
    expect(potonganReturDiakui(150_000, nota)).toBeCloseTo(50_000, 6);
    expect(potonganReturDiakui(150_000, { ...nota, bebanDiputuskan: true })).toBe(150_000);
    // Gudang menerima lebih dari klaim: tidak ada yang ditahan.
    expect(potonganReturDiakui(150_000, { nilaiKlaim: 300_000, nilaiFisik: 400_000, bebanDiputuskan: false })).toBe(150_000);
  });

  it("sasaran = maks(fisik yang diakui, yang sudah dipakai toko); fisik yang diakui tidak melebihi klaim nota", () => {
    // Belum dipotong: kredit retur 100 rb belum dipakai.
    expect(nilaiReturBukuBesar({ nilaiFisik: 100_000, nilaiKlaimNota: 300_000, potonganDiakui: 0, ditagihKeToko: 0 })).toEqual({
      fisikDiakui: 100_000,
      dipakai: 0,
      sasaran: 100_000,
      rugi: 0,
      kreditBelumDipakai: 100_000,
    });
    // Ditanggung TOKO sesudah dipotong 300 rb: faktur beban 200 rb → dipakai bersih 100 rb.
    expect(nilaiReturBukuBesar({ nilaiFisik: 100_000, nilaiKlaimNota: 300_000, potonganDiakui: 300_000, ditagihKeToko: 200_000 })).toMatchObject({
      sasaran: 100_000,
      rugi: 0,
      kreditBelumDipakai: 0,
    });
    // Ditanggung perusahaan/sales/gudang: potongan 300 rb dilepas penuh, 200 rb jadi rugi.
    expect(nilaiReturBukuBesar({ nilaiFisik: 100_000, nilaiKlaimNota: 300_000, potonganDiakui: 300_000, ditagihKeToko: 0 })).toMatchObject({
      sasaran: 300_000,
      rugi: 200_000,
      kreditBelumDipakai: 0,
    });
    // Gudang menerima lebih dari nota: yang diakui sebesar nota.
    expect(nilaiReturBukuBesar({ nilaiFisik: 400_000, nilaiKlaimNota: 300_000, potonganDiakui: 0, ditagihKeToko: 0 }).fisikDiakui).toBe(300_000);
    // Hitungan yatim (belum ada nota): tidak ada kredit untuk siapa pun.
    expect(nilaiReturBukuBesar({ nilaiFisik: 400_000, nilaiKlaimNota: null, potonganDiakui: 0, ditagihKeToko: 0 }).sasaran).toBe(0);
  });

  it("baris retur: barang layak kembali ke persediaan, rusak ke persediaan rusak, HPP dibalik; pendapatan dibalik sebesar sasaran", () => {
    const nilai = nilaiReturBukuBesar({ nilaiFisik: 100_000, nilaiKlaimNota: 300_000, potonganDiakui: 300_000, ditagihKeToko: 0 });
    const b = barisRetur({
      konsinyasi: false,
      storeId: "t1",
      tanggal: HARI,
      pengaturanPpn: NON_PKP,
      nilai,
      stokLayak: [{ tipeBarang: "FINISHED_GOOD", nilai: 40_000 }],
      nilaiRusak: 15_000,
    });
    expect(jumlahSen(b)).toBe(0);
    expect(peta(b)).toEqual({
      "INVENTORY_FG||": 40_000,
      "INVENTORY_DAMAGED||": 15_000,
      "COGS|t1|PUTUS": -55_000,
      "SALES_RETURN|t1|PUTUS": 100_000,
      "LOSS_EXPENSE|t1|PUTUS": 200_000,
      "AR_STORE|t1|": -300_000,
    });
  });

  it("PKP: PPN keluaran ikut dibalik atas fisik yang diakui, tidak atas rugi", () => {
    const nilai = nilaiReturBukuBesar({ nilaiFisik: 111_000, nilaiKlaimNota: 111_000, potonganDiakui: 0, ditagihKeToko: 0 });
    const b = barisRetur({ konsinyasi: false, storeId: "t1", tanggal: HARI, pengaturanPpn: PKP, nilai, stokLayak: [], nilaiRusak: 0 });
    expect(peta(b)).toEqual({ "SALES_RETURN|t1|PUTUS": 100_000, "PPN_KELUARAN||": 11_000, "AR_STORE|t1|": -111_000 });
  });

  it("retur dari toko konsinyasi bukan urusan jurnal lapangan", () => {
    const nilai = nilaiReturBukuBesar({ nilaiFisik: 1, nilaiKlaimNota: 1, potonganDiakui: 0, ditagihKeToko: 0 });
    expect(
      barisRetur({ konsinyasi: true, storeId: "t1", tanggal: HARI, pengaturanPpn: NON_PKP, nilai, stokLayak: [{ tipeBarang: "FINISHED_GOOD", nilai: 1 }], nilaiRusak: 1 }),
    ).toEqual([]);
  });
});

describe("tukar barang", () => {
  it("barang masuk dan keluar dinetto per peran persediaan; selisih biaya ke HPP", () => {
    const b = barisTukar({
      storeId: "t1",
      masuk: [{ tipeBarang: "FINISHED_GOOD", nilai: 100_000 }],
      keluar: [{ tipeBarang: "FINISHED_GOOD", nilai: 120_000 }],
    });
    expect(peta(b)).toEqual({ "INVENTORY_FG||": -20_000, "COGS|t1|PUTUS": 20_000 });
    expect(barisTukar({ storeId: "t1", masuk: [{ tipeBarang: "FINISHED_GOOD", nilai: 5 }], keluar: [{ tipeBarang: "FINISHED_GOOD", nilai: 5 }] })).toEqual([]);
  });
});

describe("retur toko — HPP dibalik sebesar HPP saat dijual (bug 6)", () => {
  const nol = nilaiReturBukuBesar({ nilaiFisik: 0, nilaiKlaimNota: 0, potonganDiakui: 0, ditagihKeToko: 0 });

  it("kemeja M layak: persediaan sebesar kartu stok (103.528,91), HPP dibalik sebesar saat dijual (81.222,22), selisih ke INVENTORY_VARIANCE", () => {
    const baris = barisRetur({
      konsinyasi: false,
      storeId: "t1",
      tanggal: HARI,
      pengaturanPpn: NON_PKP,
      nilai: nol,
      stokLayak: [{ tipeBarang: "FINISHED_GOOD", nilai: 103_528.91 }],
      nilaiRusak: 0,
      hppKembali: 81_222.22,
    });
    expect(peta(baris)).toEqual({
      "INVENTORY_FG||": 103_528.91,
      "COGS|t1|PUTUS": -81_222.22,
      "INVENTORY_VARIANCE||": -22_306.69,
    });
    expect(jumlahSen(baris)).toBe(0);
  });

  it("kemeja M rusak dinilai HPP saat dijual: tanpa selisih", () => {
    const baris = barisRetur({
      konsinyasi: false,
      storeId: "t1",
      tanggal: HARI,
      pengaturanPpn: NON_PKP,
      nilai: nol,
      stokLayak: [],
      nilaiRusak: 81_222.22,
      hppKembali: 81_222.22,
    });
    expect(peta(baris)).toEqual({ "INVENTORY_DAMAGED||": 81_222.22, "COGS|t1|PUTUS": -81_222.22 });
  });

  it("HPP saat dijual lebih tinggi dari kartu stok → selisih DIDEBIT; tanpa hppKembali = perilaku lama (HPP = nilai barang masuk)", () => {
    const naik = barisRetur({
      konsinyasi: false,
      storeId: "t1",
      tanggal: HARI,
      pengaturanPpn: NON_PKP,
      nilai: nol,
      stokLayak: [{ tipeBarang: "FINISHED_GOOD", nilai: 50_000 }],
      nilaiRusak: 0,
      hppKembali: 60_000,
    });
    expect(peta(naik)).toEqual({ "INVENTORY_FG||": 50_000, "COGS|t1|PUTUS": -60_000, "INVENTORY_VARIANCE||": 10_000 });
    const lama = barisRetur({
      konsinyasi: false,
      storeId: "t1",
      tanggal: HARI,
      pengaturanPpn: NON_PKP,
      nilai: nol,
      stokLayak: [{ tipeBarang: "FINISHED_GOOD", nilai: 50_000 }],
      nilaiRusak: 20_000,
    });
    expect(peta(lama)).toEqual({ "INVENTORY_FG||": 50_000, "INVENTORY_DAMAGED||": 20_000, "COGS|t1|PUTUS": -70_000 });
  });

  it("kunci penyesuaian stok: pengiriman, persetujuan lama, dan barang retur yang masuk per baris NRI", () => {
    expect(kunciStokPengiriman("PUTUS/1", "d1", "l1")).toBe("fieldsales-PUTUS/1-delivery-d1-line-l1");
    expect(kunciStokPersetujuan("PUTUS/1", "l1")).toBe("fieldsales-PUTUS/1-consume-line-l1");
    expect(kunciStokReturMasuk("w1")).toBe("nri-masuk:w1");
  });
});

describe("faktur piutang manual/impor (bug 5)", () => {
  it("dijurnal sendiri hanya bila bukan nota pengiriman, bukan faktur beban retur, dan bukan toko konsinyasi", () => {
    expect(fakturDijurnalSendiri({ source: "MANUAL", deliveryId: null, note: null, konsinyasi: false })).toBe(true);
    expect(fakturDijurnalSendiri({ source: "IMPORT", deliveryId: null, note: "catatan biasa", konsinyasi: false })).toBe(true);
    expect(fakturDijurnalSendiri({ source: "DELIVERY", deliveryId: "d1", note: null, konsinyasi: false })).toBe(false);
    // Nota tagihan lama yang sumbernya tertulis lain tetapi menunjuk pengiriman: jurnal notanya yang berlaku.
    expect(fakturDijurnalSendiri({ source: "MANUAL", deliveryId: "d1", note: null, konsinyasi: false })).toBe(false);
    expect(fakturDijurnalSendiri({ source: "MANUAL", deliveryId: null, note: "Selisih retur NRT-1 ditanggung toko. [beban-retur:c1]", konsinyasi: false })).toBe(false);
    expect(fakturDijurnalSendiri({ source: "MANUAL", deliveryId: null, note: null, konsinyasi: true })).toBe(false);
  });

  it("nilai yang dijurnal = nilai faktur dikurangi yang dibayar sebelum impor, tidak pernah negatif", () => {
    expect(nilaiFakturDijurnal({ amount: 2_220_000, paidBeforeImport: 0 })).toBe(2_220_000);
    expect(nilaiFakturDijurnal({ amount: 1_250_000.75, paidBeforeImport: 250_000.5 })).toBe(1_000_000.25);
    expect(nilaiFakturDijurnal({ amount: 100, paidBeforeImport: 300 })).toBe(0);
  });

  it("DR piutang toko / CR penjualan (kanal PUTUS, toko); PKP memisahkan PPN keluaran; tanpa HPP", () => {
    expect(peta(barisFaktur({ total: 2_220_000, storeId: "t1", tanggal: HARI, pengaturanPpn: NON_PKP }))).toEqual({
      "AR_STORE|t1|": 2_220_000,
      "SALES_REVENUE|t1|PUTUS": -2_220_000,
    });
    expect(peta(barisFaktur({ total: 1_110_000, storeId: "t1", tanggal: HARI, pengaturanPpn: PKP }))).toEqual({
      "AR_STORE|t1|": 1_110_000,
      "SALES_REVENUE|t1|PUTUS": -1_000_000,
      "PPN_KELUARAN||": -110_000,
    });
    expect(barisFaktur({ total: 0, storeId: "t1", tanggal: HARI, pengaturanPpn: NON_PKP })).toEqual([]);
  });
});

describe("jenis potongan materai (temuan kecil uji akuntansi 2)", () => {
  it("materai/meterai bawaannya biaya bank & administrasi, bukan potongan penjualan; jenis lain dan potongan retur tanpa bawaan", () => {
    for (const nama of ["Materai", "meterai", "Bea meterai 10.000", "Biaya materai"]) {
      expect(peranBawaanJenisPotongan(nama, "NOMINAL")).toBe("BANK_CHARGES");
    }
    expect(peranBawaanJenisPotongan("Materai", "DARI_RETUR")).toBeNull();
    expect(peranBawaanJenisPotongan("Potongan promosi", "NOMINAL")).toBeNull();
    expect(peranBawaanJenisPotongan("Lain-lain", "PERSEN")).toBeNull();
    // Peran bawaan memang peran yang boleh dipilih di master.
    expect(peranPotongan({ postingRole: peranBawaanJenisPotongan("Materai", "NOMINAL"), pkpOnly: false })).toBe("BANK_CHARGES");
  });

  it("formulir jenis BARU mengikuti nama selama peran belum dipilih sendiri; pilihan orang tidak ditimpa", () => {
    expect(peranIsianJenisBaru({ namaLama: "", namaBaru: "Materai", cara: "NOMINAL", peranSekarang: null })).toBe("BANK_CHARGES");
    expect(peranIsianJenisBaru({ namaLama: "Materai", namaBaru: "Materai 10rb", cara: "NOMINAL", peranSekarang: "BANK_CHARGES" })).toBe("BANK_CHARGES");
    expect(peranIsianJenisBaru({ namaLama: "Materai", namaBaru: "Mat", cara: "NOMINAL", peranSekarang: "BANK_CHARGES" })).toBeNull();
    expect(peranIsianJenisBaru({ namaLama: "Mat", namaBaru: "Materai", cara: "NOMINAL", peranSekarang: "LOSS_EXPENSE" })).toBe("LOSS_EXPENSE");
  });

  it("peran yang berlaku untuk ditampilkan di master: dipilih, atau otomatis", () => {
    expect(peranPotongan({ postingRole: null, pkpOnly: false })).toBe("SALES_DISCOUNT");
    expect(peranPotongan({ postingRole: null, pkpOnly: true })).toBe("PPH23_PREPAID");
  });
});
