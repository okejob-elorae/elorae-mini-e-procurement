import { describe, expect, it } from "vitest";
import {
  BATAS_CATATAN_SOROT,
  bacaCatatan,
  barisBerubah,
  gabungCatatan,
  tandaGabungan,
  uraiTanda,
} from "./sorot";

describe("bacaCatatan", () => {
  it("kosong, rusak, atau bukan objek dibaca sebagai belum ada catatan", () => {
    expect(bacaCatatan(null)).toBeNull();
    expect(bacaCatatan("")).toBeNull();
    expect(bacaCatatan("{rusak")).toBeNull();
    expect(bacaCatatan("[1,2]")).toBeNull();
    expect(bacaCatatan("42")).toBeNull();
  });

  it("hanya pasangan id → teks yang dipakai", () => {
    expect(bacaCatatan(JSON.stringify({ a: "DRAFT", b: 3, c: "SUBMITTED" }))).toEqual({
      a: "DRAFT",
      c: "SUBMITTED",
    });
  });
});

describe("barisBerubah", () => {
  const baris = [
    { id: "a", tanda: "APPROVED" },
    { id: "b", tanda: "PENDING" },
    { id: "c", tanda: "REJECTED" },
  ];

  it("tanpa catatan sebelumnya (kunjungan pertama) tidak ada yang menyala", () => {
    expect(barisBerubah(null, baris)).toEqual([]);
  });

  it("hanya baris yang statusnya berubah sejak terakhir dilihat", () => {
    expect(barisBerubah({ a: "PENDING", b: "PENDING", c: "REJECTED" }, baris)).toEqual(["a"]);
  });

  it("baris baru yang belum pernah terlihat tidak menyala", () => {
    expect(barisBerubah({ b: "PENDING" }, baris)).toEqual([]);
  });

  it("baris yang baru saja ditandai sendiri tidak dinyalakan dua kali", () => {
    expect(
      barisBerubah({ a: "PENDING", b: "DRAFT", c: "REJECTED" }, baris, new Set(["a"])),
    ).toEqual(["b"]);
  });

  it("id ganda dalam satu daftar hanya dihitung sekali", () => {
    expect(
      barisBerubah({ a: "PENDING" }, [
        { id: "a", tanda: "APPROVED" },
        { id: "a", tanda: "APPROVED" },
      ]),
    ).toEqual(["a"]);
  });
});

describe("gabungCatatan", () => {
  it("memperbarui dan menambah tanpa membuang baris dari halaman lain", () => {
    expect(
      gabungCatatan({ x: "DRAFT", a: "PENDING" }, [
        { id: "a", tanda: "APPROVED" },
        { id: "b", tanda: "PENDING" },
      ]),
    ).toEqual({ x: "DRAFT", a: "APPROVED", b: "PENDING" });
  });

  it("dari kosong menjadi catatan halaman ini", () => {
    expect(gabungCatatan(null, [{ id: "a", tanda: "1" }])).toEqual({ a: "1" });
  });

  it("dibatasi: yang paling lama tidak dilihat dibuang lebih dulu", () => {
    const hasil = gabungCatatan({ lama: "1", tengah: "1", baru: "1" }, [{ id: "tengah", tanda: "2" }], 2);
    expect(Object.keys(hasil)).toEqual(["baru", "tengah"]);
    expect(hasil.tengah).toBe("2");
  });

  it("batas bawaan cukup besar untuk beberapa halaman daftar", () => {
    expect(BATAS_CATATAN_SOROT).toBeGreaterThanOrEqual(200);
  });
});

describe("tandaGabungan / uraiTanda", () => {
  it("bolak-balik tanpa kehilangan isi, juga untuk karakter aneh", () => {
    const baris = [
      { id: "cm1|x", tanda: "A|B" },
      { id: "\"kutip\"", tanda: "" },
    ];
    expect(uraiTanda(tandaGabungan(baris))).toEqual(baris);
  });

  it("isi sama → tanda sama (supaya efek tidak berjalan di setiap render)", () => {
    expect(tandaGabungan([{ id: "a", tanda: "1" }])).toBe(tandaGabungan([{ id: "a", tanda: "1" }]));
    expect(tandaGabungan([{ id: "a", tanda: "1" }])).not.toBe(tandaGabungan([{ id: "a", tanda: "2" }]));
  });

  it("teks rusak diurai sebagai daftar kosong", () => {
    expect(uraiTanda("bukan json")).toEqual([]);
  });
});
