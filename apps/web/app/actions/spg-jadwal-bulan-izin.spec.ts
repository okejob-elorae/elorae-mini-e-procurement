import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Jadwal kerja bulanan SPG (P7c): SPG mengisi dan mengajukan dari HP (`pwa:access`,
 * toko SELALU dari server lewat `ambilTokoTetap`, pemilik sel SELALU SPG yang masuk);
 * kantor menyetujui, menolak, dan membuka lagi = `spg_schedules:approve`. Izin bayar
 * komisi, pengelola piutang, dan akses HP saja tidak cukup untuk keputusan kantor.
 * Tombol di halaman memakai izin yang sama dengan aksinya. Tanpa basis data:
 * penulisnya ditiru.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

const state = vi.hoisted(() => ({
  sesi: null as { user: { id: string; permissions: string[] } } | null,
  tokoTetap: null as string | null,
  dipanggil: [] as { fn: string; input: Record<string, unknown> }[],
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => state.sesi) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/pwa/peran", () => ({ ambilTokoTetap: vi.fn(async () => state.tokoTetap) }));
vi.mock("@/lib/spg/jadwal-bulan-writer", () => {
  const catat = (fn: string) =>
    vi.fn(async (input: Record<string, unknown>) => {
      state.dipanggil.push({ fn, input });
      return { ok: true, status: "DIAJUKAN", versi: 1 };
    });
  return {
    isiJadwalBulanSaya: catat("isiJadwalBulanSaya"),
    ajukanJadwalBulan: catat("ajukanJadwalBulan"),
    setujuiJadwalBulan: catat("setujuiJadwalBulan"),
    tolakJadwalBulan: catat("tolakJadwalBulan"),
    bukaLagiJadwalBulan: catat("bukaLagiJadwalBulan"),
  };
});

const aksi = await import("./spg-komisi-jadwal");

const masuk = (permissions: string[]) => {
  state.sesi = { user: { id: "u1", permissions } };
};

beforeEach(() => {
  state.sesi = null;
  state.tokoTetap = null;
  state.dipanggil = [];
});

const KEPUTUSAN = { userId: "spg-1", bulan: "2026-11", versi: 1 };
const setujui = () => aksi.setujuiJadwalBulanAction(KEPUTUSAN);
const tolak = () => aksi.tolakJadwalBulanAction({ ...KEPUTUSAN, alasan: "uji" });
const bukaLagi = () => aksi.bukaLagiJadwalBulanAction({ ...KEPUTUSAN, alasan: "uji" });

describe("keputusan kantor atas jadwal bulanan: spg_schedules:approve", () => {
  it("izin bayar komisi, pengelola piutang, dan akses HP saja ditolak sebelum menyentuh penulis", async () => {
    for (const izin of [["spg_commission:pay"], ["receivables:manage"], ["pwa:access"]]) {
      masuk(izin);
      expect(await setujui()).toEqual({ ok: false, code: "TANPA_AKSES" });
      expect(await tolak()).toEqual({ ok: false, code: "TANPA_AKSES" });
      expect(await bukaLagi()).toEqual({ ok: false, code: "TANPA_AKSES" });
    }
    expect(state.dipanggil).toEqual([]);
  });

  it("pemegang izin menyetujui, menolak, dan membuka lagi atas namanya sendiri", async () => {
    masuk(["spg_schedules:approve"]);
    expect((await setujui()).ok).toBe(true);
    expect((await tolak()).ok).toBe(true);
    expect((await bukaLagi()).ok).toBe(true);
    expect(state.dipanggil.map((d) => d.fn)).toEqual(["setujuiJadwalBulan", "tolakJadwalBulan", "bukaLagiJadwalBulan"]);
    for (const d of state.dipanggil) expect(d.input).toMatchObject({ olehUserId: "u1", userId: "spg-1", bulan: "2026-11", versi: 1 });
  });
});

describe("SPG mengisi dan mengajukan jadwalnya: pwa:access dan toko tetap", () => {
  const ISIAN = [
    { userId: "spg-lain", day: "2026-11-03", isi: { jenis: "KERJA", kode: "PAGI" } },
    { userId: "u1", day: "2026-11-04", isi: { jenis: "LIBUR" } },
  ];
  const simpan = () => aksi.simpanJadwalBulanSayaAction({ bulan: "2026-11", isian: ISIAN });
  const ajukan = () => aksi.ajukanJadwalBulanAction({ bulan: "2026-11" });

  it("tanpa pwa:access ditolak, juga dengan toko tetap", async () => {
    state.tokoTetap = "toko-1";
    for (const izin of [["spg_schedules:approve"], ["spg_commission:pay"], []]) {
      masuk(izin);
      expect(await simpan()).toEqual({ ok: false, code: "TANPA_AKSES" });
      expect(await ajukan()).toEqual({ ok: false, code: "TANPA_AKSES" });
    }
    expect(state.dipanggil).toEqual([]);
  });

  it("dengan pwa:access tapi tanpa toko tetap ditolak", async () => {
    masuk(["pwa:access"]);
    expect(await simpan()).toEqual({ ok: false, code: "TANPA_AKSES" });
    expect(await ajukan()).toEqual({ ok: false, code: "TANPA_AKSES" });
    expect(state.dipanggil).toEqual([]);
  });

  it("dengan toko tetap: toko dari server, dan setiap sel milik SPG yang masuk walau isiannya menyebut orang lain", async () => {
    masuk(["pwa:access"]);
    state.tokoTetap = "toko-1";
    expect((await simpan()).ok).toBe(true);
    expect((await ajukan()).ok).toBe(true);
    expect(state.dipanggil.map((d) => d.fn)).toEqual(["isiJadwalBulanSaya", "ajukanJadwalBulan"]);
    const [isi, aju] = state.dipanggil;
    expect(isi.input).toMatchObject({ userId: "u1", storeId: "toko-1", bulan: "2026-11" });
    const sel = isi.input.isian as { userId: string }[];
    expect(sel).toHaveLength(2);
    expect(sel.every((s) => s.userId === "u1")).toBe(true);
    expect(aju.input).toEqual({ userId: "u1", storeId: "toko-1", bulan: "2026-11" });
  });
});

describe("tombol di halaman memakai izin yang sama dengan aksinya", () => {
  it("Jadwal SPG dan Komisi SPG memeriksa spg_schedules:approve", () => {
    const jadwal = readFileSync(path.join(__dirname, "../backoffice/jadwal-spg/page.tsx"), "utf8");
    expect(jadwal).toContain("hasPermission(izin, PERMISSIONS.SPG_SCHEDULES_APPROVE)");
    const komisi = readFileSync(path.join(__dirname, "../backoffice/komisi-spg/page.tsx"), "utf8");
    expect(komisi).toContain("bolehSetujuiJadwal={hasPermission(izin, PERMISSIONS.SPG_SCHEDULES_APPROVE)}");
  });
});
