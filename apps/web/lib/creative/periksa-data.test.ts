import { describe, expect, it } from "vitest";
import {
  anomaliAngka,
  BAGIAN_JENIS,
  BATAS_BARIS_PERIKSA,
  grupPeriksa,
  kelompokKembarPeriksa,
  TAHAP_SUDAH_TAYANG,
  tanggalTerbalik,
  tayangDiMasaDepan,
  tautanKolaborasi,
  URUTAN_PERIKSA,
} from "./periksa-data";

const pada = (iso: string) => new Date(iso);

describe("tanggalTerbalik", () => {
  it("selesai sebelum mulai = terbalik; sama hari atau salah satu kosong = tidak", () => {
    expect(tanggalTerbalik(pada("2026-10-05T00:00:00+07:00"), pada("2026-10-03T00:00:00+07:00"))).toBe(true);
    expect(tanggalTerbalik(pada("2026-10-05T00:00:00+07:00"), pada("2026-10-05T00:00:00+07:00"))).toBe(false);
    expect(tanggalTerbalik(pada("2026-10-05T00:00:00+07:00"), pada("2026-10-06T00:00:00+07:00"))).toBe(false);
    expect(tanggalTerbalik(null, pada("2026-10-01T00:00:00+07:00"))).toBe(false);
    expect(tanggalTerbalik(pada("2026-10-01T00:00:00+07:00"), null)).toBe(false);
  });
});

describe("tayangDiMasaDepan", () => {
  it("hanya hari WIB SESUDAH hari ini; nanti malam di hari yang sama bukan masa depan", () => {
    expect(tayangDiMasaDepan(pada("2026-10-11T00:00:00+07:00"), "2026-10-10")).toBe(true);
    expect(tayangDiMasaDepan(pada("2026-10-10T23:59:00+07:00"), "2026-10-10")).toBe(false);
    // 17.30 UTC tanggal 10 = 00.30 WIB tanggal 11.
    expect(tayangDiMasaDepan(pada("2026-10-10T17:30:00Z"), "2026-10-10")).toBe(true);
    expect(tayangDiMasaDepan(null, "2026-10-10")).toBe(false);
  });
});

describe("anomaliAngka", () => {
  const b = (id: string, iso: string, views: number, likes = 0) => ({ id, recordedAt: pada(iso), views, likes });

  it("like > views (views > 0) — bacaan terakhir yang janggal dan berapa kali", () => {
    const r = anomaliAngka([b("a", "2026-10-01T00:00:00Z", 100, 150), b("b", "2026-10-02T00:00:00Z", 0, 5), b("c", "2026-10-03T00:00:00Z", 200, 300)]);
    expect(r.likeLebih).toEqual({ waktu: "2026-10-03T00:00:00.000Z", likes: 300, views: 200, kali: 2 });
  });

  it("views 0 dengan like tidak dihitung like > views", () => {
    expect(anomaliAngka([b("a", "2026-10-01T00:00:00Z", 0, 9)]).likeLebih).toBeNull();
  });

  it("views turun dibanding bacaan SEBELUMNYA mana pun (bukan hanya tepat sebelumnya); dilaporkan yang terakhir", () => {
    const r = anomaliAngka([
      b("a", "2026-10-01T00:00:00Z", 100),
      b("b", "2026-10-02T00:00:00Z", 50),
      b("c", "2026-10-03T00:00:00Z", 120),
      b("d", "2026-10-04T00:00:00Z", 110),
    ]);
    expect(r.turun).toEqual({ waktuSebelum: "2026-10-03T00:00:00.000Z", sebelum: 120, waktu: "2026-10-04T00:00:00.000Z", sesudah: 110, kali: 2 });
  });

  it("urutan masukan tidak penting; views naik terus = tidak janggal", () => {
    const r = anomaliAngka([b("c", "2026-10-03T00:00:00Z", 300), b("a", "2026-10-01T00:00:00Z", 100), b("b", "2026-10-02T00:00:00Z", 200)]);
    expect(r).toEqual({ likeLebih: null, turun: null });
  });

  it("dua bacaan di waktu yang SAMA tidak saling dibandingkan (sama dengan SQL: e.recordedAt < m.recordedAt)", () => {
    expect(anomaliAngka([b("a", "2026-10-01T00:00:00Z", 100), b("b", "2026-10-01T00:00:00Z", 90)]).turun).toBeNull();
    const r = anomaliAngka([b("a", "2026-10-01T00:00:00Z", 100), b("b", "2026-10-01T00:00:00Z", 90), b("c", "2026-10-02T00:00:00Z", 95)]);
    expect(r.turun).toMatchObject({ sebelum: 100, sesudah: 95, kali: 1 });
  });
});

describe("kelompokKembarPeriksa", () => {
  it("WA sama dan handle sama lintas platform; nilai yang sama ikut dilaporkan", () => {
    const baris = kelompokKembarPeriksa([
      { id: "k1", nama: "Nadia", waNormal: "6281234567890", handles: ["@NadiaStyle"] },
      { id: "k2", nama: "Nadia S", waNormal: "6281234567890", handles: ["lain"] },
      { id: "k3", nama: "Budi", waNormal: null, handles: ["budi"] },
      { id: "k4", nama: "Budi IG", waNormal: null, handles: ["https://www.instagram.com/Budi/"] },
      { id: "k5", nama: "Sendiri", waNormal: null, handles: ["unik"] },
    ]);
    expect(baris).toHaveLength(2);
    expect(baris[0]).toMatchObject({
      id: "k1",
      judul: "Nadia · Nadia S",
      tautan: null,
      rincian: { macam: "KEMBAR", sebab: ["WA"], waSama: "6281234567890", handleSama: null, anggota: [{ id: "k1", nama: "Nadia" }, { id: "k2", nama: "Nadia S" }] },
    });
    expect(baris[1].rincian).toMatchObject({ macam: "KEMBAR", sebab: ["HANDLE"], handleSama: "budi" });
  });
});

describe("grupPeriksa", () => {
  it("baris dipotong ke batas, jumlah tetap angka sebenarnya", () => {
    const baris = Array.from({ length: BATAS_BARIS_PERIKSA + 5 }, (_, i) => ({ id: `x${i}`, judul: `x${i}`, sub: null, tautan: null, rincian: { macam: "KOSONG" as const } }));
    const g = grupPeriksa("KOL_TANPA_AKUN", 70, baris);
    expect(g.baris).toHaveLength(BATAS_BARIS_PERIKSA);
    expect(g.jumlah).toBe(70);
    expect(g.bagian).toBe("kelengkapan");
  });
});

describe("daftar jenis", () => {
  it("setiap jenis punya bagian, tanpa ganda", () => {
    expect(new Set(URUTAN_PERIKSA).size).toBe(URUTAN_PERIKSA.length);
    for (const j of URUTAN_PERIKSA) expect(BAGIAN_JENIS[j]).toBeTruthy();
  });

  it("tahap 'sudah tayang' = Tayang dan sesudahnya, tanpa jalur keluar", () => {
    expect(TAHAP_SUDAH_TAYANG).toEqual(["TAYANG", "ANGKA_MASUK", "DIBAYAR", "SELESAI"]);
  });

  it("tautan kolaborasi dengan tab", () => {
    expect(tautanKolaborasi("k1")).toBe("/backoffice/kreatif/kolaborasi/k1");
    expect(tautanKolaborasi("k1", "konten")).toBe("/backoffice/kreatif/kolaborasi/k1?tab=konten");
  });
});
