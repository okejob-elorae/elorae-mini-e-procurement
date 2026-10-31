import { describe, expect, it, vi } from "vitest";

/*
 * Nilai pelunasan awal sebuah faktur di formulir BKM bersama (kantor & HP):
 * bagian sisa yang TIDAK ditahan potongan retur BKM terverifikasi — bukan sisa
 * penuh, yang langsung ditolak penulisnya dengan `RETUR_DITAHAN` saat simpan.
 */

vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }) }));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {}, warning: () => {} } }));
vi.mock("@/app/actions/receivables", () => ({ buatKlaimAction: vi.fn() }));
vi.mock("@/app/actions/tugas-tagih", () => ({ tautanPesanKlaimBaruAction: vi.fn() }));
vi.mock("@/components/foto/UnggahFoto", () => ({ UnggahFoto: () => null }));
vi.mock("@/lib/foto/unggah", () => ({ unggahFoto: vi.fn() }));
vi.mock("@/lib/pwa/offline/laporan-queue", () => ({ antreKlaim: vi.fn() }));
vi.mock("@/lib/pwa/offline/queue", () => ({ newLocalId: () => "kunci-uji" }));

const { bolehDilunasiDari } = await import("./KlaimBaruClient");

describe("nilai pelunasan awal per faktur", () => {
  it("memakai bagian yang tidak ditahan retur, bukan sisa penuh", () => {
    expect(bolehDilunasiDari({ outstanding: 1_000_000, bolehDilunasi: 700_000 })).toBe(700_000);
  });

  it("faktur tanpa tahanan: sisa penuh", () => {
    expect(bolehDilunasiDari({ outstanding: 500_000, bolehDilunasi: 500_000 })).toBe(500_000);
  });

  it("seluruh sisa ditahan → 0; tidak pernah negatif atau melebihi sisa", () => {
    expect(bolehDilunasiDari({ outstanding: 300_000, bolehDilunasi: 0 })).toBe(0);
    expect(bolehDilunasiDari({ outstanding: 300_000, bolehDilunasi: -5 })).toBe(0);
    expect(bolehDilunasiDari({ outstanding: 300_000, bolehDilunasi: 400_000 })).toBe(300_000);
  });

  it("baris lama tanpa `bolehDilunasi` jatuh ke sisa", () => {
    expect(bolehDilunasiDari({ outstanding: 250_000 })).toBe(250_000);
  });
});
