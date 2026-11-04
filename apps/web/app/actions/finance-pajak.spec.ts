import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Pagar izin aksi pajak: setiap aksi memeriksa izinnya sendiri dan pelaku
 * selalu dari sesi. Penulisnya dipalsukan — yang diuji di sini hanya pagar
 * dan penerusannya.
 */

const sesi = vi.hoisted(() => ({ ada: true, permissions: [] as string[] }));
const panggil = vi.hoisted(() => ({ daftar: [] as { nama: string; arg: Record<string, unknown> }[] }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => (sesi.ada ? { user: { id: "u-sesi", permissions: sesi.permissions } } : null)) }));
const catat = (nama: string) =>
  vi.fn(async (arg: Record<string, unknown>) => {
    panggil.daftar.push({ nama, arg });
    return { ok: true };
  });
vi.mock("@/lib/finance/pajak/masa-writer", () => ({ finalkanRekapPpn: catat("final"), bukaRekapPpn: catat("buka") }));
vi.mock("@/lib/finance/pajak/setoran-writer", () => ({ catatSetoran: catat("setor"), batalkanSetoran: catat("batal") }));
vi.mock("@/lib/finance/pajak/pph-final-writer", () => ({ postingPphFinal: catat("pphFinal"), bukaPphFinal: catat("bukaPph") }));
vi.mock("@/lib/finance/pajak/coretax-queries", () => ({ notaUntukEkspor: vi.fn(async () => ({ baris: [], faktur: [], terpotong: false })) }));
vi.mock("@/lib/finance/pajak/identitas-pengaturan", () => ({ bacaIdentitasPajak: vi.fn(async () => ({ npwp: null, nitku: null, nama: null })) }));
vi.mock("@/lib/finance/pajak/ppn-pengaturan", () => ({
  bacaPengaturanPpn: vi.fn(async () => ({ statusPkp: "BELUM_DITETAPKAN", tarifPersen: 12, pakaiDppNilaiLain: true, hargaJualTermasukPpn: true, berlakuSejak: null })),
}));
vi.mock("@/lib/db/tx-retry", () => ({ runSerializable: vi.fn(async () => undefined) }));

const aksi = await import("./finance-pajak");

beforeEach(() => {
  sesi.ada = true;
  sesi.permissions = [];
  panggil.daftar = [];
});

describe("aksi pajak — pagar izin", () => {
  it("tanpa journals:manage: rekap, setoran, PPh final ditolak dan penulis tidak dipanggil", async () => {
    sesi.permissions = ["journals:view", "tax_invoices:view", "settings_tax:view"];
    expect(await aksi.finalkanRekapPpnAction({ masa: "2026-09" })).toEqual({ ok: false, kode: "TANPA_AKSES" });
    expect(await aksi.bukaRekapPpnAction({ masa: "2026-09", alasan: "x" })).toEqual({ ok: false, kode: "TANPA_AKSES" });
    expect(await aksi.catatSetoranAction({ jenis: "PPN", masa: "2026-09", jumlah: 1, tanggalBayar: "2026-10-01", ntpn: "x" })).toEqual({ ok: false, kode: "TANPA_AKSES" });
    expect(await aksi.batalkanSetoranAction({ id: "t", alasan: "x" })).toEqual({ ok: false, kode: "TANPA_AKSES" });
    expect(await aksi.postingPphFinalAction({ masa: "2026-09" })).toEqual({ ok: false, kode: "TANPA_AKSES" });
    expect(panggil.daftar).toEqual([]);
  });

  it("dengan journals:manage: pelaku dari sesi, bukan dari isian", async () => {
    sesi.permissions = ["journals:manage"];
    await aksi.finalkanRekapPpnAction({ masa: "2026-09", olehUserId: "penyusup" } as never);
    await aksi.catatSetoranAction({ jenis: "PPN", masa: "2026-09", jumlah: 1, tanggalBayar: "2026-10-01", ntpn: "x", olehUserId: "penyusup" } as never);
    expect(panggil.daftar.map((p) => [p.nama, p.arg.olehUserId])).toEqual([
      ["final", "u-sesi"],
      ["setor", "u-sesi"],
    ]);
  });

  it("ekspor faktur butuh tax_invoices:view dan NPWP perusahaan", async () => {
    sesi.permissions = ["journals:manage"];
    expect(await aksi.eksporFakturKeluaranAction({ dari: "2026-09-01", sampai: "2026-09-30" })).toEqual({ ok: false, kode: "TANPA_AKSES" });
    sesi.permissions = ["tax_invoices:view"];
    expect(await aksi.eksporFakturKeluaranAction({ dari: "2026-09-30", sampai: "2026-09-01" })).toEqual({ ok: false, kode: "RENTANG_TIDAK_SAH" });
    expect(await aksi.eksporFakturKeluaranAction({ dari: "2026-09-01", sampai: "2026-09-30" })).toEqual({ ok: false, kode: "NPWP_PERUSAHAAN_KOSONG" });
  });

  it("pengaturan pajak: membaca butuh settings_tax:view, menyimpan butuh settings_tax:manage; isian rusak ditolak berkode", async () => {
    sesi.permissions = ["journals:manage"];
    expect(await aksi.ambilPengaturanPajakAction()).toEqual({ ok: false, kode: "TANPA_AKSES" });
    sesi.permissions = ["settings_tax:view"];
    expect(await aksi.simpanPengaturanPpnAction({ statusPkp: "PKP" })).toEqual({ ok: false, kode: "TANPA_AKSES" });
    sesi.permissions = ["settings_tax:manage"];
    expect(await aksi.simpanPengaturanPpnAction({ statusPkp: "PKP", tarifPersen: 0, pakaiDppNilaiLain: true, hargaJualTermasukPpn: true })).toEqual({
      ok: false,
      kode: "TARIF_TIDAK_SAH",
    });
    expect(await aksi.simpanIdentitasPajakAction({ npwp: "12" })).toEqual({ ok: false, kode: "NPWP_TIDAK_SAH" });
    expect(await aksi.simpanProfilPajakAction({ bentukUsaha: "PT", rezimPph: "FINAL_UMKM", sejak: "" })).toMatchObject({ ok: true });
  });

  it("tanpa sesi: semua ditolak", async () => {
    sesi.ada = false;
    expect(await aksi.finalkanRekapPpnAction({ masa: "2026-09" })).toEqual({ ok: false, kode: "TANPA_AKSES" });
    expect(await aksi.eksporFakturKeluaranAction({ dari: "2026-09-01", sampai: "2026-09-30" })).toEqual({ ok: false, kode: "TANPA_AKSES" });
  });
});
