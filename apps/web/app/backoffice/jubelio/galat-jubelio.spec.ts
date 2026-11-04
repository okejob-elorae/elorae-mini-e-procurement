import { describe, expect, it, vi } from "vitest";
import {
  galatDariBalasanApi,
  galatDariLemparan,
  jalankanAksiJubelio,
  kunciGalatJubelio,
} from "./galat-jubelio";

describe("galatDariLemparan", () => {
  it("maps a missing session or permission to TANPA_AKSES", () => {
    expect(galatDariLemparan(new Error("Unauthorized")).code).toBe("TANPA_AKSES");
    const terlarang = Object.assign(new Error("Forbidden: Insufficient permissions"), { status: 403 });
    expect(galatDariLemparan(terlarang).code).toBe("TANPA_AKSES");
  });

  it("maps an unreachable apps/api to LAYANAN_MATI and keeps the technical text as rincian", () => {
    // Bentuk galat undici saat apps/api tidak jalan: "fetch failed" + cause ECONNREFUSED.
    const err = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    expect(galatDariLemparan(err)).toEqual({
      ok: false,
      code: "LAYANAN_MATI",
      rincian: "fetch failed (ECONNREFUSED)",
    });
    expect(galatDariLemparan(new Error("INTERNAL_API_URL is not set. Add it to apps/web/.env.")).code).toBe(
      "LAYANAN_MATI",
    );
  });

  it("maps anything else to GAGAL", () => {
    expect(galatDariLemparan(new Error("boom"))).toEqual({ ok: false, code: "GAGAL", rincian: "boom" });
    expect(galatDariLemparan("x").code).toBe("GAGAL");
  });
});

describe("galatDariBalasanApi", () => {
  it("separates access, unreachable and refused replies", () => {
    expect(galatDariBalasanApi(403, "no").code).toBe("TANPA_AKSES");
    expect(galatDariBalasanApi(502, "Bad Gateway").code).toBe("LAYANAN_MATI");
    expect(galatDariBalasanApi(500, "Internal")).toEqual({
      ok: false,
      code: "LAYANAN_MENOLAK",
      rincian: "Internal",
    });
  });
});

describe("jalankanAksiJubelio", () => {
  it("never rejects: a thrown error becomes { ok: false, code }", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      jalankanAksiJubelio(async () => {
        throw new Error("boom");
      }),
    ).resolves.toEqual({ ok: false, code: "GAGAL", rincian: "boom" });
    spy.mockRestore();
  });

  it("passes a successful result through", async () => {
    await expect(jalankanAksiJubelio(async () => ({ ok: true, data: 3 }))).resolves.toEqual({ ok: true, data: 3 });
  });
});

describe("kunciGalatJubelio", () => {
  it("falls back to GAGAL for an unknown code", () => {
    expect(kunciGalatJubelio("LAYANAN_MATI")).toBe("LAYANAN_MATI");
    expect(kunciGalatJubelio("APA_SAJA")).toBe("GAGAL");
  });
});
