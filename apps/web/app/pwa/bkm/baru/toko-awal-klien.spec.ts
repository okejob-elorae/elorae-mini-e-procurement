import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/*
 * Formulir BKM bersama (HP dan kantor) dengan `tokoAwal`: toko yang dikirim
 * halaman HP dari `?toko=` langsung terpilih DAN fakturnya langsung tampil —
 * tanpa harus memilih toko lagi. Toko yang tidak ada di pemilih diabaikan;
 * formulir kantor (tanpa `tokoAwal`) tetap terbuka tanpa toko. Komponen anak
 * yang berat ditiru; pemilih toko ditiru jadi penanda nilai terpilihnya.
 */

vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }) }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => createElement("a", { href }, children),
}));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {}, warning: () => {} } }));
vi.mock("@/app/actions/receivables", () => ({ buatKlaimAction: vi.fn() }));
vi.mock("@/app/actions/tugas-tagih", () => ({ tautanPesanKlaimBaruAction: vi.fn() }));
vi.mock("@/components/foto/UnggahFoto", () => ({ UnggahFoto: () => null }));
vi.mock("@/lib/foto/unggah", () => ({ unggahFoto: vi.fn() }));
vi.mock("@/lib/pwa/offline/laporan-classify", () => ({ nasibUnggah: vi.fn() }));
vi.mock("@/lib/pwa/offline/laporan-queue", () => ({ antreKlaim: vi.fn() }));
vi.mock("@/lib/pwa/offline/hitung", () => ({ PERISTIWA_ANTREAN: "antrean" }));
vi.mock("@/lib/pwa/offline/queue", () => ({ newLocalId: () => "kunci-uji" }));
vi.mock("@/components/ui/tanggal-input", () => ({ TanggalInput: () => null }));
vi.mock("@/components/ui/page-header", () => ({
  PageHeader: ({ title }: { title: string }) => createElement("h1", null, title),
}));
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, children }: { value: string; children: ReactNode }) =>
    createElement("div", { "data-pilih": value }, children),
  SelectTrigger: ({ children }: { children: ReactNode }) => createElement("div", null, children),
  SelectValue: () => null,
  SelectContent: () => null,
  SelectItem: () => null,
}));

const { KlaimBaruClient } = await import("@/app/backoffice/pelunasan/baru/KlaimBaruClient");

const faktur = (id: string, invoiceNo: string) => ({
  id,
  invoiceNo,
  invoiceDate: "2026-09-01T00:00:00.000Z",
  dueDate: "2026-10-01T00:00:00.000Z",
  outstanding: 500_000,
  total: 500_000,
});

const BAHAN = {
  toko: [
    { id: "toko-tagih", name: "Toko Tagih", pkp: false },
    { id: "toko-dua", name: "Toko Dua", pkp: false },
  ],
  piutangPerToko: {
    "toko-tagih": [faktur("p-1", "INV-TAGIH-1")],
    "toko-dua": [faktur("p-2", "INV-DUA-1")],
  },
  returPerToko: {},
  jenisPotongan: [],
} as never;

const render = (tokoAwal?: string | null) =>
  renderToStaticMarkup(createElement(KlaimBaruClient, { bahan: BAHAN, antreLuring: true, kembaliKe: "/pwa/bkm", tokoAwal }));

describe("formulir BKM — toko awal dari halaman toko", () => {
  it("toko di pemilih: langsung terpilih dan HANYA fakturnya yang tampil", () => {
    const html = render("toko-dua");
    expect(html).toContain('data-pilih="toko-dua"');
    expect(html).toContain("INV-DUA-1");
    expect(html).not.toContain("INV-TAGIH-1");
    // Keterangan tombol kirim sudah maju ke faktur, bukan "pilih toko".
    expect(html).toContain("needInvoice");
    expect(html).not.toContain("needStore");
  });

  it("toko yang tidak ada di pemilih diabaikan — formulir kosong tanpa galat", () => {
    const html = render("toko-asing");
    expect(html).toContain('data-pilih=""');
    expect(html).not.toContain("INV-");
    expect(html).toContain("needStore");
  });

  it("formulir kantor (tanpa tokoAwal) tetap terbuka tanpa toko", () => {
    const html = render();
    expect(html).toContain('data-pilih=""');
    expect(html).not.toContain("INV-");
  });
});
