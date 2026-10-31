import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { kunciGalatPutusan, pemeriksaSamaKlaim, tombolPutusan } from "./putusan-klaim";

/*
 * Tombol "Cocok di rekening" / "Tolak" di rincian BKM.
 *
 * Dulu tombolnya tampil untuk BKM yang dicatat atau dilaporkan oleh penonton
 * sendiri, lalu baru menolak PEMERIKSA_SAMA saat diklik. Dan saat verifikasi
 * gagal karena faktur sudah dilunasi BKM lain, pesannya memakai kalimat
 * formulir pembuatan ("dilunasi melebihi sisanya") yang tidak menjelaskan apa
 * yang terjadi sejak laporan dibuat.
 */

describe("pemeriksaSamaKlaim — aturan yang sama dengan putuskanKlaim", () => {
  const klaim = { salesmanId: "sales-1", createdById: "admin-1" };

  it("sales pelapor tidak boleh memutuskan laporannya sendiri", () => {
    expect(pemeriksaSamaKlaim("sales-1", klaim)).toBe(true);
  });

  it("admin yang mencatatkan BKM dari kantor juga tidak", () => {
    expect(pemeriksaSamaKlaim("admin-1", klaim)).toBe(true);
  });

  it("admin keuangan lain boleh", () => {
    expect(pemeriksaSamaKlaim("keuangan-2", klaim)).toBe(false);
  });

  it("kolom kosong tidak pernah cocok dengan penonton", () => {
    expect(pemeriksaSamaKlaim("keuangan-2", { salesmanId: null, createdById: null })).toBe(false);
    expect(pemeriksaSamaKlaim("", { salesmanId: "", createdById: null })).toBe(false);
  });

  // Aturan ini ada dua kali (penulis + layar). Bila syarat di penulis berubah,
  // tes ini gagal supaya `pemeriksaSamaKlaim` ikut diubah.
  it("syarat di putuskanKlaim masih pelapor ATAU pencatat — sama dengan helper ini", () => {
    const PENULIS = readFileSync(join(__dirname, "../../../../lib/receivables/writer.ts"), "utf8");
    const awal = PENULIS.indexOf("export async function putuskanKlaim(");
    const badan = PENULIS.slice(awal, PENULIS.indexOf("'PEMERIKSA_SAMA' as const", awal));
    expect(badan).toMatch(
      /if \(input\.olehUserId === klaim\.salesmanId \|\| input\.olehUserId === klaim\.createdById\) \{\s*return \{ ok: false, alasan: $/,
    );
  });
});

describe("tombolPutusan", () => {
  const dasar = { status: "DIKIRIM" as const, bolehMemutuskan: true, giroMenunggu: false, pemeriksaSama: false };

  it("pemeriksa lain: tombol tampil dan aktif", () => {
    expect(tombolPutusan(dasar)).toEqual({ tampil: true, alasanNonaktif: null });
  });

  it("pelapor/pencatat sendiri: tombol tampil tapi mati, dengan alasannya", () => {
    expect(tombolPutusan({ ...dasar, pemeriksaSama: true })).toEqual({
      tampil: true,
      alasanNonaktif: "PEMERIKSA_SAMA",
    });
  });

  it("tidak tampil tanpa izin, untuk giro yang menunggu, atau BKM yang sudah diputuskan", () => {
    expect(tombolPutusan({ ...dasar, bolehMemutuskan: false }).tampil).toBe(false);
    expect(tombolPutusan({ ...dasar, giroMenunggu: true }).tampil).toBe(false);
    for (const status of ["TERVERIFIKASI", "DITOLAK", "DIBATALKAN"] as const) {
      expect(tombolPutusan({ ...dasar, status }).tampil).toBe(false);
    }
  });
});

describe("kunciGalatPutusan", () => {
  it("MELEBIHI_SISA saat verifikasi punya kalimatnya sendiri, bukan kalimat formulir pembuatan", () => {
    expect(kunciGalatPutusan("MELEBIHI_SISA", "TERVERIFIKASI")).toBe("errVerifikasiMELEBIHI_SISA");
  });

  it("kode lain tetap memakai pesan bersama", () => {
    expect(kunciGalatPutusan("PEMERIKSA_SAMA", "TERVERIFIKASI")).toBe("errPEMERIKSA_SAMA");
    expect(kunciGalatPutusan("RETUR_TERPAKAI", "TERVERIFIKASI")).toBe("errRETUR_TERPAKAI");
    expect(kunciGalatPutusan("ALASAN_WAJIB", "DITOLAK")).toBe("errALASAN_WAJIB");
    expect(kunciGalatPutusan("MELEBIHI_SISA", "DITOLAK")).toBe("errMELEBIHI_SISA");
  });
});

describe("RincianKlaimClient — sambungan tombol dan pesan", () => {
  const KLIEN = readFileSync(join(__dirname, "RincianKlaimClient.tsx"), "utf8");

  it("pesan galat putusan lewat kunciGalatPutusan, bukan `err${kode}` langsung", () => {
    expect(KLIEN).toContain("kunciGalatPutusan(hasil.kode, keputusan)");
    expect(KLIEN).not.toMatch(/t\(`err\$\{hasil\.kode\}`/);
  });

  it("tombol Cocok di rekening dan Tolak mati dengan alasan untuk pelapor sendiri", () => {
    expect(KLIEN).toContain("tombolPutusan({");
    const tombol = KLIEN.slice(KLIEN.indexOf("tombol.tampil &&"), KLIEN.indexOf("{t('verify')}"));
    expect(tombol).toMatch(/disabled=\{pending \|\| tombol\.alasanNonaktif !== null\}/);
    expect(KLIEN).toContain("t('errPEMERIKSA_SAMA')");
  });

  it("jawaban PEMERIKSA_SAMA dari server ikut mematikan tombol tanpa muat ulang", () => {
    expect(KLIEN).toMatch(/hasil\.kode === 'PEMERIKSA_SAMA'\) setPemeriksaSamaDariServer\(true\)/);
  });
});
