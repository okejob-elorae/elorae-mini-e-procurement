import { describe, expect, it } from "vitest";
import { bisaDikirimSebagaiReturLain, nilaiTeksReturTertahan } from "./retur-lain";

describe("nilaiTeksReturTertahan", () => {
  it("menyebut nomor nota yang barang selisihnya cocok", () => {
    expect(nilaiTeksReturTertahan({ noNrtSelisih: "NRT-4471" })).toEqual({ noNrt: "NRT-4471" });
  });

  it("tanpa nomor tetap mengisi tempat kosongnya, supaya teksnya tidak gagal diformat", () => {
    expect(nilaiTeksReturTertahan({ noNrtSelisih: undefined })).toEqual({ noNrt: "—" });
    expect(nilaiTeksReturTertahan({ noNrtSelisih: "" })).toEqual({ noNrt: "—" });
  });
});

describe("bisaDikirimSebagaiReturLain", () => {
  it("hanya nota retur yang gagal karena barangnya cocok dengan barang selisih nota lain", () => {
    expect(bisaDikirimSebagaiReturLain({ syncState: "failed", error: "ADA_SELISIH_DITEMUKAN" })).toBe(true);
  });

  it("penolakan lain tetap hanya Coba lagi / Hapus", () => {
    expect(bisaDikirimSebagaiReturLain({ syncState: "failed", error: "NOMOR_DIPAKAI" })).toBe(false);
    expect(bisaDikirimSebagaiReturLain({ syncState: "failed", error: undefined })).toBe(false);
  });

  it("yang masih menunggu atau sedang dikirim tidak ditawari", () => {
    expect(bisaDikirimSebagaiReturLain({ syncState: "pending", error: "ADA_SELISIH_DITEMUKAN" })).toBe(false);
    expect(bisaDikirimSebagaiReturLain({ syncState: "syncing", error: undefined })).toBe(false);
  });
});
