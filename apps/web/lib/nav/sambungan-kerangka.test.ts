import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Penjaga sambungan kerangka kantor. Logika murninya diuji di berkasnya sendiri
 * (`saring.test.ts`, `tampilan-pengguna.test.ts`, `hari-wib.test.ts`,
 * `tampilan-lonceng.test.ts`), tetapi komponen kliennya tidak dirender di
 * vitest — tanpa penjaga ini, mencabut pemanggilannya dari komponen membuat
 * semua tes tetap hijau sementara layarnya kembali ke cacat lama.
 */

const akar = join(__dirname, "..", "..");
const baca = (rel: string) => readFileSync(join(akar, rel), "utf8");

describe("sambungan kerangka kantor", () => {
  it("menu samping: saat mencari, grup yang cocok dibuka (`grupTerbuka`)", () => {
    const src = baca("app/backoffice/BackofficeShell.tsx");
    expect(src).toMatch(/open=\{grupTerbuka\(item\.href, openNavKey, sedangMencari, lolos\.has\(item\.href\)\)\}/);
  });

  it("menu pengguna: satu centang tema dari `keadaanTema`, teks lewat i18n", () => {
    const src = baca("app/backoffice/BackofficeShell.tsx");
    expect(src).toContain("keadaanTema(theme, systemTheme)");
    expect(src).not.toMatch(/isLight|isSystem/);
    for (const inggris of [">My Account<", ">Theme<", ">Light<", ">Dark<", ">System<", ">Sign out<"]) {
      expect(src).not.toContain(inggris);
    }
  });

  it("lonceng: teks per jenis, waktu relatif berbahasa pembaca, tombol uji hanya untuk admin sistem", () => {
    const src = baca("components/notifications/NotificationIcon.tsx");
    expect(src).toContain("tampilanLonceng(item, penerjemah)");
    expect(src).toContain("locale: localeWaktu");
    expect(src).not.toMatch(/\{item\.(title|body)\}/);
    // Tombol uji kirim berada di dalam cabang `bolehUji`.
    const awalUji = src.indexOf("{bolehUji ? (");
    expect(awalUji).toBeGreaterThan(-1);
    expect(src.indexOf("onClick={handleSendTest}")).toBeGreaterThan(awalUji);
  });

  it("Laporan operasional: rentang 'bulan ini' dan batas kueri dihitung dalam WIB", () => {
    const src = baca("app/backoffice/laporan/LaporanPageClient.tsx");
    expect(src).toContain("bulanIniWib()");
    expect(src).not.toContain("toISOString().slice(0, 10)");
    expect(src).not.toMatch(/new Date\(rp[12]/);
  });
});
