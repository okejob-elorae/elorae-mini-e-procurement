import { describe, expect, it } from "vitest";
import {
  bacaLabel,
  bacaProfilUkuran,
  hitungKolaborasiKol,
  inisial,
  kembarDalamTempelan,
  kolDiblokir,
  pecahKolom,
  persenTepatWaktu,
  polaCariWa,
  punyaLabel,
  tulisLabel,
  tulisProfilUkuran,
  uraiTempelan,
  urlProfil,
} from "./kol-aturan";
import { alamatSaringKol, bacaSaringKol, SARING_KOL_BAWAAN } from "./kol-saring";

describe("kolDiblokir", () => {
  it("diblokir hanya bila ada tanggal blokir", () => {
    expect(kolDiblokir({ blockedAt: new Date() })).toBe(true);
    expect(kolDiblokir({ blockedAt: "2026-10-07T00:00:00Z" })).toBe(true);
    expect(kolDiblokir({ blockedAt: null })).toBe(false);
    expect(kolDiblokir(null)).toBe(false);
  });
});

describe("label", () => {
  it("memisah koma/titik koma, merapikan, dan membuang kembar tanpa memandang huruf", () => {
    expect(bacaLabel(" Favorit, #hijab;favorit ,  hati-hati  ")).toEqual(["Favorit", "hijab", "hati-hati"]);
    expect(tulisLabel(["a", " b ", "A"])).toBe("a, b");
    expect(tulisLabel("  ,  ")).toBeNull();
  });

  it("punyaLabel tidak peka huruf besar-kecil", () => {
    expect(punyaLabel("Favorit, hijab", "favorit")).toBe(true);
    expect(punyaLabel("Favorit, hijab", "fav")).toBe(false);
  });
});

describe("profil ukuran", () => {
  it("menulis JSON dengan kunci tetap dan membaca kembali", () => {
    const teks = tulisProfilUkuran({ atasan: " M ", bawahan: "28", tinggiCm: "158", hijab: true, catatan: "" });
    expect(teks).toBe('{"atasan":"M","bawahan":"28","tinggiCm":158,"hijab":true,"catatan":null}');
    expect(bacaProfilUkuran(teks)).toEqual({ atasan: "M", bawahan: "28", tinggiCm: 158, hijab: true, catatan: null });
  });

  it("profil kosong disimpan null; isi rusak dibaca kosong; tinggi mustahil dibuang", () => {
    expect(tulisProfilUkuran({ atasan: " ", hijab: null })).toBeNull();
    expect(bacaProfilUkuran("{rusak")).toEqual({ atasan: null, bawahan: null, tinggiCm: null, hijab: null, catatan: null });
    expect(bacaProfilUkuran('{"tinggiCm": 900}').tinggiCm).toBeNull();
  });
});

describe("tempelan Tambah massal", () => {
  it("menerima koma, titik koma, dan tab; handle dinormalkan; angka dibaca pemaaf", () => {
    const b = uraiTempelan(["@NadiaPutri, Nadia Putri, 52k", "rara.id;Rara;1.250;0812-3456-7890;Bandung", "https://www.tiktok.com/@budi\tBudi\t1,2jt"].join("\n"));
    expect(b.map((x) => [x.handle, x.nama, x.pengikut])).toEqual([
      ["nadiaputri", "Nadia Putri", 52_000],
      ["rara.id", "Rara", 1_250],
      ["budi", "Budi", 1_200_000],
    ]);
    expect(b[1].wa).toBe("6281234567890");
    expect(b[1].kota).toBe("Bandung");
    expect(b[0].nomor).toBe(1);
  });

  it("dengan koma, pengikut '1,2jt' dan '1,250,000' tidak terbelah", () => {
    expect(pecahKolom("budi, Budi, 1,2jt, 08123456789, Solo")).toEqual(["budi", "Budi", "1,2jt", "08123456789", "Solo"]);
    expect(pecahKolom("budi, Budi, 1,250,000")).toEqual(["budi", "Budi", "1,250,000"]);
    expect(uraiTempelan("budi, Budi, 1,250,000")[0].pengikut).toBe(1_250_000);
  });

  it("melewati baris kosong, komentar, dan baris judul; menandai galat per baris", () => {
    const b = uraiTempelan("username, nama, pengikut\n\n# catatan\n, Tanpa handle\nx, X, banyak\ny, Y, 10, 0812");
    expect(b.map((x) => x.nomor)).toEqual([4, 5, 6]);
    expect(b[0].galat).toEqual(["HANDLE_KOSONG"]);
    expect(b[1].galat).toEqual(["PENGIKUT_TIDAK_TERBACA"]);
    expect(b[2].galat).toEqual(["WA_TIDAK_SAH"]);
  });

  it("handle yang muncul dua kali ditandai pada kemunculan kedua", () => {
    const b = uraiTempelan("a\nb\n@A\nc\nb");
    expect([...kembarDalamTempelan(b).entries()]).toEqual([
      [3, 1],
      [5, 2],
    ]);
  });
});

describe("profil & ringkasan", () => {
  it("tautan profil: yang tersimpan menang, selain itu dibuat dari handle", () => {
    expect(urlProfil("TIKTOK", "@Budi")).toBe("https://www.tiktok.com/@budi");
    expect(urlProfil("INSTAGRAM", "rara")).toBe("https://www.instagram.com/rara");
    expect(urlProfil("SHOPEE", "toko")).toBeNull();
    expect(urlProfil("SHOPEE", "toko", "shopee.co.id/toko")).toBe("https://shopee.co.id/toko");
  });

  it("inisial dari dua kata pertama", () => {
    expect(inisial("Nadia Putri Ayu")).toBe("NP");
    expect(inisial("@rara.id")).toBe("RI");
    expect(inisial("")).toBe("?");
  });

  it("menghitung kolaborasi per keadaan", () => {
    expect(hitungKolaborasiKol(["SELESAI", "GHOSTING", "DITOLAK", "BATAL", "NEGO", "TAYANG", "SELESAI"])).toEqual({
      total: 7,
      selesai: 2,
      berjalan: 2,
      ghosting: 1,
      ditolak: 1,
      batal: 1,
    });
  });

  it("tepat waktu menurut hari WIB; yang belum tayang tidak dinilai", () => {
    const r = persenTepatWaktu([
      // Tayang 23.30 WIB pada hari rencana — tepat.
      { plannedLiveAt: "2026-10-05T00:00:00+07:00", liveAtPertama: "2026-10-05T23:30:00+07:00" },
      { plannedLiveAt: "2026-10-05T00:00:00+07:00", liveAtPertama: "2026-10-06T01:00:00+07:00" },
      { plannedLiveAt: "2026-10-05T00:00:00+07:00", liveAtPertama: null },
      { plannedLiveAt: null, liveAtPertama: "2026-10-01T00:00:00+07:00" },
    ]);
    expect(r).toEqual({ tepat: 1, dinilai: 2, persen: 50 });
    expect(persenTepatWaktu([]).persen).toBeNull();
  });

  it("pola cari WA menyamakan awalan; teks biasa bukan nomor", () => {
    expect(polaCariWa("0812-345")).toBe("62812345");
    expect(polaCariWa("+62 812")).toBe("62812");
    expect(polaCariWa("8123")).toBe("628123");
    expect(polaCariWa("nadia")).toBeNull();
    expect(polaCariWa("08")).toBeNull();
  });
});

describe("saringan dari alamat", () => {
  it("membaca nilai sah dan membuang yang tidak dikenal", () => {
    const s = bacaSaringKol({ cari: " nadia ", platform: "tiktok", tier: "MIKRO", status: "deal", urut: "gmv", halaman: "3", ukuran: "50", tampilan: "galeri" });
    expect(s).toEqual({ cari: "nadia", platform: "TIKTOK", tier: "mikro", label: "", status: "DEAL", urut: "gmv", halaman: 3, ukuran: 50, tampilan: "galeri" });
    expect(bacaSaringKol({ platform: "x", status: "aneh", ukuran: "7", tampilan: "papan" })).toEqual(SARING_KOL_BAWAAN);
  });

  it("mengenal tier mid (tier ke-5)", () => {
    expect(bacaSaringKol({ tier: "mid" }).tier).toBe("mid");
    expect(bacaSaringKol({ tier: "Mid" }).tier).toBe("mid");
  });

  it("alamat hanya membawa yang berbeda dari bawaan, dan bolak-balik sama", () => {
    expect(alamatSaringKol("/k", SARING_KOL_BAWAAN)).toBe("/k");
    const s = { ...SARING_KOL_BAWAAN, cari: "rara", status: "BELUM" as const, halaman: 2 };
    const url = alamatSaringKol("/k", s);
    expect(url).toBe("/k?cari=rara&status=BELUM&halaman=2");
    expect(bacaSaringKol(Object.fromEntries(new URLSearchParams(url.split("?")[1])))).toEqual(s);
  });
});
