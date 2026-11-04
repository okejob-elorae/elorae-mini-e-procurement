import { describe, expect, it } from "vitest";
import { AMBANG_BAWAAN } from "./ambang";
import {
  alamatKontenKol,
  bacaParamKontenKol,
  batasBulan,
  cuplikan,
  drafTerlambat,
  geserBulanKonten,
  hariPadat,
  kelompokJadwal,
  kisiBulanKonten,
  peringatanAngka,
  periksaIsianAngka,
  platformDariLink,
  sahLink,
  tebakPlatformFormat,
} from "./konten-kol";

describe("sahLink", () => {
  it("menerima link lengkap dan menambah https:// pada link tanpa skema", () => {
    expect(sahLink(" https://www.tiktok.com/@a/video/1 ")).toBe("https://www.tiktok.com/@a/video/1");
    expect(sahLink("instagram.com/reel/abc")).toBe("https://instagram.com/reel/abc");
  });

  it("menolak teks bebas, spasi, dan skema lain", () => {
    expect(sahLink("sudah tayang kak")).toBeNull();
    expect(sahLink("")).toBeNull();
    expect(sahLink("javascript:alert(1)")).toBeNull();
    expect(sahLink("ftp://contoh.com/a")).toBeNull();
    expect(sahLink("localhost")).toBeNull();
  });
});

describe("platformDariLink + tebakPlatformFormat", () => {
  it("mengenali situs marketplace dan media sosial", () => {
    expect(platformDariLink("https://vt.tiktok.com/ZS123")).toBe("TIKTOK");
    expect(platformDariLink("instagram.com/p/1")).toBe("INSTAGRAM");
    expect(platformDariLink("https://youtu.be/abc")).toBe("YOUTUBE");
    expect(platformDariLink("https://shopee.co.id/video/1")).toBe("SHOPEE");
    expect(platformDariLink("https://contoh.com/x")).toBeNull();
  });

  it("link mengalahkan deliverable; format ikut deliverable dengan platform yang sama", () => {
    expect(
      tebakPlatformFormat({
        link: "https://instagram.com/reel/1",
        deliverables: [
          { platform: "TIKTOK", format: "VIDEO" },
          { platform: "INSTAGRAM", format: "CAROUSEL" },
        ],
      }),
    ).toEqual({ platform: "INSTAGRAM", format: "CAROUSEL" });
  });

  it("tanpa link yang dikenal memakai deliverable, lalu akun, lalu LAINNYA", () => {
    expect(tebakPlatformFormat({ link: "https://drive.google.com/x", deliverables: [{ platform: "TIKTOK", format: "LIVE" }] })).toEqual({
      platform: "TIKTOK",
      format: "LIVE",
    });
    expect(tebakPlatformFormat({ akun: [{ platform: "YOUTUBE" }] })).toEqual({ platform: "YOUTUBE", format: "VIDEO" });
    expect(tebakPlatformFormat({})).toEqual({ platform: "LAINNYA", format: "VIDEO" });
  });
});

describe("alamat halaman", () => {
  const hariIni = "2026-10-07";

  it("membaca nilai bawaan dan menolak nilai rusak", () => {
    expect(bacaParamKontenKol({}, hariIni)).toEqual({ chip: "menunggu", cari: "", campaign: null, kolaborasi: null, halaman: 1, bulan: "2026-10" });
    expect(bacaParamKontenKol({ chip: "x", halaman: "-2", bulan: "2026-13" }, hariIni)).toMatchObject({
      chip: "menunggu",
      halaman: 1,
      bulan: "2026-10",
    });
  });

  it("bolak-balik baca ↔ tulis tanpa kehilangan isi", () => {
    const p = { chip: "tayang" as const, cari: "nadia", campaign: "c1", kolaborasi: "k9", halaman: 3, bulan: "2026-10" };
    const url = alamatKontenKol(p, hariIni);
    expect(url).toBe("/backoffice/kreatif/konten-kol?tab=tayang&cari=nadia&campaign=c1&kolaborasi=k9&halaman=3");
    const sp = Object.fromEntries(new URL(url, "http://x").searchParams);
    expect(bacaParamKontenKol(sp, hariIni)).toEqual(p);
  });

  it("jadwal menulis bulan, bukan halaman", () => {
    expect(alamatKontenKol({ chip: "jadwal", cari: "", campaign: null, kolaborasi: null, halaman: 4, bulan: "2026-11" }, hariIni)).toBe(
      "/backoffice/kreatif/konten-kol?tab=jadwal&bulan=2026-11",
    );
    expect(alamatKontenKol({ chip: "menunggu", cari: "", campaign: null, kolaborasi: null, halaman: 1, bulan: "2026-10" }, hariIni)).toBe(
      "/backoffice/kreatif/konten-kol",
    );
  });

  it("membaca tautan Hari ini (?tab=…&kolaborasi=…) dan ?chip= lama", () => {
    expect(bacaParamKontenKol({ tab: "draf", kolaborasi: "kb1" }, hariIni)).toMatchObject({ chip: "draf", kolaborasi: "kb1" });
    expect(bacaParamKontenKol({ chip: "tayang" }, hariIni).chip).toBe("tayang");
    expect(bacaParamKontenKol({ tab: "disetujui", kolaborasi: "x".repeat(65) }, hariIni)).toMatchObject({ chip: "disetujui", kolaborasi: null });
  });
});

describe("peringatanAngka", () => {
  const dasar = { tahap: "TAYANG" as const, tahapAt: "2026-10-01", kontenId: "k1", link: "https://tiktok.com/x" };

  it("H+3 yang lewat tanpa angka muncul sebagai kosong — satu saja, yang terbaru", () => {
    const p = peringatanAngka({ ...dasar, liveAt: "2026-10-01", angkaTerakhirHari: null }, "2026-10-05");
    expect(p.kosong).toEqual([{ jenis: "ANGKA_H3", tanggal: "2026-10-04", lewatHari: 1 }]);
    expect(p.berikut).toEqual({ jenis: "ANGKA_H7", tanggal: "2026-10-08" });
  });

  it("titik yang jatuh hari ini belum lewat", () => {
    const p = peringatanAngka({ ...dasar, liveAt: "2026-10-01", angkaTerakhirHari: null }, "2026-10-02");
    expect(p.kosong).toEqual([]);
    expect(p.berikut).toEqual({ jenis: "ANGKA_H1", tanggal: "2026-10-02" });
  });

  it("angka yang dicatat sesudah titiknya menghapus peringatannya", () => {
    const p = peringatanAngka({ ...dasar, liveAt: "2026-10-01", angkaTerakhirHari: "2026-10-04" }, "2026-10-05");
    expect(p.kosong).toEqual([]);
    expect(p.berikut?.jenis).toBe("ANGKA_H7");
  });

  it("kolaborasi selesai tidak menagih angka", () => {
    const p = peringatanAngka({ ...dasar, tahap: "SELESAI", liveAt: "2026-10-01", angkaTerakhirHari: null }, "2026-10-20");
    expect(p).toEqual({ kosong: [], berikut: null });
  });
});

describe("periksaIsianAngka", () => {
  it("menolak semua nol, pecahan, dan negatif", () => {
    expect(periksaIsianAngka({ views: 0, likes: 0, comments: 0, shares: 0, saves: 0 })).toBe("ANGKA_KOSONG");
    expect(periksaIsianAngka({ views: 1.5 })).toBe("ANGKA_TIDAK_SAH");
    expect(periksaIsianAngka({ views: -1 })).toBe("ANGKA_TIDAK_SAH");
    expect(periksaIsianAngka({ views: 52_000, likes: 3 })).toBeNull();
  });
});

describe("jadwal tayang", () => {
  it("kisi Oktober 2026 dimulai Senin 28 September dan berhenti di minggu terakhir", () => {
    const kisi = kisiBulanKonten("2026-10");
    expect(kisi[0][0]).toEqual({ tanggal: "2026-09-28", diBulan: false });
    expect(kisi.at(-1)!.at(-1)!.tanggal).toBe("2026-11-01");
    expect(kisi.flat().filter((h) => h.diBulan)).toHaveLength(31);
  });

  it("menggeser bulan melewati batas tahun", () => {
    expect(geserBulanKonten("2026-12", 1)).toBe("2027-01");
    expect(geserBulanKonten("2026-01", -1)).toBe("2025-12");
    expect(batasBulan("2026-02")).toEqual({ dari: "2026-02-01", sampai: "2026-02-28" });
  });

  it("mengelompokkan per hari, yang tayang dulu; padat mulai lima", () => {
    const g = kelompokJadwal([
      { id: "a", kolaborasiId: "c", tanggal: "2026-10-03", jenis: "RENCANA", label: "@a", platform: null },
      { id: "b", kolaborasiId: "c", tanggal: "2026-10-03", jenis: "TAYANG", label: "@b", platform: null },
      { id: "c", kolaborasiId: "c", tanggal: "rusak", jenis: "TAYANG", label: "@c", platform: null },
    ]);
    expect(g.get("2026-10-03")!.map((b) => b.id)).toEqual(["b", "a"]);
    expect(g.size).toBe(1);
    expect(hariPadat(4)).toBe(false);
    expect(hariPadat(5)).toBe(true);
  });
});

describe("draf", () => {
  it("hanya draf MENUNGGU yang disorot merah lewat ambang review", () => {
    expect(drafTerlambat("MENUNGGU", AMBANG_BAWAAN.reviewDrafHari + 1)).toBe(true);
    expect(drafTerlambat("MENUNGGU", AMBANG_BAWAAN.reviewDrafHari)).toBe(false);
    expect(drafTerlambat("REVISI", 30)).toBe(false);
  });

  it("memotong catatan panjang", () => {
    expect(cuplikan("a  b\nc")).toBe("a b c");
    expect(cuplikan("x".repeat(80), 10)).toBe("xxxxxxxxx…");
  });
});
