import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ambilKeadaan,
  gagalProses,
  kabarNotifikasi,
  langgan,
  mulaiProses,
  perbaruiProses,
  selesaiProses,
  setLuring,
  tampilkanPesan,
  tutupButir,
  tutupPesan,
  _aturUlangPulau,
} from "./pulau";
import { DURASI, tampilan } from "./keadaan";

const utama = () => tampilan(ambilKeadaan())?.utama ?? null;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-07T03:00:00Z"));
  _aturUlangPulau();
});

afterEach(() => {
  _aturUlangPulau();
  vi.useRealTimers();
});

describe("pemancar pulau status", () => {
  it("memberi tahu pelanggan saat pesan masuk dan saat pesan hilang sendiri", () => {
    const pendengar = vi.fn();
    const lepas = langgan(pendengar);
    const id = tampilkanPesan({ jenis: "sukses", teks: "Tersimpan" });
    expect(typeof id).toBe("string");
    expect(pendengar).toHaveBeenCalledTimes(1);
    expect(utama()?.teks).toBe("Tersimpan");

    vi.advanceTimersByTime(DURASI.sukses - 1);
    expect(utama()?.teks).toBe("Tersimpan");
    vi.advanceTimersByTime(1);
    expect(utama()).toBeNull();
    expect(pendengar).toHaveBeenCalledTimes(2);

    lepas();
    tampilkanPesan({ jenis: "info", teks: "lagi" });
    expect(pendengar).toHaveBeenCalledTimes(2);
  });

  it("snapshot hanya berganti bila keadaannya berubah (aman untuk useSyncExternalStore)", () => {
    const a = ambilKeadaan();
    expect(ambilKeadaan()).toBe(a);
    tutupPesan("tidak-ada");
    expect(ambilKeadaan()).toBe(a);
    tampilkanPesan({ jenis: "info", teks: "x" });
    expect(ambilKeadaan()).not.toBe(a);
  });

  it("galat bertahan ±8 detik", () => {
    tampilkanPesan({ jenis: "galat", teks: "Gagal" });
    vi.advanceTimersByTime(7999);
    expect(utama()?.jenis).toBe("galat");
    vi.advanceTimersByTime(1);
    expect(utama()).toBeNull();
  });

  it("id sama memperbarui dan mengulang waktunya", () => {
    tampilkanPesan({ id: "s", jenis: "memuat", teks: "Menyimpan…" });
    vi.advanceTimersByTime(10_000);
    tampilkanPesan({ id: "s", jenis: "sukses", teks: "Tersimpan" });
    expect(ambilKeadaan().pesan).toHaveLength(1);
    vi.advanceTimersByTime(DURASI.sukses - 1);
    expect(utama()?.teks).toBe("Tersimpan");
    vi.advanceTimersByTime(1);
    expect(utama()).toBeNull();
  });

  it("antrean pesan: yang lebih awal kedaluwarsa tidak menghapus yang lebih baru", () => {
    tampilkanPesan({ jenis: "sukses", teks: "a" });
    vi.advanceTimersByTime(1000);
    tampilkanPesan({ jenis: "galat", teks: "b" });
    vi.advanceTimersByTime(DURASI.sukses - 1000);
    expect(utama()).toMatchObject({ teks: "b", tambahan: 0 });
    expect(tampilan(ambilKeadaan())?.kedua).toBeNull();
    vi.advanceTimersByTime(DURASI.galat);
    expect(utama()).toBeNull();
  });

  it("proses dengan persen nyata, lalu selesai", () => {
    mulaiProses("impor", "Mengimpor");
    perbaruiProses("impor", 33.3);
    expect(utama()).toMatchObject({ jenis: "proses", persen: 33 });
    vi.advanceTimersByTime(60 * 60_000);
    expect(utama()?.jenis).toBe("proses");
    selesaiProses("impor", "Impor selesai");
    expect(utama()).toMatchObject({ jenis: "sukses", teks: "Impor selesai" });
    vi.advanceTimersByTime(DURASI.sukses);
    expect(utama()).toBeNull();
  });

  it("proses gagal menjadi galat", () => {
    mulaiProses("x", "X");
    gagalProses("x", "Gagal");
    expect(utama()).toMatchObject({ jenis: "galat", teks: "Gagal" });
  });

  it("luring → mengirim → terkirim sebentar", () => {
    setLuring({ luring: true, belumTerkirim: 3, mengirim: false });
    expect(utama()).toMatchObject({ jenis: "luring", jumlah: 3 });
    setLuring({ luring: false, belumTerkirim: 3, mengirim: true });
    expect(utama()?.jenis).toBe("mengirim");
    setLuring({ luring: false, belumTerkirim: 0, mengirim: false });
    expect(utama()?.jenis).toBe("terkirim");
    vi.advanceTimersByTime(DURASI.terkirim);
    expect(utama()).toBeNull();
  });

  it("notifikasi baru hilang sendiri", () => {
    kabarNotifikasi({ judul: "BKM/2026/0007", tautan: "/backoffice/pelunasan/1" });
    expect(utama()).toMatchObject({ jenis: "notifikasi", jumlah: 1 });
    vi.advanceTimersByTime(DURASI.notifikasi);
    expect(utama()).toBeNull();
  });

  it("menutup butir yang tampil lewat ketukan", () => {
    tampilkanPesan({ jenis: "galat", teks: "x" });
    tutupButir(utama()!);
    expect(utama()).toBeNull();
  });

  it("aturan ulang membersihkan pengatur waktu", () => {
    const pendengar = vi.fn();
    langgan(pendengar);
    tampilkanPesan({ jenis: "sukses", teks: "x" });
    _aturUlangPulau();
    pendengar.mockClear();
    vi.advanceTimersByTime(DURASI.galat);
    expect(pendengar).not.toHaveBeenCalled();
  });
});
