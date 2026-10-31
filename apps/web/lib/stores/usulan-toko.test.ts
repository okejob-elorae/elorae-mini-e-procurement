import { describe, expect, it } from "vitest";
import {
  cariKandidatDuplikat,
  JARAK_DUPLIKAT_METER,
  jarakEdit,
  namaMirip,
  normalisasiNamaToko,
  pembulatanJarak,
  saranKodeToko,
  validasiPersetujuan,
  validasiUsulanToko,
  type Pembanding,
} from "./usulan-toko";

/**
 * Aturan usulan toko baru dari HP. Yang dijaga: formulir lapangan yang
 * setengah jadi tidak pernah sampai ke admin, dan toko yang sudah ada (atau
 * sudah diusulkan rekan) terlihat SEBELUM ada toko kembar di master.
 */

const DASAR = {
  name: "Toko Sinar Jaya",
  address: "Jl. Pasar Baru 12, Bandung",
  photoUrl: "/api/foto/abc",
};

describe("validasiUsulanToko", () => {
  it("accepts a minimal proposal and cleans whitespace", () => {
    const r = validasiUsulanToko({ ...DASAR, name: "  Toko   Sinar  Jaya ", phone: " 0812-3456 7890 ", note: "  " });
    expect(r).toEqual({
      ok: true,
      data: {
        name: "Toko Sinar Jaya",
        address: "Jl. Pasar Baru 12, Bandung",
        phone: "0812-3456 7890",
        contactName: null,
        termsType: null,
        groupId: null,
        lat: null,
        lng: null,
        photoUrl: "/api/foto/abc",
        note: null,
      },
    });
  });

  it("requires a name, an address and the storefront photo", () => {
    const r = validasiUsulanToko({ name: " ", address: "", photoUrl: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.galat).toEqual(["NAMA_WAJIB", "ALAMAT_WAJIB", "FOTO_WAJIB"]);
  });

  it("refuses a photo URL that is not ours", () => {
    for (const photoUrl of ["javascript:alert(1)", "//evil.example/x.jpg", "http://evil.example/x.jpg"]) {
      const r = validasiUsulanToko({ ...DASAR, photoUrl });
      expect(r.ok ? [] : r.galat).toEqual(["FOTO_TIDAK_SAH"]);
    }
    expect(validasiUsulanToko({ ...DASAR, photoUrl: "https://cdn.example/x.jpg" }).ok).toBe(true);
  });

  it("accepts loose Indonesian phone spellings and refuses letters or too few digits", () => {
    for (const phone of ["0812 3456 7890", "+62 812-3456-7890", "(022) 420 1234", "022.4201234"]) {
      expect(validasiUsulanToko({ ...DASAR, phone }).ok).toBe(true);
    }
    for (const phone of ["telp 0812", "12345", "0812345678901234567"]) {
      const r = validasiUsulanToko({ ...DASAR, phone });
      expect(r.ok ? [] : r.galat).toEqual(["TELEPON_TIDAK_SAH"]);
    }
  });

  it("treats an empty phone as no phone", () => {
    const r = validasiUsulanToko({ ...DASAR, phone: "   " });
    expect(r.ok && r.data.phone).toBe(null);
  });

  it("needs latitude and longitude together, within range", () => {
    const setengah = validasiUsulanToko({ ...DASAR, lat: -6.9, lng: null });
    expect(setengah.ok ? [] : setengah.galat).toEqual(["KOORDINAT_TIDAK_LENGKAP"]);
    const luar = validasiUsulanToko({ ...DASAR, lat: -95, lng: 107 });
    expect(luar.ok ? [] : luar.galat).toEqual(["KOORDINAT_TIDAK_SAH"]);
    const nan = validasiUsulanToko({ ...DASAR, lat: Number.NaN, lng: 107 });
    expect(nan.ok ? [] : nan.galat).toEqual(["KOORDINAT_TIDAK_SAH"]);
    const pas = validasiUsulanToko({ ...DASAR, lat: -6.9175, lng: 107.6191 });
    expect(pas.ok && [pas.data.lat, pas.data.lng]).toEqual([-6.9175, 107.6191]);
  });

  it("keeps the store type only when it is PUTUS or KONSI, and 'belum tahu' as null", () => {
    expect(validasiUsulanToko({ ...DASAR, termsType: "KONSI" }).ok).toBe(true);
    const kosong = validasiUsulanToko({ ...DASAR, termsType: "" });
    expect(kosong.ok && kosong.data.termsType).toBe(null);
    const salah = validasiUsulanToko({ ...DASAR, termsType: "GROSIR" });
    expect(salah.ok ? [] : salah.galat).toEqual(["JENIS_TIDAK_SAH"]);
  });

  it("bounds the free-text fields", () => {
    const r = validasiUsulanToko({ ...DASAR, name: "x".repeat(192), note: "y".repeat(1001), contactName: "z".repeat(192) });
    expect(r.ok ? [] : r.galat).toEqual(["NAMA_TERLALU_PANJANG", "KONTAK_TERLALU_PANJANG", "CATATAN_TERLALU_PANJANG"]);
  });
});

describe("normalisasiNamaToko", () => {
  it("lower-cases, drops the word toko/tk and punctuation, and collapses spaces", () => {
    expect(normalisasiNamaToko("TOKO  Sinar-Jaya!!")).toBe("sinar jaya");
    expect(normalisasiNamaToko("Tk. Sinar Jaya")).toBe("sinar jaya");
    expect(normalisasiNamaToko("Sinar Jaya Toko")).toBe("sinar jaya");
    expect(normalisasiNamaToko("Café Ananda")).toBe("cafe ananda");
  });

  it("keeps words that merely contain 'toko'", () => {
    expect(normalisasiNamaToko("Tokopedia Corner")).toBe("tokopedia corner");
  });
});

describe("jarakEdit", () => {
  it("counts insertions, deletions and substitutions", () => {
    expect(jarakEdit("sinar", "sinar")).toBe(0);
    expect(jarakEdit("sinar", "sinat")).toBe(1);
    expect(jarakEdit("sinar", "sina")).toBe(1);
    expect(jarakEdit("kitten", "sitting")).toBe(3);
    expect(jarakEdit("", "abc")).toBe(3);
  });
});

describe("namaMirip", () => {
  it("flags the same store spelled differently", () => {
    expect(namaMirip("Toko Sinar Jaya", "SINAR JAYA")).toBe(true);
    expect(namaMirip("Sinar Jaya", "Sinar Jya")).toBe(true);
    expect(namaMirip("Sinar Jaya", "Sinar Jaya 2")).toBe(true);
    expect(namaMirip("Mekar Sari", "Toko Mekar Sari Fashion")).toBe(true);
  });

  it("does not flag unrelated names", () => {
    expect(namaMirip("Sinar Jaya", "Mekar Sari")).toBe(false);
    expect(namaMirip("Butik Anggrek", "Butik Melati")).toBe(false);
  });

  it("does not stretch fuzzy rules over very short names", () => {
    // "Ani" dan "Ana" beda satu huruf, tapi nama sependek itu terlalu umum.
    expect(namaMirip("Ani", "Ana")).toBe(false);
    expect(namaMirip("Jaya", "Sinar Jaya")).toBe(false);
    expect(namaMirip("Ani", "Toko Ani")).toBe(true);
  });

  it("never matches a name that is only the word 'toko'", () => {
    expect(namaMirip("Toko", "Tk.")).toBe(false);
  });
});

describe("pembulatanJarak", () => {
  it("rounds to a readable figure", () => {
    expect(pembulatanJarak(83.4)).toBe(80);
    expect(pembulatanJarak(146)).toBe(150);
    expect(pembulatanJarak(4.2)).toBe(4);
    expect(pembulatanJarak(0.2)).toBe(1);
  });
});

describe("cariKandidatDuplikat", () => {
  // Titik acuan di Bandung; 0.001° lintang ≈ 111 m.
  const PUSAT = { lat: -6.9175, lng: 107.6191 };
  const pembanding: Pembanding[] = [
    { jenis: "TOKO", id: "s1", code: "TK-001", name: "Toko Sinar Jaya", address: "Jl. A", lat: PUSAT.lat + 0.03, lng: PUSAT.lng, aktif: true },
    { jenis: "TOKO", id: "s2", code: "TK-002", name: "Butik Melati", address: "Jl. B", lat: PUSAT.lat + 0.0007, lng: PUSAT.lng, aktif: true },
    { jenis: "TOKO", id: "s3", code: "TK-003", name: "Sinar Jaya", address: "Jl. C", lat: PUSAT.lat + 0.0005, lng: PUSAT.lng, aktif: false },
    { jenis: "USULAN", id: "p1", code: null, name: "Sinar Jaya Baru", address: "Jl. D", lat: null, lng: null, aktif: true },
    { jenis: "TOKO", id: "s4", code: "TK-004", name: "Mekar Sari", address: "Jl. E", lat: PUSAT.lat + 0.01, lng: PUSAT.lng, aktif: true },
  ];

  it("returns stores with a similar name or within the radius, strongest match first", () => {
    // Nama mirip lebih kuat daripada sekadar berdekatan: di pasar, puluhan toko
    // berbeda berdiri dalam 150 m.
    const hasil = cariKandidatDuplikat({ name: "Sinar Jaya", ...PUSAT }, pembanding);
    expect(hasil.map((k) => k.id)).toEqual(["s3", "s1", "p1", "s2"]);
    expect(hasil[0]).toMatchObject({ jenis: "TOKO", namaMirip: true, jarakMeter: 60, aktif: false });
    expect(hasil[1]).toMatchObject({ namaMirip: true, jarakMeter: null });
    expect(hasil[2]).toMatchObject({ jenis: "USULAN", namaMirip: true, jarakMeter: null });
    expect(hasil[3]).toMatchObject({ namaMirip: false, jarakMeter: 80 });
  });

  it("uses the name alone when the proposal has no location", () => {
    const hasil = cariKandidatDuplikat({ name: "Butik Melati", lat: null, lng: null }, pembanding);
    expect(hasil.map((k) => k.id)).toEqual(["s2"]);
  });

  it("ignores stores just outside the radius", () => {
    const tepat = JARAK_DUPLIKAT_METER / 111_000;
    const jauh: Pembanding[] = [
      { jenis: "TOKO", id: "x", code: "X", name: "Lain Sekali", address: "", lat: PUSAT.lat + tepat * 1.1, lng: PUSAT.lng, aktif: true },
    ];
    expect(cariKandidatDuplikat({ name: "Sinar Jaya", ...PUSAT }, jauh)).toEqual([]);
  });

  it("can leave out the proposal itself and the store it became", () => {
    const hasil = cariKandidatDuplikat({ name: "Sinar Jaya", ...PUSAT }, pembanding, {
      kecualiUsulanId: "p1",
      kecualiTokoId: "s3",
    });
    expect(hasil.map((k) => k.id)).toEqual(["s1", "s2"]);
  });

  it("caps the list", () => {
    const banyak: Pembanding[] = Array.from({ length: 30 }, (_, i) => ({
      jenis: "TOKO" as const,
      id: `t${i}`,
      code: `T${i}`,
      name: `Sinar Jaya ${i}`,
      address: "",
      lat: null,
      lng: null,
      aktif: true,
    }));
    expect(cariKandidatDuplikat({ name: "Sinar Jaya", lat: null, lng: null }, banyak)).toHaveLength(10);
  });
});

describe("saranKodeToko", () => {
  it("continues the most common numbered pattern, keeping its zero padding", () => {
    expect(saranKodeToko(["TK-001", "TK-002", "TK-003"])).toBe("TK-004");
    expect(saranKodeToko(["TK-009", "TK-010", "BDG1"])).toBe("TK-011");
    expect(saranKodeToko(["TK-0099"])).toBe("TK-0100");
    expect(saranKodeToko(["TK-999"])).toBe("TK-1000");
  });

  it("breaks a tie between patterns by the higher number", () => {
    expect(saranKodeToko(["A-1", "B-7"])).toBe("B-8");
  });

  it("starts a pattern when there is none", () => {
    expect(saranKodeToko([])).toBe("TK-001");
    expect(saranKodeToko(["PUSAT", "GUDANG"])).toBe("TK-001");
  });
});

describe("validasiPersetujuan", () => {
  const TOKO = {
    name: "Toko Sinar Jaya",
    address: "Jl. Pasar Baru 12",
    phone: null,
    contactName: null,
    code: " TK-004 ",
    termsType: "PUTUS",
    groupId: null,
    salesmanId: "u1",
    paymentTempo: 30,
    isPkp: false,
    markupPercent: 25,
  };

  it("cleans the approval input and drops the markup of a PUTUS store", () => {
    const r = validasiPersetujuan(TOKO);
    expect(r).toEqual({
      ok: true,
      data: {
        name: "Toko Sinar Jaya",
        address: "Jl. Pasar Baru 12",
        phone: null,
        contactName: null,
        code: "TK-004",
        termsType: "PUTUS",
        groupId: null,
        salesmanId: "u1",
        paymentTempo: 30,
        isPkp: false,
        markupPercent: null,
      },
    });
  });

  it("keeps the markup of a consignment store and refuses a negative markup or one above the column limit", () => {
    const ok = validasiPersetujuan({ ...TOKO, termsType: "KONSI", markupPercent: 25 });
    expect(ok.ok && ok.data.markupPercent).toBe(25);
    // A markup of 100% or more is valid (the price doubles); only the column limit bounds it.
    const seratus = validasiPersetujuan({ ...TOKO, termsType: "KONSI", markupPercent: 100 });
    expect(seratus.ok && seratus.data.markupPercent).toBe(100);
    const salah = validasiPersetujuan({ ...TOKO, termsType: "KONSI", markupPercent: 1000 });
    expect(salah.ok ? [] : salah.galat).toEqual(["MARKUP_TIDAK_SAH"]);
    const negatif = validasiPersetujuan({ ...TOKO, termsType: "KONSI", markupPercent: -1 });
    expect(negatif.ok ? [] : negatif.galat).toEqual(["MARKUP_TIDAK_SAH"]);
    const kosong = validasiPersetujuan({ ...TOKO, termsType: "KONSI", markupPercent: null });
    expect(kosong.ok && kosong.data.markupPercent).toBe(null);
  });

  it("requires a code and a store type, and a whole-day payment term", () => {
    const r = validasiPersetujuan({ ...TOKO, code: "  ", termsType: null, paymentTempo: 1.5 });
    expect(r.ok ? [] : r.galat).toEqual(["KODE_WAJIB", "JENIS_WAJIB", "TEMPO_TIDAK_SAH"]);
    const panjang = validasiPersetujuan({ ...TOKO, code: "K".repeat(65), paymentTempo: 366 });
    expect(panjang.ok ? [] : panjang.galat).toEqual(["KODE_TERLALU_PANJANG", "TEMPO_TIDAK_SAH"]);
  });

  it("re-checks the store fields the admin may have corrected", () => {
    const r = validasiPersetujuan({ ...TOKO, name: "", phone: "abc" });
    expect(r.ok ? [] : r.galat).toEqual(["NAMA_WAJIB", "TELEPON_TIDAK_SAH"]);
  });
});
