import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Penjaga aksesibilitas kerangka kantor dan komponen bersama (audit ulang
 * 2026-10-08). Komponen kliennya tidak dirender di vitest, jadi tes ini membaca
 * sumbernya: mencabut salah satu sambungan di bawah mengembalikan cacat yang
 * terukur di layar tanpa satu tes pun merah.
 */

const akar = join(__dirname, "..", "..");
const baca = (rel: string) => readFileSync(join(akar, rel), "utf8");

describe("laci menu HP", () => {
  const src = baca("app/backoffice/BackofficeShell.tsx");

  it("satu lembar terkendali: pemicu dan isinya di bawah Sheet yang sama dengan open={mobileMenuOpen}", () => {
    expect(src.match(/<Sheet\b/g)?.length).toBe(1);
    expect(src).toContain("<Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>");
  });

  it("tombol menu bernama, laci punya judul dan keterangan untuk pembaca layar", () => {
    expect(src).toContain("aria-label={tNav('bukaMenu')}");
    expect(src).toMatch(/<SheetTitle className="sr-only">\{tNav\('judulMenuSamping'\)\}<\/SheetTitle>/);
    expect(src).toMatch(/<SheetDescription className="sr-only">/);
  });

  it("jangkar #… di alamat menggulir <main>, bukan dokumen", () => {
    expect(src).toContain("<main ref={isiHalaman}");
    expect(src).toContain("geserKeJangkar(wadah.getBoundingClientRect().top, el.getBoundingClientRect().top)");
    expect(src).toContain("window.addEventListener('hashchange', gantiHash)");
  });

  it("laci menutup saat rute berganti", () => {
    expect(src).toMatch(/setMobileMenuOpen\(false\);\s*\}, \[pathname\]\);/);
  });
});

describe("menu samping", () => {
  const src = baca("app/backoffice/BackofficeShell.tsx");

  it("tautan aktif memakai aria-current='page' (anak, tingkat atas, sematan)", () => {
    expect(src).toContain("aria-current={isChildActive ? 'page' : undefined}");
    expect(src).toContain("aria-current={isActive ? 'page' : undefined}");
    expect(src).toContain("aria-current={pathname === f.href ? 'page' : undefined}");
  });

  it("menu menggulir ke tautan aktif tanpa scrollIntoView", () => {
    expect(src).toContain("geserAgarTerlihat(wadah.getBoundingClientRect(), aktif.getBoundingClientRect())");
    expect(src).not.toContain("scrollIntoView");
  });

  it("kepala halaman memakai entriHalamanAktif (anak menang seri)", () => {
    expect(src).toContain("entriHalamanAktif(pathname, navItems)");
  });

  it("placeholder kotak cari menu terbaca (bukan /40)", () => {
    expect(src).not.toContain("placeholder:text-primary-foreground/40");
    expect(src).toContain("placeholder:text-primary-foreground/80");
  });
});

describe("cincin fokus", () => {
  const css = baca("app/globals.css");

  it("kontrol bersama memakai --cincin-fokus, bukan --ring mentah", () => {
    const aturan = css.slice(css.indexOf('[data-slot="button"]:focus-visible'));
    expect(aturan.slice(0, aturan.indexOf("}"))).toContain("outline: 2px solid var(--cincin-fokus);");
    expect(css).not.toContain("outline: 2px solid var(--ring);");
  });

  it("tema terang memakai warna tautan; tema gelap dicerahkan", () => {
    expect(css).toMatch(/:root \{\s*--cincin-fokus: var\(--tautan\);/);
    expect(css).toContain("--cincin-fokus: oklch(from var(--ring) max(l, 0.72) c h);");
  });

  it("utilitas ring-ring/border-ring memakai cincin fokus, bukan warna tema mentah", () => {
    expect(css).toContain("--color-ring: var(--cincin-fokus);");
  });

  it("outline bawaan semua elemen = cincin fokus (bukan ring/50)", () => {
    expect(css).not.toContain("outline-ring/50");
    expect(css).toContain("outline-color: var(--cincin-fokus);");
  });

  it("menu samping berlatar warna tema memakai --primary-foreground di dalam tepi", () => {
    expect(css).toMatch(/\[data-menu-samping\] :is\(a, button, input\):focus-visible \{\s*outline: 2px solid var\(--primary-foreground\);\s*outline-offset: -2px;/);
    expect(baca("app/backoffice/BackofficeShell.tsx")).toContain("data-menu-samping");
  });
});

describe("kartu kantor: kelas pemanggil menang atas kepadatan tema", () => {
  const css = baca("app/globals.css");
  it("kepadatan tema hanya menimpa jarak BAWAAN (py-6/gap-6/px-6), bukan py-0/p-4 pemanggil", () => {
    expect(css).toContain('html.backoffice-shell [data-slot="card"].py-6 {');
    expect(css).toContain('html.backoffice-shell [data-slot="card"].gap-6 {');
    expect(css).toContain('html.backoffice-shell [data-slot="card-content"].px-6,');
    expect(css).not.toMatch(/html\.backoffice-shell \[data-slot="card"\] \{\s*gap: var\(--ui-card-gap\);/);
  });
});

describe("kategori: teks lencana ≥ 4,5:1 di baris berlatar", () => {
  it("nada teks tema terang 800, bukan 700", () => {
    const src = baca("lib/ui/category-color.ts");
    expect(src).not.toMatch(/text-(sky|violet|orange|cyan|fuchsia|indigo|teal|rose)-700/);
  });
});

describe("komponen bersama berbahasa pembaca", () => {
  it("tombol tutup dialog dan lembar memakai common.close, bukan 'Close'", () => {
    for (const berkas of ["components/ui/dialog.tsx", "components/ui/sheet.tsx"]) {
      const src = baca(berkas);
      expect(src, berkas).not.toMatch(/>Close</);
      expect(src, berkas).toContain('{t("close")}');
    }
  });

  it("masukan tag: bawaan lewat i18n, tanpa 'Add tag...' / 'Remove'", () => {
    const src = baca("components/ui/tags-input.tsx");
    expect(src).not.toContain("'Add tag...'");
    expect(src).not.toContain("`Remove ${tag}`");
  });

  it("combobox: bawaan placeholder lewat i18n, tanpa 'Search...'", () => {
    const src = baca("components/ui/searchable-combobox.tsx");
    expect(src).not.toContain('"Search..."');
    expect(src).not.toContain('"Select..."');
    expect(src).not.toContain('"No results found."');
    expect(src).toContain('t("cariElipsis")');
  });

  it("tab tidak aktif cukup kontras (bukan text-foreground/60) dan daftar tab boleh turun baris", () => {
    const src = baca("components/ui/tabs.tsx");
    expect(src).not.toContain("text-foreground/60");
    expect(src).toContain("text-foreground/80");
    expect(src).toContain("group-data-[orientation=horizontal]/tabs:flex-wrap");
    expect(src).not.toMatch(/group-data-\[orientation=horizontal\]\/tabs:h-9\b/);
  });
});
