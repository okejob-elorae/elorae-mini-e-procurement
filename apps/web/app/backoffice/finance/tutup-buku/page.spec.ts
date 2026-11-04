import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Gerbang halaman Keuangan → Tutup buku, Integritas buku besar, dan Tanggal
 * mulai buku besar: `journals:view` melihat, `journals:manage` mengubah.
 * Kueri dipalsukan — yang diuji gerbang dan parameter.
 */

const sesi = vi.hoisted(() => ({ ada: true, permissions: [] as string[] }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => (sesi.ada ? { user: { id: "u", permissions: sesi.permissions } } : null)) }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((ke: string) => {
    throw new Error(`REDIRECT:${ke}`);
  }),
}));
const kueri = vi.hoisted(() => ({ periksa: [] as unknown[], tanpaJurnal: [] as unknown[] }));
vi.mock("@/lib/finance/periode/queries", () => ({
  daftarPeriode: vi.fn(async () => ({ bulan: [], tahun: [], bulanPertama: null, tanggalMulai: null })),
  bacaDaftarPeriksa: vi.fn(async (tb: unknown) => {
    kueri.periksa.push(tb);
    return { butir: [], bolehTutup: true, perluPersetujuan: false };
  }),
}));
vi.mock("@/lib/finance/integritas/queries", () => ({
  dokumenTanpaJurnal: vi.fn(async (opsi: unknown) => {
    kueri.tanpaJurnal.push(opsi);
    return { berlaku: false, sebab: "TANPA_TANGGAL_MULAI" };
  }),
  jurnalTakSeimbang: vi.fn(async () => []),
  jurnalYatim: vi.fn(async () => ({ yatim: [], tidakDiperiksa: [], terpotong: false })),
  saldoBertandaTerbalik: vi.fn(async () => {
    throw new Error("kueri rusak");
  }),
  jurnalSesudahDitutup: vi.fn(async () => []),
}));
vi.mock("@/lib/finance/periode/tanggal-mulai", () => ({
  bacaInfoTanggalMulai: vi.fn(async () => ({ tanggal: "2026-08-01", mentahTidakSah: null, diubahPada: null, diubahOleh: null, adaPeriodeTertutup: false })),
}));
vi.mock("./TutupBukuClient", () => ({ TutupBukuClient: () => null }));
vi.mock("../integritas/IntegritasClient", () => ({ IntegritasClient: () => null }));
vi.mock("../mulai-buku-besar/MulaiBukuBesarClient", () => ({ MulaiBukuBesarClient: () => null }));

const { default: TutupBuku } = await import("./page");
const { default: Integritas } = await import("../integritas/page");
const { default: MulaiBukuBesar } = await import("../mulai-buku-besar/page");

type Props = { props: Record<string, unknown> };

beforeEach(() => {
  sesi.ada = true;
  sesi.permissions = [];
  kueri.periksa = [];
  kueri.tanpaJurnal = [];
});

describe("halaman tutup buku, integritas, tanggal mulai", () => {
  it("tanpa sesi → login; tanpa journals:view → beranda (ketiganya), kueri tidak jalan", async () => {
    sesi.ada = false;
    await expect(TutupBuku({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT:/login");
    sesi.ada = true;
    sesi.permissions = ["finance_reports:view"];
    await expect(TutupBuku({ searchParams: Promise.resolve({ bulan: "2026-09" }) })).rejects.toThrow("REDIRECT:/backoffice");
    await expect(Integritas({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT:/backoffice");
    await expect(MulaiBukuBesar()).rejects.toThrow("REDIRECT:/backoffice");
    expect(kueri.periksa).toHaveLength(0);
    expect(kueri.tanpaJurnal).toHaveLength(0);
  });

  it("tutup buku: daftar periksa hanya untuk ?bulan yang sah; mengubah hanya journals:manage", async () => {
    sesi.permissions = ["journals:view"];
    const a = (await TutupBuku({ searchParams: Promise.resolve({ bulan: "bukan" }) })) as Props;
    expect(a.props).toMatchObject({ dipilih: null, periksa: null, bolehMengelola: false });
    expect(kueri.periksa).toHaveLength(0);
    sesi.permissions = ["journals:view", "journals:manage"];
    const b = (await TutupBuku({ searchParams: Promise.resolve({ bulan: "2026-09" }) })) as Props;
    expect(b.props).toMatchObject({ dipilih: "2026-09", bolehMengelola: true });
    expect(kueri.periksa).toEqual([{ tahun: 2026, bulan: 9 }]);
  });

  it("integritas: saringan bulan & diam diteruskan; satu bagian yang gagal tidak menjatuhkan halaman", async () => {
    sesi.permissions = ["journals:view"];
    const el = (await Integritas({ searchParams: Promise.resolve({ bulan: "2026-09", tanpaJurnal: "diam" }) })) as Props;
    expect(kueri.tanpaJurnal).toEqual([{ bulan: { tahun: 2026, bulan: 9 }, hanyaDiam: true }]);
    expect(el.props).toMatchObject({ saring: { bulan: "2026-09", hanyaDiam: true }, terbalik: null, bolehMengelola: false });
  });

  it("tanggal mulai: pembaca jurnal melihat, mengubah hanya journals:manage", async () => {
    sesi.permissions = ["journals:view"];
    expect(((await MulaiBukuBesar()) as Props).props).toMatchObject({ bolehMengelola: false });
    sesi.permissions = ["journals:view", "journals:manage"];
    expect(((await MulaiBukuBesar()) as Props).props).toMatchObject({ bolehMengelola: true, info: { tanggal: "2026-08-01" } });
  });
});
