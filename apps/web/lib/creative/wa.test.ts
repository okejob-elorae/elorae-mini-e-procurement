import { describe, expect, it } from "vitest";
import {
  bacaIdentitas,
  bacaTemplateWa,
  IDENTITAS_BAWAAN,
  isiTemplate,
  normalisasiWa,
  susunVariabel,
  tautanWa,
  TEMPLATE_BAWAAN,
  validasiTemplateWa,
  VARIABEL_WA,
  variabelDalam,
  variabelTakDikenal,
} from "./wa";

describe("normalisasiWa", () => {
  it("menyeragamkan 0…, +62…, 62…, 620… dan 8… menjadi 62…", () => {
    expect(normalisasiWa("0812-3456-7890")).toBe("6281234567890");
    expect(normalisasiWa("+62 812 3456 7890")).toBe("6281234567890");
    expect(normalisasiWa("6281234567890")).toBe("6281234567890");
    expect(normalisasiWa("62081234567890")).toBe("6281234567890");
    expect(normalisasiWa("812 3456 7890")).toBe("6281234567890");
    expect(normalisasiWa("(0812) 3456.7890")).toBe("6281234567890");
  });

  it("kosong, terlalu pendek, atau bukan nomor = null", () => {
    expect(normalisasiWa(null)).toBeNull();
    expect(normalisasiWa("")).toBeNull();
    expect(normalisasiWa("abc")).toBeNull();
    expect(normalisasiWa("0812")).toBeNull();
    expect(normalisasiWa("1234567890123456789")).toBeNull();
  });
});

describe("tautanWa", () => {
  it("membuka wa.me dengan nomor yang sudah dinormalkan dan pesan ter-encode", () => {
    expect(tautanWa("0812-3456-7890", "Halo kak & tim")).toBe("https://wa.me/6281234567890?text=Halo%20kak%20%26%20tim");
    expect(tautanWa("6281234567890")).toBe("https://wa.me/6281234567890");
  });

  it("null bila nomornya tidak bisa dipakai", () => {
    expect(tautanWa("", "x")).toBeNull();
  });
});

describe("isiTemplate", () => {
  it("mengisi variabel yang dikenal dan membiarkan yang tidak dikenal", () => {
    expect(isiTemplate("Halo {nama} dari {brand} {asing}", { nama: "Rina", brand: "Eloraé" })).toBe("Halo Rina dari Eloraé {asing}");
    // Pengirim yang sudah memuat merek tidak ditulis "Tim Eloraé dari Eloraé".
    expect(isiTemplate("Saya {pengirim} dari {brand}.", { pengirim: "Tim Eloraé", brand: "Eloraé" })).toBe("Saya Tim Eloraé.");
    expect(isiTemplate("Saya {pengirim} dari {brand}.", { pengirim: "Tim Elorae", brand: "Eloraé" })).toBe("Saya Tim Elorae.");
    expect(isiTemplate("Saya {pengirim} dari {brand}.", { pengirim: "Dina", brand: "Eloraé" })).toBe("Saya Dina dari Eloraé.");
  });

  it("variabel yang dikenal tapi kosong dibiarkan terlihat, supaya ketahuan belum terisi", () => {
    expect(isiTemplate("Resi {resi}", { resi: null })).toBe("Resi {resi}");
    expect(isiTemplate("Resi {resi}", { resi: "  " })).toBe("Resi {resi}");
  });

  it("mengisi setiap kemunculan", () => {
    expect(isiTemplate("{nama}, {nama}!", { nama: "Kak" })).toBe("Kak, Kak!");
  });

  it("daftar variabel yang dipakai dan yang tidak dikenal", () => {
    expect(variabelDalam("{nama} {resi} {nama} {x}")).toEqual(["nama", "resi", "x"]);
    expect(variabelTakDikenal("{nama} {x} {y}")).toEqual(["x", "y"]);
  });
});

describe("TEMPLATE_BAWAAN", () => {
  it("tujuh template berkunci unik, hanya memakai variabel yang dikenal", () => {
    expect(TEMPLATE_BAWAAN).toHaveLength(8);
    expect(new Set(TEMPLATE_BAWAAN.map((t) => t.kunci)).size).toBe(8);
    for (const t of TEMPLATE_BAWAAN) {
      expect(t.nama.trim().length).toBeGreaterThan(0);
      expect(variabelTakDikenal(t.isi)).toEqual([]);
    }
  });

  it("tidak memakai sapaan 'kamu'", () => {
    for (const t of TEMPLATE_BAWAAN) expect(t.isi.toLowerCase()).not.toMatch(/\bkamu\b/);
  });

  it("template alamat meminta nama penerima, nomor HP, alamat, kota, dan kode pos", () => {
    const alamat = TEMPLATE_BAWAAN.find((t) => t.kunci === "alamat")!;
    for (const kata of ["Nama penerima", "No. HP", "Alamat lengkap", "Kota", "Kode pos"]) expect(alamat.isi).toContain(kata);
  });
});

describe("pengaturan template dan identitas", () => {
  it("baris kosong/rusak = bawaan; daftar kosong yang disimpan dihormati", () => {
    expect(bacaTemplateWa(null)).toEqual(TEMPLATE_BAWAAN);
    expect(bacaTemplateWa("{rusak")).toEqual(TEMPLATE_BAWAAN);
    expect(bacaTemplateWa("[]")).toEqual([]);
    expect(bacaTemplateWa(JSON.stringify([{ kunci: "a", nama: "A", isi: "x" }, { nama: "tanpa isi" }]))).toEqual([
      { kunci: "a", nama: "A", isi: "x" },
    ]);
  });

  it("validasi penyimpanan menolak nama/isi kosong dan kunci kembar", () => {
    expect(validasiTemplateWa([{ kunci: "a", nama: "", isi: "x" }])).toEqual({ ok: false, kode: "NAMA_WAJIB", indeks: 0 });
    expect(validasiTemplateWa([{ kunci: "a", nama: "A", isi: " " }])).toEqual({ ok: false, kode: "ISI_WAJIB", indeks: 0 });
    expect(
      validasiTemplateWa([
        { kunci: "a", nama: "A", isi: "x" },
        { kunci: "a", nama: "B", isi: "y" },
      ]),
    ).toEqual({ ok: false, kode: "KUNCI_KEMBAR", indeks: 1 });
    expect(validasiTemplateWa("x")).toEqual({ ok: false, kode: "TIDAK_VALID" });
    const ok = validasiTemplateWa([{ kunci: " a ", nama: " A ", isi: "x\n" }]);
    expect(ok).toEqual({ ok: true, templates: [{ kunci: "a", nama: "A", isi: "x" }] });
  });

  it("identitas bawaan bermerek Eloraé dan pembacanya pemaaf", () => {
    expect(IDENTITAS_BAWAAN.brand).toBe("Eloraé");
    expect(bacaIdentitas(null)).toEqual(IDENTITAS_BAWAAN);
    expect(bacaIdentitas(JSON.stringify({ pengirim: "Dina", brand: 3 }))).toEqual({ ...IDENTITAS_BAWAAN, pengirim: "Dina" });
  });
});

describe("susunVariabel", () => {
  it("nama jatuh ke username, produk jatuh ke produk utama, fee diformat rupiah", () => {
    const v = susunVariabel({
      namaKol: "",
      username: "rina.style",
      platform: "TikTok",
      campaign: null,
      produk: null,
      resi: "JNE123",
      ekspedisi: "JNE",
      fee: 1_250_000,
      identitas: { pengirim: "Dina", brand: "Eloraé", produk: "koleksi Lebaran" },
    });
    expect(v).toMatchObject({ nama: "rina.style", username: "rina.style", produk: "koleksi Lebaran", fee: "Rp 1.250.000", resi: "JNE123" });
    expect(Object.keys(v).sort()).toEqual([...VARIABEL_WA].sort());
    expect(susunVariabel({ fee: 0, identitas: IDENTITAS_BAWAAN }).fee).toBeNull();
  });
});
