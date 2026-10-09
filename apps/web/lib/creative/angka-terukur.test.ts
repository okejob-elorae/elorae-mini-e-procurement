import { describe, expect, it } from "vitest";
import { akunUtama, ikutiTerukur, samaDenganTerukur, TOLERANSI_ER } from "./angka-terukur";

describe("ikutiTerukur", () => {
  it("angka KOL kosong → diisi angka terukur", () => {
    expect(ikutiTerukur(null, null, 7.69, TOLERANSI_ER)).toBe(7.69);
    expect(ikutiTerukur(null, 5.1, 7.69, TOLERANSI_ER)).toBe(7.69);
  });

  it("angka KOL sama dengan terukur sebelumnya (belum ditimpa tangan) → ikut angka baru", () => {
    expect(ikutiTerukur(5.1, 5.1, 7.69, TOLERANSI_ER)).toBe(7.69);
    expect(ikutiTerukur(30_143, 30_143, 31_000)).toBe(31_000);
  });

  it("angka KOL berbeda dari terukur sebelumnya (diketik pemilik) → dibiarkan", () => {
    expect(ikutiTerukur(4.8, 5.1, 7.69, TOLERANSI_ER)).toBeNull();
    expect(ikutiTerukur(12_000, 30_143, 31_000)).toBeNull();
    // Belum pernah terukur tapi KOL sudah punya angka: itu ketikan pemilik.
    expect(ikutiTerukur(4.8, null, 7.69, TOLERANSI_ER)).toBeNull();
  });

  it("tidak ada angka terukur baru, atau sudah sama → tidak menulis apa pun", () => {
    expect(ikutiTerukur(null, 5.1, null, TOLERANSI_ER)).toBeNull();
    expect(ikutiTerukur(7.69, 7.69, 7.69, TOLERANSI_ER)).toBeNull();
  });
});

describe("samaDenganTerukur", () => {
  it("kosong di salah satu sisi bukan 'sama'", () => {
    expect(samaDenganTerukur(null, 7.69, TOLERANSI_ER)).toBe(false);
    expect(samaDenganTerukur(7.69, null, TOLERANSI_ER)).toBe(false);
    expect(samaDenganTerukur(7.694, 7.69, TOLERANSI_ER)).toBe(true);
  });
});

describe("akunUtama", () => {
  it("pengikut terbanyak; seri → id terkecil", () => {
    expect(akunUtama([{ id: "b", followers: 10 }, { id: "a", followers: 50 }])?.id).toBe("a");
    expect(akunUtama([{ id: "b", followers: 10 }, { id: "a", followers: 10 }])?.id).toBe("a");
    expect(akunUtama([])).toBeNull();
  });
});
