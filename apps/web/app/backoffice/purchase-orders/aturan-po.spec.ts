import { describe, expect, it } from "vitest";
import { bolehTerimaBarang, keadaanBatalPo, tampilStatusBayar } from "./aturan-po";

/*
 * Tombol di rincian dan daftar PO mengikuti satu aturan. Server tetap
 * penjaganya (`batalkanPurchaseOrder`, `createGRN`); ini supaya layar tidak
 * menawarkan tombol yang pasti ditolak, dan menyebut alasannya.
 */
describe("bolehTerimaBarang", () => {
  it("PO yang sudah dikirim ke pemasok atau baru diterima sebagian", () => {
    expect(bolehTerimaBarang("SUBMITTED")).toBe(true);
    expect(bolehTerimaBarang("PARTIAL")).toBe(true);
  });

  it("draf, lengkap, lebih, ditutup, dibatalkan → tidak", () => {
    for (const s of ["DRAFT", "CLOSED", "OVER", "CANCELLED"]) expect(bolehTerimaBarang(s)).toBe(false);
  });
});

describe("keadaanBatalPo", () => {
  const baris = (...diterima: number[]) => diterima.map((receivedQty) => ({ receivedQty }));

  it("draf / dikirim tanpa penerimaan → boleh", () => {
    expect(keadaanBatalPo({ status: "DRAFT", items: baris(0, 0), grns: [] })).toBe("boleh");
    expect(keadaanBatalPo({ status: "SUBMITTED", items: baris(0), grns: [] })).toBe("boleh");
  });

  it("sudah ada barang diterima (50 dari 100) → mati, pakai Tutup PO", () => {
    expect(keadaanBatalPo({ status: "PARTIAL", items: baris(50, 0), grns: [{ id: "g1" }] })).toBe("mati");
  });

  it("GRN terima-lebih yang menunggu pemilik: status masih SUBMITTED tapi GRN sudah ada → mati", () => {
    expect(keadaanBatalPo({ status: "SUBMITTED", items: baris(0), grns: [{ id: "g1" }] })).toBe("mati");
  });

  it("qty diterima tanpa GRN tertaut (penerimaan lama) juga → mati", () => {
    expect(keadaanBatalPo({ status: "OVER", items: baris(120), grns: [] })).toBe("mati");
  });

  it("qty diterima berupa teks desimal dari server", () => {
    expect(keadaanBatalPo({ status: "PARTIAL", items: [{ receivedQty: "0.50" }], grns: [] })).toBe("mati");
  });

  it("sudah ditutup atau dibatalkan → sembunyi", () => {
    expect(keadaanBatalPo({ status: "CLOSED", items: baris(100), grns: [] })).toBe("sembunyi");
    expect(keadaanBatalPo({ status: "CANCELLED", items: baris(0), grns: [] })).toBe("sembunyi");
  });

  it("daftar PO hanya membawa jumlah GRN", () => {
    expect(keadaanBatalPo({ status: "SUBMITTED", items: baris(0), jumlahGrn: 1 })).toBe("mati");
    expect(keadaanBatalPo({ status: "SUBMITTED", items: baris(0), jumlahGrn: 0 })).toBe("boleh");
  });
});

describe("tampilStatusBayar", () => {
  it("PO draf dan dibatalkan tidak punya tagihan, jadi tanpa lencana bayar", () => {
    expect(tampilStatusBayar("DRAFT")).toBe(false);
    expect(tampilStatusBayar("CANCELLED")).toBe(false);
  });

  it("PO yang sudah dikirim ke pemasok menampilkannya", () => {
    for (const s of ["SUBMITTED", "PARTIAL", "CLOSED", "OVER"]) expect(tampilStatusBayar(s)).toBe(true);
  });
});
