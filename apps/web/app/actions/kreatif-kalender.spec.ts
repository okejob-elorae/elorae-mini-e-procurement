import { beforeEach, describe, expect, it, vi } from "vitest";

/* Aksi tautan langganan kalender: gerbang izin, asal, dan bentuk jawabannya. Penulis ditiru. */

const sesi = vi.hoisted(() => ({ id: "u1" as string | null, izin: ["creative:view"] as string[] }));
const tiruan = vi.hoisted(() => ({ buat: vi.fn(), cabut: vi.fn() }));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => (sesi.id ? { user: { id: sesi.id, email: null, permissions: sesi.izin } } : null)),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/creative/kalender-langganan-writer", () => ({
  buatLanggananKalender: tiruan.buat,
  cabutLanggananKalender: tiruan.cabut,
}));

import { buatLanggananKalenderAction, cabutLanggananKalenderAction } from "./kreatif-kalender";

beforeEach(() => {
  sesi.id = "u1";
  sesi.izin = ["creative:view"];
  tiruan.buat.mockReset();
  tiruan.cabut.mockReset();
});

describe("buatLanggananKalenderAction", () => {
  it("tanpa masuk atau tanpa creative:view → TANPA_AKSES, penulis tidak dipanggil", async () => {
    sesi.id = null;
    expect(await buatLanggananKalenderAction({ asal: "https://elorae.cloud" })).toEqual({ ok: false, kode: "TANPA_AKSES" });
    sesi.id = "u1";
    sesi.izin = ["field_sales_orders:view"];
    expect(await buatLanggananKalenderAction({ asal: "https://elorae.cloud" })).toEqual({ ok: false, kode: "TANPA_AKSES" });
    expect(tiruan.buat).not.toHaveBeenCalled();
  });

  it("asal yang bukan origin → ALAMAT_TIDAK_SAH", async () => {
    expect(await buatLanggananKalenderAction({ asal: "https://elorae.cloud/x" })).toEqual({ ok: false, kode: "ALAMAT_TIDAK_SAH" });
    expect(tiruan.buat).not.toHaveBeenCalled();
  });

  it("berhasil → tiga bentuk alamat untuk orang yang sedang masuk", async () => {
    tiruan.buat.mockResolvedValue({ feedId: "f1", token: "TOK", sejak: new Date("2026-10-10T01:00:00Z"), lamaDicabut: 0 });
    const r = await buatLanggananKalenderAction({ asal: "https://elorae.cloud" });
    expect(tiruan.buat).toHaveBeenCalledWith({ userId: "u1" });
    expect(r).toEqual({
      ok: true,
      https: "https://elorae.cloud/api/kreatif/kalender/TOK",
      webcal: "webcal://elorae.cloud/api/kreatif/kalender/TOK",
      google: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent("webcal://elorae.cloud/api/kreatif/kalender/TOK")}`,
      sejak: "2026-10-10T01:00:00.000Z",
    });
  });

  it("galat penulis → GAGAL, tidak melempar", async () => {
    tiruan.buat.mockRejectedValue(new Error("x"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await buatLanggananKalenderAction({ asal: "https://elorae.cloud" })).toEqual({ ok: false, kode: "GAGAL" });
    err.mockRestore();
  });
});

describe("cabutLanggananKalenderAction", () => {
  it("meneruskan TIDAK_ADA dan ok; tanpa izin ditolak", async () => {
    tiruan.cabut.mockResolvedValueOnce({ ok: false, kode: "TIDAK_ADA" }).mockResolvedValueOnce({ ok: true, dicabut: 1 });
    expect(await cabutLanggananKalenderAction()).toEqual({ ok: false, kode: "TIDAK_ADA" });
    expect(await cabutLanggananKalenderAction()).toEqual({ ok: true });
    expect(tiruan.cabut).toHaveBeenCalledWith({ userId: "u1" });
    sesi.izin = [];
    expect(await cabutLanggananKalenderAction()).toEqual({ ok: false, kode: "TANPA_AKSES" });
  });
});
