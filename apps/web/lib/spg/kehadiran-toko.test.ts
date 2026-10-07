import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { geserHari } from "@/lib/salesman/jadwal";
import { bacaHariKerjaSpg, KUNCI_HARI_KERJA_SPG } from "@/lib/salesman/izin";
import { kehadiranSpgToko, susunKehadiran, tampilKehadiran } from "./kehadiran-toko";

/*
 * Kehadiran SPG hari ini di halaman toko salesman, terhadap basis data uji.
 * Kunjungan, izin, dan jadwal diseed pada tanggal lampau yang acak (tidak
 * bertabrakan dengan data pengembangan); "sekarang" = pukul 13.00 WIB hari itu.
 * Teardown hanya lewat id yang diseed.
 */

/*
 * Server produksi berjalan di UTC; mesin pengembang di WIB. Zona proses dibuat
 * UTC SEBELUM modul dimuat (formatter jam dibuat saat modul dimuat), supaya
 * jam yang tidak dipaku ke WIB ketahuan di sini, bukan di HP.
 */
const zonaAsli = vi.hoisted(() => {
  const asli = process.env.TZ;
  process.env.TZ = "UTC";
  return asli;
});
afterAll(() => {
  if (zonaAsli === undefined) delete process.env.TZ;
  else process.env.TZ = zonaAsli;
});

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const token = Math.random().toString(36).slice(2, 10);
const acak = (min: number, maks: number) => min + Math.floor(Math.random() * (maks - min + 1));
const HARI = `${acak(2001, 2019)}-${String(acak(1, 12)).padStart(2, "0")}-${String(acak(10, 28)).padStart(2, "0")}`;
const KEMARIN = geserHari(HARI, -1);
const BESOK = geserHari(HARI, 1);
const jam = (hhmm: string, tanggal = HARI) => new Date(`${tanggal}T${hhmm}:00+07:00`);
const SEKARANG = jam("13:00");
/*
 * Hari kerja SPG diberikan langsung supaya hasilnya tidak bergantung pada
 * `spg.hariKerja` di basis data pengembangan (tes tidak pernah menulisnya).
 */
const SETIAP_HARI = { hariKerjaSpg: [0, 1, 2, 3, 4, 5, 6] };
const HARI_MINGGU = new Date(`${HARI}T00:00:00Z`).getUTCDay();
const TANPA_HARI_INI = { hariKerjaSpg: [0, 1, 2, 3, 4, 5, 6].filter((x) => x !== HARI_MINGGU) };

d("kehadiran SPG di toko hari ini (test bed only)", () => {
  let toko = "";
  let tokoLain = "";
  let tokoKosong = "";
  let kantor = "";
  let sales = "";
  const spg: Record<string, string> = {};
  let visitIds: string[] = [];
  let izinIds: string[] = [];
  let shiftIds: string[] = [];

  beforeAll(async () => {
    toko = "";
    tokoLain = "";
    tokoKosong = "";
    kantor = "";
    sales = "";
    for (const k of Object.keys(spg)) delete spg[k];
    visitIds = [];
    izinIds = [];
    shiftIds = [];

    const buatToko = (kode: string) =>
      prisma.store.create({ data: { code: `T-KH-${kode}-${token}`, name: `KH ${kode} ${token}`, address: `Jl. ${kode}`, termsType: "KONSI" } });
    toko = (await buatToko("A")).id;
    tokoLain = (await buatToko("B")).id;
    tokoKosong = (await buatToko("C")).id;
    kantor = (await prisma.user.create({ data: { email: `kh-k-${token}@test.local`, name: `KH Kantor ${token}` } })).id;
    sales = (await prisma.user.create({ data: { email: `kh-s-${token}@test.local`, name: `KH Sales ${token}` } })).id;
    const buatSpg = async (kunci: string, storeId = toko) => {
      spg[kunci] = (
        await prisma.user.create({
          data: { email: `kh-${kunci}-${token}@test.local`, name: `KH ${kunci} ${token}`, assignedStoreId: storeId },
        })
      ).id;
    };
    // Nama diurutkan abjad di hasil; kunci huruf menentukan urutan itu.
    for (const k of ["Ani", "Budi", "Citra", "Dewi", "Eka", "Fani", "Gita", "Hana"]) await buatSpg(k);
    await buatSpg("Lain", tokoLain);

    const kunjungan = async (userId: string, storeId: string, masuk: Date, keluar: Date | null) => {
      const v = await prisma.storeVisit.create({
        data: { storeId, userId, checkinAt: masuk, checkoutAt: keluar, checkinLat: -6.2, checkinLng: 106.8 },
      });
      visitIds.push(v.id);
    };
    // Ani: masuk 08.15, masih di toko — walau izinnya disetujui, ia datang.
    await kunjungan(spg.Ani, toko, jam("08:15"), null);
    // Budi: dua kunjungan, yang kedua masih terbuka → di toko sejak yang pertama.
    await kunjungan(spg.Budi, toko, jam("08:00"), jam("12:00"));
    await kunjungan(spg.Budi, toko, jam("12:30"), null);
    // Gita: masuk 00.30 WIB (hari sebelumnya menurut UTC), pulang 01.00.
    await kunjungan(spg.Gita, toko, jam("00:30"), jam("01:00"));
    // Hana: dua kunjungan, keduanya sudah ditutup → pulang pada check-out terakhir.
    await kunjungan(spg.Hana, toko, jam("07:45"), jam("11:00"));
    await kunjungan(spg.Hana, toko, jam("11:30"), jam("12:40"));
    // Fani: kunjungan KEMARIN yang lupa ditutup — bukan bukti hadir hari ini.
    await kunjungan(spg.Fani, toko, jam("17:00", KEMARIN), null);
    // Eka: kunjungan BESOK (salah jam HP) tidak dihitung untuk hari ini.
    await kunjungan(spg.Eka, toko, jam("09:00", BESOK), null);
    // Salesman yang check-in di toko ini bukan SPG — tidak ikut daftar.
    await kunjungan(sales, toko, jam("10:00"), null);
    // SPG toko lain yang mampir — bukan SPG toko ini.
    await kunjungan(spg.Lain, toko, jam("09:30"), null);

    const izin = async (userId: string, type: string, startDay: string, endDay: string, status: string) => {
      const r = await prisma.leaveRequest.create({ data: { userId, type, startDay, endDay, reason: "uji", status } });
      izinIds.push(r.id);
    };
    await izin(spg.Ani, "IZIN", HARI, HARI, "DISETUJUI");
    await izin(spg.Citra, "SAKIT", KEMARIN, HARI, "DISETUJUI");
    // Dewi: izin yang masih DIAJUKAN belum berarti izin.
    await izin(spg.Dewi, "CUTI", HARI, HARI, "DIAJUKAN");
    // Izin yang sudah lewat tidak menyentuh hari ini.
    await izin(spg.Fani, "IZIN", geserHari(HARI, -5), KEMARIN, "DISETUJUI");

    const shift = async (userId: string, kind: string, startTime: string | null, endTime: string | null) => {
      const r = await prisma.spgShift.create({
        data: { userId, storeId: toko, day: HARI, kind, startTime, endTime, createdById: kantor },
      });
      shiftIds.push(r.id);
    };
    // Eka libur menurut jadwal; Dewi dijadwalkan masuk 14.00.
    await shift(spg.Eka, "LIBUR", null, null);
    await shift(spg.Dewi, "KERJA", "14:00", "22:00");
  });

  afterAll(async () => {
    await prisma.spgShift.deleteMany({ where: { id: { in: seededIds(shiftIds) } } });
    await prisma.leaveRequest.deleteMany({ where: { id: { in: seededIds(izinIds) } } });
    await prisma.storeVisit.deleteMany({ where: { id: { in: seededIds(visitIds) } } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds([...Object.values(spg), kantor, sales].filter(Boolean)) } } });
    await prisma.store.deleteMany({ where: { id: { in: seededIds([toko, tokoLain, tokoKosong].filter(Boolean)) } } });
  });

  it("satu baris per SPG toko ini, urut nama, dengan keadaan hari ini", async () => {
    const hasil = tampilKehadiran(await kehadiranSpgToko(seededId(toko), SEKARANG, SETIAP_HARI));
    expect(hasil.map((h) => h.nama)).toEqual(
      ["Ani", "Budi", "Citra", "Dewi", "Eka", "Fani", "Gita", "Hana"].map((n) => `KH ${n} ${token}`),
    );
    const per = Object.fromEntries(hasil.map((h) => [h.nama.split(" ")[1], h]));

    expect(per.Ani).toMatchObject({ keadaan: "DI_TOKO", masuk: "08.15", pulang: null });
    expect(per.Budi).toMatchObject({ keadaan: "DI_TOKO", masuk: "08.00", pulang: null });
    // Sakit tertulis "izin" saja di HP salesman — jenisnya tidak dikirim.
    expect(per.Citra).toEqual(expect.objectContaining({ keadaan: "IZIN", masuk: null, pulang: null }));
    expect(per.Citra).not.toHaveProperty("jenisIzin");
    expect(per.Dewi).toMatchObject({ keadaan: "BELUM", masuk: null, jadwalMulai: "14:00" });
    expect(per.Eka).toMatchObject({ keadaan: "LIBUR", masuk: null });
    expect(per.Fani).toMatchObject({ keadaan: "BELUM", masuk: null, jadwalMulai: null });
    expect(per.Gita).toMatchObject({ keadaan: "PULANG", masuk: "00.30", pulang: "01.00" });
    expect(per.Hana).toMatchObject({ keadaan: "PULANG", masuk: "07.45", pulang: "12.40" });
  });

  it("muatan ke HP hanya nama, keadaan, jam, dan jadwal — tanpa angka uang dan tanpa jenis izin", async () => {
    const hasil = tampilKehadiran(await kehadiranSpgToko(seededId(toko), SEKARANG, SETIAP_HARI));
    for (const h of hasil) {
      expect(Object.keys(h).sort()).toEqual(["jadwalMulai", "keadaan", "masuk", "nama", "pulang", "userId"]);
    }
    // Izin/sakit/cuti adalah urusan pribadi SPG: salesman hanya melihat "izin hari ini".
    expect(JSON.stringify(hasil)).not.toMatch(/SAKIT|CUTI|jenisIzin/);
    // id dan nama uji acak (cuid bisa memuat "rp") — yang diperiksa isian lainnya.
    const isi = hasil.map((h) => [h.keadaan, h.masuk, h.pulang, h.jadwalMulai]);
    expect(JSON.stringify(isi)).not.toMatch(/Rp|harga|price|total|nilai/i);
    expect(JSON.stringify(isi)).not.toMatch(/\d{4,}/);
  });

  it("toko tanpa SPG → daftar kosong (kartu tidak tampil)", async () => {
    expect(await kehadiranSpgToko(seededId(tokoKosong), SEKARANG, SETIAP_HARI)).toEqual([]);
    // SPG toko lain yang mampir ke toko ini tidak membuat toko lainnya "berkunjung".
    const lain = tampilKehadiran(await kehadiranSpgToko(seededId(tokoLain), SEKARANG, SETIAP_HARI));
    expect(lain).toEqual([expect.objectContaining({ nama: `KH Lain ${token}`, keadaan: "BELUM" })]);
  });

  it("bukan hari kerja SPG (Pengaturan): yang tidak datang tertulis bukan hari kerja, bukan 'belum datang'", async () => {
    const hasil = tampilKehadiran(await kehadiranSpgToko(seededId(toko), SEKARANG, TANPA_HARI_INI));
    const per = Object.fromEntries(hasil.map((h) => [h.nama.split(" ")[1], h]));
    // Tanpa kunjungan, izin, atau jadwal → bukan hari kerja.
    expect(per.Fani.keadaan).toBe("BUKAN_HARI_KERJA");
    // Jadwal KERJA hari itu mengalahkan pengaturan: tetap ditunggu.
    expect(per.Dewi).toMatchObject({ keadaan: "BELUM", jadwalMulai: "14:00" });
    // Jadwal LIBUR, izin, dan yang datang tidak berubah.
    expect(per.Eka.keadaan).toBe("LIBUR");
    expect(per.Citra.keadaan).toBe("IZIN");
    expect(per.Ani.keadaan).toBe("DI_TOKO");
    expect(per.Hana.keadaan).toBe("PULANG");
  });

  it("tanpa pilihan, hari kerja dibaca dari pengaturan spg.hariKerja", async () => {
    const setelan = await prisma.systemSetting.findUnique({ where: { key: KUNCI_HARI_KERJA_SPG }, select: { value: true } });
    const kerjaHariIni = bacaHariKerjaSpg(setelan?.value).includes(HARI_MINGGU);
    const per = Object.fromEntries(
      tampilKehadiran(await kehadiranSpgToko(seededId(toko), SEKARANG)).map((h) => [h.nama.split(" ")[1], h]),
    );
    expect(per.Fani.keadaan).toBe(kerjaHariIni ? "BELUM" : "BUKAN_HARI_KERJA");
  });

  it("hari berikutnya semua belum datang — kunjungan kemarin tidak terbawa", async () => {
    const besok = tampilKehadiran(await kehadiranSpgToko(seededId(toko), jam("06:00", BESOK), SETIAP_HARI));
    const per = Object.fromEntries(besok.map((h) => [h.nama.split(" ")[1], h]));
    // Jadwal libur Eka hanya untuk hari itu.
    expect(per.Eka.keadaan).not.toBe("LIBUR");
    expect(per.Ani.keadaan).toBe("BELUM");
    expect(per.Budi.keadaan).toBe("BELUM");
    expect(per.Hana.keadaan).toBe("BELUM");
    // Izin Citra berakhir hari ini → besok ia belum datang, bukan izin.
    expect(per.Citra.keadaan).toBe("BELUM");
  });
});

describe("susunKehadiran — hari kerja SPG (murni)", () => {
  const dasar = {
    spg: [{ id: "u1", nama: "Rina" }],
    kunjungan: [],
    izin: [],
    hari: "2026-10-04",
  };

  it("bukan hari kerja dan tanpa jadwal → bukan hari kerja", () => {
    expect(susunKehadiran({ ...dasar, shift: [], hariKerja: false })[0].keadaan).toBe("BUKAN_HARI_KERJA");
    expect(susunKehadiran({ ...dasar, shift: [], hariKerja: true })[0].keadaan).toBe("BELUM");
  });

  it("jadwal KERJA mengalahkan pengaturan; jadwal LIBUR tetap libur", () => {
    const kerja = [{ userId: "u1", kind: "KERJA", startTime: "09:00" }];
    expect(susunKehadiran({ ...dasar, shift: kerja, hariKerja: false })[0]).toMatchObject({
      keadaan: "BELUM",
      jadwalMulai: "09:00",
    });
    const libur = [{ userId: "u1", kind: "LIBUR", startTime: null }];
    expect(susunKehadiran({ ...dasar, shift: libur, hariKerja: true })[0].keadaan).toBe("LIBUR");
  });

  it("yang datang di hari libur tetap tercatat datang", () => {
    const kunjungan = [{ userId: "u1", checkinAt: new Date("2026-10-04T02:00:00Z"), checkoutAt: null }];
    expect(susunKehadiran({ ...dasar, kunjungan, shift: [], hariKerja: false })[0].keadaan).toBe("DI_TOKO");
  });
});
