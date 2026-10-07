import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/*
 * Ubin "Lapor pelunasan" dan "Lapor retur" di halaman toko salesman: alamatnya
 * membawa toko ini (`?toko=`) supaya formulirnya langsung memilih toko itu.
 * Pelunasan hanya toko PUTUS (konsinyasi tidak punya piutang); SPG tidak
 * mendapat keduanya. Juga dirender sungguhan: ubinnya benar-benar ada di kartu
 * Kunjungan berjalan (AksiKunjungan) dan di luar kunjungan (LaporDariToko), dan
 * kartu kehadiran SPG menulis keadaannya. Tanpa basis data.
 */

vi.mock("next-intl", () => ({
  useTranslations:
    (ns: string) =>
    (k: string, p?: Record<string, unknown>) =>
      `${ns}.${k}${p ? JSON.stringify(p) : ""}`,
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => createElement("a", { href }, children),
}));
vi.mock("@/lib/pwa/offline/hitung", () => ({ PERISTIWA_ANTREAN: "antrean" }));
vi.mock("./checklist/tanda-foto-panduan", () => ({ kirimTandaFotoPanduan: vi.fn() }));

const { ubinLapor, LaporDariToko } = await import("./UbinLapor");
const { AksiKunjungan } = await import("./AksiKunjungan");
const { KehadiranSpgToko } = await import("./KehadiranSpgToko");

const ringkas = (x: ReturnType<typeof ubinLapor>) => x.map((u) => [u.jenis, u.href]);
const tautan = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));

describe("ubin lapor dari halaman toko", () => {
  it("toko PUTUS: pelunasan dan retur, keduanya membawa toko ini", () => {
    expect(ringkas(ubinLapor({ storeId: "toko-1", termsType: "PUTUS", spg: false }))).toEqual([
      ["laporPelunasan", "/pwa/bkm/baru?toko=toko-1"],
      ["laporRetur", "/pwa/retur/baru?toko=toko-1"],
    ]);
  });

  it("toko KONSI: hanya retur — konsinyasi tidak pernah punya piutang", () => {
    expect(ringkas(ubinLapor({ storeId: "toko-k", termsType: "KONSI", spg: false }))).toEqual([
      ["laporRetur", "/pwa/retur/baru?toko=toko-k"],
    ]);
  });

  it("SPG tidak mendapat ubin lapor", () => {
    expect(ubinLapor({ storeId: "toko-1", termsType: "PUTUS", spg: true })).toEqual([]);
    expect(ubinLapor({ storeId: "toko-k", termsType: "KONSI", spg: true })).toEqual([]);
  });

  it("id toko di-encode di alamat", () => {
    expect(ubinLapor({ storeId: "a b&c", termsType: "KONSI", spg: false })[0].href).toBe("/pwa/retur/baru?toko=a%20b%26c");
  });
});

describe("ubin lapor dirender di kartu kunjungan dan di luar kunjungan", () => {
  const kunjungan = (termsType: "PUTUS" | "KONSI", spg = false) =>
    tautan(renderToStaticMarkup(createElement(AksiKunjungan, { storeId: "toko-1", termsType, spg })));

  it("kartu Kunjungan berjalan, toko PUTUS: kedua ubin lapor beserta labelnya", () => {
    const html = renderToStaticMarkup(createElement(AksiKunjungan, { storeId: "toko-1", termsType: "PUTUS" }));
    expect(tautan(html)).toEqual(
      expect.arrayContaining(["/pwa/bkm/baru?toko=toko-1", "/pwa/retur/baru?toko=toko-1"]),
    );
    expect(html).toContain("pwa.kunjunganBerjalan.laporPelunasan");
    expect(html).toContain("pwa.kunjunganBerjalan.laporRetur");
  });

  it("kartu Kunjungan berjalan, toko KONSI: hanya lapor retur", () => {
    const hrefs = kunjungan("KONSI");
    expect(hrefs).toContain("/pwa/retur/baru?toko=toko-1");
    expect(hrefs.some((h) => h.startsWith("/pwa/bkm/baru"))).toBe(false);
  });

  it("kartu kunjungan SPG: tanpa ubin lapor", () => {
    const hrefs = kunjungan("PUTUS", true);
    expect(hrefs.some((h) => h.startsWith("/pwa/bkm/") || h.startsWith("/pwa/retur/"))).toBe(false);
  });

  it("di luar kunjungan (LaporDariToko): ubin yang sama", () => {
    const putus = tautan(renderToStaticMarkup(createElement(LaporDariToko, { storeId: "toko-1", termsType: "PUTUS" })));
    expect(putus).toEqual(["/pwa/bkm/baru?toko=toko-1", "/pwa/retur/baru?toko=toko-1"]);
    const konsi = tautan(renderToStaticMarkup(createElement(LaporDariToko, { storeId: "toko-1", termsType: "KONSI" })));
    expect(konsi).toEqual(["/pwa/retur/baru?toko=toko-1"]);
  });
});

describe("kartu SPG hari ini", () => {
  const baris = (b: Partial<Parameters<typeof KehadiranSpgToko>[0]["baris"][number]>) => ({
    userId: b.nama ?? "x",
    nama: "x",
    keadaan: "BELUM" as const,
    masuk: null,
    pulang: null,
    jadwalMulai: null,
    ...b,
  });

  it("toko tanpa SPG: kartu tidak tampil", () => {
    expect(renderToStaticMarkup(createElement(KehadiranSpgToko, { baris: [] }))).toBe("");
  });

  it("setiap keadaan menulis teksnya dengan jam yang benar", () => {
    const html = renderToStaticMarkup(
      createElement(KehadiranSpgToko, {
        baris: [
          baris({ nama: "Ani", keadaan: "DI_TOKO", masuk: "08.15" }),
          baris({ nama: "Budi", keadaan: "PULANG", masuk: "08.00", pulang: "16.30" }),
          baris({ nama: "Citra", keadaan: "IZIN" }),
          baris({ nama: "Dewi", keadaan: "BELUM", jadwalMulai: "14:00" }),
          baris({ nama: "Eka", keadaan: "LIBUR" }),
          baris({ nama: "Gani", keadaan: "BUKAN_HARI_KERJA" }),
          baris({ nama: "Fani", keadaan: "BELUM" }),
        ],
      }),
    ).replace(/&quot;/g, '"');
    expect(html).toContain("pwa.kehadiranSpg.judul");
    expect(html).toContain('pwa.kehadiranSpg.diToko{"jam":"08.15"}');
    expect(html).toContain('pwa.kehadiranSpg.pulang{"pulang":"16.30","masuk":"08.00"}');
    // Izin, sakit, dan cuti sama-sama "Izin hari ini" di HP salesman.
    expect(html).toContain("pwa.kehadiranSpg.izin.IZIN");
    expect(html).not.toMatch(/SAKIT|CUTI/);
    expect(html).toContain('pwa.kehadiranSpg.belumJadwal{"jam":"14:00"}');
    expect(html).toContain("pwa.kehadiranSpg.libur");
    expect(html).toMatch(/Gani<\/p><p[^>]*>pwa\.kehadiranSpg\.bukanHariKerja</);
    expect(html).toMatch(/Fani<\/p><p[^>]*>pwa\.kehadiranSpg\.belum</);
  });
});
