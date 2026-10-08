import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Gerbang halaman pajak: kalender, rekap PPN, setoran, PPh final = pembaca
 * jurnal (`journals:view`); faktur keluaran = pembaca faktur pajak
 * (`tax_invoices:view`). Kueri tidak berjalan untuk yang ditolak.
 */

const sesi = vi.hoisted(() => ({ ada: true, permissions: [] as string[] }));
const kueri = vi.hoisted(() => ({ jalan: [] as string[] }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => (sesi.ada ? { user: { id: "u", permissions: sesi.permissions } } : null)) }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((ke: string) => {
    throw new Error(`REDIRECT:${ke}`);
  }),
}));
vi.mock("@/lib/finance/pajak/kalender-queries", () => ({
  butirKalenderPajak: vi.fn(async () => {
    kueri.jalan.push("kalender");
    return {
      butir: [
        { kunci: "a", perluTindakan: true, tenggat: "LEWAT" },
        { kunci: "b", perluTindakan: true, tenggat: "SEGERA" },
        { kunci: "c", perluTindakan: false, tenggat: "NANTI" },
      ],
      statusPkp: "PKP",
      rezimPph: "FINAL_UMKM",
    };
  }),
}));
vi.mock("@/lib/finance/pajak/coretax-queries", () => ({
  notaUntukEkspor: vi.fn(async () => {
    kueri.jalan.push("faktur");
    return { baris: [], faktur: [], terpotong: false };
  }),
}));
vi.mock("@/lib/finance/pajak/ppn-pengaturan", () => ({
  bacaPengaturanPpn: vi.fn(async () => ({ statusPkp: "PKP", tarifPersen: 12, pakaiDppNilaiLain: true, hargaJualTermasukPpn: true, berlakuSejak: null })),
}));
vi.mock("@/lib/finance/pajak/profil-pengaturan", () => ({ bacaProfilPajak: vi.fn(async () => ({ bentukUsaha: "PT", rezimPph: "NORMAL", sejak: null })) }));
vi.mock("@/lib/finance/pajak/identitas-pengaturan", () => ({ bacaIdentitasPajak: vi.fn(async () => ({ npwp: "0012345678901000", nitku: null, nama: null })) }));
vi.mock("./KalenderPajakClient", () => ({ KalenderPajakClient: () => null }));
vi.mock("./faktur-keluaran/FakturKeluaranClient", () => ({ FakturKeluaranClient: () => null }));

const { default: Kalender } = await import("./page");
const { default: Faktur } = await import("./faktur-keluaran/page");

type Props = { props: Record<string, unknown> };

beforeEach(() => {
  sesi.ada = true;
  sesi.permissions = [];
  kueri.jalan = [];
});

describe("halaman pajak", () => {
  it("kalender: tanpa sesi → login; tanpa journals:view → beranda; kueri tidak jalan", async () => {
    sesi.ada = false;
    await expect(Kalender({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT:/login");
    sesi.ada = true;
    sesi.permissions = ["tax_invoices:view"];
    await expect(Kalender({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT:/backoffice");
    expect(kueri.jalan).toEqual([]);
  });

  it("kalender: saringan memakai definisi Beranda dan jumlah per saringan; kelola hanya untuk journals:manage", async () => {
    sesi.permissions = ["journals:view"];
    const el = (await Kalender({ searchParams: Promise.resolve({ saring: "lewat" }) })) as Props;
    expect(el.props.saring).toBe("lewat");
    expect((el.props.butir as { kunci: string }[]).map((b) => b.kunci)).toEqual(["a"]);
    expect(el.props.jumlah).toEqual({ semua: 3, segera: 1, lewat: 1 });
    expect((el.props.akses as { kelola: boolean }).kelola).toBe(false);
    sesi.permissions = ["journals:view", "journals:manage"];
    const el2 = (await Kalender({ searchParams: Promise.resolve({ saring: "asal" }) })) as Props;
    expect(el2.props.saring).toBe("semua");
    expect((el2.props.akses as { kelola: boolean }).kelola).toBe(true);
  });

  it("faktur keluaran: butuh tax_invoices:view (journals:view saja ditolak); rentang bawaan = bulan lalu", async () => {
    sesi.permissions = ["journals:view", "journals:manage"];
    await expect(Faktur({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT:/backoffice");
    expect(kueri.jalan).toEqual([]);
    sesi.permissions = ["tax_invoices:view"];
    const el = (await Faktur({ searchParams: Promise.resolve({ dari: "2026-09-30", sampai: "2026-09-01" }) })) as Props;
    // Rentang terbalik ditukar, NPWP terisi.
    expect(el.props).toMatchObject({ dari: "2026-09-01", sampai: "2026-09-30", adaNpwp: true, sertakan: "MENUNGGU" });
    const bawaan = (await Faktur({ searchParams: Promise.resolve({}) })) as Props;
    expect(String(bawaan.props.dari)).toMatch(/^\d{4}-\d{2}-01$/);
  });
});
