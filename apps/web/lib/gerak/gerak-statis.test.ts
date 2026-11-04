import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buttonVariants } from "@/components/ui/button";
import { KURVA_LEMBAR, KURVA_PEGAS, MAKS_BARIS_BERURUTAN, jedaBaris, kurvaCss } from "./kurva";
import { DURASI_SOROT_MS, NAMA_ANIMASI_SOROT } from "./sorot";

/*
 * Tes statis gerak: membaca globals.css dan sumber komponen UI yang
 * sungguhan. Yang dijaga:
 *  - setiap gerak baru punya penawarnya di `prefers-reduced-motion: reduce`;
 *  - angka di CSS (kurva, jeda baris, durasi sorot) sama dengan lib/gerak;
 *  - tombol yang "tertekan" tidak mengubah tinggi atau bantalannya.
 */

const akar = path.resolve(__dirname, "../..");
const baca = (rel: string) => readFileSync(path.join(akar, rel), "utf8");
const css = baca("app/globals.css");

/** Isi setiap blok `@media (...)` yang kondisinya memuat `kondisi`. */
function blokMedia(teks: string, kondisi: string): string[] {
  const hasil: string[] = [];
  let i = 0;
  while ((i = teks.indexOf("@media", i)) !== -1) {
    const buka = teks.indexOf("{", i);
    const kepala = teks.slice(i, buka);
    let dalam = 1;
    let j = buka + 1;
    while (dalam > 0 && j < teks.length) {
      if (teks[j] === "{") dalam++;
      else if (teks[j] === "}") dalam--;
      j++;
    }
    if (kepala.includes(kondisi)) hasil.push(teks.slice(buka + 1, j - 1));
    i = j;
  }
  return hasil;
}

const kurangiGerak = blokMedia(css, "prefers-reduced-motion: reduce").join("\n");

/** Teks tanpa blok `@…{ … }` bersarang (@keyframes, @media, @theme) — tinggal aturan biasa. */
function buangBlokBersarang(teks: string): string {
  let hasil = "";
  let i = 0;
  while (i < teks.length) {
    const at = teks.indexOf("@", i);
    if (at === -1) {
      hasil += teks.slice(i);
      break;
    }
    hasil += teks.slice(i, at);
    const buka = teks.indexOf("{", at);
    const titikKoma = teks.indexOf(";", at);
    if (buka === -1 || (titikKoma !== -1 && titikKoma < buka)) {
      i = titikKoma === -1 ? teks.length : titikKoma + 1;
      continue;
    }
    let dalam = 1;
    let j = buka + 1;
    while (dalam > 0 && j < teks.length) {
      if (teks[j] === "{") dalam++;
      else if (teks[j] === "}") dalam--;
      j++;
    }
    i = j;
  }
  return hasil;
}

/** Aturan datar `pemilih { isi }` (komentar sudah dibuang), pemilih dipecah per koma. */
function aturanCss(teks: string): { pemilih: string[]; isi: string }[] {
  return [...teks.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, p, isi]) => ({
    pemilih: p
      .split(",")
      .map((s) => s.trim().replace(/\s+/g, " "))
      .filter(Boolean),
    isi,
  }));
}

describe("globals.css — setiap gerak baru dibungkus 'kurangi gerakan'", () => {
  it.each([
    [".baris-berurutan", "baris tabel yang muncul berurutan"],
    [".sorot-baru", "sorot baris yang baru berubah"],
    ['[data-sorot="baru"]', "sorot lewat atribut (useSorotBaris)"],
    ["::view-transition-group(*)", "transisi halaman"],
    ["::view-transition-old(*)", "transisi halaman (lama)"],
    ["::view-transition-new(*)", "transisi halaman (baru)"],
  ])("%s (%s)", (pemilih) => {
    expect(css).toContain(pemilih);
    expect(kurangiGerak).toContain(pemilih);
  });

  it("SETIAP pemilih yang memasang animasi di bagian gerak punya aturan penawar sendiri", () => {
    // Bukan sekadar potongan teks: `tr[data-sorot="baru"] > td` (yang dipakai baris)
    // bisa hilang dari blok penawar sementara `[data-sorot="baru"]:not(tr)` masih ada.
    const judul = css.indexOf("Gerak kecil yang membantu kerja");
    expect(judul).toBeGreaterThan(-1);
    // Bagian ini saja: dari judulnya sampai akhir blok penawarnya sendiri.
    const awalPenawar = css.indexOf("@media (prefers-reduced-motion: reduce)", judul);
    expect(awalPenawar).toBeGreaterThan(judul);
    let akhir = css.indexOf("{", awalPenawar) + 1;
    for (let dalam = 1; dalam > 0 && akhir < css.length; akhir++) {
      if (css[akhir] === "{") dalam++;
      else if (css[akhir] === "}") dalam--;
    }
    const bagian = css.slice(css.lastIndexOf("/*", judul), akhir).replace(/\/\*[\s\S]*?\*\//g, "");
    const penawar = blokMedia(bagian, "prefers-reduced-motion: reduce").join("\n");
    const tanpaBlok = buangBlokBersarang(bagian);
    const bergerak = aturanCss(tanpaBlok).filter((a) => /(^|;|\s)animation\s*:/.test(a.isi));
    const pemilihPenawar = new Set(
      aturanCss(penawar)
        .filter((a) => /(^|;|\s)animation\s*:/.test(a.isi))
        .flatMap((a) => a.pemilih),
    );
    expect(bergerak.length).toBeGreaterThan(0);
    for (const aturan of bergerak) {
      for (const p of aturan.pemilih) expect(pemilihPenawar, `penawar untuk ${p}`).toContain(p);
    }
  });

  it("jaring pengaman lama tetap ada: semua animasi dipendekkan jadi 1 ms", () => {
    expect(kurangiGerak).toMatch(/\*,\s*\*::before,\s*\*::after\s*\{[^}]*animation-duration:\s*1ms !important/);
  });

  it("sorot memakai warna, bukan gerak — tanpa transform di keyframes-nya", () => {
    const kf = css.match(/@keyframes sorot-baru\s*\{([\s\S]*?)\n\}/);
    expect(kf).not.toBeNull();
    expect(kf![1]).toContain("background-color");
    expect(kf![1]).not.toContain("transform");
  });

  it("sorot punya warna untuk tema terang dan gelap", () => {
    expect(css).toMatch(/:root\s*\{[^}]*--sorot-baru:/);
    expect(css).toMatch(/\.dark\s*\{[^}]*--sorot-baru:/);
  });

  it("durasi sorot di CSS sama dengan DURASI_SOROT_MS, dan nama animasinya cocok", () => {
    const pakai = [...css.matchAll(/animation:\s*(sorot-baru[\w-]*)\s+(\d+)ms/g)];
    expect(pakai.length).toBeGreaterThan(0);
    for (const [, nama, ms] of pakai) {
      expect(nama.startsWith(NAMA_ANIMASI_SOROT)).toBe(true);
      expect(Number(ms)).toBe(DURASI_SOROT_MS);
    }
  });
});

describe("globals.css — angka sama dengan lib/gerak", () => {
  it("--ease-pegas dan --ease-lembar = KURVA_PEGAS dan KURVA_LEMBAR", () => {
    expect(css).toContain(`--ease-pegas: ${kurvaCss(KURVA_PEGAS)};`);
    expect(css).toContain(`--ease-lembar: ${kurvaCss(KURVA_LEMBAR)};`);
  });

  it("jeda tiap baris = jedaBaris(n), dan berhenti di baris ke-12", () => {
    const aturan = [...css.matchAll(/\.baris-berurutan > tr:nth-child\(([^)]+)\)\s*\{\s*animation-delay:\s*(\d+)ms;\s*\}/g)];
    expect(aturan.length).toBe(MAKS_BARIS_BERURUTAN - 1);
    for (const [, n, ms] of aturan) {
      const ekor = n.match(/^n \+ (\d+)$/);
      if (ekor) {
        expect(Number(ekor[1])).toBe(MAKS_BARIS_BERURUTAN);
        expect(Number(ms)).toBe(jedaBaris(MAKS_BARIS_BERURUTAN));
      } else {
        expect(Number(ms)).toBe(jedaBaris(Number(n)));
      }
    }
  });

  it("baris berurutan tidak meninggalkan transform setelah selesai (fill backwards, bukan both)", () => {
    const dasar = css.match(/\.baris-berurutan > tr\s*\{([^}]*)\}/);
    expect(dasar).not.toBeNull();
    expect(dasar![1]).toMatch(/\bbackwards\b/);
    expect(dasar![1]).not.toMatch(/\bboth\b|\bforwards\b/);
  });

  it("selama transisi halaman klik tetap sampai ke halaman", () => {
    expect(css).toMatch(/::view-transition\s*\{[^}]*pointer-events:\s*none/);
  });
});

/** Utilitas tata letak dari daftar kelas (setelah varian terakhir di luar kurung siku). */
function utilitasTataLetak(kelas: string): string[] {
  return kelas
    .split(/\s+/)
    .filter(Boolean)
    .filter((k) => {
      const dasar = k.replace(/^(?:[^[\]:]*(?:\[[^\]]*\])?[^[\]:]*:)+/, "");
      return /^(?:h|w|size|min-h|min-w|max-h|max-w|p[xytrbl]?|m[xytrbl]?|gap)-/.test(dasar);
    })
    .sort();
}

const DASAR_LAMA = "gap-2";
const UKURAN_LAMA: Record<string, string> = {
  default: "h-9 px-4 py-2 has-[>svg]:px-3",
  xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
  sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
  lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
  icon: "size-9",
  "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
  "icon-sm": "size-8",
  "icon-lg": "size-10",
};

describe("Tombol — rasa tertekan tanpa menggeser tata letak", () => {
  it.each(Object.keys(UKURAN_LAMA))("ukuran %s: tinggi, lebar, bantalan, celah tidak berubah", (size) => {
    const kelas = buttonVariants({ size: size as never });
    expect(utilitasTataLetak(kelas)).toEqual(utilitasTataLetak(`${DASAR_LAMA} ${UKURAN_LAMA[size]}`));
  });

  it("menekan hanya mengecilkan lewat transform, dan hanya bila gerak tidak dikurangi", () => {
    const kelas = buttonVariants({});
    expect(kelas).toContain("motion-safe:active:scale-[0.97]");
    for (const k of kelas.split(/\s+/).filter((x) => x.includes("active:"))) {
      expect(k.startsWith("motion-safe:")).toBe(true);
      expect(k).toMatch(/:scale-/);
    }
  });
});

describe("Dialog, panel, popover, menu — masuk dengan pegas, keluar lebih cepat", () => {
  const sumber: [string, string, number][] = [
    ["components/ui/dialog.tsx", "ease-pegas", 1],
    ["components/ui/alert-dialog.tsx", "ease-pegas", 1],
    ["components/ui/popover.tsx", "ease-pegas", 1],
    ["components/ui/dropdown-menu.tsx", "ease-pegas", 2],
    ["components/ui/sheet.tsx", "ease-lembar", 1],
  ];

  it.each(sumber)("%s memakai data-[state=open]:%s", (berkas, kurva, kali) => {
    const isi = baca(berkas);
    const cocok = isi.match(new RegExp(`data-\\[state=open\\]:${kurva}\\b`, "g")) ?? [];
    expect(cocok.length).toBeGreaterThanOrEqual(kali);
  });

  it.each(sumber.map(([b]) => [b]))("%s: durasi keluar lebih pendek dari durasi masuk", (berkas) => {
    const isi = baca(berkas);
    const ms = (s: string) => Number(s.replace(/[^\d]/g, ""));
    const masuk = [...isi.matchAll(/data-\[state=open\]:duration-\[?(\d+)(?:ms\])?/g)].map((m) => ms(m[1]));
    const keluar = [...isi.matchAll(/data-\[state=closed\]:duration-\[?(\d+)(?:ms\])?/g)].map((m) => ms(m[1]));
    expect(masuk.length).toBeGreaterThan(0);
    expect(keluar.length).toBeGreaterThan(0);
    expect(Math.max(...keluar)).toBeLessThan(Math.min(...masuk));
  });
});
