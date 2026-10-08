import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { postJournal, prisma, seededId, seededIds } from "@elorae/db";
import type { AccountType } from "@/lib/constants/enums";

/*
 * Rekap masa PPN, setoran pajak, dan PPh final terhadap basis data sungguhan.
 *
 * Masa uji tahun 2007 (tidak dipakai tes lain — tes tutup buku memakai
 * 2001–2003). Pemetaan peran → akun dipalsukan lewat `resolveAccount` ke akun
 * uji berkas ini; profil pajak dipalsukan FINAL_UMKM. Tidak ada pengaturan
 * bersama yang diubah. Teardown lewat `seededId()`.
 */

const peta = vi.hoisted(() => ({ akun: new Map<string, string>() }));

vi.mock("@/lib/finance/journals/mapping", async (asli) => {
  const m = await asli<typeof import("@/lib/finance/journals/mapping")>();
  return {
    ...m,
    resolveAccount: vi.fn(async (role: string) => {
      const id = peta.akun.get(role);
      if (!id) throw new m.UnmappedRoleError(role);
      return id;
    }),
  };
});

vi.mock("@/lib/finance/pajak/profil-pengaturan", () => ({
  bacaProfilPajak: vi.fn(async () => ({ bentukUsaha: "PT_PERORANGAN", rezimPph: "FINAL_UMKM", sejak: null })),
}));

const { finalkanRekapPpn, bukaRekapPpn } = await import("./masa-writer");
const { rekapPpnMasa } = await import("./masa-queries");
const { catatSetoran, batalkanSetoran } = await import("./setoran-writer");
const { postingPphFinal, bukaPphFinal, hitungPphFinalMasa } = await import("./pph-final-writer");

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3306") || url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const PERAN: [string, AccountType][] = [
  ["AR", "ASET"],
  ["BANK", "ASET"],
  ["PPN_MASUKAN", "ASET"],
  ["PPH22_PREPAID", "ASET"],
  ["AP", "LIABILITAS"],
  ["PPN_KELUARAN", "LIABILITAS"],
  ["PPN_PAYABLE", "LIABILITAS"],
  ["PPH_FINAL_PAYABLE", "LIABILITAS"],
  ["SALES_REVENUE", "PENDAPATAN"],
  ["PPH_FINAL_EXPENSE", "BEBAN"],
];

const token = Math.floor(Math.random() * 1e7);
const SEKARANG = new Date("2008-06-15T03:00:00Z");
let userId = "";
const akunIds: string[] = [];
const recapIds: string[] = [];
const bayarIds: string[] = [];

const tgl = (hari: string) => new Date(`${hari}T05:00:00+07:00`);
const akun = (peran: string) => peta.akun.get(peran)!;

/** Penjualan ber-PPN tercatat (jurnal transaksi bermemo DPP). */
async function jual(hari: string, dpp: number, ppn: number) {
  await postJournal(prisma, {
    date: tgl(hari),
    description: `uji jual ${token}`,
    postedById: userId,
    lines: [
      { chartAccountId: akun("AR"), debit: dpp + ppn, credit: 0 },
      { chartAccountId: akun("SALES_REVENUE"), debit: 0, credit: dpp },
      { chartAccountId: akun("PPN_KELUARAN"), debit: 0, credit: ppn, memo: `DPP ${dpp.toFixed(2)}` },
    ],
  });
}

async function beli(hari: string, dpp: number, ppn: number) {
  await postJournal(prisma, {
    date: tgl(hari),
    description: `uji beli ${token}`,
    postedById: userId,
    lines: [
      { chartAccountId: akun("PPN_MASUKAN"), debit: ppn, credit: 0, memo: `DPP ${dpp.toFixed(2)}` },
      { chartAccountId: akun("AP"), debit: 0, credit: ppn },
    ],
  });
}

async function barisJurnal(sourceType: string, sourceId: string) {
  const j = await prisma.journal.findUnique({
    where: { sourceType_sourceId: { sourceType, sourceId } },
    select: { id: true, lines: { select: { chartAccountId: true, debit: true, credit: true } } },
  });
  const peranDari = new Map([...peta.akun.entries()].map(([r, id]) => [id, r]));
  return j
    ? j.lines.map((l) => [peranDari.get(l.chartAccountId), Number(l.debit), Number(l.credit)]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    : null;
}

async function rekap(masa: string) {
  const r = await prisma.taxPeriodRecap.findUnique({ where: { type_period: { type: "PPN", period: masa } } });
  if (r && !recapIds.includes(r.id)) recapIds.push(r.id);
  return r;
}

d("rekap masa PPN, setoran pajak, PPh final (basis data uji)", () => {
  beforeAll(async () => {
    userId = (await prisma.user.create({ data: { email: `pajak-${token}@test.local`, name: "Uji pajak" }, select: { id: true } })).id;
    for (const [i, [peran, tipe]] of PERAN.entries()) {
      const a = await prisma.chartAccount.create({
        data: { code: `8${token}${String(i).padStart(2, "0")}`, name: `${peran} (uji pajak)`, type: tipe, depth: 1, isActive: true },
        select: { id: true },
      });
      akunIds.push(a.id);
      peta.akun.set(peran, a.id);
    }
    // Sisa uji lama (bila tes sebelumnya terputus) tidak boleh menahan masa 2007.
    const sisa = await prisma.taxPeriodRecap.findMany({ where: { period: { startsWith: "2007-" }, type: { in: ["PPN", "PPH_FINAL"] } }, select: { id: true } });
    recapIds.push(...sisa.map((s) => s.id));
    await prisma.taxPeriodRecap.deleteMany({ where: { id: { in: seededIds(sisa.map((s) => s.id)) } } });
  }, 60_000);

  afterAll(async () => {
    const jurnal = await prisma.journal.findMany({ where: { postedById: seededId(userId) }, select: { id: true } });
    const ids = jurnal.map((j) => j.id);
    await prisma.journalLine.deleteMany({ where: { journalId: { in: seededIds(ids) } } });
    await prisma.journal.deleteMany({ where: { id: { in: seededIds(ids) } } });
    await prisma.auditLog.deleteMany({ where: { userId: seededId(userId) } });
    await prisma.taxPayment.deleteMany({ where: { id: { in: seededIds(bayarIds) } } });
    await prisma.taxPeriodRecap.deleteMany({ where: { id: { in: seededIds(recapIds) } } });
    await prisma.chartAccount.deleteMany({ where: { id: { in: seededIds(akunIds) } } });
    if (userId) await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  }, 60_000);

  it("kurang bayar: rekap dari buku besar, jurnal penyelesaian, jejak; final kedua ditolak", async () => {
    await jual("2007-03-05", 1_000_000, 110_000);
    await jual("2007-03-20", 2_000_000, 220_000);
    await beli("2007-03-10", 1_000_000, 110_000);
    const hidup = await rekapPpnMasa("2007-03");
    expect(hidup.rekap).toMatchObject({ keluaran: 330_000, keluaranDpp: 3_000_000, masukan: 110_000, masukanDpp: 1_000_000, kompensasi: 0, saldo: 220_000 });
    expect(hidup.rincian.barisTanpaDpp).toBe(0);

    expect(await finalkanRekapPpn({ masa: "2007-04", olehUserId: userId, sekarang: new Date("2007-04-10T03:00:00Z") })).toEqual({
      ok: false,
      kode: "MASA_BELUM_SELESAI",
    });
    const r = await finalkanRekapPpn({ masa: "2007-03", olehUserId: userId, sekarang: SEKARANG });
    expect(r).toMatchObject({ ok: true });
    expect(await barisJurnal("PPN_MASA", "2007-03#1")).toEqual([
      ["PPN_KELUARAN", 330_000, 0],
      ["PPN_MASUKAN", 0, 110_000],
      ["PPN_PAYABLE", 0, 220_000],
    ]);
    const row = await rekap("2007-03");
    expect(row).toMatchObject({ status: "FINAL" });
    expect(Number(row!.balance)).toBe(220_000);
    expect(await prisma.auditLog.count({ where: { action: "TAX_PPN_PERIOD_FINALIZED", entityId: row!.id } })).toBe(1);
    expect(await finalkanRekapPpn({ masa: "2007-03", olehUserId: userId, sekarang: SEKARANG })).toEqual({ ok: false, kode: "SUDAH_FINAL" });
  });

  it("lebih bayar dibawa sebagai kompensasi; urutan masa dijaga; buka kembali hanya masa terakhir dan membalik jurnal", async () => {
    await beli("2007-04-08", 3_000_000, 330_000);
    await jual("2007-04-09", 1_000_000, 110_000);
    await jual("2007-06-02", 5_000_000, 550_000);
    // 2007-05 belum final padahal ada PPN sebelum Juni → Juni ditolak.
    expect(await finalkanRekapPpn({ masa: "2007-06", olehUserId: userId, sekarang: SEKARANG })).toEqual({ ok: false, kode: "MASA_SEBELUM_BELUM_FINAL" });

    expect(await finalkanRekapPpn({ masa: "2007-04", olehUserId: userId, sekarang: SEKARANG })).toMatchObject({ ok: true });
    expect(await barisJurnal("PPN_MASA", "2007-04#1")).toEqual([
      ["PPN_KELUARAN", 110_000, 0],
      ["PPN_MASUKAN", 0, 110_000],
    ]);
    expect(Number((await rekap("2007-04"))!.balance)).toBe(-220_000);

    // Mei tanpa transaksi: kompensasi 220.000 lewat, tetap lebih bayar, tanpa jurnal.
    expect(await finalkanRekapPpn({ masa: "2007-05", olehUserId: userId, sekarang: SEKARANG })).toEqual({ ok: true, journalId: null });
    const mei = await rekap("2007-05");
    expect([Number(mei!.compensation), Number(mei!.balance)]).toEqual([220_000, -220_000]);

    // Juni: 550.000 − 0 − 220.000 = 330.000 kurang bayar; masukan dikredit sebesar kompensasi.
    expect(await finalkanRekapPpn({ masa: "2007-06", olehUserId: userId, sekarang: SEKARANG })).toMatchObject({ ok: true });
    expect(await barisJurnal("PPN_MASA", "2007-06#1")).toEqual([
      ["PPN_KELUARAN", 550_000, 0],
      ["PPN_MASUKAN", 0, 220_000],
      ["PPN_PAYABLE", 0, 330_000],
    ]);

    expect(await bukaRekapPpn({ masa: "2007-05", olehUserId: userId, alasan: "salah hitung" })).toEqual({ ok: false, kode: "MASA_SESUDAH_FINAL" });
    expect(await bukaRekapPpn({ masa: "2007-06", olehUserId: userId, alasan: "" })).toEqual({ ok: false, kode: "ALASAN_WAJIB" });
    const buka = await bukaRekapPpn({ masa: "2007-06", olehUserId: userId, alasan: "ada nota terlambat" });
    expect(buka).toMatchObject({ ok: true });
    expect(await barisJurnal("PPN_MASA_REVERSAL", "2007-06#1")).toEqual([
      ["PPN_KELUARAN", 0, 550_000],
      ["PPN_MASUKAN", 220_000, 0],
      ["PPN_PAYABLE", 330_000, 0],
    ]);
    expect((await rekap("2007-06"))!.status).toBe("DRAFT");
    // Nota terlambat, final lagi → generasi baru.
    await jual("2007-06-28", 1_000_000, 110_000);
    expect(await finalkanRekapPpn({ masa: "2007-06", olehUserId: userId, sekarang: SEKARANG })).toMatchObject({ ok: true });
    expect((await barisJurnal("PPN_MASA", "2007-06#2"))!.find((b) => b[0] === "PPN_PAYABLE")).toEqual(["PPN_PAYABLE", 0, 440_000]);
  });

  it("setoran: jurnal hutang/bank, idempoten, NTPN unik, masa yang sudah disetor tidak bisa dibuka, batal membalik", async () => {
    const isian = { jenis: "PPN", masa: "2007-03", jumlah: 220_000, tanggalBayar: "2007-04-28", ntpn: `A${String(token).padStart(15, "0")}`, hariIni: "2008-06-15" };
    const a = await catatSetoran({ ...isian, idempotencyKey: `kunci-${token}`, olehUserId: userId });
    expect(a).toMatchObject({ ok: true, ulang: false });
    if (!a.ok) throw new Error("setoran gagal");
    bayarIds.push(a.id);
    expect(await barisJurnal("TAX_PAYMENT", a.id)).toEqual([
      ["BANK", 0, 220_000],
      ["PPN_PAYABLE", 220_000, 0],
    ]);
    expect(await catatSetoran({ ...isian, idempotencyKey: `kunci-${token}`, olehUserId: userId })).toMatchObject({ ok: true, id: a.id, ulang: true });
    expect(await catatSetoran({ ...isian, idempotencyKey: `lain-${token}`, olehUserId: userId })).toEqual({ ok: false, kode: "NTPN_SUDAH_ADA" });
    expect(await catatSetoran({ ...isian, jenis: "PPH26", olehUserId: userId })).toEqual({ ok: false, kode: "JENIS_TIDAK_SAH" });

    // Masa 2007-03 sudah disetor: tidak boleh dibuka walau masa sesudahnya dibuka dulu.
    expect(await bukaRekapPpn({ masa: "2007-03", olehUserId: userId, alasan: "uji buka" })).toMatchObject({ ok: false });

    const batal = await batalkanSetoran({ id: a.id, olehUserId: userId, alasan: "salah NTPN" });
    expect(batal).toMatchObject({ ok: true });
    expect(await barisJurnal("TAX_PAYMENT_REVERSAL", a.id)).toEqual([
      ["BANK", 220_000, 0],
      ["PPN_PAYABLE", 0, 220_000],
    ]);
    expect(await batalkanSetoran({ id: a.id, olehUserId: userId, alasan: "salah NTPN" })).toEqual({ ok: false, kode: "SUDAH_DIBATALKAN" });
    // NTPN dari setoran yang dibatalkan boleh dipakai lagi.
    const ulang = await catatSetoran({ ...isian, idempotencyKey: `baru-${token}`, olehUserId: userId });
    expect(ulang).toMatchObject({ ok: true, ulang: false });
    if (ulang.ok) bayarIds.push(ulang.id);
  });

  it("balapan: dua finalisasi bersamaan → satu menang; dua kiriman setoran berkunci sama → satu setoran", async () => {
    await jual("2007-09-03", 1_000_000, 110_000);
    // 2007-07 dan 2007-08 tanpa PPN pada akun uji; final berurutan agar 09 boleh.
    for (const m of ["2007-07", "2007-08"]) expect(await finalkanRekapPpn({ masa: m, olehUserId: userId, sekarang: SEKARANG })).toMatchObject({ ok: true });
    await rekap("2007-07");
    await rekap("2007-08");
    const hasil = await Promise.all([1, 2].map(() => finalkanRekapPpn({ masa: "2007-09", olehUserId: userId, sekarang: SEKARANG })));
    expect(hasil.filter((h) => h.ok)).toHaveLength(1);
    expect(hasil.filter((h) => !h.ok)).toEqual([{ ok: false, kode: "SUDAH_FINAL" }]);
    await rekap("2007-09");
    expect(await prisma.journal.count({ where: { sourceType: "PPN_MASA", sourceId: { startsWith: "2007-09#" } } })).toBe(1);

    const isian = { jenis: "PPN", masa: "2007-09", jumlah: 110_000, tanggalBayar: "2007-10-20", ntpn: `B${String(token).padStart(15, "0")}`, hariIni: "2008-06-15" };
    const dua = await Promise.all([1, 2].map(() => catatSetoran({ ...isian, idempotencyKey: `balap-${token}`, olehUserId: userId })));
    expect(dua.every((h) => h.ok)).toBe(true);
    const ids = new Set(dua.map((h) => (h.ok ? h.id : "")));
    expect(ids.size).toBe(1);
    bayarIds.push(...ids);
    expect(await prisma.taxPayment.count({ where: { idempotencyKey: `balap-${token}` } })).toBe(1);
  });

  it("baris PPN tanpa memo DPP (jurnal manual): PPN ikut, DPP diperkirakan PPN ÷ tarif efektif", async () => {
    await postJournal(prisma, {
      date: tgl("2007-12-05"),
      description: `uji manual ${token}`,
      postedById: userId,
      isManual: true,
      lines: [
        { chartAccountId: akun("AR"), debit: 11_000, credit: 0 },
        { chartAccountId: akun("PPN_KELUARAN"), debit: 0, credit: 11_000 },
      ],
    });
    const r = await rekapPpnMasa("2007-12");
    expect(r.rincian.barisTanpaDpp).toBe(1);
    expect(r.rekap).toMatchObject({ keluaran: 11_000, keluaranDpp: 100_000 });
    expect(r.rincian.perSumber).toEqual([{ sourceType: null, keluaran: 11_000, masukan: 0, baris: 1 }]);
  });

  it("PPh final UMKM: 0,5% omzet buku besar dikurangi PPh 22 marketplace; buka kembali membalik", async () => {
    await postJournal(prisma, {
      date: tgl("2007-11-05"),
      description: `uji omzet ${token}`,
      postedById: userId,
      lines: [
        { chartAccountId: akun("AR"), debit: 100_000_000, credit: 0 },
        { chartAccountId: akun("SALES_REVENUE"), debit: 0, credit: 100_000_000 },
      ],
    });
    await postJournal(prisma, {
      source: { type: "SETTLEMENT", id: `uji-${token}` },
      date: tgl("2007-11-20"),
      description: `uji settlement ${token}`,
      postedById: userId,
      lines: [
        { chartAccountId: akun("PPH22_PREPAID"), debit: 100_000, credit: 0 },
        { chartAccountId: akun("AR"), debit: 0, credit: 100_000 },
      ],
    });
    const h = await hitungPphFinalMasa("2007-11");
    expect(h.hasil).toMatchObject({ omzet: 100_000_000, pajak: 500_000, kreditPph22: 100_000, terutang: 400_000 });
    expect(await postingPphFinal({ masa: "2007-11", olehUserId: userId, sekarang: SEKARANG })).toMatchObject({ ok: true, pajak: 500_000 });
    const r = await prisma.taxPeriodRecap.findUnique({ where: { type_period: { type: "PPH_FINAL", period: "2007-11" } } });
    recapIds.push(r!.id);
    expect(await barisJurnal("PPH_FINAL", "2007-11#1")).toEqual([
      ["PPH_FINAL_EXPENSE", 500_000, 0],
      ["PPH_FINAL_PAYABLE", 0, 400_000],
      ["PPH22_PREPAID", 0, 100_000],
    ]);
    expect(await postingPphFinal({ masa: "2007-11", olehUserId: userId, sekarang: SEKARANG })).toEqual({ ok: false, kode: "SUDAH_FINAL" });
    expect(await bukaPphFinal({ masa: "2007-11", olehUserId: userId, alasan: "koreksi omzet" })).toMatchObject({ ok: true });
    expect(await barisJurnal("PPH_FINAL_REVERSAL", "2007-11#1")).toEqual([
      ["PPH_FINAL_EXPENSE", 0, 500_000],
      ["PPH_FINAL_PAYABLE", 400_000, 0],
      ["PPH22_PREPAID", 100_000, 0],
    ]);
    // Kredit PPh 22 yang dibalik kembali tersedia: posting ulang memakai generasi 2.
    expect(await postingPphFinal({ masa: "2007-11", olehUserId: userId, sekarang: SEKARANG })).toMatchObject({ ok: true });
    expect(await barisJurnal("PPH_FINAL", "2007-11#2")).not.toBeNull();
  });
});
