import { describe, expect, it } from "vitest";
import { alasanBelumBisaPosting, keadaanSaldo } from "./alasan-posting";

/*
 * Tombol "Posting Jurnal" yang mati harus menyebut alasannya — kekurangan
 * PERTAMA menurut urutan isian (deskripsi → baris → nominal → seimbang).
 */

const baris = (chartAccountId: string, debit: string, credit: string) => ({ chartAccountId, debit, credit });

describe("alasanBelumBisaPosting", () => {
  it("formulir kosong → minta deskripsi dulu", () => {
    expect(alasanBelumBisaPosting({ description: "", lines: [baris("", "", ""), baris("", "", "")] })).toEqual({
      kunci: "description",
    });
  });

  it("deskripsi spasi saja dianggap kosong", () => {
    expect(alasanBelumBisaPosting({ description: "   ", lines: [] })).toEqual({ kunci: "description" });
  });

  it("baris bernominal tanpa akun disebut nomornya (akan terbuang diam-diam bila dikirim)", () => {
    expect(
      alasanBelumBisaPosting({ description: "Saldo awal", lines: [baris("a1", "1000", ""), baris("", "", "1000")] }),
    ).toEqual({ kunci: "lineAccount", n: 2 });
  });

  it("kurang dari dua baris berakun dan bernominal", () => {
    expect(
      alasanBelumBisaPosting({ description: "Saldo awal", lines: [baris("a1", "1000", ""), baris("a2", "", "")] }),
    ).toEqual({ kunci: "twoLines" });
  });

  it("debit dan kredit belum sama", () => {
    expect(
      alasanBelumBisaPosting({ description: "Saldo awal", lines: [baris("a1", "1000", ""), baris("a2", "", "900")] }),
    ).toEqual({ kunci: "unbalanced" });
  });

  it("semua terpenuhi → null", () => {
    expect(
      alasanBelumBisaPosting({ description: "Saldo awal", lines: [baris("a1", "1000", ""), baris("a2", "", "1000")] }),
    ).toBeNull();
  });
});

describe("keadaanSaldo — 'Seimbang' tidak tampil saat total masih 0", () => {
  it("kosong, seimbang, belum seimbang", () => {
    expect(keadaanSaldo(0, 0)).toBe("kosong");
    expect(keadaanSaldo(1000, 1000)).toBe("seimbang");
    expect(keadaanSaldo(1000, 999.995)).toBe("seimbang");
    expect(keadaanSaldo(1000, 900)).toBe("belum");
  });
});
