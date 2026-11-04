import { describe, expect, it, vi } from "vitest";
import {
  DURASI,
  aturLuring,
  gagalProses,
  kabarNotifikasi,
  kedaluwarsaBerikutnya,
  keadaanAwal,
  mulaiProses,
  perbaruiProses,
  rapikan,
  selesaiProses,
  tambahPesan,
  tampilan,
  tutupNotifikasi,
  tutupPesan,
  tutupTampilan,
  type KeadaanPulau,
} from "./keadaan";

const T0 = 1_000_000;

/** Jenis butir utama yang tampil, atau null bila kapsul diam. */
function utama(k: KeadaanPulau) {
  return tampilan(k)?.utama ?? null;
}

describe("pulau status — keadaan murni", () => {
  it("keadaan awal diam: tidak ada kapsul", () => {
    expect(tampilan(keadaanAwal())).toBeNull();
    expect(kedaluwarsaBerikutnya(keadaanAwal())).toBeNull();
  });

  it("pesan sukses tampil lalu hilang sendiri ±2,5 detik", () => {
    const k = tambahPesan(keadaanAwal(), { jenis: "sukses", teks: "Tersimpan" }, T0);
    expect(utama(k)).toMatchObject({ jenis: "sukses", teks: "Tersimpan", tambahan: 0, peran: "status" });
    expect(DURASI.sukses).toBe(2500);
    expect(kedaluwarsaBerikutnya(k)).toBe(T0 + 2500);
    expect(utama(rapikan(k, T0 + 2499))?.teks).toBe("Tersimpan");
    expect(tampilan(rapikan(k, T0 + 2500))).toBeNull();
  });

  it("galat bertahan ±8 detik dan diumumkan sebagai alert", () => {
    const k = tambahPesan(keadaanAwal(), { jenis: "galat", teks: "Gagal menyimpan" }, T0);
    expect(utama(k)).toMatchObject({ jenis: "galat", peran: "alert", bisaDitutup: true });
    expect(utama(rapikan(k, T0 + 7999))?.teks).toBe("Gagal menyimpan");
    expect(tampilan(rapikan(k, T0 + 8000))).toBeNull();
  });

  it("durasi null bertahan sampai ditutup; durasi sendiri dihormati", () => {
    let k = tambahPesan(keadaanAwal(), { id: "a", jenis: "info", teks: "Tetap", durasiMs: null }, T0);
    k = tambahPesan(k, { id: "b", jenis: "sukses", teks: "Sebentar", durasiMs: 1500 }, T0);
    expect(kedaluwarsaBerikutnya(k)).toBe(T0 + 1500);
    k = rapikan(k, T0 + 10 * 60_000);
    expect(utama(k)?.teks).toBe("Tetap");
    expect(kedaluwarsaBerikutnya(k)).toBeNull();
    k = tutupPesan(k, "a");
    expect(tampilan(k)).toBeNull();
  });

  it("pesan dengan id yang sama MEMPERBARUI: Menyimpan… → Tersimpan, satu kapsul, waktunya diulang", () => {
    let k = tambahPesan(keadaanAwal(), { id: "simpan", jenis: "memuat", teks: "Menyimpan…" }, T0);
    expect(utama(k)).toMatchObject({ jenis: "memuat", teks: "Menyimpan…" });
    k = tambahPesan(k, { id: "simpan", jenis: "sukses", teks: "Tersimpan" }, T0 + 5000);
    expect(k.pesan).toHaveLength(1);
    expect(utama(k)).toMatchObject({ jenis: "sukses", teks: "Tersimpan", tambahan: 0 });
    expect(kedaluwarsaBerikutnya(k)).toBe(T0 + 5000 + DURASI.sukses);
  });

  it("pesan yang diperbarui menjadi yang terbaru, bukan tetap di tempat lamanya", () => {
    let k = tambahPesan(keadaanAwal(), { id: "a", jenis: "info", teks: "A" }, T0);
    k = tambahPesan(k, { id: "b", jenis: "info", teks: "B" }, T0);
    expect(utama(k)?.teks).toBe("B");
    k = tambahPesan(k, { id: "a", jenis: "info", teks: "A2" }, T0);
    expect(utama(k)).toMatchObject({ teks: "A2", tambahan: 1 });
  });

  it("pesan berantre: yang terbaru tampil, sisanya jadi +N, lalu muncul bergantian saat yang baru hilang", () => {
    let k = tambahPesan(keadaanAwal(), { jenis: "info", teks: "satu", durasiMs: 9000 }, T0);
    k = tambahPesan(k, { jenis: "info", teks: "dua", durasiMs: 9000 }, T0);
    k = tambahPesan(k, { jenis: "sukses", teks: "tiga" }, T0);
    expect(utama(k)).toMatchObject({ teks: "tiga", tambahan: 2 });
    k = rapikan(k, T0 + DURASI.sukses);
    expect(utama(k)).toMatchObject({ teks: "dua", tambahan: 1 });
  });

  it("memuat tanpa durasi tidak tertahan selamanya", () => {
    const k = tambahPesan(keadaanAwal(), { jenis: "memuat", teks: "Menyimpan…" }, T0);
    expect(kedaluwarsaBerikutnya(k)).toBe(T0 + DURASI.memuat);
    expect(DURASI.memuat).toBeGreaterThanOrEqual(30_000);
  });

  it("pesan dengan tombol aksi bertahan cukup lama untuk diketuk", () => {
    const jalankan = vi.fn();
    const k = tambahPesan(keadaanAwal(), { jenis: "sukses", teks: "Dihapus", aksi: { label: "Urungkan", jalankan } }, T0);
    expect(kedaluwarsaBerikutnya(k)).toBe(T0 + DURASI.denganAksi);
    expect(DURASI.denganAksi).toBeGreaterThan(DURASI.sukses);
    utama(k)?.aksi?.jalankan("klik");
    expect(jalankan).toHaveBeenCalledWith("klik");
  });

  it("urutan prioritas: galat > proses > luring/mengirim > notifikasi > pesan > tertunda > diam", () => {
    const kirimUlang = vi.fn();
    let k = keadaanAwal();
    k = aturLuring(k, { luring: false, belumTerkirim: 2, mengirim: false, kirimUlang }, T0);
    expect(utama(k)?.jenis).toBe("tertunda");
    k = tambahPesan(k, { id: "p", jenis: "sukses", teks: "ok", durasiMs: null }, T0);
    expect(utama(k)?.jenis).toBe("sukses");
    expect(tampilan(k)?.kedua?.jenis).toBe("tertunda");
    k = kabarNotifikasi(k, { judul: "BKM/2026/0007", tautan: "/x" }, T0);
    expect(utama(k)?.jenis).toBe("notifikasi");
    expect(tampilan(k)?.kedua?.jenis).toBe("sukses");
    k = aturLuring(k, { luring: true, belumTerkirim: 3, mengirim: false }, T0);
    expect(utama(k)).toMatchObject({ jenis: "luring", jumlah: 3 });
    expect(tampilan(k)?.kedua?.jenis).toBe("notifikasi");
    k = mulaiProses(k, "impor", "Mengimpor");
    expect(utama(k)?.jenis).toBe("proses");
    expect(tampilan(k)?.kedua?.jenis).toBe("luring");
    k = tambahPesan(k, { id: "g", jenis: "galat", teks: "rusak", durasiMs: null }, T0);
    expect(utama(k)?.jenis).toBe("galat");
    expect(tampilan(k)?.kedua?.jenis).toBe("proses");

    // Dilepas dari atas: setiap tingkat muncul kembali sesuai urutannya.
    k = tutupPesan(k, "g");
    expect(utama(k)?.jenis).toBe("proses");
    k = selesaiProses(k, "impor", undefined, T0);
    expect(utama(k)?.jenis).toBe("luring");
    k = aturLuring(k, { luring: false, belumTerkirim: 0, mengirim: false }, T0);
    expect(utama(k)?.jenis).toBe("notifikasi");
    k = tutupNotifikasi(k);
    expect(utama(k)?.jenis).toBe("sukses");
    expect(tampilan(k)?.kedua).toBeNull();
    k = tutupPesan(k, "p");
    expect(tampilan(k)).toBeNull();
  });

  it("galat paling atas walau ada pesan sukses yang lebih baru", () => {
    let k = tambahPesan(keadaanAwal(), { jenis: "galat", teks: "gagal" }, T0);
    k = tambahPesan(k, { jenis: "sukses", teks: "berhasil" }, T0 + 10);
    expect(utama(k)).toMatchObject({ jenis: "galat", teks: "gagal", tambahan: 0 });
    expect(tampilan(k)?.kedua).toMatchObject({ jenis: "sukses", teks: "berhasil" });
  });

  it("proses: mulai tanpa persen, persen diperbarui dan dibatasi 0–100, selesai menjadi pesan sukses", () => {
    let k = mulaiProses(keadaanAwal(), "resync", "Resync settlement");
    expect(utama(k)).toMatchObject({ jenis: "proses", teks: "Resync settlement", persen: null, bisaDitutup: false });
    k = perbaruiProses(k, "resync", 41.6);
    expect(utama(k)?.persen).toBe(42);
    k = perbaruiProses(k, "resync", 140, "Hampir selesai");
    expect(utama(k)).toMatchObject({ persen: 100, teks: "Hampir selesai" });
    k = perbaruiProses(k, "resync", -5);
    expect(utama(k)?.persen).toBe(0);
    // Mulai lagi dengan id yang sama tidak menghapus persennya.
    k = mulaiProses(k, "resync", "Resync settlement");
    expect(utama(k)?.persen).toBe(0);
    expect(k.proses).toHaveLength(1);
    k = selesaiProses(k, "resync", "Resync selesai", T0);
    expect(k.proses).toHaveLength(0);
    expect(utama(k)).toMatchObject({ jenis: "sukses", teks: "Resync selesai" });
  });

  it("proses yang tidak dikenal: perbarui tanpa label tidak membuat apa-apa, dengan label membuatnya", () => {
    expect(perbaruiProses(keadaanAwal(), "x", 50).proses).toHaveLength(0);
    expect(utama(perbaruiProses(keadaanAwal(), "x", 50, "Label"))).toMatchObject({ persen: 50, teks: "Label" });
  });

  it("proses selesai tanpa teks hilang diam-diam; gagal menjadi galat", () => {
    let k = mulaiProses(keadaanAwal(), "a", "A");
    expect(tampilan(selesaiProses(k, "a", undefined, T0))).toBeNull();
    k = gagalProses(k, "a", "Impor gagal", T0);
    expect(k.proses).toHaveLength(0);
    expect(utama(k)).toMatchObject({ jenis: "galat", teks: "Impor gagal" });
  });

  it("beberapa proses: yang terbaru tampil dengan +N", () => {
    let k = mulaiProses(keadaanAwal(), "a", "A");
    k = mulaiProses(k, "b", "B");
    expect(utama(k)).toMatchObject({ teks: "B", tambahan: 1 });
  });

  it("luring: tanpa sinyal → mengirim → terkirim sebentar → diam", () => {
    let k = aturLuring(keadaanAwal(), { luring: true, belumTerkirim: 3, mengirim: false, tautan: "/pwa/orders/pending" }, T0);
    expect(utama(k)).toMatchObject({ jenis: "luring", jumlah: 3, tautan: "/pwa/orders/pending", bisaDitutup: false });
    k = aturLuring(k, { luring: false, belumTerkirim: 3, mengirim: true }, T0 + 1000);
    expect(utama(k)).toMatchObject({ jenis: "mengirim", jumlah: 3 });
    k = aturLuring(k, { luring: false, belumTerkirim: 0, mengirim: false }, T0 + 2000);
    expect(utama(k)).toMatchObject({ jenis: "terkirim" });
    expect(kedaluwarsaBerikutnya(k)).toBe(T0 + 2000 + DURASI.terkirim);
    expect(tampilan(rapikan(k, T0 + 2000 + DURASI.terkirim))).toBeNull();
  });

  it("luring tanpa antrean tetap tampil; daring tanpa antrean tidak tampil", () => {
    expect(utama(aturLuring(keadaanAwal(), { luring: true, belumTerkirim: 0, mengirim: false }, T0))).toMatchObject({
      jenis: "luring",
      jumlah: 0,
      tautan: null,
    });
    expect(tampilan(aturLuring(keadaanAwal(), { luring: false, belumTerkirim: 0, mengirim: false }, T0))).toBeNull();
  });

  it("pengiriman yang berhenti dengan sisa menampilkan sisanya sebentar", () => {
    let k = aturLuring(keadaanAwal(), { luring: false, belumTerkirim: 3, mengirim: true }, T0);
    k = aturLuring(k, { luring: false, belumTerkirim: 1, mengirim: false }, T0);
    expect(utama(k)).toMatchObject({ jenis: "sisa", jumlah: 1 });
    expect(kedaluwarsaBerikutnya(k)).toBe(T0 + DURASI.sisa);
  });

  it("putus lagi menghapus kilasan 'terkirim'", () => {
    let k = aturLuring(keadaanAwal(), { luring: false, belumTerkirim: 1, mengirim: true }, T0);
    k = aturLuring(k, { luring: false, belumTerkirim: 0, mengirim: false }, T0);
    k = aturLuring(k, { luring: true, belumTerkirim: 0, mengirim: false }, T0 + 100);
    expect(k.luring.selesai).toBeNull();
    expect(utama(k)?.jenis).toBe("luring");
  });

  it("laporan luring yang sama persis tidak membuat keadaan baru (pemantau melapor tiap beberapa detik)", () => {
    const kirimUlang = () => undefined;
    const k = aturLuring(keadaanAwal(), { luring: false, belumTerkirim: 2, mengirim: false, kirimUlang }, T0);
    expect(aturLuring(k, { luring: false, belumTerkirim: 2, mengirim: false, kirimUlang }, T0 + 5000)).toBe(k);
    expect(aturLuring(k, { luring: false, belumTerkirim: 3, mengirim: false, kirimUlang }, T0 + 5000)).not.toBe(k);
  });

  it("antrean tertunda saat daring hanya tampil bila ada kirim ulang, dan mengetuknya menjalankannya", () => {
    expect(tampilan(aturLuring(keadaanAwal(), { luring: false, belumTerkirim: 2, mengirim: false }, T0))).toBeNull();
    const kirimUlang = vi.fn();
    const k = aturLuring(keadaanAwal(), { luring: false, belumTerkirim: 2, mengirim: false, kirimUlang }, T0);
    expect(utama(k)).toMatchObject({ jenis: "tertunda", jumlah: 2 });
    utama(k)?.diketuk?.();
    expect(kirimUlang).toHaveBeenCalledOnce();
  });

  it("notifikasi: bisa diketuk, jumlahnya bertambah selama masih tampil, lalu hilang sendiri", () => {
    const diketuk = vi.fn();
    let k = kabarNotifikasi(keadaanAwal(), { judul: "BKM/2026/0007", tautan: "/bkm/1" }, T0);
    expect(utama(k)).toMatchObject({ jenis: "notifikasi", teks: "BKM/2026/0007", jumlah: 1, tautan: "/bkm/1" });
    k = kabarNotifikasi(k, { judul: "NRT-12", jumlah: 2, diketuk }, T0 + 1000);
    expect(utama(k)).toMatchObject({ teks: "NRT-12", jumlah: 3, tautan: null });
    utama(k)?.diketuk?.();
    expect(diketuk).toHaveBeenCalledOnce();
    expect(kedaluwarsaBerikutnya(k)).toBe(T0 + 1000 + DURASI.notifikasi);
    expect(tampilan(rapikan(k, T0 + 1000 + DURASI.notifikasi))).toBeNull();
    // Sesudah hilang, hitungan mulai dari awal lagi.
    k = kabarNotifikasi(rapikan(k, T0 + 1000 + DURASI.notifikasi), { judul: "baru" }, T0 + 20_000);
    expect(utama(k)?.jumlah).toBe(1);
  });

  it("notifikasi yang terkumpul menjadi lebih dari satu membawa ke daftarnya, bukan ke notifikasi terakhir saja", () => {
    const bukaSatu = vi.fn();
    const bukaDaftar = vi.fn();
    const semua = { tautan: "/semua", diketuk: bukaDaftar };
    // Satu notifikasi: ketukan membuka notifikasi itu.
    let k = kabarNotifikasi(keadaanAwal(), { judul: "A", tautan: "/a", semua }, T0);
    expect(utama(k)).toMatchObject({ jumlah: 1, tautan: "/a" });
    expect(utama(k)?.diketuk).toBeUndefined();
    // Notifikasi kedua masuk selagi yang pertama masih tampil: kapsul menyebut 2,
    // jadi ketukannya harus membuka daftar — bukan hanya notifikasi "B".
    k = kabarNotifikasi(k, { judul: "B", diketuk: bukaSatu, semua }, T0 + 1000);
    expect(utama(k)).toMatchObject({ teks: "B", jumlah: 2, tautan: "/semua" });
    utama(k)?.diketuk?.();
    expect(bukaDaftar).toHaveBeenCalledOnce();
    expect(bukaSatu).not.toHaveBeenCalled();
    // Satu kabar berisi dua notifikasi sekaligus juga membuka daftar.
    k = kabarNotifikasi(keadaanAwal(), { judul: "C", jumlah: 2, diketuk: bukaSatu, semua }, T0);
    expect(utama(k)).toMatchObject({ jumlah: 2, tautan: "/semua" });
  });

  it("menutup lewat ketukan: pesan, notifikasi, dan kilasan terkirim bisa ditutup; proses dan luring tidak", () => {
    let k = tambahPesan(keadaanAwal(), { id: "x", jenis: "galat", teks: "gagal" }, T0);
    const butir = utama(k)!;
    k = tutupTampilan(k, butir);
    expect(tampilan(k)).toBeNull();

    k = kabarNotifikasi(keadaanAwal(), { judul: "n" }, T0);
    expect(tampilan(tutupTampilan(k, utama(k)!))).toBeNull();

    k = aturLuring(keadaanAwal(), { luring: false, belumTerkirim: 1, mengirim: true }, T0);
    k = aturLuring(k, { luring: false, belumTerkirim: 0, mengirim: false }, T0);
    expect(tampilan(tutupTampilan(k, utama(k)!))).toBeNull();

    k = mulaiProses(keadaanAwal(), "a", "A");
    expect(utama(tutupTampilan(k, utama(k)!))?.jenis).toBe("proses");
    k = aturLuring(keadaanAwal(), { luring: true, belumTerkirim: 0, mengirim: false }, T0);
    expect(utama(tutupTampilan(k, utama(k)!))?.jenis).toBe("luring");
  });

  it("kunci butir stabil per sumber, supaya animasi tahu kapan isinya berganti", () => {
    let k = tambahPesan(keadaanAwal(), { id: "a", jenis: "memuat", teks: "…" }, T0);
    const sebelum = utama(k)!.kunci;
    k = tambahPesan(k, { id: "a", jenis: "sukses", teks: "ok" }, T0);
    expect(utama(k)!.kunci).toBe(sebelum);
    k = tambahPesan(k, { id: "b", jenis: "sukses", teks: "lain" }, T0);
    expect(utama(k)!.kunci).not.toBe(sebelum);
  });

  it("tidak mengubah keadaan lama (immutable)", () => {
    const awal = keadaanAwal();
    const k = tambahPesan(awal, { jenis: "info", teks: "x" }, T0);
    expect(awal.pesan).toHaveLength(0);
    expect(k).not.toBe(awal);
    const sama = rapikan(k, T0);
    expect(sama).toBe(k);
  });
});
