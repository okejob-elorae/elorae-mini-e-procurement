import { describe, expect, it } from "vitest";
import { jawabTanpaSesiDenganJson } from "./tanpa-sesi";

describe("permintaan tanpa sesi", () => {
  it("permintaan data (API) dijawab JSON, bukan dialihkan ke halaman masuk", () => {
    for (const p of ["/api/suppliers", "/api/notifications", "/api/backoffice/nav-counts", "/pwa/api/catalog", "/pwa/api/upload/visit-photo"]) {
      expect(jawabTanpaSesiDenganJson(p), p).toBe(true);
    }
  });

  it("halaman tetap dialihkan ke halaman masuk", () => {
    for (const p of ["/backoffice", "/backoffice/dashboard", "/pwa", "/pwa/stores/abc", "/gudang-retur", "/print/finance/neraca", "/apiku", "/pwa/apis"]) {
      expect(jawabTanpaSesiDenganJson(p), p).toBe(false);
    }
  });
});
