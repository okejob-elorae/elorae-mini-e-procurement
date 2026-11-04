import { describe, expect, it } from "vitest";
import { cariKembar, kelompokKembar, normalisasiHandle, type CalonKembar } from "./kembar";

describe("normalisasiHandle", () => {
  it("membuang @, huruf besar, dan tautan profil", () => {
    expect(normalisasiHandle("@Rina.Style")).toBe("rina.style");
    expect(normalisasiHandle("https://www.instagram.com/rina.style/?hl=id")).toBe("rina.style");
    expect(normalisasiHandle("instagram.com/rina.style")).toBe("rina.style");
    expect(normalisasiHandle("https://www.tiktok.com/@rina.style?lang=id")).toBe("rina.style");
    expect(normalisasiHandle("https://www.tiktok.com/@rina.style/video/7300000000000000000")).toBe("rina.style");
    expect(normalisasiHandle("https://www.youtube.com/@RinaStyle")).toBe("rinastyle");
    expect(normalisasiHandle("https://www.youtube.com/channel/UCabc123")).toBe("ucabc123");
    expect(normalisasiHandle("https://shopee.co.id/rinastyle")).toBe("rinastyle");
    expect(normalisasiHandle("  rina_style  ")).toBe("rina_style");
  });

  it("kosong = null", () => {
    expect(normalisasiHandle("")).toBeNull();
    expect(normalisasiHandle("  @ ")).toBeNull();
    expect(normalisasiHandle(null)).toBeNull();
    expect(normalisasiHandle("https://www.instagram.com/")).toBeNull();
  });
});

const daftar: CalonKembar[] = [
  { id: "a", nama: "Rina", waNormal: "6281234567890", handles: ["rina.style"] },
  { id: "b", nama: "Rina 2", waNormal: null, handles: ["@Rina.Style"] },
  { id: "c", nama: "Dewi", waNormal: "6281234567890", handles: ["dewi"] },
  { id: "d", nama: "Sari", waNormal: "6289999999999", handles: ["sari"] },
];

describe("cariKembar", () => {
  it("menemukan kembar lewat nomor WA dan lewat handle lintas platform", () => {
    expect(cariKembar({ waNormal: "0812-3456-7890", handles: ["https://tiktok.com/@rina.style"] }, daftar)).toEqual([
      { id: "a", nama: "Rina", sebab: ["WA", "HANDLE"] },
      { id: "b", nama: "Rina 2", sebab: ["HANDLE"] },
      { id: "c", nama: "Dewi", sebab: ["WA"] },
    ]);
  });

  it("melewati dirinya sendiri saat mengubah KOL", () => {
    expect(cariKembar({ waNormal: "6289999999999", handles: [] }, daftar, "d")).toEqual([]);
  });

  it("tanpa nomor dan tanpa handle tidak pernah kembar", () => {
    expect(cariKembar({ waNormal: null, handles: ["", "@"] }, daftar)).toEqual([]);
  });
});

describe("kelompokKembar", () => {
  it("menggabungkan rantai kembar jadi satu kelompok", () => {
    // a–b kembar lewat handle, a–c lewat WA: satu kelompok a, b, c.
    expect(kelompokKembar(daftar)).toEqual([{ ids: ["a", "b", "c"], sebab: ["HANDLE", "WA"] }]);
  });

  it("tidak ada kelompok bila semua unik", () => {
    expect(kelompokKembar([daftar[3]])).toEqual([]);
  });
});
