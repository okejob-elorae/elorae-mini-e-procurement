import { describe, expect, it } from "vitest";
import { awalKirim, langkahKirim, type KeadaanKirim } from "./pengiriman";

const jalan = (k: KeadaanKirim, ...p: Parameters<typeof langkahKirim>[1][]) => p.reduce(langkahKirim, k);

describe("pemantau sinyal — kapan 'Mengirim…' tampil", () => {
  it("mulai dari keadaan peramban", () => {
    expect(awalKirim(false, 2)).toEqual({ luring: true, mengirim: false, belum: 2 });
    expect(awalKirim(true, 0)).toEqual({ luring: false, mengirim: false, belum: 0 });
  });

  it("putus sinyal: luring, tidak mengirim", () => {
    expect(jalan(awalKirim(true, 1), { jenis: "luring" })).toEqual({ luring: true, mengirim: false, belum: 1 });
  });

  it("tersambung lagi dengan antrean: mengirim sampai antreannya habis", () => {
    let k = jalan(awalKirim(false, 3), { jenis: "daring" });
    expect(k).toEqual({ luring: false, mengirim: true, belum: 3 });
    k = langkahKirim(k, { jenis: "hitung", belum: 1 });
    expect(k.mengirim).toBe(true);
    k = langkahKirim(k, { jenis: "hitung", belum: 0 });
    expect(k).toEqual({ luring: false, mengirim: false, belum: 0 });
  });

  it("tersambung lagi tanpa antrean: tidak ada yang dikirim", () => {
    expect(jalan(awalKirim(false, 0), { jenis: "daring" }).mengirim).toBe(false);
  });

  it("pengiriman yang tenang atau melewati batas berhenti walau masih ada sisa", () => {
    const k = jalan(awalKirim(false, 3), { jenis: "daring" }, { jenis: "hitung", belum: 2 });
    expect(langkahKirim(k, { jenis: "tenang" })).toEqual({ luring: false, mengirim: false, belum: 2 });
    expect(langkahKirim(k, { jenis: "batas" }).mengirim).toBe(false);
  });

  it("kirim ulang manual hanya berlaku saat ada sinyal dan antrean", () => {
    expect(langkahKirim(awalKirim(true, 2), { jenis: "kirimUlang" }).mengirim).toBe(true);
    expect(langkahKirim(awalKirim(true, 0), { jenis: "kirimUlang" }).mengirim).toBe(false);
    expect(langkahKirim(awalKirim(false, 2), { jenis: "kirimUlang" }).mengirim).toBe(false);
  });

  it("hitungan saat luring hanya memperbarui angka", () => {
    expect(langkahKirim(awalKirim(false, 1), { jenis: "hitung", belum: 4 })).toEqual({ luring: true, mengirim: false, belum: 4 });
  });

  it("putus di tengah pengiriman menghentikan 'Mengirim…'", () => {
    const k = jalan(awalKirim(false, 3), { jenis: "daring" }, { jenis: "luring" });
    expect(k).toEqual({ luring: true, mengirim: false, belum: 3 });
  });
});
