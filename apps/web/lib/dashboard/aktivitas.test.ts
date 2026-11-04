import { describe, expect, it } from "vitest";
import { kelompokkanAktivitas, type Aktivitas } from "./aktivitas";

const a = (id: string, action: string, entityType: string, userName: string | null, menit: number): Aktivitas => ({
  id,
  action,
  entityType,
  userName,
  createdAt: new Date(Date.UTC(2026, 8, 28, 10, 0) - menit * 60_000).toISOString(),
});

describe("kelompokkanAktivitas", () => {
  it("folds a run of the same action by the same person into one row", () => {
    const hasil = kelompokkanAktivitas(
      [
        a("1", "SWAP", "ContentPlan", "Admin", 0),
        a("2", "SWAP", "ContentPlan", "Admin", 5),
        a("3", "SWAP", "ContentPlan", "Admin", 9),
        a("4", "CREATE", "ContentPlan", "Admin", 12),
      ],
      6,
    );
    expect(hasil).toHaveLength(2);
    expect(hasil[0]).toMatchObject({ id: "1", action: "SWAP", jumlah: 3 });
    expect(hasil[0].terlama).toBe(a("3", "SWAP", "ContentPlan", "Admin", 9).createdAt);
    expect(hasil[1]).toMatchObject({ id: "4", action: "CREATE", jumlah: 1 });
  });

  it("keeps runs by different people apart", () => {
    const hasil = kelompokkanAktivitas(
      [a("1", "SWAP", "ContentPlan", "Admin", 0), a("2", "SWAP", "ContentPlan", "Rina", 1)],
      6,
    );
    expect(hasil.map((g) => g.jumlah)).toEqual([1, 1]);
  });

  it("does not merge the same action on a different kind of record", () => {
    const hasil = kelompokkanAktivitas(
      [a("1", "CREATE", "PurchaseOrder", "Admin", 0), a("2", "CREATE", "Item", "Admin", 1)],
      6,
    );
    expect(hasil).toHaveLength(2);
  });

  it("only merges consecutive rows, so the order of events survives", () => {
    const hasil = kelompokkanAktivitas(
      [
        a("1", "SWAP", "ContentPlan", "Admin", 0),
        a("2", "CREATE", "Item", "Admin", 1),
        a("3", "SWAP", "ContentPlan", "Admin", 2),
      ],
      6,
    );
    expect(hasil.map((g) => g.id)).toEqual(["1", "2", "3"]);
  });

  it("stops at the limit", () => {
    const daftar = Array.from({ length: 12 }, (_, i) => a(String(i), `A${i}`, "Item", "Admin", i));
    expect(kelompokkanAktivitas(daftar, 6)).toHaveLength(6);
  });

  it("returns nothing for nothing", () => {
    expect(kelompokkanAktivitas([], 6)).toEqual([]);
  });
});
