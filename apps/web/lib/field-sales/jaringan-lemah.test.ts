import { afterEach, describe, expect, it, vi } from "vitest";
import { BatasWaktuKirim, denganBatasWaktu, galatJaringan } from "./jaringan-lemah";

describe("galatJaringan", () => {
  it("fetch yang putus (TypeError) dan batas waktu = jaringan", () => {
    expect(galatJaringan(new TypeError("Failed to fetch"), true)).toBe(true);
    expect(galatJaringan(new TypeError("Load failed"), true)).toBe(true);
    expect(galatJaringan(new BatasWaktuKirim(), true)).toBe(true);
  });

  it("pesan jaringan tanpa digest = jaringan", () => {
    expect(galatJaringan(new Error("NetworkError when attempting to fetch resource."), true)).toBe(true);
  });

  it("galat yang dilempar SERVER bukan jaringan — tidak boleh diantrekan", () => {
    const dariServer = Object.assign(new Error("An error occurred in the Server Components render."), { digest: "123" });
    expect(galatJaringan(dariServer, true)).toBe(false);
    expect(galatJaringan(new Error("Unique constraint failed"), true)).toBe(false);
    expect(galatJaringan("bukan galat", true)).toBe(false);
  });

  it("HP offline saat galat terjadi = jaringan", () => {
    expect(galatJaringan(new Error("apa saja"), false)).toBe(true);
  });
});

describe("denganBatasWaktu", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("meneruskan hasil yang datang tepat waktu", async () => {
    await expect(denganBatasWaktu(Promise.resolve(7), 1000)).resolves.toBe(7);
  });

  it("meneruskan penolakan aslinya", async () => {
    const e = new TypeError("Failed to fetch");
    await expect(denganBatasWaktu(Promise.reject(e), 1000)).rejects.toBe(e);
  });

  it("menolak dengan BatasWaktuKirim kalau terlalu lama", async () => {
    vi.useFakeTimers();
    const lambat = new Promise<number>(() => {});
    const hasil = denganBatasWaktu(lambat, 1000);
    vi.advanceTimersByTime(1000);
    await expect(hasil).rejects.toBeInstanceOf(BatasWaktuKirim);
  });
});
