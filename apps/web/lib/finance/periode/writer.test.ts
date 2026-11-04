import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { postJournal, prisma, seededId, seededIds } from "@elorae/db";

/*
 * Penulis tutup buku di basis data sungguhan, TAHUN 2002 (tidak pernah berisi
 * data sungguhan). Peran RETAINED_EARNINGS dipalsukan ke akun uji milik tes
 * ini — pemetaan akun bersama tidak disentuh.
 */
const akun = vi.hoisted(() => ({ labaDitahan: "" }));
vi.mock("@/lib/finance/journals/mapping", async (asli) => {
  const m = await asli<typeof import("@/lib/finance/journals/mapping")>();
  return {
    ...m,
    resolveAccount: async (role: string, client?: unknown) => {
      if (role === "RETAINED_EARNINGS") {
        if (!akun.labaDitahan) throw new m.UnmappedRoleError("RETAINED_EARNINGS" as never);
        return akun.labaDitahan;
      }
      return m.resolveAccount(role as never, client as never);
    },
  };
});

import { bukaBulan, bukaTahun, tutupBulan, tutupTahun } from "./writer";
import { nilaiDaftarPeriksa, rentangBulan, SUMBER_TUTUP_TAHUN, type DataPeriksa } from "./periode";
import { JEJAK_PERIODE } from "./jejak";
import { getAccountBalances } from "@/lib/finance/reports/balances";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes(":3306") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const TAHUN = 2002;
const SEKARANG = new Date("2026-10-08T03:00:00.000Z");

const LULUS: DataPeriksa = {
  jurnalDraf: 0,
  dokumenTanpaJurnal: { belum: "SEBELUM_TANGGAL_MULAI" },
  jurnalGagalTanpaTanggal: 0,
  rekonsiliasiBank: { belum: "BANK_BELUM_DIIMPOR" },
  penyusutan: { belum: "TANPA_ASET_TETAP" },
  rekapPpn: { belum: "BUKAN_PKP" },
  settlement: { belum: "TANPA_PENJUALAN_MARKETPLACE" },
};
const daftarLulus = nilaiDaftarPeriksa(LULUS);

d("tutup buku — penulis (test bed only, tahun 2002)", () => {
  let token = "";
  let userId = "";
  let kas = "";
  let pendapatan = "";
  let beban = "";

  const tgl = (bulan: number, hari: number) => new Date(Date.UTC(TAHUN, bulan - 1, hari, 3));

  async function jurnalUji(bulan: number, nilai: number, opsi: { status?: "DRAFT"; sumber?: string } = {}) {
    return postJournal(prisma, {
      date: tgl(bulan, 10),
      description: `uji tutup buku ${token}`,
      postedById: userId,
      ...(opsi.status ? { status: opsi.status, isManual: true, closedPeriod: "allow" as const } : {}),
      ...(opsi.sumber ? { source: { type: "UJI_TUTUP_BUKU", id: `${opsi.sumber}-${token}` } } : {}),
      lines: [
        { chartAccountId: kas, debit: nilai, credit: 0 },
        { chartAccountId: pendapatan, debit: 0, credit: nilai },
      ],
    });
  }

  const tutup = (bulan: number, setuju = false) =>
    tutupBulan({ tb: { tahun: TAHUN, bulan }, olehUserId: userId, setujuPeringatan: setuju, sekarang: SEKARANG, daftarPeriksa: daftarLulus });

  beforeAll(async () => {
    userId = "";
    kas = "";
    pendapatan = "";
    beban = "";
    akun.labaDitahan = "";
    token = Math.floor(Math.random() * 10_000_000).toString();
    userId = (await prisma.user.create({ data: { email: `uji-tutup-buku-${token}@test.local`, name: "Uji tutup buku" } })).id;
    kas = (await prisma.chartAccount.create({ data: { code: `9${token}61`, name: "Kas uji tutup", type: "ASET", depth: 1 } })).id;
    pendapatan = (await prisma.chartAccount.create({ data: { code: `9${token}62`, name: "Pendapatan uji tutup", type: "PENDAPATAN", depth: 1 } })).id;
    beban = (await prisma.chartAccount.create({ data: { code: `9${token}63`, name: "Beban uji tutup", type: "BEBAN", depth: 1 } })).id;
    akun.labaDitahan = (await prisma.chartAccount.create({ data: { code: `9${token}64`, name: "Laba ditahan uji", type: "EKUITAS", depth: 1 } })).id;
  });

  afterAll(async () => {
    const langkah: Array<() => Promise<unknown>> = [
      async () => {
        const j = await prisma.journal.findMany({ where: { postedById: seededId(userId) }, select: { id: true } });
        const ids = j.map((x) => x.id);
        if (!ids.length) return;
        // Pembalik menunjuk jurnal penutupnya (reversalOfId unik) — hapus pembalik dulu.
        await prisma.journalLine.deleteMany({ where: { journalId: { in: seededIds(ids) } } });
        await prisma.journal.deleteMany({ where: { id: { in: seededIds(ids) }, reversalOfId: { not: null } } });
        await prisma.journal.deleteMany({ where: { id: { in: seededIds(ids) } } });
      },
      () => prisma.auditLog.deleteMany({ where: { userId: seededId(userId) } }),
      async () => {
        const p = await prisma.accountingPeriod.findMany({ where: { year: { in: [TAHUN, TAHUN + 1] } }, select: { id: true } });
        if (p.length) await prisma.accountingPeriod.deleteMany({ where: { id: { in: seededIds(p.map((x) => x.id)) } } });
      },
      async () => {
        const y = await prisma.accountingYear.findMany({ where: { year: { in: [TAHUN - 1, TAHUN, TAHUN + 1] } }, select: { id: true } });
        if (y.length) await prisma.accountingYear.deleteMany({ where: { id: { in: seededIds(y.map((x) => x.id)) } } });
      },
      () => prisma.chartAccount.deleteMany({ where: { id: { in: [seededId(kas), seededId(pendapatan), seededId(beban), seededId(akun.labaDitahan)] } } }),
      async () => {
        if (userId) await prisma.user.delete({ where: { id: userId } });
      },
    ];
    for (const l of langkah) {
      try {
        await l();
      } catch (e) {
        console.error("[writer.test] teardown", e);
      }
    }
  }, 60_000);

  it("bulan yang belum berakhir tidak bisa ditutup", async () => {
    const r = await tutupBulan({ tb: { tahun: 2026, bulan: 10 }, olehUserId: userId, setujuPeringatan: true, sekarang: SEKARANG, daftarPeriksa: daftarLulus });
    expect(r).toEqual({ ok: false, kode: "BULAN_BELUM_BERAKHIR" });
  });

  it("menutup bulan: status, jejak di transaksi yang sama, dan tidak bisa ditutup dua kali", async () => {
    await jurnalUji(2, 1000);
    expect(await tutup(2)).toEqual({ ok: true });
    const p = await prisma.accountingPeriod.findUniqueOrThrow({ where: { year_month: { year: TAHUN, month: 2 } } });
    expect(p.status).toBe("CLOSED");
    expect(p.closedById).toBe(userId);
    const jejak = await prisma.auditLog.findFirst({ where: { action: JEJAK_PERIODE.BULAN_DITUTUP, entityId: p.id, userId } });
    expect(jejak?.metadata).toMatchObject({ bulan: `${TAHUN}-02` });
    expect(await tutup(2)).toEqual({ ok: false, kode: "SUDAH_DITUTUP" });
  });

  it("jurnal manual ke bulan tertutup ditolak; jurnal otomatis digeser ke bulan terbuka berikutnya", async () => {
    await expect(
      postJournal(prisma, {
        date: tgl(2, 20),
        description: "manual",
        postedById: userId,
        isManual: true,
        lines: [
          { chartAccountId: kas, debit: 1, credit: 0 },
          { chartAccountId: pendapatan, debit: 0, credit: 1 },
        ],
      }),
    ).rejects.toMatchObject({ code: "PERIOD_CLOSED" });
    const r = await jurnalUji(2, 500, { sumber: "geser" });
    const j = await prisma.journal.findUniqueOrThrow({ where: { id: r.journalId } });
    expect(j.date.toISOString()).toBe(rentangBulan({ tahun: TAHUN, bulan: 3 }).awal.toISOString());
    expect(j.originalDate?.toISOString()).toBe(tgl(2, 10).toISOString());
  });

  it("jurnal draf di bulan itu menahan penutupan walau daftar periksa yang diberikan lulus (diperiksa ulang di transaksi)", async () => {
    const draf = await jurnalUji(4, 10, { status: "DRAFT" });
    const r = await tutup(4);
    expect(r).toMatchObject({ ok: false, kode: "DAFTAR_PERIKSA_GAGAL", rincian: { butir: { jurnalDraf: 1 } } });
    await prisma.journalLine.deleteMany({ where: { journalId: seededId(draf.journalId) } });
    await prisma.journal.delete({ where: { id: draf.journalId } });
  });

  it("peringatan yang gagal butuh persetujuan; butir wajib yang gagal menahan", async () => {
    const peringatan = nilaiDaftarPeriksa({ ...LULUS, rekapPpn: { selesai: false } });
    const a = await tutupBulan({ tb: { tahun: TAHUN, bulan: 5 }, olehUserId: userId, setujuPeringatan: false, sekarang: SEKARANG, daftarPeriksa: peringatan });
    expect(a).toMatchObject({ ok: false, kode: "PERINGATAN_BELUM_DISETUJUI" });
    const wajib = nilaiDaftarPeriksa({ ...LULUS, dokumenTanpaJurnal: { jumlah: 2, rincian: [{ label: "GRN", jumlah: 2 }] } });
    const b = await tutupBulan({ tb: { tahun: TAHUN, bulan: 5 }, olehUserId: userId, setujuPeringatan: true, sekarang: SEKARANG, daftarPeriksa: wajib });
    expect(b).toMatchObject({ ok: false, kode: "DAFTAR_PERIKSA_GAGAL", rincian: { butir: { dokumenTanpaJurnal: 2 } } });
    expect(await tutupBulan({ tb: { tahun: TAHUN, bulan: 5 }, olehUserId: userId, setujuPeringatan: true, sekarang: SEKARANG, daftarPeriksa: peringatan })).toEqual({ ok: true });
    const mei = await prisma.accountingPeriod.findUniqueOrThrow({ where: { year_month: { year: TAHUN, month: 5 } } });
    const jejak = await prisma.auditLog.findFirst({ where: { action: JEJAK_PERIODE.BULAN_DITUTUP, entityId: mei.id } });
    expect(jejak?.metadata).toMatchObject({ bulan: `${TAHUN}-05`, peringatanDisetujui: true });
  });

  it("membuka kembali: alasan wajib, ditolak selama bulan sesudahnya tertutup, beralasan di jejak", async () => {
    expect(await tutup(3)).toEqual({ ok: true });
    expect(await bukaBulan({ tb: { tahun: TAHUN, bulan: 2 }, olehUserId: userId, alasan: "salah" })).toEqual({ ok: false, kode: "ALASAN_WAJIB" });
    expect(await bukaBulan({ tb: { tahun: TAHUN, bulan: 2 }, olehUserId: userId, alasan: "Koreksi nota retur Februari" })).toEqual({
      ok: false,
      kode: "BULAN_SESUDAHNYA_DITUTUP",
      rincian: { bulan: `${TAHUN}-03` },
    });
    expect(await bukaBulan({ tb: { tahun: TAHUN, bulan: 3 }, olehUserId: userId, alasan: "Koreksi nota retur Maret" })).toEqual({ ok: true });
    const p = await prisma.accountingPeriod.findUniqueOrThrow({ where: { year_month: { year: TAHUN, month: 3 } } });
    expect(p).toMatchObject({ status: "OPEN", reopenedById: userId, reopenReason: "Koreksi nota retur Maret" });
    const jejak = await prisma.auditLog.findFirst({ where: { action: JEJAK_PERIODE.BULAN_DIBUKA, entityId: p.id } });
    expect(jejak?.reason).toBe("Koreksi nota retur Maret");
    expect(await bukaBulan({ tb: { tahun: TAHUN, bulan: 3 }, olehUserId: userId, alasan: "Koreksi nota retur Maret" })).toEqual({ ok: false, kode: "SUDAH_TERBUKA" });
  });

  it("tutup tahun: menolak selama ada bulan terbuka; jurnal penutup memindah laba ke laba ditahan; laporan laba rugi mengabaikannya", async () => {
    // Beban 300 di Juni → laba tahun uji = pendapatan − beban milik tes ini.
    await postJournal(prisma, {
      date: tgl(6, 5),
      description: `uji beban ${token}`,
      postedById: userId,
      lines: [
        { chartAccountId: beban, debit: 300, credit: 0 },
        { chartAccountId: kas, debit: 0, credit: 300 },
      ],
    });
    const awal = await tutupTahun({ tahun: TAHUN, olehUserId: userId, sekarang: SEKARANG });
    expect(awal).toMatchObject({ ok: false, kode: "ADA_BULAN_TERBUKA" });

    for (let b = 1; b <= 12; b++) {
      const r = await tutup(b);
      if (!r.ok) expect(r.kode).toBe("SUDAH_DITUTUP");
    }
    const hasil = await tutupTahun({ tahun: TAHUN, olehUserId: userId, sekarang: SEKARANG });
    expect(hasil.ok).toBe(true);
    if (!hasil.ok) return;
    expect(hasil.journalId).toBeTruthy();
    const penutup = await prisma.journal.findUniqueOrThrow({ where: { id: hasil.journalId! }, include: { lines: true } });
    expect(penutup).toMatchObject({ sourceType: SUMBER_TUTUP_TAHUN, sourceId: `${TAHUN}` });
    const baris = (id: string) => penutup.lines.find((l) => l.chartAccountId === id);
    // Pendapatan uji 1000 + 500 (digeser ke Maret) = 1500; beban 300.
    expect(Number(baris(pendapatan)?.debit)).toBe(1500);
    expect(Number(baris(beban)?.credit)).toBe(300);
    expect(Number(baris(akun.labaDitahan)?.credit)).toBe(1200);

    const tahun = await prisma.accountingYear.findUniqueOrThrow({ where: { year: TAHUN } });
    expect(tahun).toMatchObject({ status: "CLOSED", closingJournalId: hasil.journalId });

    const rentang = { from: rentangBulan({ tahun: TAHUN, bulan: 1 }).awal, to: rentangBulan({ tahun: TAHUN, bulan: 12 }).akhir };
    const tanpaPenutup = await getAccountBalances(rentang);
    expect(tanpaPenutup.find((r) => r.accountId === pendapatan)?.signed).toBe(1500);
    const denganPenutup = await getAccountBalances({ to: rentang.to }, { sertakanTutupTahun: true });
    expect(denganPenutup.find((r) => r.accountId === pendapatan)?.signed).toBe(0);
    expect(denganPenutup.find((r) => r.accountId === akun.labaDitahan)?.signed).toBe(1200);

    expect(await tutupTahun({ tahun: TAHUN, olehUserId: userId, sekarang: SEKARANG })).toEqual({ ok: false, kode: "TAHUN_SUDAH_DITUTUP" });
    expect(await bukaBulan({ tb: { tahun: TAHUN, bulan: 12 }, olehUserId: userId, alasan: "Koreksi Desember tahun lalu" })).toEqual({
      ok: false,
      kode: "TAHUN_DITUTUP",
    });
  });

  it("buka tahun: jurnal penutup DIBALIK (tidak dihapus), bulan tetap tertutup; menutup lagi memakai generasi berikut", async () => {
    const tahunLama = await prisma.accountingYear.findUniqueOrThrow({ where: { year: TAHUN } });
    expect(await bukaTahun({ tahun: TAHUN, olehUserId: userId, alasan: "x" })).toEqual({ ok: false, kode: "ALASAN_WAJIB" });
    const buka = await bukaTahun({ tahun: TAHUN, olehUserId: userId, alasan: "Ada koreksi HPP Desember" });
    expect(buka.ok).toBe(true);
    if (!buka.ok) return;
    const pembalik = await prisma.journal.findUniqueOrThrow({ where: { id: buka.journalId! }, include: { lines: true } });
    expect(pembalik).toMatchObject({ sourceType: SUMBER_TUTUP_TAHUN, sourceId: `${TAHUN}#balik`, reversalOfId: tahunLama.closingJournalId });
    expect(Number(pembalik.lines.find((l) => l.chartAccountId === akun.labaDitahan)?.debit)).toBe(1200);
    expect(await prisma.journal.findUnique({ where: { id: tahunLama.closingJournalId! } })).not.toBeNull();

    const tahun = await prisma.accountingYear.findUniqueOrThrow({ where: { year: TAHUN } });
    expect(tahun).toMatchObject({ status: "OPEN", closingJournalId: null, reopenReason: "Ada koreksi HPP Desember" });
    const des = await prisma.accountingPeriod.findUniqueOrThrow({ where: { year_month: { year: TAHUN, month: 12 } } });
    expect(des.status).toBe("CLOSED");

    const kumulatif = await getAccountBalances({ to: rentangBulan({ tahun: TAHUN, bulan: 12 }).akhir }, { sertakanTutupTahun: true });
    expect(kumulatif.find((r) => r.accountId === pendapatan)?.signed).toBe(1500);
    expect(kumulatif.find((r) => r.accountId === akun.labaDitahan)?.signed ?? 0).toBe(0);

    const lagi = await tutupTahun({ tahun: TAHUN, olehUserId: userId, sekarang: SEKARANG });
    expect(lagi.ok).toBe(true);
    if (!lagi.ok) return;
    const generasi2 = await prisma.journal.findUniqueOrThrow({ where: { id: lagi.journalId! } });
    expect(generasi2.sourceId).toBe(`${TAHUN}#2`);
  });
});
