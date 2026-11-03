import { describe, expect, it } from "vitest";
import { tahapPengirimanPesanan } from "./tahap-pesanan";

describe("tahapPengirimanPesanan", () => {
  it("tanpa surat jalan → null", () => {
    expect(tahapPengirimanPesanan([])).toBeNull();
    expect(tahapPengirimanPesanan(undefined)).toBeNull();
    expect(tahapPengirimanPesanan(null)).toBeNull();
  });

  it("hanya PACKED → DIKEMAS", () => {
    expect(tahapPengirimanPesanan([{ status: "PACKED" }])).toBe("DIKEMAS");
  });

  it("IN_TRANSIT didahulukan dari PACKED", () => {
    expect(tahapPengirimanPesanan([{ status: "PACKED" }, { status: "IN_TRANSIT" }])).toBe("DALAM_PERJALANAN");
    expect(tahapPengirimanPesanan([{ status: "IN_TRANSIT" }, { status: "PACKED" }])).toBe("DALAM_PERJALANAN");
  });

  it("surat jalan selesai atau batal tidak dihitung", () => {
    expect(tahapPengirimanPesanan([{ status: "DELIVERED" }])).toBeNull();
    expect(tahapPengirimanPesanan([{ status: "PARTIALLY_DELIVERED" }, { status: "CANCELLED" }])).toBeNull();
    expect(tahapPengirimanPesanan([{ status: "CANCELLED" }, { status: "PACKED" }])).toBe("DIKEMAS");
  });
});
