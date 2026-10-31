import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/*
 * Bagian "Pesanan untuk toko ini" di layar Terima kiriman: tampil juga sebelum
 * check-in (melihat tidak butuh kunjungan), hanya nomor/tanggal/status/potong —
 * tanpa rupiah — dan halaman server benar-benar mengirim datanya.
 */

vi.mock("next-intl", () => ({
  useTranslations: () => (k: string, v?: Record<string, unknown>) => (v ? `${k}(${Object.values(v).join(",")})` : k),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: unknown }) => createElement("a", { href }, children as never),
}));
vi.mock("@/app/pwa/TautanKembali", () => ({ TautanKembali: () => null }));
vi.mock("@/app/pwa/TombolBantuanHp", () => ({ TombolBantuanHp: () => null }));
vi.mock("@/lib/pwa/offline/db", () => ({ pwaDb: {} }));
vi.mock("@/lib/pwa/offline/hitung", () => ({ PERISTIWA_ANTREAN: "antrean" }));
vi.mock("@/lib/pwa/offline/luring-kunjungan-hook", () => ({ useKunjunganLokal: () => ({ kunjungan: null }) }));
vi.mock("@/lib/pwa/offline/luring-kunjungan", () => ({ kunjunganLokalSah: () => false }));
vi.mock("./PerluCheckIn", () => ({ PerluCheckIn: () => createElement("i", null, "[PERLU-CHECKIN]") }));

const { TerimaClient } = await import("./TerimaClient");

type Props = ComponentProps<typeof TerimaClient>;

const PESANAN: NonNullable<Props["pesanan"]> = [
  {
    id: "o1",
    orderNo: "PUTUS/2026/10/0007",
    status: "DIKIRIM_SEBAGIAN",
    tanggalLabel: "4 Okt 2026",
    inden: false,
    barang: [{ kunci: "i1::KL-M", nama: "Kemeja Linen", varian: "KL-M", pcs: 7 }],
    jumlahPcs: 7,
  },
];

const gambar = (p: Partial<Props>) =>
  renderToStaticMarkup(createElement(TerimaClient, { namaToko: "Toko Uji", storeId: "toko-1", sudahCheckIn: false, kiriman: [], ...p }));

describe("Terima kiriman — pesanan untuk toko ini", () => {
  it("tampil sebelum check-in, dengan nomor, tanggal, status dan potong — tanpa rupiah", () => {
    const html = gambar({ pesanan: PESANAN });
    expect(html).toContain("[PERLU-CHECKIN]");
    expect(html).toContain('id="pesanan-toko"');
    expect(html).toContain("PUTUS/2026/10/0007");
    expect(html).toContain("dipesan(4 Okt 2026)");
    expect(html).toContain("status.DIKIRIM_SEBAGIAN");
    expect(html).toContain("pcs(7)");
    expect(html).not.toMatch(/Rp/);
  });

  it("tanpa pesanan → bagiannya tidak tampil", () => {
    expect(gambar({ pesanan: [] })).not.toContain("pesanan-toko");
  });

  it("halaman server mengirim pesanan menuju toko lewat muatan HP (tanggal diformat di server)", () => {
    const isi = readFileSync(path.resolve(__dirname, "page.tsx"), "utf8");
    expect(isi).toMatch(/pesananMenujuToko\(toko\.id\)/);
    expect(isi).toMatch(/pesanan=\{pesananMenujuUntukHp\(/);
  });
});
