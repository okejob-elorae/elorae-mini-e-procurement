import { describe, expect, it } from "vitest";
import { angkaSistemTampil, barangTanpaAngka, barisButa, masihMenghitung, rolTanpaAngka, saringBarisButa } from "./angka-sistem";

// Opname gudang dihitung buta: angka sistem (snapshot) dan selisih tidak boleh
// sampai ke layar selama menghitung — tidak di tampilan, tidak di muatan.

describe("angka sistem opname gudang", () => {
  it("is hidden from everyone while counting, approvers and admins included", () => {
    for (const status of ["CREATED", "COUNTING"]) {
      expect(angkaSistemTampil(status, false)).toBe(false);
      expect(angkaSistemTampil(status, true)).toBe(false);
      expect(masihMenghitung(status)).toBe(true);
    }
  });

  it("shows on the approval screen once submitted, but only to whoever may approve", () => {
    expect(angkaSistemTampil("SUBMITTED", true)).toBe(true);
    expect(angkaSistemTampil("SUBMITTED", false)).toBe(false);
    expect(masihMenghitung("SUBMITTED")).toBe(false);
  });

  it("shows to every viewer once approved; a cancelled count stays with approvers (its snapshot is close to today's stock)", () => {
    expect(angkaSistemTampil("APPROVED", false)).toBe(true);
    expect(angkaSistemTampil("CANCELLED", false)).toBe(false);
    expect(angkaSistemTampil("CANCELLED", true)).toBe(true);
    // Status yang tidak dikenal: tertutup.
    expect(angkaSistemTampil("LAINNYA", true)).toBe(false);
  });

  it("strips every system figure from item rows and keeps what the counter typed", () => {
    const baris = [
      {
        id: "b1",
        itemId: "kaos",
        variantSku: "KAOS-M",
        itemName: "Kaos",
        snapshotQty: 4937,
        countedQty: 12,
        variance: -4925,
        currentQtyAtApproval: 4930,
        hadDriftWarning: true,
        notes: "rak 3",
      },
    ];
    const hasil = barangTanpaAngka(baris);
    expect(hasil).toEqual([{ id: "b1", itemId: "kaos", variantSku: "KAOS-M", itemName: "Kaos", countedQty: 12, notes: "rak 3" }]);
    const teks = JSON.stringify(hasil);
    expect(teks).not.toContain("4937");
    expect(teks).not.toContain("4925");
    expect(teks).not.toContain("4930");
    // Sumbernya tidak diubah (baris Prisma yang sama dipakai di tempat lain).
    expect(baris[0].snapshotQty).toBe(4937);
  });

  it("strips the frozen length and variance from fabric rolls", () => {
    const hasil = rolTanpaAngka([
      { id: "r1", fabricRollId: "f1", rollCode: "RL-01", itemName: "Katun", snapshotLength: 88.5, countedLength: null, variance: null, notes: null },
    ]);
    expect(hasil).toEqual([{ id: "r1", fabricRollId: "f1", rollCode: "RL-01", itemName: "Katun", countedLength: null, notes: null }]);
    expect(JSON.stringify(hasil)).not.toContain("snapshotLength");
  });

  it("builds the blind review rows from what the payload still carries: name, size, what was counted", () => {
    const barang = barisButa(
      { scope: "FINISHED_GOOD", items: [{ id: "b1", itemName: "Kaos", variantSku: " KAOS-M ", countedQty: "12" }, { id: "b2", itemName: "Topi", variantSku: null, countedQty: null }] },
    );
    expect(barang).toEqual([
      { id: "b1", label: "Kaos", sublabel: "KAOS-M", counted: 12 },
      { id: "b2", label: "Topi", sublabel: undefined, counted: null },
    ]);
    const kain = barisButa({ scope: "FABRIC", rolls: [{ id: "r1", rollCode: "RL-01", itemName: "Katun", countedLength: 3.5 }] });
    expect(kain).toEqual([{ id: "r1", label: "RL-01", sublabel: "Katun", counted: 3.5 }]);
    // Tidak ada kolom angka sistem yang dibuat-buat (NaN, 0) untuk diisi layar.
    expect(Object.keys(barang[0]).sort()).toEqual(["counted", "id", "label", "sublabel"]);
  });

  it("filters the blind rows by counted / not yet counted and by name or size, pending first", () => {
    const baris = [
      { id: "1", label: "Kaos", sublabel: "KAOS-M", counted: 4 },
      { id: "2", label: "Kemeja", sublabel: "KMJ-L", counted: null },
      { id: "3", label: "Celana", sublabel: undefined, counted: 0 },
    ];
    expect(saringBarisButa(baris, "all", "").map((b) => b.id)).toEqual(["2", "3", "1"]);
    expect(saringBarisButa(baris, "pending", "").map((b) => b.id)).toEqual(["2"]);
    // Nol adalah hitungan, bukan "belum".
    expect(saringBarisButa(baris, "counted", "").map((b) => b.id)).toEqual(["3", "1"]);
    expect(saringBarisButa(baris, "all", "kmj").map((b) => b.id)).toEqual(["2"]);
    expect(saringBarisButa(baris, "all", "  kaos ").map((b) => b.id)).toEqual(["1"]);
  });
});
