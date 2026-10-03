import { describe, expect, it } from "vitest";
import type { TokoRencana } from "./dasbor";
import {
  HARI_JENDELA_NILAI,
  hitungTugasRencana,
  KALI_JARAK_BIASA,
  MIN_HARI_JARANG,
  MIN_HARI_PESAN,
  nilaiTokoMenurun,
  persenTurun,
  RASIO_NILAI_TURUN,
  susunRencanaDenganMenurun,
  urutkanTokoMenurun,
  type HasilMenurun,
  type PesananToko,
  type TokoMenurun,
} from "./toko-menurun";

// 30 Sep 2026, 10:00 WIB.
const HARI_INI = new Date("2026-09-30T03:00:00Z");
const HARI_MS = 86_400_000;
/** Siang WIB, `n` hari kalender sebelum HARI_INI. */
const mundur = (n: number) => new Date(Date.parse("2026-09-30T05:00:00Z") - n * HARI_MS);
const pesan = (n: number, nilai: number | null = 1_000_000): PesananToko => ({ tanggal: mundur(n), nilai });
/** Pesanan tiap `jarak` hari, yang terakhir `terakhir` hari lalu. */
const berkala = (jumlah: number, jarak: number, terakhir: number, nilai: number | null = 1_000_000) =>
  Array.from({ length: jumlah }, (_, i) => pesan(terakhir + i * jarak, nilai));

describe("nilaiTokoMenurun — ambang", () => {
  it("names its thresholds as constants", () => {
    expect(MIN_HARI_PESAN).toBe(3);
    expect(KALI_JARAK_BIASA).toBe(1.5);
    expect(MIN_HARI_JARANG).toBe(14);
    expect(HARI_JENDELA_NILAI).toBe(90);
    expect(RASIO_NILAI_TURUN).toBe(0.5);
  });
});

describe("nilaiTokoMenurun — JARANG", () => {
  it("flags a store whose silence is well past its usual gap", () => {
    // Biasanya tiap 21 hari, sudah 48 hari tidak pesan.
    const h = nilaiTokoMenurun(berkala(4, 21, 48), HARI_INI);
    expect(h).toEqual({
      alasan: "JARANG",
      hariSejakTerakhir: 48,
      jarakBiasa: 21,
      nilai90: 2_000_000, // 48 dan 69 hari lalu
      nilai90Sebelumnya: 2_000_000, // 90 dan 111 hari lalu
    });
  });

  it("does not flag exactly 1.5 × the usual gap — it must be MORE than that", () => {
    expect(nilaiTokoMenurun(berkala(4, 20, 30), HARI_INI)).toBeNull();
    expect(nilaiTokoMenurun(berkala(4, 20, 31), HARI_INI)?.alasan).toBe("JARANG");
  });

  it("never calls a store rare before 14 days, however short its usual gap", () => {
    // Tiap 8 hari → 1,5 × 8 = 12, tapi 13 hari belum dua minggu.
    expect(nilaiTokoMenurun(berkala(5, 8, 13), HARI_INI)).toBeNull();
    expect(nilaiTokoMenurun(berkala(5, 8, 14), HARI_INI)).toMatchObject({ alasan: "JARANG", hariSejakTerakhir: 14 });
  });

  it("uses the median gap, so one long break (a holiday closure) does not reset the habit", () => {
    // Jarak 10, 10, 60, 10 → median 10. Rata-ratanya 22,5 akan menyembunyikan toko ini.
    const h = nilaiTokoMenurun([pesan(20), pesan(30), pesan(40), pesan(100), pesan(110)], HARI_INI);
    expect(h).toMatchObject({ alasan: "JARANG", jarakBiasa: 10, hariSejakTerakhir: 20 });
  });

  it("averages the two middle gaps when the count is even", () => {
    // Jarak 10 dan 20 → median 15; 23 hari > 22,5.
    expect(nilaiTokoMenurun([pesan(23), pesan(33), pesan(53)], HARI_INI)).toMatchObject({ jarakBiasa: 15, alasan: "JARANG" });
    expect(nilaiTokoMenurun([pesan(22), pesan(32), pesan(52)], HARI_INI)).toBeNull();
  });

  it("ignores stores with fewer than three ordering days", () => {
    expect(nilaiTokoMenurun([], HARI_INI)).toBeNull();
    expect(nilaiTokoMenurun([pesan(200)], HARI_INI)).toBeNull();
    expect(nilaiTokoMenurun([pesan(100), pesan(200)], HARI_INI)).toBeNull();
  });

  it("counts several orders on the same WIB day as ONE ordering day", () => {
    // Tiga kiriman di hari yang sama bukan tiga kebiasaan pesan.
    expect(nilaiTokoMenurun([pesan(60), pesan(60), pesan(60)], HARI_INI)).toBeNull();
    // Hari WIB, bukan UTC: 23.30 WIB dan 00.30 WIB keesokan harinya = dua hari.
    const malam = new Date("2026-08-01T16:30:00Z"); // 1 Agu 23.30 WIB
    const dini = new Date("2026-08-01T17:30:00Z"); // 2 Agu 00.30 WIB
    const h = nilaiTokoMenurun(
      [{ tanggal: malam, nilai: 1 }, { tanggal: dini, nilai: 1 }, { tanggal: new Date("2026-08-02T05:00:00Z"), nilai: 1 }, pesan(40)],
      HARI_INI,
    );
    // Hari pesan: 1 Agu, 2 Agu, 21 Agu → jarak 1 dan 19 → median 10; 40 hari lalu > 15.
    expect(h).toMatchObject({ alasan: "JARANG", jarakBiasa: 10, hariSejakTerakhir: 40 });
  });

  it("still counts orders whose value is unknown (konsi before approval) for frequency", () => {
    const h = nilaiTokoMenurun(berkala(4, 21, 48, null), HARI_INI);
    expect(h).toEqual({ alasan: "JARANG", hariSejakTerakhir: 48, jarakBiasa: 21, nilai90: null, nilai90Sebelumnya: null });
  });

  it("does not flag a store that ordered recently, even with an unknown value", () => {
    // Pesanan kemarin masih menunggu persetujuan (nilai belum ada) — tokonya baru saja pesan.
    expect(nilaiTokoMenurun([pesan(1, null), ...berkala(3, 21, 40)], HARI_INI)).toBeNull();
  });

  it("ignores orders dated after today instead of producing a negative silence", () => {
    const h = nilaiTokoMenurun([{ tanggal: new Date("2026-10-05T05:00:00Z"), nilai: 1 }, ...berkala(3, 20, 40)], HARI_INI);
    expect(h).toMatchObject({ alasan: "JARANG", hariSejakTerakhir: 40 });
  });
});

describe("nilaiTokoMenurun — NILAI_TURUN", () => {
  it("flags a store whose last 90 days are worth less than half the 90 days before", () => {
    // Pesan teratur tiap 10 hari (tidak jarang), tapi nilainya menyusut.
    const baru = [pesan(5, 200_000), pesan(15, 200_000), pesan(25, 200_000)];
    const lama = [pesan(95, 1_000_000), pesan(105, 1_000_000), pesan(115, 1_000_000)];
    expect(nilaiTokoMenurun([...baru, ...lama], HARI_INI)).toEqual({
      alasan: "NILAI_TURUN",
      hariSejakTerakhir: 5,
      jarakBiasa: 10,
      nilai90: 600_000,
      nilai90Sebelumnya: 3_000_000,
    });
  });

  it("does not flag exactly half — it must be LESS than 50%", () => {
    const lama = [pesan(95, 1_000_000), pesan(105, 1_000_000)];
    expect(nilaiTokoMenurun([pesan(5, 500_000), pesan(15, 500_000), ...lama], HARI_INI)).toBeNull();
    expect(nilaiTokoMenurun([pesan(5, 499_999), pesan(15, 500_000), ...lama], HARI_INI)?.alasan).toBe("NILAI_TURUN");
  });

  it("splits the windows on WIB calendar days: day 89 is recent, day 90 is the window before", () => {
    const h = nilaiTokoMenurun([pesan(0, 100), pesan(89, 100), pesan(90, 1_000), pesan(179, 1_000), pesan(180, 99_999)], HARI_INI);
    expect(h).toMatchObject({ nilai90: 200, nilai90Sebelumnya: 2_000, alasan: "NILAI_TURUN" });
  });

  it("needs orders in BOTH windows — an empty recent window is a frequency question, not a value one", () => {
    // Pesan tiap 100 hari: 90 hari terakhir kosong itu wajar, bukan nilai jatuh.
    expect(nilaiTokoMenurun([pesan(95), pesan(195), pesan(295)], HARI_INI)).toBeNull();
    // Belum ada riwayat 90 hari sebelumnya: tidak ada pembanding.
    expect(nilaiTokoMenurun([pesan(5), pesan(15), pesan(25)], HARI_INI)).toBeNull();
  });

  it("does not compare values while a recent order's value is still unknown", () => {
    // Pesanan konsi yang belum disetujui bisa saja menutup selisihnya.
    const lama = [pesan(95, 1_000_000), pesan(105, 1_000_000)];
    expect(nilaiTokoMenurun([pesan(5, null), pesan(15, 100_000), ...lama], HARI_INI)).toBeNull();
  });

  it("leaves an unknown value in the OLDER window out — that can only make a drop harder to flag", () => {
    // Nilai lama yang tidak diketahui tidak dihitung: pembandingnya mengecil, bukan membesar.
    const lama = [pesan(95, 1_000_000), pesan(105, null), pesan(115, 1_000_000)];
    expect(nilaiTokoMenurun([pesan(5, 400_000), pesan(15, 400_000), ...lama], HARI_INI)).toMatchObject({
      alasan: "NILAI_TURUN",
      nilai90: 800_000,
      nilai90Sebelumnya: 2_000_000,
    });
    expect(nilaiTokoMenurun([pesan(5, 550_000), pesan(15, 550_000), ...lama], HARI_INI)).toBeNull();
  });

  it("does not compare against an older window worth nothing", () => {
    expect(nilaiTokoMenurun([pesan(5, 0), pesan(15, 0), pesan(95, 0), pesan(105, 0)], HARI_INI)).toBeNull();
  });

  it("prefers JARANG when both apply — the silence is the more urgent reason", () => {
    const h = nilaiTokoMenurun([pesan(60, 100), pesan(120, 1_000_000), pesan(130, 1_000_000), pesan(140, 1_000_000)], HARI_INI);
    expect(h?.alasan).toBe("JARANG");
    expect(h?.nilai90).toBe(100);
  });
});

describe("persenTurun", () => {
  const dasar: HasilMenurun = { alasan: "NILAI_TURUN", hariSejakTerakhir: 5, jarakBiasa: 10, nilai90: 600_000, nilai90Sebelumnya: 3_000_000 };
  it("is the rounded drop from the older window", () => {
    expect(persenTurun(dasar)).toBe(80);
    expect(persenTurun({ ...dasar, nilai90: 1, nilai90Sebelumnya: 3 })).toBe(67);
  });
  it("is null when either window has no value", () => {
    expect(persenTurun({ ...dasar, nilai90: null })).toBeNull();
    expect(persenTurun({ ...dasar, nilai90Sebelumnya: 0 })).toBeNull();
  });
});

const menurun = (storeId: string, x: Partial<HasilMenurun> = {}): TokoMenurun => ({
  storeId,
  nama: storeId,
  alasan: "JARANG",
  hariSejakTerakhir: 40,
  jarakBiasa: 20,
  nilai90: null,
  nilai90Sebelumnya: null,
  ...x,
});

describe("urutkanTokoMenurun", () => {
  it("puts the most overdue first (silence ÷ usual gap), then value drops by steepest", () => {
    const r = urutkanTokoMenurun([
      menurun("turun-sedikit", { alasan: "NILAI_TURUN", hariSejakTerakhir: 3, nilai90: 40, nilai90Sebelumnya: 100 }),
      menurun("2x", { hariSejakTerakhir: 40, jarakBiasa: 20 }),
      menurun("turun-tajam", { alasan: "NILAI_TURUN", hariSejakTerakhir: 3, nilai90: 10, nilai90Sebelumnya: 100 }),
      menurun("3x", { hariSejakTerakhir: 30, jarakBiasa: 10 }),
    ]);
    expect(r.map((x) => x.storeId)).toEqual(["3x", "2x", "turun-tajam", "turun-sedikit"]);
  });

  it("breaks an overdue tie by the longer silence, and does not mutate its input", () => {
    const masuk = [menurun("a", { hariSejakTerakhir: 30, jarakBiasa: 10 }), menurun("b", { hariSejakTerakhir: 60, jarakBiasa: 20 })];
    expect(urutkanTokoMenurun(masuk).map((x) => x.storeId)).toEqual(["b", "a"]);
    expect(masuk.map((x) => x.storeId)).toEqual(["a", "b"]);
  });
});

describe("susunRencanaDenganMenurun", () => {
  const toko = (storeId: string, x: Partial<TokoRencana> = {}): TokoRencana => ({
    storeId,
    nama: storeId,
    kunjunganTerakhir: mundur(2),
    tagih: false,
    sisaTagihan: 0,
    lat: null,
    lng: null,
    ...x,
  });
  const opsi = { batasHari: 14, hariIni: HARI_INI };

  it("adds a declining store the visit plan skipped, after the collections and before overdue visits", () => {
    const r = susunRencanaDenganMenurun(
      [
        toko("lama", { kunjunganTerakhir: mundur(30) }),
        toko("tagih", { tagih: true, sisaTagihan: 5_000_000 }),
        toko("menurun-baru-dikunjungi"),
        toko("biasa"),
      ],
      [menurun("menurun-baru-dikunjungi")],
      opsi,
    );
    expect(r.map((x) => x.storeId)).toEqual(["tagih", "menurun-baru-dikunjungi", "lama"]);
    const baru = r[1];
    expect(baru.alasan).toEqual([]);
    expect(baru.hariSejak).toBe(2);
    expect(baru.jarakMeter).toBeNull();
    expect(baru.menurun?.alasan).toBe("JARANG");
    expect(r[0].menurun).toBeNull();
  });

  it("moves an overdue visit that is also declining up with the declining stores, keeping its visit reason", () => {
    const r = susunRencanaDenganMenurun(
      [toko("lama", { kunjunganTerakhir: mundur(30) }), toko("lama-menurun", { kunjunganTerakhir: mundur(20) })],
      [menurun("lama-menurun")],
      opsi,
    );
    expect(r.map((x) => [x.storeId, x.alasan])).toEqual([
      ["lama-menurun", ["lama"]],
      ["lama", ["lama"]],
    ]);
  });

  it("keeps a store with an overdue bill in the collections group, with its decline attached", () => {
    const r = susunRencanaDenganMenurun(
      [toko("menurun"), toko("tagih-menurun", { tagih: true, sisaTagihan: 1 })],
      [menurun("menurun", { hariSejakTerakhir: 100, jarakBiasa: 10 }), menurun("tagih-menurun")],
      opsi,
    );
    expect(r.map((x) => x.storeId)).toEqual(["tagih-menurun", "menurun"]);
    expect(r[0].menurun?.storeId).toBe("tagih-menurun");
  });

  it("orders the declining group most-overdue first when the phone does not know where it is", () => {
    const r = susunRencanaDenganMenurun(
      [toko("2x"), toko("5x")],
      [menurun("2x", { hariSejakTerakhir: 40, jarakBiasa: 20 }), menurun("5x", { hariSejakTerakhir: 50, jarakBiasa: 10 })],
      opsi,
    );
    expect(r.map((x) => x.storeId)).toEqual(["5x", "2x"]);
  });

  it("orders the declining group nearest first when the phone knows its position", () => {
    const posisi = { lat: -6.9, lng: 107.6 };
    const r = susunRencanaDenganMenurun(
      [
        toko("jauh", { lat: -6.95, lng: 107.6 }),
        toko("dekat", { lat: -6.901, lng: 107.6 }),
        toko("tanpa-titik"),
      ],
      [menurun("jauh", { hariSejakTerakhir: 90, jarakBiasa: 10 }), menurun("tanpa-titik"), menurun("dekat")],
      { ...opsi, posisi },
    );
    expect(r.map((x) => x.storeId)).toEqual(["dekat", "jauh", "tanpa-titik"]);
    expect(r[0].jarakMeter).toBeGreaterThan(0);
  });

  it("ignores a declining store that is not one of this salesman's stores", () => {
    const r = susunRencanaDenganMenurun([toko("biasa")], [menurun("toko-orang-lain")], opsi);
    expect(r).toEqual([]);
  });
});

describe("hitungTugasRencana", () => {
  it("counts each store once, in its most urgent row — bills are counted elsewhere", () => {
    const r = susunRencanaDenganMenurun(
      [
        { storeId: "tagih-menurun", nama: "", kunjunganTerakhir: mundur(2), tagih: true, sisaTagihan: 1, lat: null, lng: null },
        { storeId: "menurun", nama: "", kunjunganTerakhir: mundur(2), tagih: false, sisaTagihan: 0, lat: null, lng: null },
        { storeId: "lama-menurun", nama: "", kunjunganTerakhir: mundur(40), tagih: false, sisaTagihan: 0, lat: null, lng: null },
        { storeId: "lama", nama: "", kunjunganTerakhir: null, tagih: false, sisaTagihan: 0, lat: null, lng: null },
      ],
      [menurun("tagih-menurun"), menurun("menurun"), menurun("lama-menurun")],
      { batasHari: 14, hariIni: HARI_INI },
    );
    expect(hitungTugasRencana(r)).toEqual({ menurun: 2, kunjungan: 1 });
  });
});
