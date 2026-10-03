import { describe, expect, it } from "vitest";
import {
  audiensMencakup,
  cuplikan,
  keInputWib,
  keadaanPengumuman,
  parseWaktuWib,
  peranDari,
  pilihKartuBeranda,
  perluKabar,
  saranWaktuForm,
  syaratAudiens,
  urutkanUntukHp,
  validasiPengumuman,
  whereKeadaan,
} from "./aturan";

const SEKARANG = new Date("2026-10-01T03:00:00.000Z"); // 10.00 WIB
const JAM = 60 * 60 * 1000;
const HARI = 24 * JAM;

describe("keadaanPengumuman", () => {
  const dasar = { publishedAt: new Date(SEKARANG.getTime() - JAM), expiresAt: null, archivedAt: null };

  it("terbit dan belum kedaluwarsa = AKTIF", () => {
    expect(keadaanPengumuman(dasar, SEKARANG)).toBe("AKTIF");
  });

  it("waktu terbit di depan = TERJADWAL", () => {
    expect(keadaanPengumuman({ ...dasar, publishedAt: new Date(SEKARANG.getTime() + 1) }, SEKARANG)).toBe("TERJADWAL");
  });

  it("tepat pada waktu terbit sudah AKTIF", () => {
    expect(keadaanPengumuman({ ...dasar, publishedAt: SEKARANG }, SEKARANG)).toBe("AKTIF");
  });

  it("tepat pada waktu kedaluwarsa sudah KEDALUWARSA", () => {
    expect(keadaanPengumuman({ ...dasar, expiresAt: SEKARANG }, SEKARANG)).toBe("KEDALUWARSA");
    expect(keadaanPengumuman({ ...dasar, expiresAt: new Date(SEKARANG.getTime() + 1) }, SEKARANG)).toBe("AKTIF");
  });

  it("diarsipkan mengalahkan semua keadaan lain", () => {
    const arsip = new Date(SEKARANG.getTime() - HARI);
    expect(keadaanPengumuman({ ...dasar, archivedAt: arsip }, SEKARANG)).toBe("DIARSIPKAN");
    expect(
      keadaanPengumuman({ ...dasar, publishedAt: new Date(SEKARANG.getTime() + HARI), archivedAt: arsip }, SEKARANG),
    ).toBe("DIARSIPKAN");
    expect(keadaanPengumuman({ ...dasar, expiresAt: arsip, archivedAt: arsip }, SEKARANG)).toBe("DIARSIPKAN");
  });
});

describe("whereKeadaan — filter basis data setara dengan keadaanPengumuman", () => {
  it("AKTIF", () => {
    expect(whereKeadaan("AKTIF", SEKARANG)).toEqual({
      archivedAt: null,
      publishedAt: { lte: SEKARANG },
      OR: [{ expiresAt: null }, { expiresAt: { gt: SEKARANG } }],
    });
  });
  it("TERJADWAL", () => {
    expect(whereKeadaan("TERJADWAL", SEKARANG)).toEqual({ archivedAt: null, publishedAt: { gt: SEKARANG } });
  });
  it("KEDALUWARSA", () => {
    expect(whereKeadaan("KEDALUWARSA", SEKARANG)).toEqual({ archivedAt: null, expiresAt: { lte: SEKARANG } });
  });
  it("DIARSIPKAN", () => {
    expect(whereKeadaan("DIARSIPKAN", SEKARANG)).toEqual({ archivedAt: { not: null } });
  });
});

describe("audiens", () => {
  it("SPG dikenali dari toko tetapnya", () => {
    expect(peranDari("store-1")).toBe("SPG");
    expect(peranDari(null)).toBe("SALESMAN");
  });

  it("SEMUA mencakup kedua peran, yang lain hanya perannya", () => {
    expect(audiensMencakup("SEMUA", "SALESMAN")).toBe(true);
    expect(audiensMencakup("SEMUA", "SPG")).toBe(true);
    expect(audiensMencakup("SALESMAN", "SALESMAN")).toBe(true);
    expect(audiensMencakup("SALESMAN", "SPG")).toBe(false);
    expect(audiensMencakup("SPG", "SPG")).toBe(true);
    expect(audiensMencakup("SPG", "SALESMAN")).toBe(false);
  });

  it("audiens tak dikenal tidak mencakup siapa pun", () => {
    expect(audiensMencakup("GUDANG", "SALESMAN")).toBe(false);
    expect(audiensMencakup("", "SPG")).toBe(false);
  });

  it("syarat penerima memakai definisi toko tetap yang sama", () => {
    expect(syaratAudiens("SEMUA")).toEqual({});
    expect(syaratAudiens("SALESMAN")).toEqual({ assignedStoreId: null });
    expect(syaratAudiens("SPG")).toEqual({ assignedStoreId: { not: null } });
  });

  it("audiens tak dikenal tidak menyasar siapa pun (bukan semua orang)", () => {
    expect(syaratAudiens("GUDANG")).toBeNull();
  });
});

describe("parseWaktuWib / keInputWib", () => {
  it("membaca isian datetime-local sebagai WIB", () => {
    expect(parseWaktuWib("2026-10-01T10:00")?.toISOString()).toBe("2026-10-01T03:00:00.000Z");
  });
  it("menolak bentuk lain dan tanggal mustahil", () => {
    expect(parseWaktuWib("2026-10-01")).toBeNull();
    expect(parseWaktuWib("2026-13-01T10:00")).toBeNull();
    expect(parseWaktuWib("2026-02-30T10:00")).toBeNull();
    expect(parseWaktuWib("bukan")).toBeNull();
    expect(parseWaktuWib(42)).toBeNull();
  });
  it("menulis balik ke bentuk isian, termasuk tengah malam WIB", () => {
    expect(keInputWib(new Date("2026-10-01T03:00:00.000Z"))).toBe("2026-10-01T10:00");
    expect(keInputWib(new Date("2026-09-30T17:00:00.000Z"))).toBe("2026-10-01T00:00");
  });
});

describe("validasiPengumuman", () => {
  const isian = {
    title: "  Rapat bulanan  ",
    body: "Baris satu\r\nBaris dua",
    audience: "SALESMAN",
    pinned: true,
    requireAck: false,
    publishedAt: "",
    expiresAt: "",
  };

  it("isian sah dirapikan; terbit kosong = sekarang", () => {
    const v = validasiPengumuman(isian, { sekarang: SEKARANG });
    expect(v).toEqual({
      ok: true,
      data: {
        title: "Rapat bulanan",
        body: "Baris satu\nBaris dua",
        audience: "SALESMAN",
        pinned: true,
        requireAck: false,
        publishedAt: SEKARANG,
        expiresAt: null,
      },
    });
  });

  it("judul dan isi wajib, dengan batas panjang", () => {
    const v = validasiPengumuman({ ...isian, title: "  ", body: "" }, { sekarang: SEKARANG });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.galat).toContainEqual({ kolom: "title", kode: "JUDUL_KOSONG" });
      expect(v.galat).toContainEqual({ kolom: "body", kode: "ISI_KOSONG" });
    }
    const p = validasiPengumuman({ ...isian, title: "x".repeat(121), body: "y".repeat(5001) }, { sekarang: SEKARANG });
    expect(p.ok).toBe(false);
    if (!p.ok) {
      expect(p.galat).toContainEqual({ kolom: "title", kode: "JUDUL_PANJANG" });
      expect(p.galat).toContainEqual({ kolom: "body", kode: "ISI_PANJANG" });
    }
    expect(validasiPengumuman({ ...isian, title: "x".repeat(120), body: "y".repeat(5000) }, { sekarang: SEKARANG }).ok).toBe(true);
  });

  it("audiens di luar daftar ditolak", () => {
    const v = validasiPengumuman({ ...isian, audience: "GUDANG" }, { sekarang: SEKARANG });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.galat).toContainEqual({ kolom: "audience", kode: "AUDIENS_TIDAK_SAH" });
  });

  it("bendera bukan boolean dibaca false, bukan dipercaya", () => {
    const v = validasiPengumuman({ ...isian, pinned: "ya", requireAck: 1 }, { sekarang: SEKARANG });
    expect(v.ok && v.data.pinned === false && v.data.requireAck === false).toBe(true);
  });

  it("jadwal di depan dipakai; waktu lampau tidak bisa memundurkan terbit", () => {
    const depan = validasiPengumuman({ ...isian, publishedAt: "2026-10-02T08:00" }, { sekarang: SEKARANG });
    expect(depan.ok && depan.data.publishedAt.toISOString()).toBe("2026-10-02T01:00:00.000Z");
    const lampau = validasiPengumuman({ ...isian, publishedAt: "2026-09-01T08:00" }, { sekarang: SEKARANG });
    expect(lampau.ok && lampau.data.publishedAt.getTime()).toBe(SEKARANG.getTime());
  });

  it("waktu terbit yang bukan tanggal ditolak", () => {
    const v = validasiPengumuman({ ...isian, publishedAt: "besok" }, { sekarang: SEKARANG });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.galat).toContainEqual({ kolom: "publishedAt", kode: "TERBIT_TIDAK_SAH" });
  });

  it("yang sudah terbit tidak bisa dijadwalkan ulang — waktu terbitnya dikunci", () => {
    const lama = { publishedAt: new Date(SEKARANG.getTime() - HARI), expiresAt: null };
    const v = validasiPengumuman({ ...isian, publishedAt: "2026-12-01T08:00" }, { sekarang: SEKARANG, lama });
    expect(v.ok && v.data.publishedAt.getTime()).toBe(lama.publishedAt.getTime());
  });

  it("yang masih terjadwal boleh digeser jadwalnya", () => {
    const lama = { publishedAt: new Date(SEKARANG.getTime() + HARI), expiresAt: null };
    const v = validasiPengumuman({ ...isian, publishedAt: "2026-10-05T08:00" }, { sekarang: SEKARANG, lama });
    expect(v.ok && v.data.publishedAt.toISOString()).toBe("2026-10-05T01:00:00.000Z");
  });

  it("kedaluwarsa harus sesudah terbit dan di depan", () => {
    const sebelum = validasiPengumuman(
      { ...isian, publishedAt: "2026-10-05T08:00", expiresAt: "2026-10-04T08:00" },
      { sekarang: SEKARANG },
    );
    expect(sebelum.ok).toBe(false);
    if (!sebelum.ok) expect(sebelum.galat).toContainEqual({ kolom: "expiresAt", kode: "KEDALUWARSA_SEBELUM_TERBIT" });

    const lewat = validasiPengumuman({ ...isian, expiresAt: "2026-09-30T08:00" }, { sekarang: SEKARANG });
    expect(lewat.ok).toBe(false);
    if (!lewat.ok) expect(lewat.galat.map((g) => g.kode)).toContain("KEDALUWARSA_SEBELUM_TERBIT");

    const ok = validasiPengumuman({ ...isian, expiresAt: "2026-10-08T23:59" }, { sekarang: SEKARANG });
    expect(ok.ok && ok.data.expiresAt?.toISOString()).toBe("2026-10-08T16:59:00.000Z");
  });

  it("kedaluwarsa lampau yang TIDAK diubah tetap boleh disimpan (mis. memperbaiki judul)", () => {
    const lama = {
      publishedAt: new Date(SEKARANG.getTime() - 10 * HARI),
      expiresAt: new Date(SEKARANG.getTime() - HARI),
    };
    const v = validasiPengumuman({ ...isian, expiresAt: keInputWib(lama.expiresAt) }, { sekarang: SEKARANG, lama });
    expect(v.ok).toBe(true);
  });

  it("kedaluwarsa lampau yang BARU diisi ditolak — untuk mengakhiri, arsipkan", () => {
    const lama = { publishedAt: new Date(SEKARANG.getTime() - 10 * HARI), expiresAt: null };
    const v = validasiPengumuman({ ...isian, expiresAt: "2026-09-30T10:00" }, { sekarang: SEKARANG, lama });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.galat).toContainEqual({ kolom: "expiresAt", kode: "KEDALUWARSA_LEWAT" });
  });

  it("kedaluwarsa yang bukan tanggal ditolak", () => {
    const v = validasiPengumuman({ ...isian, expiresAt: "lusa" }, { sekarang: SEKARANG });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.galat).toContainEqual({ kolom: "expiresAt", kode: "KEDALUWARSA_TIDAK_SAH" });
  });
});

describe("perluKabar", () => {
  const aktif = { publishedAt: new Date(SEKARANG.getTime() - JAM), expiresAt: null, archivedAt: null };

  it("hanya yang AKTIF dan belum pernah dikabarkan", () => {
    expect(perluKabar(aktif, SEKARANG, false)).toBe(true);
    expect(perluKabar(aktif, SEKARANG, true)).toBe(false);
    expect(perluKabar({ ...aktif, publishedAt: new Date(SEKARANG.getTime() + JAM) }, SEKARANG, false)).toBe(false);
    expect(perluKabar({ ...aktif, archivedAt: SEKARANG }, SEKARANG, false)).toBe(false);
    expect(perluKabar({ ...aktif, expiresAt: SEKARANG }, SEKARANG, false)).toBe(false);
  });

  it("dengan batas umur: yang terbit terlalu lama tidak dikabarkan lagi", () => {
    const lama = { ...aktif, publishedAt: new Date(SEKARANG.getTime() - 4 * HARI) };
    expect(perluKabar(lama, SEKARANG, false, { umurMaksMs: 3 * HARI })).toBe(false);
    expect(perluKabar(aktif, SEKARANG, false, { umurMaksMs: 3 * HARI })).toBe(true);
  });
});

describe("cuplikan", () => {
  it("merapatkan baris dan spasi", () => {
    expect(cuplikan("Satu\n\n  dua   tiga", 50)).toBe("Satu dua tiga");
  });
  it("memotong di batas kata dengan elipsis", () => {
    expect(cuplikan("aaaa bbbb cccc dddd", 12)).toBe("aaaa bbbb…");
  });
  it("kata tunggal yang terlalu panjang dipotong keras", () => {
    expect(cuplikan("x".repeat(30), 10)).toBe(`${"x".repeat(9)}…`);
  });
});

type Baris = Parameters<typeof urutkanUntukHp>[0][number];
const b = (id: string, o: Partial<Baris> = {}): Baris => ({
  id,
  pinned: false,
  publishedAt: new Date(SEKARANG.getTime() - JAM),
  dibaca: true,
  perluKonfirmasi: false,
  ...o,
});

describe("urutkanUntukHp", () => {
  it("tersemat dulu, lalu terbaru", () => {
    const hasil = urutkanUntukHp([
      b("lama", { publishedAt: new Date(SEKARANG.getTime() - 3 * HARI) }),
      b("baru", { publishedAt: new Date(SEKARANG.getTime() - JAM) }),
      b("semat-lama", { pinned: true, publishedAt: new Date(SEKARANG.getTime() - 5 * HARI) }),
    ]);
    expect(hasil.map((x) => x.id)).toEqual(["semat-lama", "baru", "lama"]);
  });
});

describe("pilihKartuBeranda", () => {
  it("hanya yang tersemat, belum dibaca, atau menunggu konfirmasi; paling banyak 3", () => {
    const hasil = pilihKartuBeranda([
      b("sudah-dibaca"),
      b("belum-1", { dibaca: false, publishedAt: new Date(SEKARANG.getTime() - 2 * JAM) }),
      b("belum-2", { dibaca: false, publishedAt: new Date(SEKARANG.getTime() - JAM) }),
      b("konfirmasi", { perluKonfirmasi: true, publishedAt: new Date(SEKARANG.getTime() - 5 * JAM) }),
      b("semat", { pinned: true, publishedAt: new Date(SEKARANG.getTime() - 9 * HARI) }),
    ]);
    expect(hasil.baris.map((x) => x.id)).toEqual(["semat", "konfirmasi", "belum-2"]);
    expect(hasil.belumDibaca).toBe(2);
    expect(hasil.perluKonfirmasi).toBe(1);
    expect(hasil.lainnya).toBe(1);
  });

  it("perlu konfirmasi didahulukan dari sekadar belum dibaca", () => {
    const hasil = pilihKartuBeranda([
      b("belum", { dibaca: false, publishedAt: new Date(SEKARANG.getTime() - JAM) }),
      b("konfirmasi", { perluKonfirmasi: true, publishedAt: new Date(SEKARANG.getTime() - 9 * JAM) }),
    ]);
    expect(hasil.baris.map((x) => x.id)).toEqual(["konfirmasi", "belum"]);
  });

  it("tanpa apa pun yang perlu dilihat = kosong", () => {
    const hasil = pilihKartuBeranda([b("a"), b("b")]);
    expect(hasil).toEqual({ baris: [], belumDibaca: 0, perluKonfirmasi: 0, lainnya: 0 });
  });
});

describe("saranWaktuForm", () => {
  it("besok 08.00 dan 7 hari lagi 23.59, menurut hari WIB", () => {
    expect(saranWaktuForm(SEKARANG)).toEqual({ terbit: "2026-10-02T08:00", berakhir: "2026-10-08T23:59" });
    // 23.30 WIB tanggal 1 = 16.30 UTC: masih tanggal 1 di WIB.
    expect(saranWaktuForm(new Date("2026-10-01T16:30:00.000Z"))).toEqual({ terbit: "2026-10-02T08:00", berakhir: "2026-10-08T23:59" });
    // 00.30 WIB tanggal 2 = 17.30 UTC tanggal 1: sudah tanggal 2 di WIB.
    expect(saranWaktuForm(new Date("2026-10-01T17:30:00.000Z"))).toEqual({ terbit: "2026-10-03T08:00", berakhir: "2026-10-09T23:59" });
  });
});
