import { describe, expect, it } from "vitest";
import { jumlahDiterima, payloadGajiHp } from "./komisi-hp";
import type { KomisiResmiHp } from "./komisi-queries";

/*
 * Satu aturan "yang benar-benar diterima" untuk layar Gaji & komisi dan kartu beranda SPG:
 * total − potongan beban barang hilang, tidak di bawah nol, dalam sen. Koreksi komisi ikut
 * angka itu dari pemuatnya (`ringkasGajiSaya`), tidak dihitung ulang di muatan.
 */

describe("jumlahDiterima", () => {
  it("total dikurangi potongan beban barang hilang", () => {
    expect(jumlahDiterima({ total: 150_000, potonganHilang: 20_000 })).toBe(130_000);
  });

  it("potongan yang lebih besar dari totalnya tidak membuat angka minus", () => {
    expect(jumlahDiterima({ total: 10_000, potonganHilang: 25_000 })).toBe(0);
  });

  it("dibulatkan ke sen", () => {
    expect(jumlahDiterima({ total: 0.3, potonganHilang: 0.1 })).toBe(0.2);
  });
});

describe("payloadGajiHp", () => {
  const resmi: KomisiResmiHp = {
    kunci: "putus:r1",
    jenis: "PUTUS",
    bulanJual: "2026-10",
    bulanBayar: "2026-11",
    toko: "Toko Uji",
    gaji: null,
    komisi: 30_000,
    komisiLama: 22_500,
    total: 30_000,
    potonganHilang: 2_500,
    potong: 15,
    ditetapkan: "2026-11-03T03:00:00.000Z",
    dibayar: null,
    aturanLama: false,
    koreksi: [{ bulanJual: "2026-09", toko: "Toko Uji", jumlah: 17_500, diterapkan: false, dibawa: 0 }],
    diterima: 45_000,
    ditahan: false,
  };
  const f = { bulan: (p: string) => `bulan ${p}`, tanggal: (iso: string) => iso.slice(0, 10) };

  it("membawa angka yang diterima dari pemuatnya, dengan koreksi dan angka lama yang dicoret", () => {
    const p = payloadGajiHp({ perkiraan: null, resmi: [resmi], koreksiMenunggu: [{ bulanJual: "2026-08", toko: "Toko Uji", jumlah: -2_500 }] }, false, f);
    expect(p.resmi[0]).toMatchObject({
      diterima: 45_000,
      komisiLama: 22_500,
      koreksi: [{ bulanLabel: "bulan 2026-09", toko: "Toko Uji", jumlah: 17_500, diterapkan: false, dibawa: 0 }],
      ditahan: false,
    });
    expect(p.koreksiMenunggu).toEqual([{ bulanLabel: "bulan 2026-08", toko: "Toko Uji", jumlah: -2_500 }]);
  });

  it("siklus yang kuncinya dibuka lagi: ditandai belum pasti (tanpa 'akan diterima'); yang sudah dibayar tidak pernah", () => {
    const dibuka: KomisiResmiHp = { ...resmi, jenis: "KONSI", bulanBayar: null, komisiLama: null, koreksi: [], belumPasti: true };
    expect(payloadGajiHp({ perkiraan: null, resmi: [dibuka] }, true, f).resmi[0]).toMatchObject({ bulanBayarLabel: null, belumPasti: true, ditahan: false });
    const dibayar: KomisiResmiHp = { ...dibuka, bulanBayar: "2026-11", dibayar: "2026-11-05T03:00:00.000Z" };
    expect(payloadGajiHp({ perkiraan: null, resmi: [dibayar] }, true, f).resmi[0].belumPasti).toBe(false);
    expect(payloadGajiHp({ perkiraan: null, resmi: [resmi] }, false, f).resmi[0].belumPasti).toBe(false);
  });

  it("tanpa koreksi menunggu: daftar kosong", () => {
    expect(payloadGajiHp({ perkiraan: null, resmi: [] }, true, f).koreksiMenunggu).toEqual([]);
  });
});
