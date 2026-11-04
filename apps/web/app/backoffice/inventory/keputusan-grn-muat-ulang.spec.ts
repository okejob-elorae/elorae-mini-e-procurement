import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/*
 * Sesudah pemilik menyetujui atau menolak GRN terima-lebih dari tab GRN, baris itu harus
 * menunjukkan keputusannya dan berhenti menawarkan keputusan lagi. Dulu `onSelesai` hanya
 * memanggil `fetchData` (stok + penyesuaian), jadi daftar GRN tetap berlencana lama sampai
 * halaman dimuat ulang. Penjaga sumber: keputusan juga menaikkan pemicu muat ulang daftar GRN.
 */
const sumber = readFileSync(path.join(__dirname, "InventoryPageClient.tsx"), "utf8");

describe("keputusan pemilik atas GRN memuat ulang daftar GRN", () => {
  it("efek daftar GRN ikut bergantung pada pemicu muat ulang", () => {
    expect(sumber).toContain("[grnPage, grnPageSize, grnSearchDebounced, grnKonfirmasi, grnMuatUlang, tToasts]");
  });

  it("keputusan pemilik menaikkan pemicu itu, lalu memuat ulang stok dan penyesuaian", () => {
    expect(sumber).toMatch(/<KeputusanPemilikGrn[\s\S]*?onSelesai=\{async \(\) => \{\s*setGrnMuatUlang\(\(n\) => n \+ 1\);\s*await fetchData\(\);/);
    expect(sumber).not.toContain("onSelesai={fetchData}");
  });
});
