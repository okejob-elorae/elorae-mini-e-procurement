import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededIds } from "@elorae/db";
import { bacaPengaturanAbsensi, KUNCI_PENGATURAN_ABSENSI } from "./absensi";
import { bacaHariKerjaSpg, geserHari, hitungHariKerja, KUNCI_HARI_KERJA_SPG } from "./izin";
import { ajukanIzin, batalkanIzin, setujuiIzin, tarikIzin, tolakIzin } from "./izin-writer";

/*
 * Penulis izin/sakit/cuti terhadap basis data uji. Semua baris milik pengguna
 * buatan tes (email berkode acak); teardown hanya lewat id yang diseed —
 * termasuk catatan kantor `LEAVE_REQUEST_SUBMITTED` yang ditulis penulisnya.
 *
 * Kuota cuti dibaca dari pengaturan yang sedang berlaku, TIDAK diubah: tes ini
 * berjalan di basis data bersama, dan pengaturan adalah milik pemiliknya.
 */

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const tag = `IZN-${Math.random().toString(36).slice(2, 10)}`;
/** Kamis 1 Okt 2026, 10.00 WIB. */
const SEKARANG = new Date("2026-10-01T10:00:00+07:00");

d("izin/sakit/cuti — penulis (test bed only)", () => {
  let sales = "";
  let salesLain = "";
  let kantor = "";
  let kantorLain = "";
  let spg = "";
  let kuota = 0;
  let hariKerjaSpg: number[] = [];
  let kunciKe = 0;
  const kunci = () => `${tag}-k${kunciKe++}`;

  beforeAll(async () => {
    sales = "";
    salesLain = "";
    kantor = "";
    kantorLain = "";
    spg = "";
    const pengguna = async (n: string, assignedStoreId: string | null = null) =>
      (
        await prisma.user.create({
          data: { email: `${tag}-${n}@test.local`.toLowerCase(), name: `${n} ${tag}`, assignedStoreId },
        })
      ).id;
    sales = await pengguna("sales");
    salesLain = await pengguna("sales2");
    kantor = await pengguna("kantor");
    kantorLain = await pengguna("kantor2");
    // `assignedStoreId` bukan relasi (tanpa kunci asing): cukup tanda "SPG" untuk penulisnya.
    spg = await pengguna("spg", `toko-${tag}`);
    const hk = await prisma.systemSetting.findUnique({ where: { key: KUNCI_HARI_KERJA_SPG }, select: { value: true } });
    hariKerjaSpg = bacaHariKerjaSpg(hk?.value);
    const row = await prisma.systemSetting.findUnique({ where: { key: KUNCI_PENGATURAN_ABSENSI }, select: { value: true } });
    kuota = bacaPengaturanAbsensi(row?.value).kuotaCutiTahunan;
  });

  const penggunaUji = () => seededIds([sales, salesLain, kantor, kantorLain, spg].filter(Boolean));

  afterEach(async () => {
    const ids = (await prisma.leaveRequest.findMany({ where: { userId: { in: penggunaUji() } }, select: { id: true } })).map(
      (r) => r.id,
    );
    // Catatan kantor ditulis penulis di dalam transaksinya. Dicocokkan di JS lewat
    // `metadata.leaveRequestId` (penyaringan jalur JSON tidak andal di semua adaptor),
    // lalu dihapus per id — tidak ada catatan milik orang lain yang ikut terhapus.
    const catatan = await prisma.adminNotification.findMany({
      where: { category: "LEAVE_REQUEST_SUBMITTED" },
      select: { id: true, metadata: true },
    });
    const milikUji = catatan
      .filter((c) => {
        const m = c.metadata as Record<string, unknown> | null;
        return typeof m?.leaveRequestId === "string" && ids.includes(m.leaveRequestId);
      })
      .map((c) => c.id);
    await prisma.adminNotification.deleteMany({ where: { id: { in: seededIds(milikUji) } } });
    await prisma.auditLog.deleteMany({ where: { entityType: "LeaveRequest", entityId: { in: seededIds(ids) } } });
    await prisma.leaveRequest.deleteMany({ where: { id: { in: seededIds(ids) } } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: penggunaUji() } } });
  });

  const ajukan = (x: Partial<Parameters<typeof ajukanIzin>[0]> = {}) =>
    ajukanIzin({
      userId: sales,
      jenis: "IZIN",
      mulai: "2026-10-05",
      selesai: "2026-10-07",
      alasan: "Urusan keluarga",
      idempotencyKey: kunci(),
      sekarang: SEKARANG,
      ...x,
    });

  const idDari = (r: Awaited<ReturnType<typeof ajukanIzin>>): string => {
    if (!r.ok) throw new Error(`harus ok, dapat ${r.kode}`);
    return r.id;
  };

  const catatanKantor = async (leaveRequestId: string) =>
    (
      await prisma.adminNotification.findMany({
        where: { category: "LEAVE_REQUEST_SUBMITTED" },
        select: { id: true, title: true, message: true, metadata: true },
      })
    ).filter((c) => (c.metadata as Record<string, unknown> | null)?.leaveRequestId === leaveRequestId);

  it("mengajukan: baris DIAJUKAN, jejak, dan satu catatan kantor bertaut ke ajuannya", async () => {
    const id = idDari(await ajukan({ jenis: "SAKIT", mulai: "2026-09-30", selesai: "2026-10-01", alasan: "  Demam  " }));
    const row = await prisma.leaveRequest.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({
      userId: sales,
      type: "SAKIT",
      startDay: "2026-09-30",
      endDay: "2026-10-01",
      reason: "Demam",
      photoUrl: null,
      status: "DIAJUKAN",
      reviewedById: null,
    });
    const jejak = await prisma.auditLog.findMany({ where: { entityType: "LeaveRequest", entityId: id } });
    expect(jejak.map((j) => j.action)).toEqual(["LEAVE_REQUEST_SUBMITTED"]);
    expect(jejak[0].changes).toMatchObject({ after: { status: "DIAJUKAN", jenis: "SAKIT", hariKerja: 2 } });
    const c = await catatanKantor(id);
    expect(c).toHaveLength(1);
    expect(c[0].title).toBe(`Sakit diajukan · sales ${tag}`);
    // Sakit dua hari kerja tanpa surat dokter: kantor diberi tahu.
    expect(c[0].message).toContain("30 Sep – 1 Okt 2026 (2 hari kerja)");
    expect(c[0].message).toContain("Tanpa surat dokter.");
  });

  it("kiriman ulang berkunci sama mengembalikan ajuan yang sama; kunci milik orang lain ditolak", async () => {
    const k = kunci();
    const a = await ajukan({ idempotencyKey: k });
    // Kiriman ulang dinilai TIDAK ulang — walau kini ia akan bentrok dengan dirinya sendiri.
    const b = await ajukan({ idempotencyKey: k });
    expect(a).toMatchObject({ ok: true, ulang: false });
    expect(b).toEqual({ ok: true, id: idDari(a), ulang: true });
    expect(await prisma.leaveRequest.count({ where: { idempotencyKey: k } })).toBe(1);
    expect(await catatanKantor(idDari(a))).toHaveLength(1);
    expect(await ajukan({ userId: salesLain, idempotencyKey: k })).toEqual({ ok: false, kode: "KUNCI_DIPAKAI" });
    expect(await ajukan({ idempotencyKey: "  " })).toEqual({ ok: false, kode: "KUNCI_WAJIB" });
  });

  it("menolak ajuan yang bertumpuk dengan ajuan hidup; yang ditolak atau ditarik melepas harinya", async () => {
    const pertama = idDari(await ajukan({ mulai: "2026-10-05", selesai: "2026-10-07" }));
    expect(await ajukan({ jenis: "SAKIT", mulai: "2026-10-07", selesai: "2026-10-08" })).toEqual({ ok: false, kode: "BENTROK" });
    // Orang lain di hari yang sama: bukan urusannya.
    expect((await ajukan({ userId: salesLain, mulai: "2026-10-05", selesai: "2026-10-07" })).ok).toBe(true);
    // Bersebelahan: boleh.
    expect((await ajukan({ mulai: "2026-10-08", selesai: "2026-10-08" })).ok).toBe(true);

    expect(await tolakIzin({ leaveRequestId: pertama, olehUserId: kantor, catatan: "Ada stok opname" })).toEqual({ ok: true });
    expect((await ajukan({ mulai: "2026-10-06", selesai: "2026-10-07" })).ok).toBe(true);
  });

  it("dua ajuan bertumpuk yang dikirim bersamaan: hanya satu yang tercatat", async () => {
    const hasil = await Promise.all([
      ajukan({ mulai: "2026-10-12", selesai: "2026-10-14" }),
      ajukan({ jenis: "SAKIT", mulai: "2026-10-13", selesai: "2026-10-13" }),
    ]);
    expect(hasil.filter((h) => h.ok)).toHaveLength(1);
    expect(hasil.filter((h) => !h.ok)).toEqual([{ ok: false, kode: "BENTROK" }]);
    expect(await prisma.leaveRequest.count({ where: { userId: sales } })).toBe(1);
  });

  it("aturan bentuk ditegakkan server: mundur terlalu jauh, cuti mundur, alasan kosong, foto asing", async () => {
    expect(await ajukan({ mulai: "2026-09-23", selesai: "2026-09-23" })).toEqual({ ok: false, kode: "TERLALU_LAMA_MUNDUR" });
    expect(await ajukan({ jenis: "CUTI", mulai: "2026-09-30", selesai: "2026-10-02" })).toEqual({
      ok: false,
      kode: "CUTI_TIDAK_BOLEH_MUNDUR",
    });
    expect(await ajukan({ alasan: " " })).toEqual({ ok: false, kode: "ALASAN_WAJIB" });
    expect(await ajukan({ fotoUrl: "https://contoh.com/x.jpg" })).toEqual({ ok: false, kode: "FOTO_TIDAK_SAH" });
    expect(await ajukan({ mulai: "2026-10-07", selesai: "2026-10-05" })).toEqual({ ok: false, kode: "SELESAI_SEBELUM_MULAI" });
    expect(await prisma.leaveRequest.count({ where: { userId: sales } })).toBe(0);
  });

  it("tidak ada yang memutuskan ajuannya sendiri — setuju, tolak, maupun batalkan", async () => {
    const id = idDari(await ajukan({ userId: kantor }));
    expect(await setujuiIzin({ leaveRequestId: id, olehUserId: kantor })).toEqual({ ok: false, kode: "MILIK_SENDIRI" });
    expect(await tolakIzin({ leaveRequestId: id, olehUserId: kantor, catatan: "x" })).toEqual({ ok: false, kode: "MILIK_SENDIRI" });
    expect((await prisma.leaveRequest.findUniqueOrThrow({ where: { id } })).status).toBe("DIAJUKAN");

    expect(await setujuiIzin({ leaveRequestId: id, olehUserId: kantorLain })).toEqual({ ok: true });
    expect(await batalkanIzin({ leaveRequestId: id, olehUserId: kantor, catatan: "x" })).toEqual({ ok: false, kode: "MILIK_SENDIRI" });
    expect((await prisma.leaveRequest.findUniqueOrThrow({ where: { id } })).status).toBe("DISETUJUI");
    expect(
      await prisma.auditLog.count({ where: { entityType: "LeaveRequest", entityId: id, action: { not: "LEAVE_REQUEST_SUBMITTED" } } }),
    ).toBe(1);
  });

  it("menyetujui: status, penyetuju, catatan opsional, jejak sebelum/sesudah", async () => {
    const id = idDari(await ajukan());
    expect(await setujuiIzin({ leaveRequestId: id, olehUserId: kantor, catatan: "  Hati-hati di jalan " })).toEqual({ ok: true });
    const row = await prisma.leaveRequest.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: "DISETUJUI", reviewedById: kantor, reviewNote: "Hati-hati di jalan" });
    expect(row.reviewedAt).toBeInstanceOf(Date);
    const j = await prisma.auditLog.findFirstOrThrow({ where: { entityType: "LeaveRequest", entityId: id, action: "LEAVE_REQUEST_APPROVED" } });
    expect(j.userId).toBe(kantor);
    expect(j.changes).toEqual({
      before: { status: "DIAJUKAN", reviewNote: null },
      after: { status: "DISETUJUI", reviewNote: "Hati-hati di jalan" },
    });
    // Sudah diputuskan: keputusan kedua ditolak, bukan ditimpa.
    expect(await tolakIzin({ leaveRequestId: id, olehUserId: kantorLain, catatan: "telat" })).toEqual({
      ok: false,
      kode: "SUDAH_DIPUTUSKAN",
    });
  });

  it("menolak butuh catatan; tanpa catatan tidak ada yang berubah", async () => {
    const id = idDari(await ajukan());
    expect(await tolakIzin({ leaveRequestId: id, olehUserId: kantor, catatan: "   " })).toEqual({ ok: false, kode: "CATATAN_WAJIB" });
    expect((await prisma.leaveRequest.findUniqueOrThrow({ where: { id } })).status).toBe("DIAJUKAN");
    expect(await tolakIzin({ leaveRequestId: id, olehUserId: kantor, catatan: "Jadwal kunjungan padat" })).toEqual({ ok: true });
    expect(await prisma.leaveRequest.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: "DITOLAK",
      reviewNote: "Jadwal kunjungan padat",
      reviewedById: kantor,
    });
    const j = await prisma.auditLog.findFirstOrThrow({ where: { entityType: "LeaveRequest", entityId: id, action: "LEAVE_REQUEST_REJECTED" } });
    expect(j.reason).toBe("Jadwal kunjungan padat");
  });

  it("dua penyetuju menekan bersamaan: tepat satu keputusan, tepat satu jejak keputusan", async () => {
    const id = idDari(await ajukan());
    const hasil = await Promise.all([
      setujuiIzin({ leaveRequestId: id, olehUserId: kantor }),
      tolakIzin({ leaveRequestId: id, olehUserId: kantorLain, catatan: "bentrok jadwal" }),
    ]);
    expect(hasil.filter((h) => h.ok)).toHaveLength(1);
    expect(hasil.filter((h) => !h.ok)).toEqual([{ ok: false, kode: "SUDAH_DIPUTUSKAN" }]);
    const jejak = await prisma.auditLog.findMany({
      where: { entityType: "LeaveRequest", entityId: id, action: { in: ["LEAVE_REQUEST_APPROVED", "LEAVE_REQUEST_REJECTED"] } },
    });
    expect(jejak).toHaveLength(1);
    const row = await prisma.leaveRequest.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe(jejak[0].action === "LEAVE_REQUEST_APPROVED" ? "DISETUJUI" : "DITOLAK");
  });

  it("pemohon menarik ajuannya yang masih menunggu; ajuan orang lain tidak 'ada' baginya", async () => {
    const id = idDari(await ajukan());
    expect(await tarikIzin({ leaveRequestId: id, userId: salesLain })).toEqual({ ok: false, kode: "TIDAK_DITEMUKAN" });
    expect(await tarikIzin({ leaveRequestId: id, userId: sales, alasan: "Tidak jadi pergi" })).toEqual({ ok: true });
    const row = await prisma.leaveRequest.findUniqueOrThrow({ where: { id } });
    // Menarik bukan keputusan kantor: kolom penyetuju tetap kosong.
    expect(row).toMatchObject({ status: "DIBATALKAN", reviewedById: null, reviewNote: null });
    const j = await prisma.auditLog.findFirstOrThrow({ where: { entityType: "LeaveRequest", entityId: id, action: "LEAVE_REQUEST_WITHDRAWN" } });
    expect(j).toMatchObject({ userId: sales, reason: "Tidak jadi pergi" });
    // Sekali ditarik, kantor tidak bisa lagi menyetujuinya.
    expect(await setujuiIzin({ leaveRequestId: id, olehUserId: kantor })).toEqual({ ok: false, kode: "SUDAH_DIPUTUSKAN" });
  });

  it("izin yang sudah disetujui: pemohon tidak bisa menarik; kantor bisa membatalkan dengan catatan", async () => {
    const id = idDari(await ajukan());
    // Membatalkan yang belum disetujui bukan jalan yang sah — kantor menolaknya.
    expect(await batalkanIzin({ leaveRequestId: id, olehUserId: kantor, catatan: "x" })).toEqual({
      ok: false,
      kode: "TRANSISI_TIDAK_SAH",
    });
    expect(await setujuiIzin({ leaveRequestId: id, olehUserId: kantor })).toEqual({ ok: true });
    expect(await tarikIzin({ leaveRequestId: id, userId: sales })).toEqual({ ok: false, kode: "SUDAH_DIPUTUSKAN" });
    expect(await batalkanIzin({ leaveRequestId: id, olehUserId: kantorLain, catatan: "" })).toEqual({
      ok: false,
      kode: "CATATAN_WAJIB",
    });
    expect(await batalkanIzin({ leaveRequestId: id, olehUserId: kantorLain, catatan: "Ternyata masuk kerja" })).toEqual({ ok: true });
    expect(await prisma.leaveRequest.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: "DIBATALKAN",
      reviewedById: kantorLain,
      reviewNote: "Ternyata masuk kerja",
    });
    const j = await prisma.auditLog.findFirstOrThrow({ where: { entityType: "LeaveRequest", entityId: id, action: "LEAVE_REQUEST_CANCELLED" } });
    expect(j.changes).toEqual({
      before: { status: "DISETUJUI", reviewNote: null },
      after: { status: "DIBATALKAN", reviewNote: "Ternyata masuk kerja" },
    });
    // Dibatalkan sekali: kedua kalinya sudah lewat.
    expect(await batalkanIzin({ leaveRequestId: id, olehUserId: kantor, catatan: "lagi" })).toEqual({
      ok: false,
      kode: "SUDAH_DIPUTUSKAN",
    });
    expect(await setujuiIzin({ leaveRequestId: "tidak-ada", olehUserId: kantor })).toEqual({ ok: false, kode: "TIDAK_DITEMUKAN" });
  });

  /** Rentang mulai `awal` yang berisi tepat `n` hari kerja (n ≥ 1). */
  const rentangHariKerja = (awal: string, n: number) => {
    let akhir = awal;
    while (hitungHariKerja(awal, akhir) < n) akhir = geserHari(akhir, 1);
    return akhir;
  };

  it("kuota cuti: yang disetujui dan yang menunggu sama-sama memakan kuota tahun itu", async () => {
    if (kuota < 2) return; // pengaturan setempat terlalu kecil untuk skenario ini
    // Kuota dipakai habis kecuali satu hari, oleh cuti 2031 yang disetujui (langsung di basis data).
    await prisma.leaveRequest.create({
      data: {
        userId: sales,
        type: "CUTI",
        startDay: "2031-03-03",
        endDay: rentangHariKerja("2031-03-03", kuota - 1),
        reason: "cuti panjang",
        status: "DISETUJUI",
      },
    });
    // Dua hari kerja (Senin–Selasa 2 Jun 2031): lewat satu.
    expect(await ajukan({ jenis: "CUTI", mulai: "2031-06-02", selesai: "2031-06-03" })).toEqual({
      ok: false,
      kode: "KUOTA_CUTI_HABIS",
      tahun: "2031",
      sisa: 1,
    });
    // Satu hari: pas — dan begitu menunggu, ia ikut memakan kuota.
    expect((await ajukan({ jenis: "CUTI", mulai: "2031-06-02", selesai: "2031-06-02" })).ok).toBe(true);
    expect(await ajukan({ jenis: "CUTI", mulai: "2031-06-09", selesai: "2031-06-09" })).toMatchObject({
      ok: false,
      kode: "KUOTA_CUTI_HABIS",
      sisa: 0,
    });
    // Izin dan sakit tidak terhalang kuota cuti.
    expect((await ajukan({ jenis: "IZIN", mulai: "2031-06-09", selesai: "2031-06-09" })).ok).toBe(true);
  });

  it("kuota cuti diperiksa ulang saat menyetujui, terhadap yang sudah disetujui", async () => {
    if (kuota < 2) return;
    const id = idDari(await ajukan({ jenis: "CUTI", mulai: "2031-06-02", selesai: "2031-06-03" }));
    // Sementara menunggu, cuti lain tahun itu disetujui lewat jalan lain dan menghabiskan kuota.
    await prisma.leaveRequest.create({
      data: {
        userId: sales,
        type: "CUTI",
        startDay: "2031-03-03",
        endDay: rentangHariKerja("2031-03-03", kuota - 1),
        reason: "cuti panjang",
        status: "DISETUJUI",
      },
    });
    expect(await setujuiIzin({ leaveRequestId: id, olehUserId: kantor })).toEqual({
      ok: false,
      kode: "KUOTA_CUTI_HABIS",
      tahun: "2031",
      sisa: 1,
    });
    expect((await prisma.leaveRequest.findUniqueOrThrow({ where: { id } })).status).toBe("DIAJUKAN");
    // Menolaknya tetap boleh.
    expect(await tolakIzin({ leaveRequestId: id, olehUserId: kantor, catatan: "Kuota habis" })).toEqual({ ok: true });
  });

  it("hari kerja pemohon: izin hari Minggu ditolak untuk salesman, diterima untuk SPG yang bekerja hari Minggu", async () => {
    // Minggu 4 Okt 2026. Hari kerja SPG dibaca dari pengaturan yang berlaku, tidak diubah.
    const minggu = { jenis: "IZIN", mulai: "2026-10-04", selesai: "2026-10-04" };
    expect(await ajukan(minggu)).toEqual({ ok: false, kode: "TANPA_HARI_KERJA" });
    const r = await ajukan({ ...minggu, userId: spg });
    if (!hariKerjaSpg.includes(0)) {
      expect(r).toEqual({ ok: false, kode: "TANPA_HARI_KERJA" });
      return;
    }
    const id = idDari(r);
    const jejak = await prisma.auditLog.findMany({ where: { entityType: "LeaveRequest", entityId: id } });
    expect(jejak[0].changes).toMatchObject({ after: { hariKerja: 1 } });
  });

  it("cuti SPG: kuota dihitung atas hari kerja SPG (Senin–Minggu memakan Minggu juga)", async () => {
    if (kuota < 7) return;
    // Senin 7 – Minggu 13 Juni 2032.
    const id = idDari(await ajukan({ userId: spg, jenis: "CUTI", mulai: "2032-06-07", selesai: "2032-06-13" }));
    const jejak = await prisma.auditLog.findMany({ where: { entityType: "LeaveRequest", entityId: id } });
    expect(jejak[0].changes).toMatchObject({ after: { hariKerja: hariKerjaSpg.length } });
    const idSales = idDari(await ajukan({ jenis: "CUTI", mulai: "2032-06-07", selesai: "2032-06-13" }));
    const jejakSales = await prisma.auditLog.findMany({ where: { entityType: "LeaveRequest", entityId: idSales } });
    expect(jejakSales[0].changes).toMatchObject({ after: { hariKerja: 6 } });
  });
});
