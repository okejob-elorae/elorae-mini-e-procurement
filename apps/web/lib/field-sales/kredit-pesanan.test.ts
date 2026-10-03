import { describe, expect, it } from "vitest";
import { CATATAN_KREDIT_TAK_TERBACA, putuskanKreditPesanan, teksAlasanKredit } from "./kredit-pesanan";
import type { HasilKredit } from "@/lib/salesman/kredit";

// formatIDR memakai spasi tak-putus antara "Rp" dan angka; samakan supaya teks uji terbaca biasa.
const biasa = (s: string | null) => (s ?? "").replace(/ /g, " ");

const lewat: HasilKredit["alasan"][number] = { kode: "LEWAT_JANJI", nilai: 1_200_000, faktur: 2 };
const nilai: HasilKredit["alasan"][number] = { kode: "MELEBIHI_BATAS_NILAI", sisaSesudah: 5_000_000, batas: 4_000_000 };
const faktur: HasilKredit["alasan"][number] = { kode: "MELEBIHI_BATAS_FAKTUR", faktur: 4, batas: 3 };

describe("teksAlasanKredit", () => {
  it("menyebut angka setiap alasan", () => {
    expect(biasa(teksAlasanKredit(lewat))).toBe("tagihan lewat janji Rp 1.200.000 (2 faktur)");
    expect(biasa(teksAlasanKredit(nilai))).toBe("sisa Rp 5.000.000 termasuk pesanan ini, dari batas Rp 4.000.000");
    expect(teksAlasanKredit(faktur)).toBe("4 faktur belum lunas dari batas 3");
  });
});

describe("putuskanKreditPesanan", () => {
  it("AMAN → tidak ditahan, tanpa catatan", () => {
    expect(putuskanKreditPesanan({ tingkat: "AMAN", alasan: [] }, "BLOKIR")).toEqual({ blokir: false, ditahan: false, catatan: null });
  });

  it("PERINGATAN → pesanan jalan, catatan keadaan saat dibuat", () => {
    const p = putuskanKreditPesanan({ tingkat: "PERINGATAN", alasan: [lewat, nilai] }, "PERINGATAN");
    expect(p.blokir).toBe(false);
    if (p.blokir) throw new Error("tidak diharapkan");
    expect(p.ditahan).toBe(false);
    expect(biasa(p.catatan)).toBe(
      "Saat dibuat: tagihan lewat janji Rp 1.200.000 (2 faktur); sisa Rp 5.000.000 termasuk pesanan ini, dari batas Rp 4.000.000",
    );
  });

  it("TAHAN → ditahan dengan catatan", () => {
    const p = putuskanKreditPesanan({ tingkat: "TAHAN", alasan: [faktur] }, "TAHAN");
    expect(p).toEqual({ blokir: false, ditahan: true, catatan: "Saat dibuat: 4 faktur belum lunas dari batas 3" });
  });

  it("BLOKIR → ditolak membawa alasannya", () => {
    expect(putuskanKreditPesanan({ tingkat: "BLOKIR", alasan: [lewat] }, "BLOKIR")).toEqual({ blokir: true, alasan: [lewat] });
  });

  it("tagihan gagal dibaca: tidak pernah memblokir, tapi mode ketat menahan", () => {
    expect(putuskanKreditPesanan(null, "PERINGATAN")).toEqual({ blokir: false, ditahan: false, catatan: CATATAN_KREDIT_TAK_TERBACA });
    expect(putuskanKreditPesanan(null, "TAHAN")).toEqual({ blokir: false, ditahan: true, catatan: CATATAN_KREDIT_TAK_TERBACA });
    expect(putuskanKreditPesanan(null, "BLOKIR")).toEqual({ blokir: false, ditahan: true, catatan: CATATAN_KREDIT_TAK_TERBACA });
  });
});
