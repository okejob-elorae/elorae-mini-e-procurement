import { describe, expect, it } from "vitest";
import { teksButir, type PenerjemahPulau } from "./teks";
import type { ButirTampilan } from "./keadaan";

/** Penerjemah tiruan: "kunci(count)" supaya tes tidak bergantung berkas bahasa. */
const t: PenerjemahPulau = (kunci, nilai) => (nilai?.count !== undefined ? `${kunci}(${nilai.count})` : kunci);

const dasar: Omit<ButirTampilan, "jenis" | "kunci"> = { teks: "", tambahan: 0, bisaDitutup: false, peran: "status" };

describe("teks kapsul pulau", () => {
  it("tanpa sinyal: dengan dan tanpa antrean", () => {
    expect(teksButir({ ...dasar, kunci: "luring", jenis: "luring", jumlah: 3 }, t).judul).toBe("tanpaSinyal · belumTerkirim(3)");
    expect(teksButir({ ...dasar, kunci: "luring", jenis: "luring", jumlah: 0 }, t).judul).toBe("tanpaSinyal");
  });

  it("mengirim, terkirim, sisa, dan antrean tertunda yang bisa dikirim ulang", () => {
    expect(teksButir({ ...dasar, kunci: "luring", jenis: "mengirim", jumlah: 3 }, t).judul).toBe("mengirim");
    expect(teksButir({ ...dasar, kunci: "luring", jenis: "terkirim", jumlah: 0 }, t).judul).toBe("terkirim");
    expect(teksButir({ ...dasar, kunci: "luring", jenis: "sisa", jumlah: 2 }, t).judul).toBe("belumTerkirim(2)");
    const tertunda = teksButir({ ...dasar, kunci: "luring", jenis: "tertunda", jumlah: 2 }, t);
    expect(tertunda).toMatchObject({ judul: "belumTerkirim(2)", tombol: "kirim" });
  });

  it("notifikasi baru membawa judul singkatnya", () => {
    expect(teksButir({ ...dasar, kunci: "notifikasi", jenis: "notifikasi", teks: "BKM/2026/0007", jumlah: 1 }, t).judul).toBe(
      "notifikasiBaru(1) · BKM/2026/0007",
    );
    expect(teksButir({ ...dasar, kunci: "notifikasi", jenis: "notifikasi", teks: "", jumlah: 2 }, t).judul).toBe("notifikasiBaru(2)");
  });

  it("proses: persen tampil, tetapi tidak diumumkan pembaca layar setiap berubah", () => {
    const hasil = teksButir({ ...dasar, kunci: "proses:a", jenis: "proses", teks: "Resync", persen: 42 }, t);
    expect(hasil).toMatchObject({ judul: "Resync", persen: 42, diumumkan: "Resync" });
    expect(teksButir({ ...dasar, kunci: "proses:a", jenis: "proses", teks: "Resync", persen: null }, t).persen).toBeNull();
  });

  it("pesan: teks dan keterangan apa adanya, keduanya diumumkan", () => {
    const hasil = teksButir({ ...dasar, kunci: "pesan:x", jenis: "galat", teks: "Gagal", keterangan: "Coba lagi" }, t);
    expect(hasil).toMatchObject({ judul: "Gagal", keterangan: "Coba lagi", diumumkan: "Gagal. Coba lagi" });
  });

  it("+N tidak ikut diumumkan sebagai angka telanjang", () => {
    const hasil = teksButir({ ...dasar, kunci: "pesan:x", jenis: "sukses", teks: "OK", tambahan: 2 }, t);
    expect(hasil.diumumkan).toBe("OK");
  });
});
