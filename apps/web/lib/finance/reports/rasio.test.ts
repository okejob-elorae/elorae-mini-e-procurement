import { describe, expect, it } from "vitest";
import type { BalanceRow } from "./balances";
import { golonganAkunRasio, hitungRasio, ringkasPosisiRasio, type KelasAkunRasio } from "./rasio";

function kelas(over: Partial<KelasAkunRasio> & { accountId: string }): KelasAkunRasio {
  return { accountId: over.accountId, type: over.type ?? "ASET", section: over.section ?? null, roles: over.roles ?? [] };
}

describe("golonganAkunRasio", () => {
  it("kas dan modal kerja = aset lancar", () => {
    expect(golonganAkunRasio(kelas({ accountId: "kas", section: "KAS", roles: ["CASH"] })).golongan).toBe("ASET_LANCAR");
    expect(golonganAkunRasio(kelas({ accountId: "ar", section: "OPERASIONAL", roles: ["AR"] }))).toMatchObject({
      golongan: "ASET_LANCAR",
      piutangDagang: true,
    });
    expect(golonganAkunRasio(kelas({ accountId: "inv", section: "OPERASIONAL", roles: ["INVENTORY_FG"] }))).toMatchObject({
      golongan: "ASET_LANCAR",
      persediaan: true,
    });
    expect(golonganAkunRasio(kelas({ accountId: "pre", section: "OPERASIONAL", roles: ["PPN_MASUKAN"] }))).toMatchObject({
      golongan: "ASET_LANCAR",
      dibayarDimuka: true,
    });
  });

  it("aset tetap dan akumulasi penyusutan = tidak lancar (walau akumulasi penyusutan berseksi operasional di arus kas)", () => {
    expect(golonganAkunRasio(kelas({ accountId: "fa", section: "INVESTASI", roles: ["FIXED_ASSET"] })).golongan).toBe("ASET_TIDAK_LANCAR");
    expect(golonganAkunRasio(kelas({ accountId: "ad", section: "OPERASIONAL", roles: ["ACCUM_DEPRECIATION"] })).golongan).toBe(
      "ASET_TIDAK_LANCAR",
    );
  });

  it("aset tanpa klasifikasi tidak dihitung lancar (dilaporkan terpisah)", () => {
    expect(golonganAkunRasio(kelas({ accountId: "x", section: null })).golongan).toBe("ASET_TAK_TERKLASIFIKASI");
  });

  it("liabilitas pendanaan = jangka panjang; selainnya (termasuk tanpa klasifikasi) lancar", () => {
    expect(golonganAkunRasio(kelas({ accountId: "loan", type: "LIABILITAS", section: "PENDANAAN" })).golongan).toBe(
      "LIABILITAS_JANGKA_PANJANG",
    );
    expect(golonganAkunRasio(kelas({ accountId: "ap", type: "LIABILITAS", section: "OPERASIONAL", roles: ["AP"] }))).toMatchObject({
      golongan: "LIABILITAS_LANCAR",
      hutangDagang: true,
    });
    expect(golonganAkunRasio(kelas({ accountId: "y", type: "LIABILITAS", section: null })).golongan).toBe("LIABILITAS_LANCAR");
  });

  it("akun laba rugi dan ekuitas tidak bergolongan", () => {
    expect(golonganAkunRasio(kelas({ accountId: "e", type: "EKUITAS", section: "PENDANAAN" })).golongan).toBeNull();
    expect(golonganAkunRasio(kelas({ accountId: "r", type: "PENDAPATAN" })).golongan).toBeNull();
  });
});

function saldo(accountId: string, signed: number, type: BalanceRow["type"] = "ASET"): BalanceRow {
  return {
    accountId,
    code: accountId,
    name: accountId,
    type,
    parentId: null,
    depth: 0,
    isActive: true,
    hasChildren: false,
    debit: 0,
    credit: 0,
    signed,
  };
}

const KELAS = new Map<string, KelasAkunRasio>([
  ["kas", kelas({ accountId: "kas", section: "KAS", roles: ["BANK"] })],
  ["ar", kelas({ accountId: "ar", section: "OPERASIONAL", roles: ["AR"] })],
  ["arToko", kelas({ accountId: "arToko", section: "OPERASIONAL", roles: ["AR_STORE"] })],
  ["inv", kelas({ accountId: "inv", section: "OPERASIONAL", roles: ["INVENTORY_FG"] })],
  ["pre", kelas({ accountId: "pre", section: "OPERASIONAL", roles: ["PREPAID_EXPENSE"] })],
  ["fa", kelas({ accountId: "fa", section: "INVESTASI", roles: ["FIXED_ASSET"] })],
  ["lain", kelas({ accountId: "lain", section: null })],
  ["ap", kelas({ accountId: "ap", type: "LIABILITAS", section: "OPERASIONAL", roles: ["AP"] })],
  ["pajak", kelas({ accountId: "pajak", type: "LIABILITAS", section: "OPERASIONAL", roles: ["PPN_PAYABLE"] })],
  ["pinjam", kelas({ accountId: "pinjam", type: "LIABILITAS", section: "PENDANAAN" })],
]);

describe("ringkasPosisiRasio", () => {
  it("menjumlah per golongan dalam sen", () => {
    const r = ringkasPosisiRasio(
      [
        saldo("kas", 1000.1),
        saldo("ar", 500.2),
        saldo("arToko", 300),
        saldo("inv", 2000),
        saldo("pre", 100),
        saldo("fa", 9000),
        saldo("lain", 77),
        saldo("ap", 800, "LIABILITAS"),
        saldo("pajak", 200, "LIABILITAS"),
        saldo("pinjam", 5000, "LIABILITAS"),
        saldo("tidakDikenal", 5),
      ],
      KELAS,
    );
    expect(r).toEqual({
      asetLancar: 3900.3,
      persediaan: 2000,
      dibayarDimuka: 100,
      piutangDagang: 800.2,
      liabilitasLancar: 1000,
      hutangDagang: 800,
      asetTakTerklasifikasi: 82,
      akunTakTerklasifikasi: 2,
    });
  });
});

describe("hitungRasio", () => {
  const awal = {
    asetLancar: 3000,
    persediaan: 1000,
    dibayarDimuka: 0,
    piutangDagang: 400,
    liabilitasLancar: 1000,
    hutangDagang: 600,
    asetTakTerklasifikasi: 0,
    akunTakTerklasifikasi: 0,
  };
  const akhir = { ...awal, asetLancar: 4000, persediaan: 3000, dibayarDimuka: 200, piutangDagang: 800, liabilitasLancar: 2000, hutangDagang: 1000 };

  it("margin, likuiditas, dan perputaran", () => {
    const r = hitungRasio({
      labaRugi: { pendapatan: 10000, hpp: 6000, labaKotor: 4000, labaBersih: 1500 },
      awal,
      akhir,
      hari: 30,
    });
    expect(r.marginKotor).toBe(40);
    expect(r.marginBersih).toBe(15);
    expect(r.rasioLancar).toBe(2);
    // (4000 − 3000 − 200) / 2000
    expect(r.rasioCepat).toBeCloseTo(0.4, 10);
    // HPP 6000 / rata-rata persediaan 2000
    expect(r.perputaranPersediaan).toBe(3);
    expect(r.hariPersediaan).toBe(10);
    // rata-rata piutang 600 / pendapatan 10000 × 30 hari
    expect(r.dso).toBeCloseTo(1.8, 10);
    // rata-rata hutang 800 / HPP 6000 × 30 hari
    expect(r.dpo).toBeCloseTo(4, 10);
    expect(r.komponen).toMatchObject({ rataPersediaan: 2000, rataPiutang: 600, rataHutang: 800, hari: 30 });
  });

  it("penyebut nol atau negatif → null, bukan tak terhingga", () => {
    const nol = { ...akhir, liabilitasLancar: 0, persediaan: 0 };
    const r = hitungRasio({
      labaRugi: { pendapatan: 0, hpp: 0, labaKotor: 0, labaBersih: -500 },
      awal: { ...awal, persediaan: 0 },
      akhir: nol,
      hari: 30,
    });
    expect(r.marginKotor).toBeNull();
    expect(r.marginBersih).toBeNull();
    expect(r.rasioLancar).toBeNull();
    expect(r.rasioCepat).toBeNull();
    expect(r.perputaranPersediaan).toBeNull();
    expect(r.hariPersediaan).toBeNull();
    expect(r.dso).toBeNull();
    expect(r.dpo).toBeNull();
  });
});
