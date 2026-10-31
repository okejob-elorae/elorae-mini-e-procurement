import { describe, expect, it } from "vitest";
import { GARIS_REKAP, labelKol, susunRekap, tanggalPanjang, type DataRekap } from "./rekap";

const dasar: DataRekap = {
  dari: "2026-10-07",
  sampai: "2026-10-07",
  dibuatPada: new Date("2026-10-07T07:30:00.000Z"),
  ringkasan: {
    kolBaru: 2,
    barangDikirim: 3,
    barangDiterima: 1,
    kontenTayang: 2,
    views: 125_000,
    orders: 14,
    gmv: 3_500_000,
    komisi: 350_000,
    biayaFee: 1_000_000,
    biayaKirim: 400_000,
    biayaBoost: 0,
  },
  posisi: [
    { tahap: "DEAL", jumlah: 4 },
    { tahap: "TAYANG", jumlah: 0 },
    { tahap: "SAMPEL_DIKIRIM", jumlah: 2 },
  ],
  perCampaign: [{ nama: "Lebaran 2026", kol: 5, views: 125_000, gmv: 3_500_000 }],
  teratas: [{ kol: "@rina.style", platform: "TikTok", gmv: 2_000_000, orders: 9 }],
  pengiriman: [{ kol: "@rina.style", platform: "TikTok", kurir: "JNE", resi: "JNE123" }, { kol: "Dewi", platform: "Instagram", kurir: null, resi: null }],
  kontenTayang: [{ kol: "@rina.style", platform: "TikTok", views: 100_000, link: "https://tiktok.com/@rina.style/video/1", tanggal: "2026-10-07" }],
  kolBaru: [{ kol: "@baru", platform: "TikTok", pengikut: 12_300 }],
  perubahanTahap: [{ kol: "@rina.style", dari: "SAMPEL_DITERIMA", ke: "TAYANG" }],
  catatan: [{ kol: "@rina.style", waktu: new Date("2026-10-07T03:05:00.000Z"), isi: "Minta revisi caption" }],
  tindakLanjut: [
    { judul: "Belum dibalas, perlu follow-up", jumlah: 3 },
    { judul: "Data kirim belum lengkap", jumlah: 0 },
  ],
};

describe("tanggalPanjang dan labelKol", () => {
  it("menulis hari dan bulan dalam bahasa Indonesia", () => {
    expect(tanggalPanjang("2026-10-07")).toBe("Rabu, 7 Oktober 2026");
    expect(tanggalPanjang("2026-02-01")).toBe("Minggu, 1 Februari 2026");
  });

  it("memakai @handle, jatuh ke nama", () => {
    expect(labelKol("@rina", "Rina")).toBe("@rina");
    expect(labelKol(null, "Rina")).toBe("Rina");
  });
});

describe("susunRekap satu hari", () => {
  const teks = susunRekap(dasar);

  it("berkepala tanggal panjang dan bergaris 46 karakter", () => {
    const baris = teks.split("\n");
    expect(baris[0]).toBe("REKAP KOL — Rabu, 7 Oktober 2026");
    expect(baris[1]).toBe(GARIS_REKAP);
    expect(GARIS_REKAP).toHaveLength(46);
  });

  it("ringkasan memuat biaya terinci dan ROAS dengan koma desimal", () => {
    expect(teks).toContain("- GMV                : Rp 3.500.000");
    // Komisi ikut biaya — definisi yang sama dengan angkaKolaborasi.
    expect(teks).toContain("- Biaya              : Rp 1.750.000 (fee Rp 1.000.000 + kirim Rp 400.000 + komisi Rp 350.000)");
    expect(teks).toContain("- ROAS               : 2,00x");
  });

  it("gross-up: fee tetap angka yang disepakati, PPh yang ditanggung ditulis sendiri, dan biaya bruto disebut", () => {
    const t = susunRekap({ ...dasar, ringkasan: { ...dasar.ringkasan, biayaFee: 19_750_000, biayaPph: 301_546, biayaKirim: 0, komisi: 0, gmv: 0 } });
    expect(t).toContain("- Biaya              : Rp 20.051.546 (fee Rp 19.750.000 + PPh gross-up Rp 301.546 + kirim Rp 0)");
    expect(t).toContain("- Fee disepakati     : Rp 19.750.000 · biaya bruto (termasuk PPh) Rp 20.051.546");
    // Tanpa gross-up tidak ada baris tambahan.
    expect(teks).not.toContain("Fee disepakati");
  });

  it("posisi tahap hanya yang berisi, dengan label Indonesia", () => {
    expect(teks).toContain("POSISI TAHAP (kondisi saat ini)");
    expect(teks).toContain("- Deal           : 4");
    expect(teks).not.toContain("- Tayang         : 0");
  });

  it("rincian satu hari: pengiriman, konten tayang dengan link, perubahan tahap, catatan berjam WIB", () => {
    expect(teks).toContain("PENGIRIMAN (2)");
    expect(teks).toContain("- @rina.style (TikTok) | JNE JNE123");
    expect(teks).toContain("- Dewi (Instagram) | resi belum ada");
    expect(teks).toContain("KONTEN TAYANG (1)");
    expect(teks).toContain("  https://tiktok.com/@rina.style/video/1");
    expect(teks).toContain("PERUBAHAN TAHAP (1)");
    expect(teks).toContain("- @rina.style: Sampel diterima → Tayang");
    expect(teks).toContain("- @rina.style (10.05): Minta revisi caption");
  });

  it("perlu ditindaklanjuti hanya kelompok yang berisi, dan kaki berjam WIB", () => {
    expect(teks).toContain("PERLU DITINDAKLANJUTI (3)");
    expect(teks).toContain("- Belum dibalas, perlu follow-up: 3");
    expect(teks).not.toContain("Data kirim belum lengkap");
    expect(teks.trimEnd().endsWith("Dibuat otomatis oleh Elorae ERP · 07/10/2026 14.30")).toBe(true);
  });
});

describe("susunRekap rentang", () => {
  const teks = susunRekap({
    ...dasar,
    dari: "2026-10-01",
    sampai: "2026-10-07",
    kontenTayang: Array.from({ length: 12 }, (_, i) => ({
      kol: `@k${i}`,
      platform: "TikTok",
      views: (i + 1) * 1000,
      link: null,
      tanggal: "2026-10-02",
    })),
    perubahanTahap: [
      { kol: "@a", dari: null, ke: "DEAL" },
      { kol: "@b", dari: "DEAL", ke: "SAMPEL_DIKIRIM" },
    ],
  });

  it("menyebut rentang dan banyak harinya", () => {
    expect(teks.split("\n")[0]).toBe("REKAP KOL — Kamis, 1 Oktober 2026 – Rabu, 7 Oktober 2026");
    expect(teks.split("\n")[1]).toBe("(7 hari)");
  });

  it("konten terbaik 10 teratas menurut views, perubahan tahap hanya dihitung", () => {
    expect(teks).toContain("KONTEN TERBAIK (dari 12 konten)");
    expect(teks).toContain("1. @k11 — 12.000 views · Jumat, 2 Oktober 2026");
    expect(teks).not.toContain("@k1 —");
    expect(teks).toContain("PERUBAHAN TAHAP: 2 kali");
    expect(teks).not.toContain("PENGIRIMAN (");
  });
});

describe("blok yang kosong tidak ditulis", () => {
  it("rekap tanpa kegiatan tetap punya ringkasan, tanpa blok rincian", () => {
    const teks = susunRekap({
      ...dasar,
      posisi: [],
      perCampaign: [],
      teratas: [],
      pengiriman: [],
      kontenTayang: [],
      kolBaru: [],
      perubahanTahap: [],
      catatan: [],
      tindakLanjut: [],
      ringkasan: { ...dasar.ringkasan, biayaFee: 0, biayaKirim: 0, gmv: 0, komisi: 0 },
    });
    expect(teks).toContain("RINGKASAN");
    expect(teks).toContain("- ROAS               : —");
    for (const blok of ["POSISI TAHAP", "PER CAMPAIGN", "TOP PERFORMER", "PENGIRIMAN", "KONTEN", "KOL BARU", "PERUBAHAN", "CATATAN", "PERLU"]) {
      expect(teks).not.toContain(blok);
    }
  });

  it("daftar panjang dipotong dengan '...dan N lainnya'", () => {
    const teks = susunRekap({
      ...dasar,
      pengiriman: Array.from({ length: 45 }, (_, i) => ({ kol: `@p${i}`, platform: null, kurir: "JNE", resi: `R${i}` })),
    });
    expect(teks).toContain("PENGIRIMAN (45)");
    expect(teks).toContain("...dan 5 lainnya");
  });
});
