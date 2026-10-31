import { describe, expect, it } from "vitest";
import {
  BATAS_CHECKLIST,
  JENIS_PERTANYAAN,
  TEMPLATE_BAWAAN,
  bacaJawaban,
  bacaPertanyaan,
  bacaSimpanan,
  bentukSimpanan,
  hitungSkor,
  BATAS_PANDUAN,
  panduanBerlaku,
  periksaPanduan,
  persenSkor,
  periksaTemplate,
  pertanyaanTerlemah,
  poinPertanyaan,
  rentangLaporan,
  ringkasPerToko,
  templateBerlaku,
  type HasilUntukLaporan,
  type PertanyaanChecklist,
} from "./checklist-toko";

const q = (o: Partial<PertanyaanChecklist> & Pick<PertanyaanChecklist, "id" | "jenis">): PertanyaanChecklist => ({
  teks: `Pertanyaan ${o.id}`,
  bobot: o.jenis === "TEKS" ? 0 : 10,
  wajib: false,
  target: o.jenis === "ANGKA" ? 4 : null,
  petunjuk: null,
  ...o,
});

const templateMentah = (pertanyaan: unknown[], lain: Record<string, unknown> = {}) => ({
  nama: "Display toko",
  termsType: null,
  pertanyaan,
  ...lain,
});

describe("jenis pertanyaan", () => {
  it("lima jenis, TEKS terakhir", () => {
    expect(JENIS_PERTANYAAN).toEqual(["YA_TIDAK", "SKALA_1_5", "ANGKA", "FOTO", "TEKS"]);
  });
});

describe("periksaTemplate", () => {
  const sah = { id: "rapi", teks: "Rak rapi", jenis: "YA_TIDAK", bobot: 10, wajib: true };

  it("menerima template yang sah dan merapikan teks", () => {
    const r = periksaTemplate(templateMentah([{ ...sah, teks: "  Rak   rapi  " }], { nama: "  Display  " }));
    expect(r).toEqual({
      ok: true,
      nilai: {
        nama: "Display",
        termsType: null,
        pertanyaan: [{ id: "rapi", teks: "Rak rapi", jenis: "YA_TIDAK", bobot: 10, wajib: true, target: null, petunjuk: null }],
      },
    });
  });

  it("menerima jenis toko PUTUS/KONSI dan menolak yang lain", () => {
    expect(periksaTemplate(templateMentah([sah], { termsType: "KONSI" }))).toMatchObject({ ok: true, nilai: { termsType: "KONSI" } });
    expect(periksaTemplate(templateMentah([sah], { termsType: "GROSIR" }))).toEqual({ ok: false, kode: "JENIS_TOKO_TIDAK_SAH" });
  });

  it("bukan objek ditolak", () => {
    expect(periksaTemplate(null)).toEqual({ ok: false, kode: "NAMA_WAJIB" });
    expect(periksaTemplate("x")).toEqual({ ok: false, kode: "NAMA_WAJIB" });
  });

  it("nama wajib dan dibatasi panjangnya", () => {
    expect(periksaTemplate(templateMentah([sah], { nama: "   " }))).toEqual({ ok: false, kode: "NAMA_WAJIB" });
    expect(periksaTemplate(templateMentah([sah], { nama: "x".repeat(BATAS_CHECKLIST.nama + 1) }))).toEqual({
      ok: false,
      kode: "NAMA_TERLALU_PANJANG",
    });
  });

  it("tanpa pertanyaan ditolak; terlalu banyak juga", () => {
    expect(periksaTemplate(templateMentah([]))).toEqual({ ok: false, kode: "TANPA_PERTANYAAN" });
    expect(periksaTemplate(templateMentah(undefined as never))).toEqual({ ok: false, kode: "TANPA_PERTANYAAN" });
    const banyak = Array.from({ length: BATAS_CHECKLIST.pertanyaan + 1 }, (_, i) => ({ ...sah, id: `q${i}` }));
    expect(periksaTemplate(templateMentah(banyak))).toEqual({ ok: false, kode: "TERLALU_BANYAK_PERTANYAAN" });
  });

  it("id ganda ditolak dengan indeks pertanyaan keduanya", () => {
    expect(periksaTemplate(templateMentah([sah, { ...sah, teks: "Lain" }]))).toEqual({ ok: false, kode: "ID_GANDA", indeks: 1 });
  });

  it("id harus pendek dan aman", () => {
    expect(periksaTemplate(templateMentah([{ ...sah, id: "" }]))).toEqual({ ok: false, kode: "PERTANYAAN_TIDAK_SAH", indeks: 0 });
    expect(periksaTemplate(templateMentah([{ ...sah, id: "ada spasi" }]))).toEqual({ ok: false, kode: "PERTANYAAN_TIDAK_SAH", indeks: 0 });
    expect(periksaTemplate(templateMentah([{ ...sah, id: "x".repeat(41) }]))).toEqual({ ok: false, kode: "PERTANYAAN_TIDAK_SAH", indeks: 0 });
    expect(periksaTemplate(templateMentah(["bukan objek"]))).toEqual({ ok: false, kode: "PERTANYAAN_TIDAK_SAH", indeks: 0 });
  });

  it("teks pertanyaan wajib dan dibatasi", () => {
    expect(periksaTemplate(templateMentah([{ ...sah, teks: "  " }]))).toEqual({ ok: false, kode: "TEKS_WAJIB", indeks: 0 });
    expect(periksaTemplate(templateMentah([{ ...sah, teks: "x".repeat(BATAS_CHECKLIST.teks + 1) }]))).toEqual({
      ok: false,
      kode: "TEKS_TERLALU_PANJANG",
      indeks: 0,
    });
  });

  it("jenis yang tidak dikenal ditolak", () => {
    expect(periksaTemplate(templateMentah([{ ...sah, jenis: "PILIHAN" }]))).toEqual({ ok: false, kode: "JENIS_TIDAK_SAH", indeks: 0 });
  });

  it("bobot pertanyaan berskor harus bilangan bulat 1–100", () => {
    for (const bobot of [0, -1, 1.5, 101, "10", null, Number.NaN]) {
      expect(periksaTemplate(templateMentah([{ ...sah, bobot }]))).toEqual({ ok: false, kode: "BOBOT_TIDAK_SAH", indeks: 0 });
    }
    expect(periksaTemplate(templateMentah([{ ...sah, bobot: 100 }]))).toMatchObject({ ok: true });
  });

  it("TEKS tidak berbobot: bobot yang dikirim diabaikan jadi 0", () => {
    const r = periksaTemplate(templateMentah([sah, { id: "catatan", teks: "Catatan", jenis: "TEKS", bobot: 50 }]));
    expect(r.ok && r.nilai.pertanyaan[1]).toMatchObject({ jenis: "TEKS", bobot: 0 });
  });

  it("ANGKA wajib punya target > 0; jenis lain targetnya dibuang", () => {
    const angka = { id: "rak", teks: "Jumlah rak", jenis: "ANGKA", bobot: 10 };
    expect(periksaTemplate(templateMentah([angka]))).toEqual({ ok: false, kode: "TARGET_TIDAK_SAH", indeks: 0 });
    expect(periksaTemplate(templateMentah([{ ...angka, target: 0 }]))).toEqual({ ok: false, kode: "TARGET_TIDAK_SAH", indeks: 0 });
    expect(periksaTemplate(templateMentah([{ ...angka, target: BATAS_CHECKLIST.angkaMaks + 1 }]))).toEqual({
      ok: false,
      kode: "TARGET_TIDAK_SAH",
      indeks: 0,
    });
    const ok = periksaTemplate(templateMentah([{ ...angka, target: 3 }, { ...sah, target: 9 }]));
    expect(ok.ok && ok.nilai.pertanyaan.map((p) => p.target)).toEqual([3, null]);
  });

  it("template tanpa satu pun pertanyaan berskor ditolak", () => {
    expect(periksaTemplate(templateMentah([{ id: "c", teks: "Catatan", jenis: "TEKS" }]))).toEqual({ ok: false, kode: "TANPA_SKOR" });
  });

  it("petunjuk opsional dirapikan; kosong jadi null; wajib non-boolean jadi false", () => {
    const r = periksaTemplate(templateMentah([{ ...sah, petunjuk: "  lihat dari lorong ", wajib: "ya" }]));
    expect(r.ok && r.nilai.pertanyaan[0]).toMatchObject({ petunjuk: "lihat dari lorong", wajib: false });
    const k = periksaTemplate(templateMentah([{ ...sah, petunjuk: "   " }]));
    expect(k.ok && k.nilai.pertanyaan[0].petunjuk).toBeNull();
    expect(periksaTemplate(templateMentah([{ ...sah, petunjuk: "x".repeat(BATAS_CHECKLIST.petunjuk + 1) }]))).toEqual({
      ok: false,
      kode: "TEKS_TERLALU_PANJANG",
      indeks: 0,
    });
  });
});

describe("bacaPertanyaan (dari JSON tersimpan)", () => {
  it("membuang baris rusak dan id ganda, menyimpan yang sah", () => {
    const hasil = bacaPertanyaan([
      { id: "a", teks: "A", jenis: "YA_TIDAK", bobot: 5, wajib: true },
      { id: "a", teks: "A lagi", jenis: "YA_TIDAK", bobot: 5 },
      { id: "b", teks: "B", jenis: "ANGKA", bobot: 5 },
      "sampah",
      { id: "c", teks: "C", jenis: "TEKS" },
    ]);
    expect(hasil.map((p) => p.id)).toEqual(["a", "c"]);
  });

  it("bukan larik → kosong", () => {
    expect(bacaPertanyaan(null)).toEqual([]);
    expect(bacaPertanyaan({ a: 1 })).toEqual([]);
  });
});

describe("TEMPLATE_BAWAAN (pakaian)", () => {
  const dengan = (teks: (kunci: string) => string) =>
    templateMentah(TEMPLATE_BAWAAN.pertanyaan.map((p) => ({ ...p, teks: teks(p.kunci), petunjuk: null })));

  it("sah begitu diberi teks, bobot berskor berjumlah 100", () => {
    const r = periksaTemplate(dengan((k) => `Teks ${k}`));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.nilai.pertanyaan.reduce((s, p) => s + p.bobot, 0)).toBe(100);
  });

  it("memakai setiap jenis pertanyaan setidaknya sekali", () => {
    expect(new Set(TEMPLATE_BAWAAN.pertanyaan.map((p) => p.jenis))).toEqual(new Set(JENIS_PERTANYAAN));
  });

  it("id unik dan sama dengan kunci teksnya", () => {
    const ids = TEMPLATE_BAWAAN.pertanyaan.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of TEMPLATE_BAWAAN.pertanyaan) expect(p.id).toBe(p.kunci);
  });
});

describe("bacaJawaban", () => {
  const daftar = [
    q({ id: "ya", jenis: "YA_TIDAK", wajib: true }),
    q({ id: "skala", jenis: "SKALA_1_5" }),
    q({ id: "angka", jenis: "ANGKA" }),
    q({ id: "foto", jenis: "FOTO" }),
    q({ id: "teks", jenis: "TEKS" }),
  ];

  it("menerima jawaban sah dan membuang kunci asing", () => {
    expect(
      bacaJawaban(daftar, { ya: true, skala: 4, angka: 2.5, foto: ["f1", "f2"], teks: "  pesaing X  ", asing: 1 }),
    ).toEqual({ ok: true, jawaban: { ya: true, skala: 4, angka: 2.5, foto: ["f1", "f2"], teks: "pesaing X" } });
  });

  it("pertanyaan wajib yang kosong ditolak dengan id-nya", () => {
    expect(bacaJawaban(daftar, {})).toEqual({ ok: false, kode: "WAJIB_DIJAWAB", pertanyaanId: "ya" });
    expect(bacaJawaban(daftar, { ya: null })).toEqual({ ok: false, kode: "WAJIB_DIJAWAB", pertanyaanId: "ya" });
  });

  it("pertanyaan opsional yang kosong dilewati", () => {
    expect(bacaJawaban(daftar, { ya: false, skala: null, teks: "   ", foto: [] })).toEqual({ ok: true, jawaban: { ya: false } });
  });

  it("wajib: TEKS spasi saja dan FOTO larik kosong dihitung kosong", () => {
    const wajib = [q({ id: "t", jenis: "TEKS", wajib: true }), q({ id: "f", jenis: "FOTO", wajib: true })];
    expect(bacaJawaban(wajib, { t: "  ", f: ["x"] })).toEqual({ ok: false, kode: "WAJIB_DIJAWAB", pertanyaanId: "t" });
    expect(bacaJawaban(wajib, { t: "ok", f: [] })).toEqual({ ok: false, kode: "WAJIB_DIJAWAB", pertanyaanId: "f" });
  });

  it("tipe yang salah ditolak", () => {
    expect(bacaJawaban(daftar, { ya: "ya" })).toEqual({ ok: false, kode: "JAWABAN_TIDAK_SAH", pertanyaanId: "ya" });
    for (const skala of [0, 6, 2.5, "3"]) {
      expect(bacaJawaban(daftar, { ya: true, skala })).toEqual({ ok: false, kode: "JAWABAN_TIDAK_SAH", pertanyaanId: "skala" });
    }
    for (const angka of [-1, Number.POSITIVE_INFINITY, "2", BATAS_CHECKLIST.angkaMaks + 1]) {
      expect(bacaJawaban(daftar, { ya: true, angka })).toEqual({ ok: false, kode: "JAWABAN_TIDAK_SAH", pertanyaanId: "angka" });
    }
    expect(bacaJawaban(daftar, { ya: true, foto: "f1" })).toEqual({ ok: false, kode: "JAWABAN_TIDAK_SAH", pertanyaanId: "foto" });
    expect(bacaJawaban(daftar, { ya: true, foto: [""] })).toEqual({ ok: false, kode: "JAWABAN_TIDAK_SAH", pertanyaanId: "foto" });
    expect(bacaJawaban(daftar, { ya: true, teks: 5 })).toEqual({ ok: false, kode: "JAWABAN_TIDAK_SAH", pertanyaanId: "teks" });
    expect(bacaJawaban(daftar, { ya: true, teks: "x".repeat(BATAS_CHECKLIST.jawabanTeks + 1) })).toEqual({
      ok: false,
      kode: "JAWABAN_TIDAK_SAH",
      pertanyaanId: "teks",
    });
  });

  it("FOTO: id ganda dirapatkan, lebih dari batas ditolak", () => {
    expect(bacaJawaban(daftar, { ya: true, foto: ["a", "a", "b"] })).toEqual({ ok: true, jawaban: { ya: true, foto: ["a", "b"] } });
    const banyak = Array.from({ length: BATAS_CHECKLIST.fotoPerPertanyaan + 1 }, (_, i) => `f${i}`);
    expect(bacaJawaban(daftar, { ya: true, foto: banyak })).toEqual({ ok: false, kode: "JAWABAN_TIDAK_SAH", pertanyaanId: "foto" });
  });

  it("jawaban bukan objek ditolak", () => {
    expect(bacaJawaban(daftar, null)).toEqual({ ok: false, kode: "JAWABAN_TIDAK_SAH", pertanyaanId: "" });
    expect(bacaJawaban(daftar, [true])).toEqual({ ok: false, kode: "JAWABAN_TIDAK_SAH", pertanyaanId: "" });
  });
});

describe("poinPertanyaan", () => {
  it("YA_TIDAK: penuh saat ya, nol saat tidak", () => {
    const p = q({ id: "a", jenis: "YA_TIDAK", bobot: 20 });
    expect(poinPertanyaan(p, true)).toBe(20);
    expect(poinPertanyaan(p, false)).toBe(0);
    expect(poinPertanyaan(p, undefined)).toBe(0);
  });

  it("SKALA_1_5: (nilai − 1) / 4 × bobot", () => {
    const p = q({ id: "a", jenis: "SKALA_1_5", bobot: 20 });
    expect([1, 2, 3, 4, 5].map((v) => poinPertanyaan(p, v))).toEqual([0, 5, 10, 15, 20]);
  });

  it("ANGKA: sebanding dengan target, tidak melebihi bobot", () => {
    const p = q({ id: "a", jenis: "ANGKA", bobot: 10, target: 4 });
    expect(poinPertanyaan(p, 0)).toBe(0);
    expect(poinPertanyaan(p, 1)).toBe(2.5);
    expect(poinPertanyaan(p, 4)).toBe(10);
    expect(poinPertanyaan(p, 9)).toBe(10);
  });

  it("FOTO: penuh saat ada foto", () => {
    const p = q({ id: "a", jenis: "FOTO", bobot: 15 });
    expect(poinPertanyaan(p, ["x"])).toBe(15);
    expect(poinPertanyaan(p, [])).toBe(0);
  });

  it("TEKS: selalu nol", () => {
    expect(poinPertanyaan(q({ id: "a", jenis: "TEKS" }), "apa pun")).toBe(0);
  });
});

describe("hitungSkor", () => {
  const daftar = [
    q({ id: "ya", jenis: "YA_TIDAK", bobot: 20 }),
    q({ id: "skala", jenis: "SKALA_1_5", bobot: 20 }),
    q({ id: "angka", jenis: "ANGKA", bobot: 10, target: 2 }),
    q({ id: "foto", jenis: "FOTO", bobot: 20 }),
    q({ id: "teks", jenis: "TEKS" }),
  ];

  it("jumlah poin, skor maksimum dan persen", () => {
    const r = hitungSkor(daftar, { ya: true, skala: 3, angka: 1, foto: ["f"], teks: "catatan" });
    // 20 + 10 + 5 + 20 = 55 dari 70
    expect(r.score).toBe(55);
    expect(r.maxScore).toBe(70);
    expect(r.persen).toBe(79);
    expect(r.rincian.map((x) => [x.id, x.poin, x.maks])).toEqual([
      ["ya", 20, 20],
      ["skala", 10, 20],
      ["angka", 5, 10],
      ["foto", 20, 20],
      ["teks", 0, 0],
    ]);
    expect(r.rincian[4].jawaban).toBe("catatan");
  });

  it("pertanyaan yang tidak dijawab = nol poin tapi tetap dihitung di maksimum", () => {
    const r = hitungSkor(daftar, {});
    expect(r).toMatchObject({ score: 0, maxScore: 70, persen: 0 });
    expect(r.rincian.every((x) => x.jawaban === null)).toBe(true);
  });

  it("pecahan dibulatkan sekali di akhir, bukan per pertanyaan", () => {
    const tiga = [
      q({ id: "a", jenis: "SKALA_1_5", bobot: 1 }),
      q({ id: "b", jenis: "SKALA_1_5", bobot: 1 }),
      q({ id: "c", jenis: "SKALA_1_5", bobot: 1 }),
    ];
    // 0.5 × 3 = 1.5 → 2 (per pertanyaan dibulatkan akan jadi 3 × 1 = 3)
    expect(hitungSkor(tiga, { a: 3, b: 3, c: 3 }).score).toBe(2);
  });

  it("rincian poin dibulatkan dua desimal", () => {
    const r = hitungSkor([q({ id: "a", jenis: "ANGKA", bobot: 10, target: 3 })], { a: 1 });
    expect(r.rincian[0].poin).toBe(3.33);
  });

  it("persen konsisten dengan skor tersimpan", () => {
    const r = hitungSkor(daftar, { ya: true, skala: 3, angka: 1 });
    expect(r.persen).toBe(persenSkor(r.score, r.maxScore));
  });
});

describe("persenSkor", () => {
  it("dibulatkan; maksimum nol → null", () => {
    expect(persenSkor(1, 3)).toBe(33);
    expect(persenSkor(2, 3)).toBe(67);
    expect(persenSkor(0, 0)).toBeNull();
  });
});

describe("bentukSimpanan / bacaSimpanan", () => {
  it("bolak-balik", () => {
    const daftar = [q({ id: "a", jenis: "YA_TIDAK" }), q({ id: "f", jenis: "FOTO" })];
    const hasil = hitungSkor(daftar, { a: true, f: ["x"] });
    const simpan = bentukSimpanan({ a: true, f: ["x"] }, hasil.rincian);
    const baca = bacaSimpanan(JSON.parse(JSON.stringify(simpan)));
    expect(baca.jawaban).toEqual({ a: true, f: ["x"] });
    expect(baca.rincian).toEqual(hasil.rincian);
  });

  it("JSON rusak → kosong, baris rincian rusak dibuang", () => {
    expect(bacaSimpanan(null)).toEqual({ jawaban: {}, rincian: [], fotoIds: [] });
    expect(bacaSimpanan({ jawaban: [], rincian: [{ id: "a" }, "x"] })).toEqual({ jawaban: {}, rincian: [], fotoIds: [] });
  });

  it("daftar id foto dari jawaban FOTO", () => {
    const daftar = [q({ id: "f", jenis: "FOTO" }), q({ id: "g", jenis: "FOTO" }), q({ id: "a", jenis: "YA_TIDAK" })];
    const hasil = hitungSkor(daftar, { f: ["x", "y"], g: ["z"], a: true });
    const baca = bacaSimpanan(bentukSimpanan({ f: ["x", "y"], g: ["z"], a: true }, hasil.rincian));
    expect(baca.fotoIds).toEqual(["x", "y", "z"]);
  });
});

describe("templateBerlaku", () => {
  const t = (id: string, termsType: "PUTUS" | "KONSI" | null, isActive = true) => ({ id, termsType, isActive });

  it("aktif saja, jenis toko sama atau semua jenis", () => {
    const daftar = [t("semua", null), t("putus", "PUTUS"), t("konsi", "KONSI"), t("mati", null, false)];
    expect(templateBerlaku(daftar, "PUTUS").map((x) => x.id)).toEqual(["semua", "putus"]);
    expect(templateBerlaku(daftar, "KONSI").map((x) => x.id)).toEqual(["semua", "konsi"]);
  });
});

describe("panduanBerlaku", () => {
  const sekarang = new Date("2026-09-30T05:00:00.000Z");
  const dasar = { isActive: true, termsType: null, groupId: null, activeFrom: null, activeTo: null } as const;
  const toko = { termsType: "PUTUS" as const, groupId: "jgu" };

  it("tanpa batasan → berlaku", () => {
    expect(panduanBerlaku(dasar, toko, sekarang)).toBe(true);
  });

  it("nonaktif → tidak berlaku", () => {
    expect(panduanBerlaku({ ...dasar, isActive: false }, toko, sekarang)).toBe(false);
  });

  it("jenis toko dan area harus cocok bila diisi", () => {
    expect(panduanBerlaku({ ...dasar, termsType: "KONSI" }, toko, sekarang)).toBe(false);
    expect(panduanBerlaku({ ...dasar, termsType: "PUTUS" }, toko, sekarang)).toBe(true);
    expect(panduanBerlaku({ ...dasar, groupId: "jtt" }, toko, sekarang)).toBe(false);
    expect(panduanBerlaku({ ...dasar, groupId: "jgu" }, toko, sekarang)).toBe(true);
    expect(panduanBerlaku({ ...dasar, groupId: "jgu" }, { ...toko, groupId: null }, sekarang)).toBe(false);
  });

  it("rentang tanggal inklusif di kedua ujung", () => {
    expect(panduanBerlaku({ ...dasar, activeFrom: sekarang }, toko, sekarang)).toBe(true);
    expect(panduanBerlaku({ ...dasar, activeTo: sekarang }, toko, sekarang)).toBe(true);
    expect(panduanBerlaku({ ...dasar, activeFrom: new Date(sekarang.getTime() + 1) }, toko, sekarang)).toBe(false);
    expect(panduanBerlaku({ ...dasar, activeTo: new Date(sekarang.getTime() - 1) }, toko, sekarang)).toBe(false);
  });
});

describe("laporan eksekusi toko", () => {
  const r = (
    id: string,
    storeId: string,
    hari: number,
    persen: number | null,
    rincian: HasilUntukLaporan["rincian"] = [],
    templateId = "t1",
  ): HasilUntukLaporan => ({
    id,
    storeId,
    templateId,
    tanggal: new Date(Date.UTC(2026, 8, hari)),
    score: persen ?? 0,
    maxScore: persen === null ? 0 : 100,
    persen,
    rincian,
  });

  it("per toko+template: terakhir, tren lima terakhir urut lama→baru, jumlah", () => {
    const hasil = [
      r("a1", "A", 1, 40),
      r("a2", "A", 2, 50),
      r("a3", "A", 3, 60),
      r("a4", "A", 4, 70),
      r("a5", "A", 5, 80),
      r("a6", "A", 6, 90),
      r("b1", "B", 3, 30),
      r("a7", "A", 7, 20, [], "t2"),
    ];
    const ringkas = ringkasPerToko([...hasil].reverse());
    const a = ringkas.find((x) => x.storeId === "A" && x.templateId === "t1")!;
    expect(a.terakhir.id).toBe("a6");
    expect(a.tren).toEqual([50, 60, 70, 80, 90]);
    expect(a.jumlah).toBe(6);
    expect(ringkas.find((x) => x.storeId === "A" && x.templateId === "t2")!.jumlah).toBe(1);
  });

  it("diurutkan dari skor terakhir terendah; tanpa skor di akhir", () => {
    const ringkas = ringkasPerToko([r("x", "X", 1, null), r("a", "A", 1, 80), r("b", "B", 1, 30)]);
    expect(ringkas.map((x) => x.storeId)).toEqual(["B", "A", "X"]);
  });

  it("pertanyaan terlemah: persen gabungan per template+pertanyaan, TEKS diabaikan", () => {
    const rin = (id: string, poin: number, maks: number, teks = `T ${id}`) => ({
      id,
      teks,
      jenis: maks === 0 ? ("TEKS" as const) : ("YA_TIDAK" as const),
      bobot: maks,
      poin,
      maks,
      jawaban: null,
    });
    const hasil = [
      r("1", "A", 1, 50, [rin("rapi", 10, 10), rin("label", 0, 10), rin("cat", 0, 0)]),
      r("2", "B", 1, 50, [rin("rapi", 0, 10), rin("label", 0, 10, "Label baru")]),
    ];
    const lemah = pertanyaanTerlemah(hasil);
    expect(lemah.map((x) => [x.id, x.persen, x.jumlah])).toEqual([
      ["label", 0, 2],
      ["rapi", 50, 2],
    ]);
    // teks terbaru yang terlihat dipakai sebagai label
    expect(lemah[0].teks).toBe("Label baru");
  });
});

describe("periksaPanduan", () => {
  const sah = { judul: "Rak musim hujan", isi: "Jaket di depan, kaos di belakang.", gambarUrl: "/api/foto/abc", termsType: "", groupId: "", mulai: "", selesai: "" };

  it("menerima isian sah; kosong berarti semua / tanpa batas", () => {
    expect(periksaPanduan({ ...sah, judul: "  Rak   musim hujan " })).toEqual({
      ok: true,
      nilai: { judul: "Rak musim hujan", isi: "Jaket di depan, kaos di belakang.", gambarUrl: "/api/foto/abc", termsType: null, groupId: null, mulai: null, selesai: null },
    });
  });

  it("isi mempertahankan baris baru", () => {
    const r = periksaPanduan({ ...sah, isi: "  Baris 1\nBaris 2  " });
    expect(r.ok && r.nilai.isi).toBe("Baris 1\nBaris 2");
  });

  it("judul dan isi wajib, dibatasi panjangnya", () => {
    expect(periksaPanduan({ ...sah, judul: " " })).toEqual({ ok: false, kode: "JUDUL_WAJIB" });
    expect(periksaPanduan({ ...sah, isi: "" })).toEqual({ ok: false, kode: "ISI_WAJIB" });
    expect(periksaPanduan({ ...sah, judul: "x".repeat(BATAS_PANDUAN.judul + 1) })).toEqual({ ok: false, kode: "TEKS_TERLALU_PANJANG" });
    expect(periksaPanduan({ ...sah, isi: "x".repeat(BATAS_PANDUAN.isi + 1) })).toEqual({ ok: false, kode: "TEKS_TERLALU_PANJANG" });
    expect(periksaPanduan(null)).toEqual({ ok: false, kode: "JUDUL_WAJIB" });
  });

  it("gambar hanya dari unggahan sendiri, boleh kosong", () => {
    expect(periksaPanduan({ ...sah, gambarUrl: "https://x.com/a.jpg" })).toEqual({ ok: false, kode: "GAMBAR_TIDAK_SAH" });
    expect(periksaPanduan({ ...sah, gambarUrl: null })).toMatchObject({ ok: true, nilai: { gambarUrl: null } });
  });

  it("jenis toko dan area", () => {
    expect(periksaPanduan({ ...sah, termsType: "KONSI", groupId: "g1" })).toMatchObject({ ok: true, nilai: { termsType: "KONSI", groupId: "g1" } });
    expect(periksaPanduan({ ...sah, termsType: "LAIN" })).toEqual({ ok: false, kode: "JENIS_TOKO_TIDAK_SAH" });
    expect(periksaPanduan({ ...sah, groupId: 5 })).toEqual({ ok: false, kode: "AREA_TIDAK_SAH" });
  });

  it("tanggal YYYY-MM-DD, selesai tidak sebelum mulai", () => {
    expect(periksaPanduan({ ...sah, mulai: "2026-10-01", selesai: "2026-10-31" })).toMatchObject({
      ok: true,
      nilai: { mulai: "2026-10-01", selesai: "2026-10-31" },
    });
    expect(periksaPanduan({ ...sah, mulai: "2026-10-01", selesai: "2026-10-01" })).toMatchObject({ ok: true });
    expect(periksaPanduan({ ...sah, mulai: "01/10/2026" })).toEqual({ ok: false, kode: "TANGGAL_TIDAK_SAH" });
    expect(periksaPanduan({ ...sah, mulai: "2026-02-30" })).toEqual({ ok: false, kode: "TANGGAL_TIDAK_SAH" });
    expect(periksaPanduan({ ...sah, mulai: "2026-10-02", selesai: "2026-10-01" })).toEqual({ ok: false, kode: "TANGGAL_TERBALIK" });
  });
});

describe("rentangLaporan", () => {
  // 30 Sep 2026 10:00 WIB
  const sekarang = new Date("2026-09-30T03:00:00.000Z");

  it("bawaan 90 hari terakhir, hari WIB inklusif", () => {
    const r = rentangLaporan(undefined, undefined, sekarang);
    expect(r.dariStr).toBe("2026-07-03");
    expect(r.sampaiStr).toBe("2026-09-30");
    expect(r.dari.toISOString()).toBe("2026-07-02T17:00:00.000Z");
    expect(r.sampai.toISOString()).toBe("2026-09-30T16:59:59.999Z");
  });

  it("memakai isian yang sah", () => {
    const r = rentangLaporan("2026-09-01", "2026-09-15", sekarang);
    expect([r.dariStr, r.sampaiStr]).toEqual(["2026-09-01", "2026-09-15"]);
  });

  it("isian rusak jatuh ke bawaan; terbalik ditukar", () => {
    expect(rentangLaporan("kemarin", "2026-09-15", sekarang).dariStr).toBe("2026-07-03");
    const r = rentangLaporan("2026-09-15", "2026-09-01", sekarang);
    expect([r.dariStr, r.sampaiStr]).toEqual(["2026-09-01", "2026-09-15"]);
  });
});
