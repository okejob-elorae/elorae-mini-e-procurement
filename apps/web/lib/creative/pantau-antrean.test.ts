import { describe, expect, it } from "vitest";
import { geserHari } from "@/lib/tanggal-isian";
import {
  kunciBerkala,
  kunciKonten,
  kunciProfil,
  kunciSegera,
  PRIORITAS_PANTAU,
  susunAntreanPantau,
  tugasSegera,
  type KontenAntrean,
  type MasukanAntrean,
} from "./pantau-antrean";
import { PANTAU_BAWAAN } from "./pantau-aturan";

/*
 * Penyusun antrean (keputusan P3): konten kolaborasi yang tayang dicek H+1,
 * H+3, H+7, H+30 (hari WIB); akun KOL aktif seminggu sekali, akun lain sebulan
 * sekali; KOL diblokir tidak pernah. Kunci unik adalah penjaga dobelnya.
 */

const TAYANG = "2003-03-10";

function masukan(isi: Partial<MasukanAntrean> = {}): MasukanAntrean {
  return {
    hariIni: TAYANG,
    konten: [],
    akun: [],
    kunciAda: new Set(),
    akunTerbuka: new Set(),
    pengaturan: PANTAU_BAWAAN,
    ...isi,
  };
}

const konten = { id: "k1", link: "https://www.tiktok.com/@kol.satu/video/7301234567890123456", liveAtHari: TAYANG, kolDiblokir: false };
const akun = { id: "a1", handle: "kol.satu", kolDiblokir: false, aktif: false, terakhirDicekHari: null as string | null };

describe("kunci tugas", () => {
  it("berbentuk KONTEN:<id>:H<n> dan PROFIL:<id>:<hari WIB>", () => {
    expect(kunciKonten("k1", 3)).toBe("KONTEN:k1:H3");
    expect(kunciProfil("a1", "2003-03-10")).toBe("PROFIL:a1:2003-03-10");
  });

  it("cek segera sesudah ditempel = KONTEN:<id>:SEGERA; cek berkala = KONTEN:<id>:B<hari WIB>", () => {
    expect(kunciSegera("k1")).toBe("KONTEN:k1:SEGERA");
    expect(kunciBerkala("k1", "2003-04-20")).toBe("KONTEN:k1:B2003-04-20");
  });
});

describe("susunAntreanPantau — konten", () => {
  const pada = (n: number, kunciAda: string[] = []) =>
    susunAntreanPantau(masukan({ hariIni: geserHari(TAYANG, n), konten: [konten], kunciAda: new Set(kunciAda) }));

  it("hari tayang belum ada tugas; H+1 membuat titik H1", () => {
    expect(pada(0).baru).toEqual([]);
    const r = pada(1);
    expect(r.baru).toEqual([
      {
        kunci: "KONTEN:k1:H1",
        jenis: "KONTEN",
        platform: "TIKTOK",
        accountId: null,
        contentId: "k1",
        url: konten.link,
        titikH: 1,
        prioritas: PRIORITAS_PANTAU.KONTEN[1],
        jatuhHari: geserHari(TAYANG, 1),
      },
    ]);
    expect(r.lewati).toEqual([]);
  });

  it("titik yang sudah punya tugas tidak dibuat ulang", () => {
    expect(pada(2, ["KONTEN:k1:H1"]).baru).toEqual([]);
  });

  it("titik baru melewati titik lama yang belum dikerjakan", () => {
    const r = pada(3, ["KONTEN:k1:H1"]);
    expect(r.baru.map((t) => t.kunci)).toEqual(["KONTEN:k1:H3"]);
    expect(r.lewati).toEqual(["KONTEN:k1:H1"]);
  });

  it("konten yang tertinggal hanya dicek di titik terbarunya, sekali", () => {
    const r = pada(10);
    expect(r.baru.map((t) => t.kunci)).toEqual(["KONTEN:k1:H7"]);
    expect(r.lewati).toEqual(["KONTEN:k1:H1", "KONTEN:k1:H3"]);
    expect(r.baru[0].jatuhHari).toBe(geserHari(TAYANG, 7));
  });

  it("titik H+30 masih dibuat sampai 14 hari terlambat, sesudahnya cek berkala yang mengambil alih", () => {
    expect(pada(30).baru.map((t) => t.kunci)).toEqual(["KONTEN:k1:H30"]);
    expect(pada(44).baru.map((t) => t.kunci)).toEqual(["KONTEN:k1:H30"]);
    expect(pada(45).baru.map((t) => t.kunci)).toEqual([`KONTEN:k1:B${geserHari(TAYANG, 45)}`]);
  });

  it("link yang bukan TikTok dan KOL diblokir dilewati", () => {
    const ig = { ...konten, id: "k2", link: "https://www.instagram.com/reel/abc" };
    const blokir = { ...konten, id: "k3", kolDiblokir: true };
    const r = susunAntreanPantau(masukan({ hariIni: geserHari(TAYANG, 1), konten: [ig, blokir] }));
    expect(r.baru).toEqual([]);
  });

  it("url tugas konten memakai bentuk baku www.tiktok.com/@handle/video/<id>", () => {
    const kotor = { ...konten, id: "k5", link: "tiktok.com/@Kol.Satu/video/7301234567890123456?is_from_webapp=1" };
    const r = susunAntreanPantau(masukan({ hariIni: geserHari(TAYANG, 1), konten: [kotor] }));
    expect(r.baru[0].url).toBe("https://www.tiktok.com/@kol.satu/video/7301234567890123456");
  });

  it("link TikTok pendek (vt.tiktok.com) tetap diterima", () => {
    const pendek = { ...konten, id: "k4", link: "https://vt.tiktok.com/ZSabc123/" };
    expect(susunAntreanPantau(masukan({ hariIni: geserHari(TAYANG, 1), konten: [pendek] })).baru).toHaveLength(1);
  });
});

describe("tugasSegera — video yang baru ditempel", () => {
  it("dicek hari ini juga, di atas semua tugas lain", () => {
    expect(tugasSegera({ contentId: "k1", url: konten.link, hariIni: "2003-04-01" })).toEqual({
      kunci: "KONTEN:k1:SEGERA",
      jenis: "KONTEN",
      platform: "TIKTOK",
      accountId: null,
      contentId: "k1",
      url: konten.link,
      titikH: null,
      prioritas: PRIORITAS_PANTAU.KONTEN_SEGERA,
      jatuhHari: "2003-04-01",
    });
    expect(PRIORITAS_PANTAU.KONTEN_SEGERA).toBeGreaterThan(PRIORITAS_PANTAU.KONTEN[1]);
  });
});

describe("susunAntreanPantau — sesudah titik H+30 dan video lama", () => {
  const H = (n: number) => geserHari(TAYANG, n);
  const pada = (n: number, k: Partial<KontenAntrean> = {}, isi: Partial<MasukanAntrean> = {}) =>
    susunAntreanPantau(masukan({ hariIni: H(n), konten: [{ ...konten, ...k }], ...isi }));
  const kunci = (r: { baru: { kunci: string }[] }) => r.baru.map((t) => t.kunci);

  it("sesudah H+30 dicek setiap 7 hari sejak cek terakhir, sampai 90 hari sesudah tayang", () => {
    const sudah = [kunciKonten("k1", 30)];
    expect(kunci(pada(31, { terakhirDicekHari: H(30) }, { kunciAda: new Set(sudah) }))).toEqual([]);
    expect(kunci(pada(36, { terakhirDicekHari: H(30) }, { kunciAda: new Set(sudah) }))).toEqual([]);
    const r = pada(37, { terakhirDicekHari: H(30) }, { kunciAda: new Set(sudah) });
    expect(kunci(r)).toEqual([`KONTEN:k1:B${H(37)}`]);
    expect(r.baru[0]).toMatchObject({ titikH: null, prioritas: PRIORITAS_PANTAU.KONTEN_BERKALA, jatuhHari: H(37), url: konten.link });
    expect(kunci(pada(90, { terakhirDicekHari: H(83) }))).toEqual([`KONTEN:k1:B${H(90)}`]);
    expect(kunci(pada(91, { terakhirDicekHari: H(83) }))).toEqual([]);
  });

  it("selang dan batasnya mengikuti pengaturan", () => {
    const p = { ...PANTAU_BAWAAN, hariKontenBerkala: 3, batasHariKonten: 45 };
    expect(kunci(pada(40, { terakhirDicekHari: H(37) }, { pengaturan: p }))).toEqual([`KONTEN:k1:B${H(40)}`]);
    expect(kunci(pada(39, { terakhirDicekHari: H(37) }, { pengaturan: p }))).toEqual([]);
    expect(kunci(pada(46, { terakhirDicekHari: H(37) }, { pengaturan: p }))).toEqual([]);
  });

  it("video yang ditempel lama sesudah tayang tidak tertinggal: cek segeranya dulu, lalu berkala", () => {
    // Ditempel H+60: tugas SEGERA masih terbuka → belum ada yang ditambah.
    expect(kunci(pada(60, { tugasTerbuka: [kunciSegera("k1")] }))).toEqual([]);
    // SEGERA terbaca H+60 → H+67 dicek lagi.
    expect(kunci(pada(66, { terakhirDicekHari: H(60) }))).toEqual([]);
    expect(kunci(pada(67, { terakhirDicekHari: H(60) }))).toEqual([`KONTEN:k1:B${H(67)}`]);
  });

  it("bacaan sesudah sebuah titik menutup titik itu (dan yang sebelumnya); titik berikutnya tetap dibuat", () => {
    // Ditempel H+20 dan langsung terbaca: H7 (telat 13 hari) tidak perlu lagi.
    const r = pada(20, { terakhirDicekHari: H(20) });
    expect(r.baru).toEqual([]);
    expect(r.lewati).toEqual([kunciKonten("k1", 1), kunciKonten("k1", 3), kunciKonten("k1", 7)]);
    expect(kunci(pada(30, { terakhirDicekHari: H(20) }))).toEqual([kunciKonten("k1", 30)]);
  });

  it("tugas segera/berkala yang masih terbuka menahan titik baru; titik yang terbuka menahan cek berkala", () => {
    expect(kunci(pada(1, { tugasTerbuka: [kunciSegera("k1")] }))).toEqual([]);
    expect(kunci(pada(3, { tugasTerbuka: [`KONTEN:k1:B${H(1)}`] }))).toEqual([]);
    expect(kunci(pada(40, { tugasTerbuka: [kunciKonten("k1", 30)] }, { kunciAda: new Set([kunciKonten("k1", 30)]) }))).toEqual([]);
  });

  it("video lebih tua dari batasnya tanpa bacaan apa pun tidak diantrekan", () => {
    expect(kunci(pada(120))).toEqual([]);
  });

  it("cek berkala hari ini yang sudah ada tidak dibuat ulang", () => {
    expect(kunci(pada(50, {}, { kunciAda: new Set([`KONTEN:k1:B${H(50)}`]) }))).toEqual([]);
  });
});

describe("susunAntreanPantau — profil", () => {
  const HARI = "2003-03-20";
  const susun = (a: Partial<typeof akun>, isi: Partial<MasukanAntrean> = {}) =>
    susunAntreanPantau(masukan({ hariIni: HARI, akun: [{ ...akun, ...a }], ...isi })).baru;

  it("akun yang belum pernah dicek jatuh hari ini, berkunci hari WIB", () => {
    expect(susun({})).toEqual([
      {
        kunci: `PROFIL:a1:${HARI}`,
        jenis: "PROFIL",
        platform: "TIKTOK",
        accountId: "a1",
        contentId: null,
        url: "https://www.tiktok.com/@kol.satu",
        titikH: null,
        prioritas: PRIORITAS_PANTAU.PROFIL_LAIN,
        jatuhHari: HARI,
      },
    ]);
  });

  it("akun aktif dicek seminggu sekali", () => {
    expect(susun({ aktif: true, terakhirDicekHari: geserHari(HARI, -6) })).toEqual([]);
    const r = susun({ aktif: true, terakhirDicekHari: geserHari(HARI, -7) });
    expect(r).toHaveLength(1);
    expect(r[0].prioritas).toBe(PRIORITAS_PANTAU.PROFIL_AKTIF);
  });

  it("akun lain dicek sebulan sekali", () => {
    expect(susun({ terakhirDicekHari: geserHari(HARI, -29) })).toEqual([]);
    expect(susun({ terakhirDicekHari: geserHari(HARI, -30) })).toHaveLength(1);
  });

  it("selang mengikuti pengaturan", () => {
    const p = { ...PANTAU_BAWAAN, hariAkunLain: 10 };
    expect(susun({ terakhirDicekHari: geserHari(HARI, -10) }, { pengaturan: p })).toHaveLength(1);
  });

  it("akun yang masih punya tugas terbuka, atau sudah punya tugas hari ini, tidak ditambah", () => {
    expect(susun({}, { akunTerbuka: new Set(["a1"]) })).toEqual([]);
    expect(susun({}, { kunciAda: new Set([`PROFIL:a1:${HARI}`]) })).toEqual([]);
  });

  it("KOL diblokir tidak pernah dicek; handle kosong dilewati", () => {
    expect(susun({ kolDiblokir: true })).toEqual([]);
    expect(susun({ handle: " @ " })).toEqual([]);
  });

  it("handle dengan @ atau huruf besar dirapikan di URL", () => {
    expect(susun({ handle: "@Kol.Satu" })[0].url).toBe("https://www.tiktok.com/@kol.satu");
  });
});

describe("prioritas", () => {
  it("konten di atas profil aktif di atas profil lain; titik awal di atas titik akhir", () => {
    const k = PRIORITAS_PANTAU.KONTEN;
    expect(k[1]).toBeGreaterThan(k[3]);
    expect(k[3]).toBeGreaterThan(k[7]);
    expect(k[7]).toBeGreaterThan(k[30]);
    expect(k[30]).toBeGreaterThan(PRIORITAS_PANTAU.KONTEN_BERKALA);
    expect(PRIORITAS_PANTAU.KONTEN_BERKALA).toBeGreaterThan(PRIORITAS_PANTAU.PROFIL_AKTIF);
    expect(PRIORITAS_PANTAU.PROFIL_AKTIF).toBeGreaterThan(PRIORITAS_PANTAU.PROFIL_LAIN);
  });
});
