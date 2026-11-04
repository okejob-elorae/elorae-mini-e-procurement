import { describe, expect, it } from "vitest";
import {
  angkaSudahMatang,
  bolehPindahTahap,
  butuhAlasan,
  feeDiakui,
  isJalurKeluar,
  JALUR_KELUAR,
  jenisPindah,
  LABEL_TAHAP,
  majuOtomatis,
  nilaiFeeDiakui,
  SEMUA_TAHAP,
  statusBayarBawaan,
  tahapAktif,
  tahapBerikut,
  TAHAP_BERJALAN,
  tujuanPindah,
  URUTAN_TAHAP,
  type Tahap,
} from "./tahap";

describe("urutan tahap kolaborasi", () => {
  it("punya 13 tahap jalan dan 3 jalur keluar, tanpa kembar", () => {
    expect(URUTAN_TAHAP).toHaveLength(13);
    expect(JALUR_KELUAR).toEqual(["DITOLAK", "GHOSTING", "BATAL"]);
    expect(new Set(SEMUA_TAHAP).size).toBe(16);
    expect(URUTAN_TAHAP[0]).toBe("PROSPEK");
    expect(URUTAN_TAHAP.at(-1)).toBe("SELESAI");
  });

  it("setiap tahap punya label bahasa Indonesia", () => {
    for (const t of SEMUA_TAHAP) expect(LABEL_TAHAP[t].length).toBeGreaterThan(0);
  });

  it("tahap berjalan = urutan tanpa SELESAI", () => {
    expect(TAHAP_BERJALAN).not.toContain("SELESAI");
    expect(TAHAP_BERJALAN).toHaveLength(12);
    expect(tahapAktif("DIBAYAR")).toBe(true);
    expect(tahapAktif("SELESAI")).toBe(false);
    expect(tahapAktif("GHOSTING")).toBe(false);
  });

  it("tahap berikut mengikuti urutan, berhenti di SELESAI dan di jalur keluar", () => {
    expect(tahapBerikut("PROSPEK")).toBe("DIHUBUNGI");
    expect(tahapBerikut("DIBAYAR")).toBe("SELESAI");
    expect(tahapBerikut("SELESAI")).toBeNull();
    expect(tahapBerikut("BATAL")).toBeNull();
    expect(isJalurKeluar("DITOLAK")).toBe(true);
    expect(isJalurKeluar("DEAL")).toBe(false);
  });
});

describe("bolehPindahTahap", () => {
  it("maju boleh melompati tahap, tanpa alasan", () => {
    expect(jenisPindah("PROSPEK", "DEAL")).toBe("MAJU");
    expect(bolehPindahTahap("PROSPEK", "TAYANG")).toEqual({ boleh: true, jenis: "MAJU" });
    expect(butuhAlasan("DEAL", "SAMPEL_DIKIRIM")).toBe(false);
  });

  it("mundur hanya dengan alasan", () => {
    expect(jenisPindah("TAYANG", "DRAF")).toBe("MUNDUR");
    expect(bolehPindahTahap("TAYANG", "DRAF")).toEqual({ boleh: false, sebab: "ALASAN_WAJIB" });
    expect(bolehPindahTahap("TAYANG", "DRAF", "   ")).toEqual({ boleh: false, sebab: "ALASAN_WAJIB" });
    expect(bolehPindahTahap("TAYANG", "DRAF", "link salah tempel")).toEqual({ boleh: true, jenis: "MUNDUR" });
  });

  it("keluar ke jalur keluar dari tahap aktif mana pun, alasan wajib", () => {
    for (const dari of TAHAP_BERJALAN) {
      for (const ke of JALUR_KELUAR) {
        expect(jenisPindah(dari, ke)).toBe("KELUAR");
        expect(bolehPindahTahap(dari, ke).boleh).toBe(false);
        expect(bolehPindahTahap(dari, ke, "tidak membalas dua minggu")).toEqual({ boleh: true, jenis: "KELUAR" });
      }
    }
  });

  it("kolaborasi SELESAI tidak bisa langsung dikeluarkan, tapi boleh dimundurkan dengan alasan", () => {
    expect(jenisPindah("SELESAI", "BATAL")).toBeNull();
    expect(bolehPindahTahap("SELESAI", "BATAL", "x")).toEqual({ boleh: false, sebab: "TIDAK_BISA" });
    expect(bolehPindahTahap("SELESAI", "DIBAYAR", "ternyata belum lunas")).toEqual({ boleh: true, jenis: "MUNDUR" });
  });

  it("dari jalur keluar hanya 'buka lagi' ke PROSPEK atau DIHUBUNGI, dengan alasan", () => {
    expect(jenisPindah("GHOSTING", "DIHUBUNGI")).toBe("BUKA_LAGI");
    expect(jenisPindah("BATAL", "PROSPEK")).toBe("BUKA_LAGI");
    expect(bolehPindahTahap("GHOSTING", "DIHUBUNGI")).toEqual({ boleh: false, sebab: "ALASAN_WAJIB" });
    expect(bolehPindahTahap("GHOSTING", "DIHUBUNGI", "membalas lagi")).toEqual({ boleh: true, jenis: "BUKA_LAGI" });
    // Menghidupkan langsung ke tengah alur akan melewati semua pemeriksaan di depannya.
    expect(jenisPindah("BATAL", "DEAL")).toBeNull();
    expect(jenisPindah("DITOLAK", "GHOSTING")).toBeNull();
  });

  it("menolak pindah ke tahap yang sama", () => {
    expect(jenisPindah("NEGO", "NEGO")).toBeNull();
    expect(bolehPindahTahap("NEGO", "NEGO", "x")).toEqual({ boleh: false, sebab: "SAMA" });
  });

  it("tujuanPindah memuat semua tujuan yang sah dan tidak memuat dirinya", () => {
    const dariDeal = tujuanPindah("DEAL");
    expect(dariDeal).not.toContain("DEAL");
    expect(dariDeal).toContain("PROSPEK");
    expect(dariDeal).toContain("SELESAI");
    expect(dariDeal).toContain("BATAL");
    expect(tujuanPindah("BATAL")).toEqual(["PROSPEK", "DIHUBUNGI"]);
  });
});

describe("majuOtomatis — hanya maju, tidak pernah dari jalur keluar atau SELESAI", () => {
  it("resi diisi memajukan ke SAMPEL_DIKIRIM", () => {
    expect(majuOtomatis("DEAL", { adaResi: true })).toBe("SAMPEL_DIKIRIM");
  });

  it("tanggal terima didahulukan dari resi", () => {
    expect(majuOtomatis("DEAL", { adaResi: true, adaTerima: true })).toBe("SAMPEL_DITERIMA");
  });

  it("link draf → DRAF, draf disetujui → DRAF_DISETUJUI, link konten → TAYANG", () => {
    expect(majuOtomatis("SAMPEL_DITERIMA", { adaLinkDraf: true })).toBe("DRAF");
    expect(majuOtomatis("DRAF", { drafDisetujui: true })).toBe("DRAF_DISETUJUI");
    expect(majuOtomatis("SAMPEL_DITERIMA", { adaLinkKonten: true })).toBe("TAYANG");
  });

  it("TIDAK pernah memundurkan: fakta yang lebih awal dari tahap sekarang diabaikan", () => {
    expect(majuOtomatis("TAYANG", { adaResi: true, adaTerima: true })).toBeNull();
    expect(majuOtomatis("DRAF_DISETUJUI", { adaLinkDraf: true })).toBeNull();
  });

  it("TIDAK menyentuh kolaborasi di jalur keluar atau yang sudah SELESAI", () => {
    for (const t of [...JALUR_KELUAR, "SELESAI"] as Tahap[]) {
      expect(majuOtomatis(t, { adaLinkKonten: true, statusBayar: "LUNAS" })).toBeNull();
    }
  });

  it("angka konten pada hari WIB ≥ tayang + 7 → ANGKA_MASUK; sebelum itu belum", () => {
    expect(majuOtomatis("TAYANG", { adaLinkKonten: true, tayangHari: "2026-10-01", angkaTerakhirHari: "2026-10-07" })).toBeNull();
    expect(majuOtomatis("TAYANG", { adaLinkKonten: true, tayangHari: "2026-10-01", angkaTerakhirHari: "2026-10-08" })).toBe(
      "ANGKA_MASUK",
    );
    expect(angkaSudahMatang("2026-10-01", "2026-10-08")).toBe(true);
    expect(angkaSudahMatang("2026-10-01", null)).toBe(false);
    expect(angkaSudahMatang(null, "2026-10-08")).toBe(false);
  });

  it("LUNAS → DIBAYAR, tetapi hanya sesudah kontennya tayang", () => {
    // Fee yang dibayar di depan tidak boleh menyembunyikan kolaborasi dari antrean sampel dan konten.
    expect(majuOtomatis("DEAL", { statusBayar: "LUNAS" })).toBeNull();
    expect(majuOtomatis("TAYANG", { adaLinkKonten: true, statusBayar: "LUNAS" })).toBe("DIBAYAR");
    expect(majuOtomatis("ANGKA_MASUK", { statusBayar: "LUNAS" })).toBe("DIBAYAR");
  });

  it("kolaborasi tanpa fee langsung SELESAI dari ANGKA_MASUK", () => {
    expect(
      majuOtomatis("TAYANG", {
        adaLinkKonten: true,
        tayangHari: "2026-10-01",
        angkaTerakhirHari: "2026-10-09",
        statusBayar: "TIDAK_PERLU",
      }),
    ).toBe("SELESAI");
    expect(majuOtomatis("ANGKA_MASUK", { statusBayar: "TIDAK_PERLU" })).toBe("SELESAI");
    // Yang berbayar tetap menunggu lunas.
    expect(majuOtomatis("ANGKA_MASUK", { statusBayar: "BELUM" })).toBeNull();
  });

  it("tanpa fakta apa pun tidak bergerak", () => {
    expect(majuOtomatis("PROSPEK", {})).toBeNull();
  });
});

describe("feeDiakui — fee baru jadi beban saat kontennya tayang", () => {
  it("TIDAK mengakui fee sebelum tayang", () => {
    for (const t of ["PROSPEK", "DEAL", "SAMPEL_DIKIRIM", "DRAF", "DRAF_DISETUJUI"] as Tahap[]) {
      expect(feeDiakui(t)).toBe(false);
      expect(nilaiFeeDiakui(t, 2_500_000)).toBe(0);
    }
  });

  it("mengakui fee di TAYANG, ANGKA_MASUK, DIBAYAR, SELESAI", () => {
    for (const t of ["TAYANG", "ANGKA_MASUK", "DIBAYAR", "SELESAI"] as Tahap[]) {
      expect(nilaiFeeDiakui(t, 2_500_000)).toBe(2_500_000);
    }
  });

  it("TIDAK mengakui fee kolaborasi yang keluar jalur", () => {
    for (const t of JALUR_KELUAR) expect(nilaiFeeDiakui(t, 2_500_000)).toBe(0);
  });
});

describe("statusBayarBawaan", () => {
  it("fee nol berarti tidak perlu dibayar; fee berapa pun di atas nol berarti belum", () => {
    expect(statusBayarBawaan(0)).toBe("TIDAK_PERLU");
    expect(statusBayarBawaan(1)).toBe("BELUM");
    expect(statusBayarBawaan(Number.NaN)).toBe("TIDAK_PERLU");
  });
});
