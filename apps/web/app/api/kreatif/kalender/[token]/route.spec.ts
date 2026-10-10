import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Rute langganan kalender tanpa basis data: pembuka tautan, penyusun .ics, dan
 * pencatat pemakaian ditiru; pembatasnya yang asli (60 per jam per token).
 */

const tiruan = vi.hoisted(() => ({
  buka: vi.fn(),
  isi: vi.fn(),
  catat: vi.fn(),
}));

vi.mock("@/lib/creative/kalender-langganan-queries", async () => {
  const { buatPembatasJendela } = await vi.importActual<typeof import("@/lib/field-sales/portal-toko-batas")>("@/lib/field-sales/portal-toko-batas");
  const { MAKS_BACA_LANGGANAN_PER_JAM, JENDELA_BACA_LANGGANAN_MS } = await vi.importActual<typeof import("@/lib/creative/kalender-langganan")>(
    "@/lib/creative/kalender-langganan",
  );
  return {
    pembatasBacaLangganan: buatPembatasJendela(MAKS_BACA_LANGGANAN_PER_JAM, JENDELA_BACA_LANGGANAN_MS),
    bukaLanggananKalender: tiruan.buka,
    isiLanggananKalender: tiruan.isi,
  };
});

vi.mock("@/lib/creative/kalender-langganan-writer", () => ({ catatPemakaianLangganan: tiruan.catat }));

import { pembatasBacaLangganan } from "@/lib/creative/kalender-langganan-queries";
import { GET } from "./route";

const TOKEN = "A".repeat(43);
const panggil = (segmen: string, kepala: Record<string, string> = {}) =>
  GET(new Request(`http://web:3000/api/kreatif/kalender/${segmen}`, { headers: kepala }), { params: Promise.resolve({ token: segmen }) });

beforeEach(() => {
  tiruan.buka.mockReset();
  tiruan.isi.mockReset();
  tiruan.catat.mockReset();
  pembatasBacaLangganan.kosongkan();
});

describe("GET /api/kreatif/kalender/[token]", () => {
  it("token berbentuk salah → 404 tanpa menyentuh basis data", async () => {
    const r = await panggil("pendek");
    expect(r.status).toBe(404);
    expect(tiruan.buka).not.toHaveBeenCalled();
    expect(r.headers.get("Cache-Control")).toBe("no-store");
  });

  it("tidak dikenal, dicabut, atau tanpa izin (buka → null) → 404 tanpa keterangan", async () => {
    tiruan.buka.mockResolvedValue(null);
    const r = await panggil(TOKEN);
    expect(r.status).toBe(404);
    expect(await r.text()).toBe("Not found");
    expect(tiruan.isi).not.toHaveBeenCalled();
  });

  it("tautan sah → text/calendar dengan kepala privasi; asal dari kepala proxy; pemakaian dicatat", async () => {
    tiruan.buka.mockResolvedValue({ feedId: "f1", userId: "u1", terakhirDibaca: null });
    tiruan.isi.mockResolvedValue("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n");
    tiruan.catat.mockResolvedValue(true);
    const r = await panggil(TOKEN, { "x-forwarded-proto": "https", "x-forwarded-host": "elorae.cloud" });
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toBe("text/calendar; charset=utf-8");
    expect(r.headers.get("Cache-Control")).toBe("private, max-age=300");
    expect(r.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(r.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(await r.text()).toBe("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n");
    expect(tiruan.isi).toHaveBeenCalledWith({ userId: "u1", asal: "https://elorae.cloud" });
    expect(tiruan.catat).toHaveBeenCalledWith("f1", null);
  });

  it("akhiran .ics diterima", async () => {
    tiruan.buka.mockResolvedValue({ feedId: "f1", userId: "u1", terakhirDibaca: null });
    tiruan.isi.mockResolvedValue("X");
    const r = await panggil(`${TOKEN}.ics`);
    expect(r.status).toBe(200);
    expect(tiruan.buka).toHaveBeenCalledWith(TOKEN);
  });

  it("lebih dari 60 bacaan per jam per token → 429; token lain tidak ikut tertahan", async () => {
    tiruan.buka.mockResolvedValue({ feedId: "f1", userId: "u1", terakhirDibaca: null });
    tiruan.isi.mockResolvedValue("X");
    for (let i = 0; i < 60; i++) expect((await panggil(TOKEN)).status).toBe(200);
    const r = await panggil(TOKEN);
    expect(r.status).toBe(429);
    expect(r.headers.get("Retry-After")).toBe("3600");
    expect((await panggil("B".repeat(43))).status).toBe(200);
  });

  it("galat saat menyusun → 500 tanpa rincian", async () => {
    tiruan.buka.mockResolvedValue({ feedId: "f1", userId: "u1", terakhirDibaca: null });
    tiruan.isi.mockRejectedValue(new Error("rahasia di pesan galat"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await panggil(TOKEN);
    expect(r.status).toBe(500);
    expect(await r.text()).not.toContain("rahasia");
    err.mockRestore();
  });
});
