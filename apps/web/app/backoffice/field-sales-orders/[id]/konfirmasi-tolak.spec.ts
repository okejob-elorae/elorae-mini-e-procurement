import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { kunciKonfirmasiTolak } from "./konfirmasi-tolak";

/*
 * Kalimat konfirmasi "Tolak" menurut keadaan pesanan.
 *
 * Dulu setiap pesanan non-konsi membaca "Stok yang direservasi akan dilepas",
 * padahal pre-order yang masih menunggu belum mencadangkan apa pun: stoknya
 * baru dicadangkan saat jendela dirilis (pesanan yang sudah disetujui) atau
 * saat disetujui sesudah rilis. Konsi juga baru dicadangkan saat disetujui.
 */

describe("kunciKonfirmasiTolak", () => {
  it("putus biasa: stok yang dicadangkan saat pesanan dibuat akan dilepas", () => {
    expect(kunciKonfirmasiTolak("PUTUS", null)).toBe("rejectConfirm");
  });

  it("konsi yang menunggu: kalimat konsi, tanpa janji melepas stok", () => {
    expect(kunciKonfirmasiTolak("KONSI", null)).toBe("rejectConfirmKonsi");
    expect(kunciKonfirmasiTolak("KONSI", undefined)).toBe("rejectConfirmKonsi");
  });

  it("pre-order belum dirilis: belum ada stok yang dicadangkan", () => {
    expect(kunciKonfirmasiTolak("PUTUS", { dirilis: false })).toBe("rejectConfirmPreorder");
  });

  it("pre-order sesudah dirilis tapi masih menunggu: tetap belum dicadangkan (dicadangkan saat disetujui)", () => {
    expect(kunciKonfirmasiTolak("PUTUS", { dirilis: true })).toBe("rejectConfirmPreorder");
  });

  it("keadaan pre-order tidak dikirim pemanggil: kalimat yang benar untuk semua kasus, bukan janji palsu", () => {
    expect(kunciKonfirmasiTolak("PUTUS", undefined)).toBe("rejectConfirmUnknown");
  });
});

describe("ApproveRejectCard — dialog tolak memakai kunciKonfirmasiTolak", () => {
  const KARTU = readFileSync(join(__dirname, "ApproveRejectCard.tsx"), "utf8");

  it("deskripsi dialog tolak tidak lagi memilih kalimat sendiri", () => {
    expect(KARTU).toContain("kunciKonfirmasiTolak(orderType, preorder)");
    expect(KARTU).not.toMatch(/t\("rejectConfirm"\)/);
    expect(KARTU).not.toMatch(/t\("rejectConfirmKonsi"\)/);
  });

  it("menerima keadaan pre-order lewat prop", () => {
    expect(KARTU).toMatch(/preorder\?: \{ dirilis: boolean \} \| null;/);
  });
});
