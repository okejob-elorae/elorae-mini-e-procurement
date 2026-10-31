import { describe, expect, it } from "vitest";
import { kabarBaru, type ButirKabar } from "./kabar-baru";

const butir = (id: string, createdAt: string, readAt: string | null = null): ButirKabar => ({ id, createdAt, readAt });

describe("kabar baru untuk pulau status", () => {
  const awal = [butir("b", "2026-10-07T03:00:00.000Z"), butir("a", "2026-10-07T02:00:00.000Z")];

  it("muatan pertama hanya menjadi patokan — notifikasi lama tidak dimunculkan saat halaman dimuat", () => {
    const { baru, penanda } = kabarBaru(null, awal);
    expect(baru).toEqual([]);
    expect(penanda.batasMs).toBe(Date.parse("2026-10-07T03:00:00.000Z"));
  });

  it("yang lebih baru dan belum dibaca dimunculkan, terbaru dulu", () => {
    const { penanda } = kabarBaru(null, awal);
    const d = butir("d", "2026-10-07T03:05:00.000Z");
    const c = butir("c", "2026-10-07T03:01:00.000Z");
    const hasil = kabarBaru(penanda, [d, c, ...awal]);
    expect(hasil.baru.map((x) => x.id)).toEqual(["d", "c"]);
    // Patokan maju: muatan berikutnya tidak memunculkannya lagi.
    expect(kabarBaru(hasil.penanda, [d, c, ...awal]).baru).toEqual([]);
  });

  it("yang sudah dibaca (mis. dari HP lain) tidak dimunculkan", () => {
    const { penanda } = kabarBaru(null, awal);
    expect(kabarBaru(penanda, [butir("e", "2026-10-07T04:00:00.000Z", "2026-10-07T04:00:01.000Z"), ...awal]).baru).toEqual([]);
  });

  it("baris lama yang baru terlihat (mis. halaman pertama bergeser) tidak dimunculkan", () => {
    const { penanda } = kabarBaru(null, awal);
    expect(kabarBaru(penanda, [...awal, butir("z", "2026-10-06T01:00:00.000Z")]).baru).toEqual([]);
  });

  it("id baru dengan waktu yang sama persis dengan patokan tetap dihitung baru", () => {
    const { penanda } = kabarBaru(null, awal);
    expect(kabarBaru(penanda, [butir("kembar", "2026-10-07T03:00:00.000Z"), ...awal]).baru.map((x) => x.id)).toEqual(["kembar"]);
  });

  it("muatan pertama yang kosong tetap menjadi patokan", () => {
    const { penanda } = kabarBaru(null, []);
    expect(kabarBaru(penanda, [butir("x", "2026-10-07T05:00:00.000Z")]).baru.map((x) => x.id)).toEqual(["x"]);
  });

  it("tanggal rusak diabaikan, bukan dianggap baru", () => {
    const { penanda } = kabarBaru(null, awal);
    expect(kabarBaru(penanda, [butir("rusak", "bukan tanggal"), ...awal]).baru).toEqual([]);
  });
});
