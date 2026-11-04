import { describe, expect, it } from "vitest";
import {
  adaSebelumnya,
  catatPerpindahan,
  jenisDariHitungan,
  popSudahTercatat,
  RIWAYAT_KOSONG,
  type JenisPerpindahan,
  type Riwayat,
} from "./riwayat";

const jalan = (langkah: Array<[string, JenisPerpindahan]>): Riwayat =>
  langkah.reduce((r, [alamat, jenis]) => catatPerpindahan(r, alamat, jenis), RIWAYAT_KOSONG);

describe("catatPerpindahan / adaSebelumnya", () => {
  it("Lainnya → Insentif: kembali dari Insentif menuju Lainnya, bukan beranda", () => {
    const r = jalan([
      ["/pwa", "dorong"],
      ["/pwa/lainnya", "dorong"],
      ["/pwa/insentif", "dorong"],
    ]);
    expect(r.tumpukan).toEqual(["/pwa", "/pwa/lainnya", "/pwa/insentif"]);
    expect(adaSebelumnya(r)).toBe(true);
  });

  it("tetap bekerja setelah ratusan perpindahan (riwayat browser dibatasi 50, tumpukan ini juga)", () => {
    const langkah: Array<[string, JenisPerpindahan]> = Array.from({ length: 300 }, (_, i) => [`/pwa/x${i}`, "dorong"]);
    const r = jalan([...langkah, ["/pwa/lainnya", "dorong"], ["/pwa/insentif", "dorong"]]);
    expect(r.tumpukan).toHaveLength(50);
    expect(r.tumpukan.slice(-2)).toEqual(["/pwa/lainnya", "/pwa/insentif"]);
    expect(adaSebelumnya(r)).toBe(true);
  });

  it("dibuka langsung (mis. dari notifikasi): tidak ada halaman sebelumnya → pakai cadangan", () => {
    expect(adaSebelumnya(jalan([["/pwa/jadwal?tanggal=2026-10-05", "dorong"]]))).toBe(false);
  });

  it("mundur mengurangi tumpukan", () => {
    const r = jalan([
      ["/pwa", "dorong"],
      ["/pwa/lainnya", "dorong"],
      ["/pwa/insentif", "dorong"],
      ["/pwa/lainnya", "pop"],
    ]);
    expect(r.tumpukan).toEqual(["/pwa", "/pwa/lainnya"]);
  });

  it("router.replace mengganti puncak, tidak menambah halaman yang bisa dituju", () => {
    const r = jalan([
      ["/pwa/stores/t1/catalog?ganti=o1", "dorong"],
      ["/pwa/orders/o2", "ganti"],
    ]);
    expect(r.tumpukan).toEqual(["/pwa/orders/o2"]);
    expect(adaSebelumnya(r)).toBe(false);
  });

  it("pop ke halaman yang tidak tercatat (maju lagi, atau mundur jauh) memulai ulang tumpukan", () => {
    const r = jalan([
      ["/pwa", "dorong"],
      ["/pwa/lainnya", "dorong"],
      ["/pwa/kabar", "pop"],
    ]);
    expect(r.tumpukan).toEqual(["/pwa/kabar"]);
    expect(adaSebelumnya(r)).toBe(false);
  });

  it("memuat ulang halaman yang sama tidak menambah entri", () => {
    expect(
      jalan([
        ["/pwa", "dorong"],
        ["/pwa", "dorong"],
      ]).tumpukan,
    ).toEqual(["/pwa"]);
  });
});

describe("jenisDariHitungan / popSudahTercatat — urutan peristiwa tidak bisa diandalkan", () => {
  const tumpukan: Riwayat = { tumpukan: ["/pwa", "/pwa/lainnya", "/pwa/insentif"] };

  it("push yang terhitung = dorong; popstate yang terhitung = pop", () => {
    expect(jenisDariHitungan({ dorong: 1, pop: 0 }, tumpukan, "/pwa/target")).toBe("dorong");
    expect(jenisDariHitungan({ dorong: 0, pop: 1 }, tumpukan, "/pwa/lainnya")).toBe("pop");
  });

  it("Chrome: halaman sudah digambar sebelum popstate tiba — ke halaman di bawah puncak tetap terbaca mundur", () => {
    expect(jenisDariHitungan({ dorong: 0, pop: 0 }, tumpukan, "/pwa/lainnya")).toBe("pop");
  });

  it("tanpa push ke halaman lain = ganti (router.replace)", () => {
    expect(jenisDariHitungan({ dorong: 0, pop: 0 }, tumpukan, "/pwa/orders/o2")).toBe("ganti");
  });

  it("popstate yang terlambat untuk halaman yang sudah tercatat diabaikan, jadi tidak membuat langkah berikutnya terbaca mundur", () => {
    // Insentif → Kembali: tercatat lebih dulu (tanpa hitungan), lalu popstate tiba.
    const sesudahMundur = catatPerpindahan(tumpukan, "/pwa/lainnya", jenisDariHitungan({ dorong: 0, pop: 0 }, tumpukan, "/pwa/lainnya"));
    expect(sesudahMundur.tumpukan).toEqual(["/pwa", "/pwa/lainnya"]);
    expect(popSudahTercatat(sesudahMundur, "/pwa/lainnya")).toBe(true);
    // Langkah berikutnya: Lainnya → Peringkat tetap dorong, bukan pop yang tersisa.
    const lanjut = catatPerpindahan(sesudahMundur, "/pwa/peringkat", jenisDariHitungan({ dorong: 1, pop: 0 }, sesudahMundur, "/pwa/peringkat"));
    expect(lanjut.tumpukan).toEqual(["/pwa", "/pwa/lainnya", "/pwa/peringkat"]);
    expect(adaSebelumnya(lanjut)).toBe(true);
  });

  it("popstate yang tiba lebih dulu (halaman belum tercatat) dihitung", () => {
    expect(popSudahTercatat(tumpukan, "/pwa/lainnya")).toBe(false);
  });
});
