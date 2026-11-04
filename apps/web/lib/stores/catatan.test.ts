import { describe, expect, it } from "vitest";
import { BATAS_CATATAN, bolehAksesCatatan, hakCatatan, ringkasCatatan, urutkanCatatan, validasiCatatan } from "./catatan";

describe("validasiCatatan", () => {
  it("dirapikan: ujung dipangkas, baris Windows dinormalkan", () => {
    expect(validasiCatatan("  Pemilik libur tiap Jumat\r\nTelepon dulu  ")).toEqual({
      ok: true,
      body: "Pemilik libur tiap Jumat\nTelepon dulu",
    });
  });

  it("kosong ditolak", () => {
    expect(validasiCatatan("   \n ")).toEqual({ ok: false, kode: "KOSONG" });
    expect(validasiCatatan(undefined)).toEqual({ ok: false, kode: "KOSONG" });
    expect(validasiCatatan(42)).toEqual({ ok: false, kode: "KOSONG" });
  });

  it(`paling panjang ${BATAS_CATATAN} karakter`, () => {
    expect(validasiCatatan("x".repeat(BATAS_CATATAN)).ok).toBe(true);
    expect(validasiCatatan("x".repeat(BATAS_CATATAN + 1))).toEqual({ ok: false, kode: "TERLALU_PANJANG" });
    // Spasi di ujung tidak dihitung.
    expect(validasiCatatan(`  ${"x".repeat(BATAS_CATATAN)}  `).ok).toBe(true);
  });
});

describe("hakCatatan", () => {
  it("penulis boleh mengubah, menghapus, dan menyematkan catatannya sendiri", () => {
    expect(hakCatatan({ userId: "u1", authorId: "u1", kelolaSemua: false })).toBe(true);
  });
  it("orang lain tidak boleh, kecuali pemegang stores:manage", () => {
    expect(hakCatatan({ userId: "u2", authorId: "u1", kelolaSemua: false })).toBe(false);
    expect(hakCatatan({ userId: "u2", authorId: "u1", kelolaSemua: true })).toBe(true);
  });
});

describe("bolehAksesCatatan", () => {
  const dasar = { userId: "u1", storeId: "s1" };

  it("kantor dengan stores:view selalu boleh", () => {
    expect(bolehAksesCatatan({ ...dasar, kantorLihat: true, lapangan: null })).toBe(true);
  });

  it("bukan kantor dan bukan orang lapangan: tidak boleh", () => {
    expect(bolehAksesCatatan({ ...dasar, kantorLihat: false, lapangan: null })).toBe(false);
  });

  it("SPG hanya di toko tetapnya", () => {
    const spg = (tokoTetap: string) => ({ tokoTetap, terkunci: false, penanggungJawabId: null });
    expect(bolehAksesCatatan({ ...dasar, kantorLihat: false, lapangan: spg("s1") })).toBe(true);
    expect(bolehAksesCatatan({ ...dasar, kantorLihat: false, lapangan: spg("s2") })).toBe(false);
  });

  it("salesman mengikuti kunci 'hanya toko sendiri' yang sama dengan halaman toko", () => {
    const sales = (terkunci: boolean, penanggungJawabId: string | null) => ({ tokoTetap: null, terkunci, penanggungJawabId });
    expect(bolehAksesCatatan({ ...dasar, kantorLihat: false, lapangan: sales(false, "lain") })).toBe(true);
    expect(bolehAksesCatatan({ ...dasar, kantorLihat: false, lapangan: sales(true, "u1") })).toBe(true);
    expect(bolehAksesCatatan({ ...dasar, kantorLihat: false, lapangan: sales(true, "lain") })).toBe(false);
    expect(bolehAksesCatatan({ ...dasar, kantorLihat: false, lapangan: sales(true, null) })).toBe(false);
  });
});

describe("urutkanCatatan", () => {
  const c = (id: string, pinned: boolean, menit: number) => ({ id, pinned, createdAt: new Date(Date.UTC(2026, 9, 1, 0, menit)) });

  it("tersemat di atas, lalu terbaru", () => {
    const hasil = urutkanCatatan([c("lama", false, 1), c("semat-lama", true, 0), c("baru", false, 5), c("semat-baru", true, 3)]);
    expect(hasil.map((x) => x.id)).toEqual(["semat-baru", "semat-lama", "baru", "lama"]);
  });
});

describe("ringkasCatatan", () => {
  it("satu baris, dipotong", () => {
    expect(ringkasCatatan("Pemilik\nlibur Jumat", 80)).toBe("Pemilik libur Jumat");
    expect(ringkasCatatan("aaaa bbbb cccc dddd", 12)).toBe("aaaa bbbb…");
  });
});
