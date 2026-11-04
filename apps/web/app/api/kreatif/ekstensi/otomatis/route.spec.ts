import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

/*
 * POST /api/kreatif/ekstensi/otomatis tanpa basis data: token perangkat dan
 * penyimpan (`simpanOtomatis`) ditiru; pembaca muatan dan pembatas 120/jam
 * per perangkat yang asli. Bentuk jawabannya adalah kontrak dengan ekstensi.
 */

const tiruan = vi.hoisted(() => ({ perangkat: vi.fn(), simpan: vi.fn() }));

vi.mock("@/lib/creative/pantau-api", async () => {
  const asli = await vi.importActual<typeof import("@/lib/creative/pantau-api")>("@/lib/creative/pantau-api");
  return { ...asli, perangkatPermintaan: tiruan.perangkat };
});
vi.mock("@/lib/creative/pantau-writer", () => ({ simpanOtomatis: tiruan.simpan }));

import { MAKS_OTOMATIS_PER_JAM, pembatasOtomatisPantau } from "@/lib/creative/pantau-batas";
import { POST } from "./route";

const PERANGKAT = { id: "perangkat-1", nama: "Laptop", dibuatOlehId: "u1", dijedaSampai: null, alasanJeda: null, dicabutAt: null, terakhirLaporAt: null };
const PROFIL = { jenis: "PROFIL", uniqueId: "kol.satu", pengikut: 100, posting: [{ id: "7301", dibuatPada: 1_700_000_000, disematkan: false, views: 1, like: 0, komentar: 0, share: 0, save: 0, sebutan: ["elorae.official"] }] };

const kirim = (badan: unknown) =>
  POST(new Request("http://web:3000/api/kreatif/ekstensi/otomatis", { method: "POST", body: JSON.stringify(badan), headers: { authorization: "Bearer x" } }));

beforeEach(() => {
  tiruan.perangkat.mockReset();
  tiruan.simpan.mockReset();
  tiruan.perangkat.mockResolvedValue({ ok: true, perangkat: PERANGKAT });
  pembatasOtomatisPantau.kosongkan();
});

describe("POST /otomatis", () => {
  it("jawaban DISIMPAN: { ok, hasil, kol, videoMasuk, brand }", async () => {
    tiruan.simpan.mockResolvedValue({ ok: true, hasil: "DISIMPAN", kol: { id: "k1", nama: "@kol.satu" }, videoMasuk: 1, brand: 2 });
    const r = await kirim({ url: "https://www.tiktok.com/@kol.satu", data: PROFIL });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, hasil: "DISIMPAN", kol: { id: "k1", nama: "@kol.satu" }, videoMasuk: 1, brand: 2 });
    // Muatan sudah dirapikan pembaca sebelum sampai ke penyimpan.
    expect(tiruan.simpan.mock.calls[0][0].data.posting[0].sebutan).toEqual(["elorae.official"]);
  });

  it("jawaban DIABAIKAN tanpa kol", async () => {
    tiruan.simpan.mockResolvedValue({ ok: true, hasil: "DIABAIKAN", videoMasuk: 0, brand: 0 });
    const r = await kirim({ url: "https://www.tiktok.com/@kol.satu", data: PROFIL });
    expect(await r.json()).toEqual({ ok: true, hasil: "DIABAIKAN", videoMasuk: 0, brand: 0 });
  });

  it("penolakan penyimpan memakai kode yang ada: TANPA_IZIN 403, KOL_DIBLOKIR 409", async () => {
    tiruan.simpan.mockResolvedValueOnce({ ok: false, kode: "TANPA_IZIN" });
    const a = await kirim({ url: "https://www.tiktok.com/@kol.satu", data: PROFIL });
    expect([a.status, await a.json()]).toEqual([403, { ok: false, kode: "TANPA_IZIN" }]);
    tiruan.simpan.mockResolvedValueOnce({ ok: false, kode: "KOL_DIBLOKIR" });
    const b = await kirim({ url: "https://www.tiktok.com/@kol.satu", data: PROFIL });
    expect([b.status, await b.json()]).toEqual([409, { ok: false, kode: "KOL_DIBLOKIR" }]);
  });

  it("muatan atau URL yang tidak sah → 400 MUATAN_TIDAK_SAH, penyimpan tidak dipanggil", async () => {
    for (const badan of [{ url: "https://www.threads.net/@x", data: PROFIL }, { url: "https://www.tiktok.com/@a", data: { ...PROFIL, posting: [{ ...PROFIL.posting[0], sebutan: "x" }] } }, []]) {
      const r = await kirim(badan);
      expect([r.status, await r.json()]).toEqual([400, { ok: false, kode: "MUATAN_TIDAK_SAH" }]);
    }
    expect(tiruan.simpan).not.toHaveBeenCalled();
  });

  it("token yang ditolak dijawab apa adanya", async () => {
    tiruan.perangkat.mockResolvedValue({ ok: false, respons: NextResponse.json({ ok: false, kode: "TOKEN_TIDAK_SAH" }, { status: 401 }) });
    const r = await kirim({ url: "https://www.tiktok.com/@kol.satu", data: PROFIL });
    expect(r.status).toBe(401);
  });

  it(`lebih dari ${MAKS_OTOMATIS_PER_JAM} kiriman per jam per perangkat → 429 TERLALU_SERING`, async () => {
    tiruan.simpan.mockResolvedValue({ ok: true, hasil: "DIABAIKAN", videoMasuk: 0, brand: 0 });
    for (let i = 0; i < MAKS_OTOMATIS_PER_JAM; i++) pembatasOtomatisPantau.coba(PERANGKAT.id);
    const r = await kirim({ url: "https://www.tiktok.com/@kol.satu", data: PROFIL });
    expect([r.status, await r.json()]).toEqual([429, { ok: false, kode: "TERLALU_SERING" }]);
    // Perangkat lain tidak terkena.
    tiruan.perangkat.mockResolvedValue({ ok: true, perangkat: { ...PERANGKAT, id: "perangkat-2" } });
    expect((await kirim({ url: "https://www.tiktok.com/@kol.satu", data: PROFIL })).status).toBe(200);
  });
});
