import { describe, expect, it } from "vitest";
import {
  alasanCukup,
  bacaKunciBulan,
  bulanPenahanTutup,
  bulanPertamaBuku,
  bulanSebelum,
  bulanSesudah,
  bulanSudahBerakhir,
  bulanWib,
  deretBulan,
  kunciBulan,
  nilaiDaftarPeriksa,
  rentangBulan,
  tanggalTutupTahun,
  terkunciSebelumBuku,
  type DataPeriksa,
} from "./periode";
import { balikBaris, sumberIdMilikTahun, sumberIdPembalik, sumberIdPenutup, susunJurnalTutupTahun } from "./tutup-tahun-aturan";
import { peringatanTanggalMulai, periksaTanggalMulaiBaru, tanggalMulaiSah } from "./tanggal-mulai-aturan";

describe("kalender bulan WIB", () => {
  it("rentang bulan dipotong di tengah malam WIB", () => {
    const r = rentangBulan({ tahun: 2026, bulan: 9 });
    expect(r.awal.toISOString()).toBe("2026-08-31T17:00:00.000Z");
    expect(r.akhir.toISOString()).toBe("2026-09-30T16:59:59.999Z");
    expect(bulanWib(r.awal)).toEqual({ tahun: 2026, bulan: 9 });
    expect(bulanWib(r.akhir)).toEqual({ tahun: 2026, bulan: 9 });
  });

  it("kunci, baca, maju/mundur, deret", () => {
    expect(kunciBulan({ tahun: 2026, bulan: 3 })).toBe("2026-03");
    expect(bacaKunciBulan("2026-03")).toEqual({ tahun: 2026, bulan: 3 });
    expect(bacaKunciBulan("2026-13")).toBeNull();
    expect(bacaKunciBulan("26-03")).toBeNull();
    expect(bulanSesudah({ tahun: 2026, bulan: 12 })).toEqual({ tahun: 2027, bulan: 1 });
    expect(bulanSebelum({ tahun: 2026, bulan: 1 })).toEqual({ tahun: 2025, bulan: 12 });
    expect(deretBulan({ tahun: 2025, bulan: 11 }, { tahun: 2026, bulan: 2 }).map(kunciBulan)).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
  });

  it("bulan berakhir hanya sesudah hari terakhirnya lewat (WIB)", () => {
    expect(bulanSudahBerakhir({ tahun: 2026, bulan: 9 }, new Date("2026-09-30T16:59:59.000Z"))).toBe(false);
    expect(bulanSudahBerakhir({ tahun: 2026, bulan: 9 }, new Date("2026-09-30T17:00:00.000Z"))).toBe(true);
  });

  it("jurnal penutup tahun bertanggal 31 Des 23:59:59 WIB — masih di tahun itu", () => {
    const t = tanggalTutupTahun(2025);
    expect(t.toISOString()).toBe("2025-12-31T16:59:59.000Z");
    expect(bulanWib(t)).toEqual({ tahun: 2025, bulan: 12 });
  });

  it("alasan buka kembali minimal satu kalimat", () => {
    expect(alasanCukup("salah")).toBe(false);
    expect(alasanCukup("  Koreksi nota bulan ini  ")).toBe(true);
  });
});

describe("urutan tutup", () => {
  const tutup = (...k: string[]) => new Set(k);

  it("bulan pertama buku = bulan tanggal mulai (walau ada jurnal lebih awal); tanpa tanggal mulai, bulan jurnal paling awal", () => {
    expect(bulanPertamaBuku({ tahun: 2026, bulan: 8 }, { tahun: 2016, bulan: 7 })).toEqual({ tahun: 2026, bulan: 8 });
    expect(bulanPertamaBuku(null, { tahun: 2026, bulan: 7 })).toEqual({ tahun: 2026, bulan: 7 });
    expect(bulanPertamaBuku(null, null)).toBeNull();
  });

  it("menutup bulan ditahan oleh bulan terbuka paling awal sejak bulan pertama buku", () => {
    const pertama = { tahun: 2026, bulan: 7 };
    expect(bulanPenahanTutup({ tahun: 2026, bulan: 7 }, pertama, tutup())).toBeNull();
    expect(bulanPenahanTutup({ tahun: 2026, bulan: 9 }, pertama, tutup("2026-07"))).toEqual({ tahun: 2026, bulan: 8 });
    expect(bulanPenahanTutup({ tahun: 2026, bulan: 9 }, pertama, tutup("2026-08"))).toEqual({ tahun: 2026, bulan: 7 });
    expect(bulanPenahanTutup({ tahun: 2026, bulan: 9 }, pertama, tutup("2026-07", "2026-08"))).toBeNull();
  });

  it("bulan sebelum bulan pertama buku (kosong) boleh ditutup kapan saja", () => {
    expect(bulanPenahanTutup({ tahun: 2002, bulan: 5 }, { tahun: 2026, bulan: 7 }, tutup())).toBeNull();
    expect(bulanPenahanTutup({ tahun: 2026, bulan: 9 }, null, tutup())).toBeNull();
  });

  it("bulan sebelum tanggal mulai buku besar terkunci begitu bulan tanggal mulai ditutup (cermin kunci periode @elorae/db)", () => {
    const mulai = { tahun: 2002, bulan: 8 };
    expect(terkunciSebelumBuku({ tahun: 2002, bulan: 7 }, mulai, tutup())).toBe(false);
    expect(terkunciSebelumBuku({ tahun: 2002, bulan: 7 }, mulai, tutup("2002-08"))).toBe(true);
    expect(terkunciSebelumBuku({ tahun: 2000, bulan: 1 }, mulai, tutup("2002-08", "2002-09"))).toBe(true);
    // Bulan tanggal mulai dan sesudahnya mengikuti barisnya sendiri; tanpa tanggal mulai tidak ada kunci turunan.
    expect(terkunciSebelumBuku({ tahun: 2002, bulan: 8 }, mulai, tutup("2002-08"))).toBe(false);
    expect(terkunciSebelumBuku({ tahun: 2002, bulan: 10 }, mulai, tutup("2002-08"))).toBe(false);
    expect(terkunciSebelumBuku({ tahun: 2002, bulan: 7 }, null, tutup("2002-08"))).toBe(false);
  });
});

describe("daftar periksa", () => {
  const lulus: DataPeriksa = {
    jurnalDraf: 0,
    dokumenTanpaJurnal: { jumlah: 0, rincian: [] },
    jurnalGagalTanpaTanggal: 0,
    rekonsiliasiBank: { belum: "BANK_BELUM_DIIMPOR" },
    penyusutan: { belum: "TANPA_ASET_TETAP" },
    rekapPpn: { belum: "BUKAN_PKP" },
    settlement: { tanpaUnggahan: [] },
  };

  it("semua lulus / belum berlaku → boleh ditutup tanpa persetujuan; butir belum berlaku tetap tampil", () => {
    const d = nilaiDaftarPeriksa(lulus);
    expect(d.bolehTutup).toBe(true);
    expect(d.perluPersetujuan).toBe(false);
    expect(d.butir).toHaveLength(7);
    expect(d.butir.find((b) => b.kunci === "penyusutan")).toMatchObject({ keadaan: "BELUM_BERLAKU", sebabBelumBerlaku: "TANPA_ASET_TETAP" });
  });

  it("butir WAJIB yang gagal menahan penutupan; PERINGATAN hanya butuh persetujuan", () => {
    const wajib = nilaiDaftarPeriksa({ ...lulus, dokumenTanpaJurnal: { jumlah: 3, rincian: [{ label: "Penerimaan barang", jumlah: 3 }] } });
    expect(wajib.bolehTutup).toBe(false);
    const draf = nilaiDaftarPeriksa({ ...lulus, jurnalDraf: 1 });
    expect(draf.bolehTutup).toBe(false);

    const peringatan = nilaiDaftarPeriksa({ ...lulus, rekapPpn: { selesai: false }, settlement: { tanpaUnggahan: ["Shopee"] } });
    expect(peringatan.bolehTutup).toBe(true);
    expect(peringatan.perluPersetujuan).toBe(true);
    expect(peringatan.butir.find((b) => b.kunci === "settlement")).toMatchObject({ keadaan: "GAGAL", jumlah: 1, rincian: [{ label: "Shopee", jumlah: 1 }] });
  });
});

describe("jurnal penutup tahun", () => {
  it("menolkan setiap akun laba rugi dan memindah laba bersih ke laba ditahan — seimbang dalam sen", () => {
    const { baris, labaBersih } = susunJurnalTutupTahun(
      [
        { accountId: "pendapatan", type: "PENDAPATAN", debit: 100, credit: 10_000.1 },
        { accountId: "hpp", type: "HPP", debit: 6_000.05, credit: 0 },
        { accountId: "beban", type: "BEBAN", debit: 1_500, credit: 0 },
        { accountId: "kas", type: "ASET", debit: 999, credit: 0 },
        { accountId: "kosong", type: "BEBAN", debit: 50, credit: 50 },
      ],
      "ld",
    );
    expect(labaBersih).toBeCloseTo(2_400.05, 2);
    expect(baris).toEqual([
      { chartAccountId: "beban", debit: 0, credit: 1500 },
      { chartAccountId: "hpp", debit: 0, credit: 6000.05 },
      { chartAccountId: "pendapatan", debit: 9900.1, credit: 0 },
      { chartAccountId: "ld", debit: 0, credit: 2400.05, memo: "RETAINED_EARNINGS" },
    ]);
    const sen = (n: number) => Math.round(n * 100);
    expect(baris.reduce((s, b) => s + sen(b.debit), 0)).toBe(baris.reduce((s, b) => s + sen(b.credit), 0));
  });

  it("tahun rugi mendebit laba ditahan", () => {
    const { baris, labaBersih } = susunJurnalTutupTahun(
      [
        { accountId: "p", type: "PENDAPATAN", debit: 0, credit: 1000 },
        { accountId: "b", type: "BEBAN", debit: 1500, credit: 0 },
      ],
      "ld",
    );
    expect(labaBersih).toBe(-500);
    expect(baris.at(-1)).toEqual({ chartAccountId: "ld", debit: 500, credit: 0, memo: "RETAINED_EARNINGS" });
  });

  it("tanpa saldo laba rugi tidak ada baris", () => {
    expect(susunJurnalTutupTahun([{ accountId: "p", type: "PENDAPATAN", debit: 5, credit: 5 }], "ld")).toEqual({ baris: [], labaBersih: 0 });
  });

  it("generasi, pembalik, dan pengenal tahun", () => {
    expect(sumberIdPenutup(2025, 1)).toBe("2025");
    expect(sumberIdPenutup(2025, 3)).toBe("2025#3");
    expect(sumberIdPembalik("2025#3")).toBe("2025#3#balik");
    expect(sumberIdMilikTahun("2025#3#balik", 2025)).toBe(true);
    expect(sumberIdMilikTahun("20251", 2025)).toBe(false);
    expect(balikBaris([{ debit: 5, credit: 0 }])).toEqual([{ debit: 0, credit: 5 }]);
  });
});

describe("tanggal mulai buku besar", () => {
  it("tanggal harus ada di kalender", () => {
    expect(tanggalMulaiSah("2026-08-01")).toBe("2026-08-01");
    expect(tanggalMulaiSah("2026-02-31")).toBeNull();
    expect(tanggalMulaiSah("1/8/2026")).toBeNull();
  });

  it("ditolak bila tidak berubah atau sudah ada bulan yang ditutup", () => {
    expect(periksaTanggalMulaiBaru("2026-08-01", { tanggalLama: "2026-08-01", adaPeriodeTertutup: false })).toEqual({ ok: false, kode: "TANGGAL_SAMA" });
    expect(periksaTanggalMulaiBaru("2026-07-01", { tanggalLama: "2026-08-01", adaPeriodeTertutup: true })).toEqual({
      ok: false,
      kode: "SUDAH_ADA_PERIODE_DITUTUP",
    });
    expect(periksaTanggalMulaiBaru("x", { tanggalLama: null, adaPeriodeTertutup: false })).toEqual({ ok: false, kode: "TANGGAL_TIDAK_SAH" });
    expect(periksaTanggalMulaiBaru("2026-07-01", { tanggalLama: "2026-08-01", adaPeriodeTertutup: false })).toEqual({ ok: true, tanggal: "2026-07-01" });
  });

  it("peringatan: pertama kali / mundur / maju, masa depan, jurnal sebelum, dokumen yang akan disapu", () => {
    const dampak = { jurnalOtomatisSebelum: 0, dokumenAkanDisapu: [], terpotong: false };
    expect(peringatanTanggalMulai("2026-08-01", null, "2026-10-08", dampak)).toEqual([{ kunci: "pertamaKali" }]);
    expect(
      peringatanTanggalMulai("2026-07-01", "2026-08-01", "2026-10-08", {
        jurnalOtomatisSebelum: 2,
        dokumenAkanDisapu: [
          { label: "A", jumlah: 3 },
          { label: "B", jumlah: 4 },
        ],
        terpotong: false,
      }),
    ).toEqual([{ kunci: "mundur" }, { kunci: "adaJurnalSebelum", n: 2 }, { kunci: "akanDisapu", n: 7 }]);
    expect(peringatanTanggalMulai("2026-12-01", "2026-08-01", "2026-10-08", dampak)).toEqual([{ kunci: "maju" }, { kunci: "masaDepan" }]);
  });
});
