import { describe, expect, it } from "vitest";
import {
  bacaMinggu,
  bacaTanggalJadwal,
  gabungRencanaJadwal,
  geserHari,
  hariKeMinggu,
  hariSeminggu,
  kepatuhanJadwal,
  kunciHariSah,
  MAKS_CATATAN_JADWAL,
  MAKS_TOKO_PER_HARI,
  rapikanCatatanJadwal,
  rencanakanSalinMinggu,
  rencanakanUbahJadwal,
  seninDari,
  statusJadwal,
  type BarisJadwal,
  type TokoJadwal,
} from "./jadwal";

// 2026-10-01 adalah Kamis. 10.00 WIB = 03.00 UTC.
const SEKARANG = new Date("2026-10-01T03:00:00Z");
const HARI_INI = "2026-10-01";

describe("hari dan minggu WIB", () => {
  it("kunci hari sah hanya untuk tanggal kalender sungguhan", () => {
    expect(kunciHariSah("2026-10-01")).toBe(true);
    expect(kunciHariSah("2026-02-30")).toBe(false);
    expect(kunciHariSah("2026-10-1")).toBe(false);
    expect(kunciHariSah(20261001)).toBe(false);
  });

  it("menggeser hari melewati batas bulan dan tahun", () => {
    expect(geserHari("2026-10-01", -1)).toBe("2026-09-30");
    expect(geserHari("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("minggu mulai Senin dan berakhir Minggu", () => {
    expect(hariKeMinggu("2026-09-28")).toBe(0); // Senin
    expect(hariKeMinggu("2026-10-04")).toBe(6); // Minggu
    expect(seninDari("2026-10-04")).toBe("2026-09-28");
    expect(seninDari("2026-09-28")).toBe("2026-09-28");
    expect(hariSeminggu("2026-09-28")).toEqual([
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
    ]);
  });

  it("minggu dari alamat: hari apa pun di minggu itu → Seninnya; rusak → minggu ini (WIB)", () => {
    expect(bacaMinggu("2026-10-08", SEKARANG)).toBe("2026-10-05");
    expect(bacaMinggu(["2026-10-08", "x"], SEKARANG)).toBe("2026-10-05");
    expect(bacaMinggu("bukan", SEKARANG)).toBe("2026-09-28");
    expect(bacaMinggu(undefined, SEKARANG)).toBe("2026-09-28");
    // Minggu 4 Okt pukul 23.30 WIB = Minggu 16.30 UTC: masih minggu 28 Sep.
    expect(bacaMinggu(undefined, new Date("2026-10-04T16:30:00Z"))).toBe("2026-09-28");
    // Senin 5 Okt pukul 00.30 WIB = Minggu 17.30 UTC: sudah minggu baru.
    expect(bacaMinggu(undefined, new Date("2026-10-04T17:30:00Z"))).toBe("2026-10-05");
  });

  it("tanggal HP: hanya di dalam jangkauan, selain itu hari ini", () => {
    expect(bacaTanggalJadwal("2026-10-05", SEKARANG)).toBe("2026-10-05");
    expect(bacaTanggalJadwal("2026-09-20", SEKARANG)).toBe("2026-09-20");
    expect(bacaTanggalJadwal("2030-01-01", SEKARANG)).toBe(HARI_INI);
    expect(bacaTanggalJadwal("2026-02-30", SEKARANG)).toBe(HARI_INI);
    expect(bacaTanggalJadwal(undefined, SEKARANG)).toBe(HARI_INI);
  });
});

describe("kepatuhan", () => {
  it("status: didatangi menang; belum didatangi → terlewat bila harinya lewat, menunggu bila belum", () => {
    expect(statusJadwal("2026-09-30", HARI_INI, true)).toBe("DIKUNJUNGI");
    expect(statusJadwal("2026-09-30", HARI_INI, false)).toBe("TERLEWAT");
    expect(statusJadwal(HARI_INI, HARI_INI, false)).toBe("MENUNGGU");
    expect(statusJadwal("2026-10-02", HARI_INI, false)).toBe("MENUNGGU");
  });

  it("dicocokkan per sales × toko × hari WIB, bukan hari UTC", () => {
    const jadwal = [
      { salesmanId: "s1", storeId: "a", dayKey: "2026-09-30" },
      { salesmanId: "s1", storeId: "b", dayKey: "2026-09-30" },
      { salesmanId: "s1", storeId: "c", dayKey: HARI_INI },
      { salesmanId: "s2", storeId: "a", dayKey: "2026-09-30" },
    ];
    const kunjungan = [
      // 30 Sep 23.30 WIB = 30 Sep 16.30 UTC → hari 30 Sep.
      { userId: "s1", storeId: "a", checkinAt: new Date("2026-09-30T16:30:00Z") },
      // 1 Okt 00.30 WIB = 30 Sep 17.30 UTC → hari 1 Okt, bukan 30 Sep.
      { userId: "s1", storeId: "b", checkinAt: new Date("2026-09-30T17:30:00Z") },
      // Sales lain di toko yang sama tidak menghitung untuk s2.
      { userId: "s9", storeId: "a", checkinAt: new Date("2026-09-30T05:00:00Z") },
    ];
    const r = kepatuhanJadwal(jadwal, kunjungan, HARI_INI);
    expect(r.baris.map((b) => b.status)).toEqual(["DIKUNJUNGI", "TERLEWAT", "MENUNGGU", "TERLEWAT"]);
    expect(r.ringkas).toEqual({ direncanakan: 4, dikunjungi: 1, terlewat: 2, menunggu: 1, izin: 0 });
  });
});

describe("catatan", () => {
  it("dirapikan; kosong → null", () => {
    expect(rapikanCatatanJadwal("  Tagih   giro\n jatuh tempo  ")).toBe("Tagih giro jatuh tempo");
    expect(rapikanCatatanJadwal("   ")).toBeNull();
    expect(rapikanCatatanJadwal(undefined)).toBeNull();
    expect(rapikanCatatanJadwal(12)).toBeNull();
  });
});

const toko = (...daftar: [string, Partial<TokoJadwal>?][]): Map<string, TokoJadwal> =>
  new Map(daftar.map(([id, x]) => [id, { id, isActive: true, salesmanId: "s1", ...x }]));

const dasar = {
  hariIni: HARI_INI,
  terkunci: false,
  salesmanId: "s1",
};

describe("rencanakanUbahJadwal", () => {
  const sebelum: BarisJadwal[] = [
    { dayKey: "2026-10-02", storeId: "a", note: "Bawa katalog" },
    { dayKey: "2026-10-02", storeId: "b", note: null },
  ];

  it("menambah, menghapus dan mengubah catatan dalam satu simpan, dengan jejak per hari", () => {
    const r = rencanakanUbahJadwal({
      ...dasar,
      sebelum,
      toko: toko(["a"], ["b"], ["c"]),
      perubahan: {
        tambah: [{ dayKey: "2026-10-02", storeId: "c", note: "  Toko baru  " }],
        hapus: [{ dayKey: "2026-10-02", storeId: "b" }],
        catatan: [{ dayKey: "2026-10-02", storeId: "a", note: "" }],
      },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.buat).toEqual([{ dayKey: "2026-10-02", storeId: "c", note: "Toko baru" }]);
    expect(r.hapus).toEqual([{ dayKey: "2026-10-02", storeId: "b" }]);
    expect(r.ubah).toEqual([{ dayKey: "2026-10-02", storeId: "a", note: null }]);
    expect(r.hariBerubah).toEqual(["2026-10-02"]);
    expect(r.jejak).toEqual({
      before: {
        "2026-10-02": [
          { storeId: "a", note: "Bawa katalog" },
          { storeId: "b", note: null },
        ],
      },
      after: {
        "2026-10-02": [
          { storeId: "a", note: null },
          { storeId: "c", note: "Toko baru" },
        ],
      },
    });
  });

  it("menambah toko yang sudah ada tidak menggandakan; catatan kosong tidak menghapus catatan lama", () => {
    const r = rencanakanUbahJadwal({
      ...dasar,
      sebelum,
      toko: toko(["a"]),
      perubahan: { tambah: [{ dayKey: "2026-10-02", storeId: "a", note: null }] },
    });
    expect(r).toMatchObject({ ok: true, buat: [], ubah: [], hapus: [], jejak: null, hariBerubah: [] });
  });

  it("ganti: isi hari menjadi persis daftar itu; catatan yang tidak disebut dipertahankan", () => {
    const r = rencanakanUbahJadwal({
      ...dasar,
      sebelum,
      toko: toko(["a"], ["d"]),
      perubahan: {
        ganti: [
          { dayKey: "2026-10-02", toko: [{ storeId: "a" }, { storeId: "d", note: "Pagi" }, { storeId: "d" }] },
          { dayKey: "2026-10-03", toko: [] },
        ],
      },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.buat).toEqual([{ dayKey: "2026-10-02", storeId: "d", note: "Pagi" }]);
    expect(r.hapus).toEqual([{ dayKey: "2026-10-02", storeId: "b" }]);
    expect(r.ubah).toEqual([]);
    // 3 Okt kosong sebelum dan sesudah: tidak berubah, tidak masuk jejak.
    expect(r.hariBerubah).toEqual(["2026-10-02"]);
    expect(Object.keys(r.jejak?.after ?? {})).toEqual(["2026-10-02"]);
  });

  it("hari yang sudah lewat ditolak — termasuk menghapus; hari ini boleh", () => {
    expect(
      rencanakanUbahJadwal({
        ...dasar,
        sebelum: [],
        toko: toko(["a"]),
        perubahan: { hapus: [{ dayKey: "2026-09-30", storeId: "a" }] },
      }),
    ).toEqual({ ok: false, kode: "HARI_LEWAT", dayKey: "2026-09-30" });
    expect(
      rencanakanUbahJadwal({
        ...dasar,
        sebelum: [],
        toko: toko(["a"]),
        perubahan: { tambah: [{ dayKey: HARI_INI, storeId: "a" }] },
      }),
    ).toMatchObject({ ok: true, hariBerubah: [HARI_INI] });
  });

  it("tanggal rusak dan perubahan kosong ditolak", () => {
    expect(
      rencanakanUbahJadwal({ ...dasar, sebelum: [], toko: toko(), perubahan: { tambah: [{ dayKey: "2026-02-30", storeId: "a" }] } }),
    ).toEqual({ ok: false, kode: "TANGGAL_TIDAK_SAH", dayKey: "2026-02-30" });
    expect(rencanakanUbahJadwal({ ...dasar, sebelum: [], toko: toko(), perubahan: {} })).toEqual({ ok: false, kode: "KOSONG" });
  });

  it("toko baru harus ada dan aktif; saat kunci menyala harus dipegang sales itu", () => {
    const tk = toko(["aktif"], ["mati", { isActive: false }], ["orangLain", { salesmanId: "s2" }], ["kosong", { salesmanId: null }]);
    const tambah = (storeId: string) => ({ tambah: [{ dayKey: "2026-10-02", storeId }] });

    expect(rencanakanUbahJadwal({ ...dasar, sebelum: [], toko: tk, perubahan: tambah("hilang") })).toEqual({
      ok: false,
      kode: "TOKO_TIDAK_DITEMUKAN",
      storeIds: ["hilang"],
    });
    expect(rencanakanUbahJadwal({ ...dasar, sebelum: [], toko: tk, perubahan: tambah("mati") })).toEqual({
      ok: false,
      kode: "TOKO_TIDAK_AKTIF",
      storeIds: ["mati"],
    });
    // Kunci mati: toko orang lain dan toko tanpa pemegang boleh.
    expect(rencanakanUbahJadwal({ ...dasar, sebelum: [], toko: tk, perubahan: tambah("orangLain") }).ok).toBe(true);
    expect(rencanakanUbahJadwal({ ...dasar, sebelum: [], toko: tk, perubahan: tambah("kosong") }).ok).toBe(true);
    // Kunci menyala: keduanya ditolak, dan semua yang salah disebut sekaligus.
    expect(
      rencanakanUbahJadwal({
        ...dasar,
        terkunci: true,
        sebelum: [],
        toko: tk,
        perubahan: {
          tambah: [
            { dayKey: "2026-10-02", storeId: "orangLain" },
            { dayKey: "2026-10-03", storeId: "kosong" },
            { dayKey: "2026-10-02", storeId: "aktif" },
          ],
        },
      }),
    ).toEqual({ ok: false, kode: "TOKO_BUKAN_MILIKNYA", storeIds: ["orangLain", "kosong"] });
  });

  it("toko yang SUDAH terjadwal tidak dinilai ulang (toko dinonaktifkan sesudahnya tetap boleh dihapus/diberi catatan)", () => {
    const r = rencanakanUbahJadwal({
      ...dasar,
      sebelum,
      toko: toko(["a", { isActive: false }]),
      perubahan: { catatan: [{ dayKey: "2026-10-02", storeId: "a", note: "Sudah tutup?" }] },
    });
    expect(r).toMatchObject({ ok: true, ubah: [{ dayKey: "2026-10-02", storeId: "a", note: "Sudah tutup?" }] });
  });

  it(`paling banyak ${MAKS_TOKO_PER_HARI} toko per hari; mengurangi hari yang penuh tetap boleh`, () => {
    const ids = Array.from({ length: MAKS_TOKO_PER_HARI + 1 }, (_, i) => `t${i}`);
    const tk = toko(...ids.map((id) => [id] as [string]));
    expect(
      rencanakanUbahJadwal({
        ...dasar,
        sebelum: [],
        toko: tk,
        perubahan: { tambah: ids.map((storeId) => ({ dayKey: "2026-10-02", storeId })) },
      }),
    ).toEqual({ ok: false, kode: "TERLALU_BANYAK", dayKey: "2026-10-02", jumlah: MAKS_TOKO_PER_HARI + 1 });

    const penuh = ids.map((storeId) => ({ dayKey: "2026-10-02", storeId, note: null }));
    expect(
      rencanakanUbahJadwal({
        ...dasar,
        sebelum: penuh,
        toko: tk,
        perubahan: { hapus: [{ dayKey: "2026-10-02", storeId: "t0" }] },
      }).ok,
    ).toBe(true);
  });

  it("catatan terlalu panjang ditolak; catatan untuk toko yang tidak terjadwal ditolak", () => {
    expect(
      rencanakanUbahJadwal({
        ...dasar,
        sebelum,
        toko: toko(["a"]),
        perubahan: { catatan: [{ dayKey: "2026-10-02", storeId: "a", note: "x".repeat(MAKS_CATATAN_JADWAL + 1) }] },
      }),
    ).toEqual({ ok: false, kode: "CATATAN_TERLALU_PANJANG" });
    expect(
      rencanakanUbahJadwal({
        ...dasar,
        sebelum,
        toko: toko(["z"]),
        perubahan: { catatan: [{ dayKey: "2026-10-02", storeId: "z", note: "Halo" }] },
      }),
    ).toEqual({ ok: false, kode: "TIDAK_DITEMUKAN", dayKey: "2026-10-02", storeId: "z" });
  });

  it("menghapus yang tidak ada = tidak berubah apa pun", () => {
    expect(
      rencanakanUbahJadwal({ ...dasar, sebelum, toko: toko(), perubahan: { hapus: [{ dayKey: "2026-10-02", storeId: "z" }] } }),
    ).toMatchObject({ ok: true, jejak: null, hariBerubah: [] });
  });
});

describe("rencanakanSalinMinggu", () => {
  // Minggu lalu 21–27 Sep, tujuan minggu ini 28 Sep–4 Okt (hari ini Kamis 1 Okt).
  const sumber: BarisJadwal[] = [
    { dayKey: "2026-09-21", storeId: "a", note: "Senin lalu" }, // → Senin 28 Sep: sudah lewat
    { dayKey: "2026-09-24", storeId: "a", note: "Kamis" }, // → Kamis 1 Okt (hari ini): disalin
    { dayKey: "2026-09-24", storeId: "b", note: null }, // → sudah ada di tujuan
    { dayKey: "2026-09-25", storeId: "mati", note: null }, // → toko nonaktif
    { dayKey: "2026-09-25", storeId: "orangLain", note: null }, // → disalin (kunci mati)
    { dayKey: "2026-09-27", storeId: "a", note: null }, // → Minggu 4 Okt
  ];
  const ada: BarisJadwal[] = [{ dayKey: "2026-10-01", storeId: "b", note: "Sudah diatur" }];
  const tk = toko(["a"], ["b"], ["mati", { isActive: false }], ["orangLain", { salesmanId: "s2" }]);

  it("menyalin menurut hari dalam minggu, melewati yang sudah ada, hari lewat dan toko nonaktif", () => {
    const r = rencanakanSalinMinggu({ ...dasar, sumber, ada, seninTujuan: "2026-09-28", toko: tk });
    expect(r.buat).toEqual([
      { dayKey: "2026-10-01", storeId: "a", note: "Kamis" },
      { dayKey: "2026-10-02", storeId: "orangLain", note: null },
      { dayKey: "2026-10-04", storeId: "a", note: null },
    ]);
    expect(r.dilewati).toEqual({ sudahAda: 1, hariLewat: 1, tokoTidakAktif: 1, bukanMiliknya: 0, penuh: 0 });
    expect(r.hariBerubah).toEqual(["2026-10-01", "2026-10-02", "2026-10-04"]);
    // Jejak: sebelum/sesudah hanya untuk hari yang berubah; yang sudah ada ikut di "sesudah".
    expect(r.jejak?.before["2026-10-01"]).toEqual([{ storeId: "b", note: "Sudah diatur" }]);
    expect(r.jejak?.after["2026-10-01"]).toEqual([
      { storeId: "a", note: "Kamis" },
      { storeId: "b", note: "Sudah diatur" },
    ]);
    expect(r.jejak?.before["2026-10-04"]).toEqual([]);
  });

  it("kunci menyala: toko yang tidak dipegang dilewati", () => {
    const r = rencanakanSalinMinggu({ ...dasar, terkunci: true, sumber, ada, seninTujuan: "2026-09-28", toko: tk });
    expect(r.buat.map((b) => b.storeId)).toEqual(["a", "a"]);
    expect(r.dilewati.bukanMiliknya).toBe(1);
  });

  it(`hari tujuan yang penuh (${MAKS_TOKO_PER_HARI}) tidak ditambah`, () => {
    const ids = Array.from({ length: MAKS_TOKO_PER_HARI }, (_, i) => `t${i}`);
    const r = rencanakanSalinMinggu({
      ...dasar,
      sumber: [{ dayKey: "2026-09-25", storeId: "a", note: null }],
      ada: ids.map((storeId) => ({ dayKey: "2026-10-02", storeId, note: null })),
      seninTujuan: "2026-09-28",
      toko: tk,
    });
    expect(r.buat).toEqual([]);
    expect(r.dilewati.penuh).toBe(1);
    expect(r.jejak).toBeNull();
  });

  it("minggu sumber kosong → tidak ada yang disalin", () => {
    const r = rencanakanSalinMinggu({ ...dasar, sumber: [], ada, seninTujuan: "2026-10-05", toko: tk });
    expect(r).toEqual({
      buat: [],
      dilewati: { sudahAda: 0, hariLewat: 0, tokoTidakAktif: 0, bukanMiliknya: 0, penuh: 0 },
      jejak: null,
      hariBerubah: [],
    });
  });
});

describe("gabungRencanaJadwal", () => {
  it("jadwal kantor yang belum didatangi paling atas, rencana otomatis tanpa kembar, yang sudah didatangi paling bawah", () => {
    const jadwal = [
      { storeId: "j1", dikunjungi: false },
      { storeId: "j2", dikunjungi: true },
      { storeId: "r2", dikunjungi: false },
    ];
    const rencana = [{ storeId: "r1" }, { storeId: "r2" }, { storeId: "j2" }];
    const hasil = gabungRencanaJadwal(jadwal, rencana);
    expect(hasil.map((b) => `${b.jenis}:${b.jenis === "jadwal" ? b.jadwal.storeId : b.rencana.storeId}`)).toEqual([
      "jadwal:j1",
      "jadwal:r2",
      "rencana:r1",
      "jadwal:j2",
    ]);
    // Alasan rencana otomatis ikut ke baris jadwalnya.
    expect(hasil[1]).toMatchObject({ jenis: "jadwal", rencana: { storeId: "r2" } });
    expect(hasil[0]).toMatchObject({ jenis: "jadwal", rencana: null });
  });

  it("tanpa jadwal = rencana otomatis apa adanya", () => {
    expect(gabungRencanaJadwal([], [{ storeId: "a" }])).toEqual([{ jenis: "rencana", rencana: { storeId: "a" } }]);
  });
});

/*
 * Hari izin/sakit/cuti yang DISETUJUI bukan hari kerja: toko terjadwal yang
 * tidak didatangi hari itu bukan "terlewat", dan tidak masuk penyebut
 * "N dari M dikunjungi". Kunjungan yang tetap terjadi tetap DIKUNJUNGI.
 */
describe("kepatuhanJadwal — hari izin yang disetujui", () => {
  const HARI = "2026-10-07";
  const jadwal = [
    { salesmanId: "s1", storeId: "t1", dayKey: "2026-10-05" },
    { salesmanId: "s1", storeId: "t2", dayKey: "2026-10-05" },
    { salesmanId: "s1", storeId: "t3", dayKey: "2026-10-06" },
    { salesmanId: "s2", storeId: "t1", dayKey: "2026-10-05" },
  ];
  const kunjungan = [{ userId: "s1", storeId: "t2", checkinAt: new Date("2026-10-05T03:00:00Z") }];
  const izin = [{ userId: "s1", type: "SAKIT", startDay: "2026-10-05", endDay: "2026-10-05" }];

  it("baris di hari izin yang tidak dikunjungi berstatus IZIN, bukan TERLEWAT", () => {
    const r = kepatuhanJadwal(jadwal, kunjungan, HARI, izin);
    const st = Object.fromEntries(r.baris.map((b) => [`${b.salesmanId}|${b.storeId}|${b.dayKey}`, b.status]));
    expect(st["s1|t1|2026-10-05"]).toBe("IZIN");
    expect(st["s1|t2|2026-10-05"]).toBe("DIKUNJUNGI");
    expect(st["s1|t3|2026-10-06"]).toBe("TERLEWAT");
    // Izin milik s1 tidak berlaku untuk s2.
    expect(st["s2|t1|2026-10-05"]).toBe("TERLEWAT");
  });

  it("baris IZIN tidak masuk penyebut 'direncanakan'", () => {
    const r = kepatuhanJadwal(jadwal, kunjungan, HARI, izin);
    expect(r.ringkas).toEqual({ direncanakan: 3, dikunjungi: 1, terlewat: 2, menunggu: 0, izin: 1 });
  });

  it("tanpa data izin perilakunya sama seperti sebelumnya", () => {
    const r = kepatuhanJadwal(jadwal, kunjungan, HARI);
    expect(r.ringkas).toEqual({ direncanakan: 4, dikunjungi: 1, terlewat: 3, menunggu: 0, izin: 0 });
  });
});
