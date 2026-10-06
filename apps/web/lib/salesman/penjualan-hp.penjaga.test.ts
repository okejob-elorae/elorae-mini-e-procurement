import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Penjaga: halaman HP salesman (beranda, riwayat penjualan, insentif,
 * peringkat, target saya) hanya membentuk angka penjualan lewat pembentuk
 * payload HP (`penjualan-hp*.ts`, `peringkatHp`, `targetSayaHp`,
 * `tokoMenurunHp`).
 *
 * Aturan mutlak pemilik: rupiah konsinyasi tidak pernah sampai ke HP. Tes basis
 * data (`penjualan-hp-queries.test.ts`) membuktikan pembentuk payload-nya
 * bersih, tapi halaman bisa saja kembali memanggil fungsi resmi kantor
 * (`komisiSalesman`, `omzetBulan`, `penjualanSalesman`) yang memuat konsi —
 * dan type-check `apps/web` tidak pernah jalan di sini, hanya di build Docker.
 * Tes ini yang menangkapnya lebih dulu.
 */

const AKAR = join(__dirname, "../..");
const baca = (f: string) => readFileSync(join(AKAR, f), "utf8");

/** Nama yang diimpor sebuah berkas (`import { a, type b as c } from "..."`). */
function namaDiimpor(sumber: string): string[] {
  const hasil: string[] = [];
  for (const m of sumber.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["'][^"']+["']/g)) {
    for (const bagian of m[1].split(",")) {
      const nama = bagian.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim();
      if (nama) hasil.push(nama);
    }
  }
  return hasil;
}

/** Fungsi resmi kantor yang memuat rupiah konsi — tidak boleh dipanggil halaman HP. */
const RESMI = [
  "komisiSalesman",
  "omzetBulan",
  "penjualanSalesman",
  "jumlahkanPenjualan",
  "susunPenjualanSalesman",
  // Papan resmi: omzet sendiri dengan konsi, dan urutan resmi mengapit capaian sendiri.
  "peringkatBulan",
  // Capaian mentah: `capaian.total`/`kanal` memuat konsi.
  "targetSaya",
  "capaianRinciSales",
  "capaianRinciOrang",
  // Nilai 90 hari per toko = total konsi di toko konsinyasi.
  "tokoMenurun",
];

const HALAMAN: { berkas: string; wajib: string[] }[] = [
  { berkas: "app/pwa/page.tsx", wajib: ["berandaPenjualanHp", "komisiUntukHp", "tokoMenurunHp"] },
  { berkas: "app/pwa/insentif/page.tsx", wajib: ["insentifHp"] },
  { berkas: "app/pwa/penjualan/page.tsx", wajib: ["riwayatPenjualan"] },
  { berkas: "app/pwa/peringkat/page.tsx", wajib: ["peringkatHp"] },
  { berkas: "app/pwa/target/page.tsx", wajib: ["targetSayaHp"] },
];

/** Berkas yang menampilkan atau meneruskan angka penjualan ke HP. */
const TAMPILAN = [
  "app/pwa/page.tsx",
  "app/pwa/HomeShell.tsx",
  "app/pwa/beranda/KartuBulanIni.tsx",
  "app/pwa/penjualan/page.tsx",
  "app/pwa/penjualan/PenjualanClient.tsx",
  "app/pwa/insentif/page.tsx",
  "app/pwa/insentif/InsentifClient.tsx",
  "app/pwa/insentif/KartuInsentifBeranda.tsx",
  "app/pwa/peringkat/page.tsx",
  "app/pwa/peringkat/PeringkatClient.tsx",
  "app/pwa/target/page.tsx",
  "app/pwa/target/TargetSayaClient.tsx",
  "app/pwa/beranda/RencanaKunjungan.tsx",
];

// Kunci rupiah konsi: `.konsi`, `konsi:`, atau kanal "konsi" di daftar kanal.
// `channelKonsi` / `channel_konsi` (label i18n) dan `pcsKonsi` tidak cocok.
const KUNCI_KONSI = /["'`]konsi["'`]|\.konsi\b|(?<![\w.])konsi\s*:/;
// Angka resmi yang memuat konsi: capaian mentah (`capaian.total`, `kanal`) dan
// nilai 90 hari toko menurun. Payload HP membawa `omzet` dan `rasioNilai`.
const ANGKA_RESMI = /capaian\.total\b|\.kanal\b|\bnilai90(Sebelumnya)?\b/;

describe("penjaga: halaman HP salesman tidak memakai angka resmi yang memuat konsi", () => {
  for (const { berkas, wajib } of HALAMAN) {
    it(`${berkas} membentuk angka lewat penjualan-hp, bukan fungsi resmi kantor`, () => {
      const nama = namaDiimpor(baca(berkas));
      for (const n of wajib) expect(nama, `${berkas} harus mengimpor ${n}`).toContain(n);
      for (const n of RESMI) expect(nama, `${berkas} tidak boleh mengimpor ${n}`).not.toContain(n);
    });
  }

  for (const berkas of TAMPILAN) {
    it(`${berkas} tidak membaca rupiah konsi`, () => {
      const baris = baca(berkas)
        .split("\n")
        .map((isi, i) => ({ isi, no: i + 1 }))
        .filter(({ isi }) => !/^\s*(\/\/|\*|\/\*)/.test(isi) && (KUNCI_KONSI.test(isi) || ANGKA_RESMI.test(isi)));
      expect(baris.map((b) => `${berkas}:${b.no}: ${b.isi.trim()}`)).toEqual([]);
    });
  }
});
