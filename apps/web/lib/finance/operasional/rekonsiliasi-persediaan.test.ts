import { describe, expect, it } from "vitest";
import { ringkasRekonPersediaan, susunRekonPersediaan, type PeranRekonPersediaan } from "./rekonsiliasi-persediaan";

const sistem: Record<PeranRekonPersediaan, number> = {
  INVENTORY: 1_000_000,
  INVENTORY_FG: 2_500_000.5,
  INVENTORY_CONSIGNMENT: 400_000,
  INVENTORY_DAMAGED: 60_000,
  INVENTORY_VAN: 0,
};

describe("rekonsiliasi persediaan", () => {
  it("peran yang berbagi akun dibandingkan sebagai satu akun; peran tanpa akun tampil tanpa angka buku besar", () => {
    const pemetaan = new Map<PeranRekonPersediaan, { id: string; code: string; name: string }>([
      ["INVENTORY", { id: "a1", code: "1103", name: "Persediaan" }],
      ["INVENTORY_FG", { id: "a1", code: "1103", name: "Persediaan" }],
      ["INVENTORY_CONSIGNMENT", { id: "a2", code: "1111", name: "Persediaan konsinyasi" }],
      ["INVENTORY_DAMAGED", { id: "a3", code: "1112", name: "Persediaan rusak" }],
    ]);
    const baris = susunRekonPersediaan({ pemetaan, saldoAkun: new Map([["a1", 3_500_000.5], ["a2", 390_000], ["a3", 60_000.4]]), sistem });
    expect(baris.map((b) => [b.akun?.id ?? null, b.peran, b.bukuBesar, b.sistem, b.selisih, b.cocok])).toEqual([
      ["a1", ["INVENTORY", "INVENTORY_FG"], 3_500_000.5, 3_500_000.5, 0, true],
      ["a2", ["INVENTORY_CONSIGNMENT"], 390_000, 400_000, -10_000, false],
      ["a3", ["INVENTORY_DAMAGED"], 60_000.4, 60_000, 0.4, true],
      [null, ["INVENTORY_VAN"], null, 0, null, false],
    ]);
    const r = ringkasRekonPersediaan(baris);
    expect(r).toEqual({ bukuBesar: 3_950_000.9, sistem: 3_960_000.5, selisih: -9_999.6, semuaCocok: false, adaBelumDipetakan: true });
  });
});
