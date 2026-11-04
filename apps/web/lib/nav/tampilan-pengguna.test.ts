import { describe, expect, it } from "vitest";
import { BAHASA, keadaanTema } from "./tampilan-pengguna";

/*
 * Menu pengguna di kepala kantor. Dulu pilihan tema "System" yang tampak terang
 * memberi centang pada "Light" DAN "System" sekaligus.
 */
describe("keadaanTema", () => {
  it("tema perangkat yang tampak terang: hanya 'ikuti perangkat' yang terpilih", () => {
    expect(keadaanTema("system", "light")).toEqual({ terpilih: "system", perangkat: "light" });
  });

  it("pilihan tersimpan terang/gelap terpilih apa adanya", () => {
    expect(keadaanTema("light", "light")).toEqual({ terpilih: "light", perangkat: "light" });
    expect(keadaanTema("dark", "dark")).toEqual({ terpilih: "dark", perangkat: "dark" });
  });

  it("'(sekarang …)' menyebut tema PERANGKAT, bukan yang sedang tampak: Gelap tersimpan di perangkat terang", () => {
    expect(keadaanTema("dark", "light")).toEqual({ terpilih: "dark", perangkat: "light" });
  });

  it("belum ada pilihan tersimpan = ikuti perangkat; tema perangkat yang belum diketahui = null", () => {
    expect(keadaanTema(undefined, undefined)).toEqual({ terpilih: "system", perangkat: null });
    expect(keadaanTema("aneh", "lain")).toEqual({ terpilih: "system", perangkat: null });
  });
});

describe("BAHASA", () => {
  it("nama bahasa lengkap, ditulis dalam bahasanya sendiri", () => {
    expect(BAHASA).toEqual([
      { kode: "id", nama: "Bahasa Indonesia" },
      { kode: "en", nama: "English" },
    ]);
  });
});
