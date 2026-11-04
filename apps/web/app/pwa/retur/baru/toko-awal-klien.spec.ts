import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/*
 * Formulir retur salesman dengan `tokoAwal`: toko yang dikirim halaman dari
 * `?toko=` langsung terpilih; toko yang tidak ada di pilihan diabaikan dan
 * formulir terbuka tanpa toko. Komponen anak yang berat ditiru; pemilih toko
 * ditiru jadi penanda nilai terpilihnya.
 */

vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }) }));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {}, warning: () => {} } }));
vi.mock("@/app/actions/store-returns", () => ({ catatReturTokoAction: vi.fn() }));
vi.mock("@/components/foto/UnggahFoto", () => ({ UnggahFoto: () => null }));
vi.mock("@/components/ocr/BacaNota", () => ({ BacaNota: () => null }));
vi.mock("@/lib/foto/unggah", () => ({ unggahFoto: vi.fn() }));
vi.mock("@/lib/pwa/offline/laporan-classify", () => ({ nasibUnggah: vi.fn() }));
vi.mock("@/lib/pwa/offline/laporan-queue", () => ({ antreRetur: vi.fn() }));
vi.mock("@/lib/pwa/offline/hitung", () => ({ PERISTIWA_ANTREAN: "antrean" }));
vi.mock("@/lib/pwa/offline/queue", () => ({ newLocalId: () => "kunci-uji" }));
vi.mock("@/components/ui/tanggal-input", () => ({ TanggalInput: () => null }));
vi.mock("@/app/pwa/TautanKembali", () => ({ TautanKembali: () => null }));
vi.mock("@/app/pwa/TombolBantuanHp", () => ({ TombolBantuanHp: () => null }));
vi.mock("@/app/pwa/KeteranganKirim", () => ({ KeteranganKirim: () => null }));
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, children }: { value: string; children: ReactNode }) =>
    createElement("div", { "data-pilih": value }, children),
  SelectTrigger: ({ children }: { children: ReactNode }) => createElement("div", null, children),
  SelectValue: () => null,
  SelectContent: () => null,
  SelectItem: () => null,
}));

const { ReturBaruClient } = await import("./ReturBaruClient");

const TOKO = [
  { id: "toko-a", name: "Toko A" },
  { id: "toko-b", name: "Toko B" },
];

const render = (tokoAwal?: string | null) => renderToStaticMarkup(createElement(ReturBaruClient, { toko: TOKO, tokoAwal }));

describe("formulir retur — toko awal dari halaman toko", () => {
  it("toko di pilihan langsung terpilih", () => {
    expect(render("toko-b")).toContain('data-pilih="toko-b"');
  });

  it("toko yang tidak ada di pilihan diabaikan — formulir tanpa toko", () => {
    const html = render("toko-asing");
    expect(html).toContain('data-pilih=""');
  });

  it("tanpa tokoAwal tetap seperti sebelumnya", () => {
    expect(render()).toContain('data-pilih=""');
  });
});
