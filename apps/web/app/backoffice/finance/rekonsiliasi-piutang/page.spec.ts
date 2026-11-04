import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Gerbang Keuangan → Rekonsiliasi piutang: `journals:view` melihat,
 * `journals:manage` memposting. Baris tindakan menggabung jurnal lapangan yang
 * tertunda (bersebab) dengan dokumen tanpa jurnal, tanpa dobel, dan hanya jurnal
 * LAPANGAN — jurnal tertunda sumber lain tetap di halaman Jurnal.
 */

const sesi = vi.hoisted(() => ({ ada: true, permissions: [] as string[] }));
const kueri = vi.hoisted(() => ({ dipanggil: 0 }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => (sesi.ada ? { user: { id: "u", permissions: sesi.permissions } } : null)) }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((ke: string) => {
    throw new Error(`REDIRECT:${ke}`);
  }),
}));
vi.mock("@/lib/finance/lapangan/rekonsiliasi-queries", () => ({
  rekonsiliasiPiutangToko: vi.fn(async () => {
    kueri.dipanggil += 1;
    return { akun: null, tanggalMulai: null, baris: [], tanpaToko: 0, total: { bukuBesar: 0, modul: 0, kreditRetur: 0, diLuarJurnal: 0, selisih: 0, tokoTidakCocok: 0 } };
  }),
}));
vi.mock("@/lib/finance/jurnal-tertunda", () => ({
  daftarJurnalTertunda: vi.fn(async () => [
    { notifikasiId: "n1", dicatatPada: new Date("2026-10-01T00:00:00Z"), sumber: { tipe: "dokumen", sourceType: "FIELD_COLLECTION", sourceId: "k1" }, sebab: "UNMAPPED_ROLE", peran: "BANK", metadata: { docNo: "BKM/2026/0001" } },
    { notifikasiId: "n2", dicatatPada: new Date("2026-10-01T00:00:00Z"), sumber: { tipe: "dokumen", sourceType: "GRN", sourceId: "g1" }, sebab: "UNMAPPED_ROLE", peran: "AP", metadata: {} },
  ]),
}));
vi.mock("@/lib/finance/lapangan/selaraskan-toko", () => ({
  dokumenLapanganTanpaJurnal: vi.fn(async () => [
    { sumber: "FIELD_COLLECTION", id: "k1", tanggal: "2026-10-01T00:00:00.000Z", label: "BKM/2026/0001" },
    { sumber: "FIELD_DELIVERY", id: "d1", tanggal: "2026-10-02T00:00:00.000Z", label: "DLV/2026/10/0001" },
  ]),
}));
vi.mock("../journals/_sumber/info-dokumen", () => ({
  cariInfoDokumen: vi.fn(async () => new Map([["FIELD_DELIVERY|d1", { nomor: "DLV/2026/10/0001", fieldOrderId: "o1" }]])),
}));
vi.mock("./RekonsiliasiPiutangClient", () => ({ RekonsiliasiPiutangClient: () => null }));

const { default: Halaman } = await import("./page");

type Props = { tindakan: { sumber: string; id: string; sebab: string | null; href?: string | null }[]; bolehMengelola: boolean; gagal: boolean };

beforeEach(() => {
  sesi.ada = true;
  kueri.dipanggil = 0;
});

describe("halaman rekonsiliasi piutang", () => {
  it("tanpa sesi → login; tanpa journals:view → beranda, kueri tidak jalan", async () => {
    sesi.ada = false;
    await expect(Halaman()).rejects.toThrow("REDIRECT:/login");
    sesi.ada = true;
    sesi.permissions = ["receivables:view"];
    await expect(Halaman()).rejects.toThrow("REDIRECT:/backoffice");
    expect(kueri.dipanggil).toBe(0);
  });

  it("pembaca jurnal melihat; tindakan = tertunda lapangan + tanpa jurnal, tanpa dobel, bertautan dokumen", async () => {
    sesi.permissions = ["journals:view"];
    const el = (await Halaman()) as { props: Props };
    expect(el.props.bolehMengelola).toBe(false);
    expect(el.props.gagal).toBe(false);
    expect(el.props.tindakan.map((t) => [t.sumber, t.id, t.sebab])).toEqual([
      ["FIELD_COLLECTION", "k1", "UNMAPPED_ROLE"],
      ["FIELD_DELIVERY", "d1", null],
    ]);
    expect(el.props.tindakan.map((t) => t.href)).toEqual(["/backoffice/pelunasan/k1", "/backoffice/field-sales-orders/o1"]);
    sesi.permissions = ["journals:view", "journals:manage"];
    expect(((await Halaman()) as { props: Props }).props.bolehMengelola).toBe(true);
  });
});
