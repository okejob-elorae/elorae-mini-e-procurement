import { describe, expect, it } from "vitest";
import { adaKoreksi, gabungDenganHitungan, periksaIsian, rupiahSah } from "./validasi";

describe("rupiahSah", () => {
  it("menerima nol dan dua desimal, menolak negatif, tiga desimal, NaN, dan teks", () => {
    expect(rupiahSah(0)).toBe(true);
    expect(rupiahSah(1250.5)).toBe(true);
    expect(rupiahSah(0.07)).toBe(true);
    expect(rupiahSah(-1)).toBe(false);
    expect(rupiahSah(1.234)).toBe(false);
    expect(rupiahSah(Number.NaN)).toBe(false);
    expect(rupiahSah("1000")).toBe(false);
  });
});

describe("periksaIsian", () => {
  it("saldo akun: baris kosong dibuang, debit DAN kredit sekaligus ditolak, akun ganda ditolak", () => {
    expect(periksaIsian("ACCOUNTS", [{ akunId: "a", debit: 10, kredit: 0 }, { akunId: "b", debit: 0, kredit: 0 }])).toEqual({
      ok: true,
      baris: [{ akunId: "a", debit: 10, kredit: 0 }],
    });
    expect(periksaIsian("ACCOUNTS", [{ akunId: "a", debit: 10, kredit: 5 }])).toEqual({ ok: false, kode: "ISIAN_TIDAK_SAH", baris: 1 });
    expect(periksaIsian("ACCOUNTS", [{ akunId: "a", debit: 10, kredit: 0 }, { akunId: "a", debit: 0, kredit: 3 }])).toEqual({
      ok: false,
      kode: "AKUN_GANDA",
      baris: 2,
    });
    expect(periksaIsian("ACCOUNTS", [{ akunId: "a", debit: -10, kredit: 0 }])).toMatchObject({ ok: false, kode: "ANGKA_TIDAK_SAH" });
    expect(periksaIsian("ACCOUNTS", "bukan larik")).toEqual({ ok: false, kode: "ISIAN_TIDAK_SAH" });
  });

  it("persediaan: varian kosong dan null adalah barang yang sama", () => {
    expect(
      periksaIsian("INVENTORY", [
        { itemId: "i1", variantSku: "", hpp: 1000 },
        { itemId: "i1", variantSku: null, hpp: 2000 },
      ]),
    ).toEqual({ ok: false, kode: "BARANG_GANDA", baris: 2 });
    expect(periksaIsian("INVENTORY", [{ itemId: "i1", variantSku: "X-S", hpp: 1000 }])).toEqual({
      ok: true,
      baris: [{ itemId: "i1", variantSku: "X-S", hpp: 1000 }],
    });
  });

  it("piutang marketplace: hanya kanal marketplace; piutang toko tidak menerima isian", () => {
    expect(periksaIsian("AR_MARKETPLACE", [{ kanal: "PUTUS", jumlah: 1 }])).toEqual({ ok: false, kode: "KANAL_TIDAK_SAH", baris: 1 });
    expect(periksaIsian("AR_MARKETPLACE", [{ kanal: "SHOPEE", jumlah: 1 }, { kanal: "SHOPEE", jumlah: 2 }])).toMatchObject({ kode: "KANAL_GANDA" });
    expect(periksaIsian("AR_STORE", [{ storeId: "x", jumlah: 999 }])).toEqual({ ok: true, baris: [] });
  });

  it("hutang: pemasok ganda ditolak", () => {
    expect(periksaIsian("AP", [{ supplierId: "s", jumlah: 1 }, { supplierId: "s", jumlah: 1 }])).toMatchObject({ kode: "PEMASOK_GANDA" });
  });
});

describe("gabungDenganHitungan", () => {
  const kunci = (b: { kanal: string }) => b.kanal;

  it("isian menang per kunci; hitungan yang tidak dikirim tetap ikut; tambahan manual tercatat dihitung 0", () => {
    const hasil = gabungDenganHitungan(
      [
        { kanal: "SHOPEE", jumlah: 1000 },
        { kanal: "TIKTOK", jumlah: 500 },
      ],
      [
        { kanal: "SHOPEE", jumlah: 900 },
        { kanal: "TOKOPEDIA", jumlah: 50 },
      ],
      kunci,
    );
    expect(hasil).toEqual([
      { kanal: "SHOPEE", jumlah: 900, dihitung: 1000 },
      { kanal: "TIKTOK", jumlah: 500, dihitung: 500 },
      { kanal: "TOKOPEDIA", jumlah: 50, dihitung: 0 },
    ]);
    expect(adaKoreksi(hasil)).toBe(true);
    expect(adaKoreksi([{ jumlah: 500, dihitung: 500 }])).toBe(false);
  });
});
