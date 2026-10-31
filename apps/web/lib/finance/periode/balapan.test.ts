import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JournalError, postJournal, prisma, seededId, seededIds } from "@elorae/db";
import { tutupBulan } from "./writer";
import { bulanWib, kunciBulan, nilaiDaftarPeriksa, rentangBulan } from "./periode";

/*
 * Balapan tutup bulan vs posting jurnal di bulan yang sama (basis data
 * sungguhan, TAHUN 2003). Yang dijaga: TIDAK ADA jurnal bertanggal di bulan
 * tertutup yang dibuat SESUDAH bulan itu ditutup. Posting yang kalah balapan
 * harus digeser (otomatis) atau ditolak (manual), tidak pernah menyelinap.
 *
 * Tanpa kunci baris periode di `postJournal`, poster yang membaca TERBUKA
 * sebelum penutup commit bisa menyisipkan jurnal sesudahnya — tes ini yang
 * menangkapnya (beberapa putaran supaya urutan keduanya sempat bertukar).
 */

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes(":3306") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const TAHUN = 2003;
const PUTARAN = [1, 2, 3, 4, 5, 6];
const SEKARANG = new Date("2026-10-08T03:00:00.000Z");
const lulus = nilaiDaftarPeriksa({
  jurnalDraf: 0,
  dokumenTanpaJurnal: { belum: "SEBELUM_TANGGAL_MULAI" },
  jurnalGagalTanpaTanggal: 0,
  rekonsiliasiBank: { belum: "BANK_BELUM_DIIMPOR" },
  penyusutan: { belum: "TANPA_ASET_TETAP" },
  rekapPpn: { belum: "BUKAN_PKP" },
  settlement: { belum: "TANPA_PENJUALAN_MARKETPLACE" },
});

d("balapan tutup bulan × posting jurnal (test bed only, tahun 2003)", () => {
  let token = "";
  let userId = "";
  let kas = "";
  let beban = "";

  beforeAll(async () => {
    userId = "";
    kas = "";
    beban = "";
    token = Math.floor(Math.random() * 10_000_000).toString();
    userId = (await prisma.user.create({ data: { email: `uji-balapan-periode-${token}@test.local`, name: "Uji balapan" } })).id;
    kas = (await prisma.chartAccount.create({ data: { code: `9${token}51`, name: "Kas uji balapan", type: "ASET", depth: 1 } })).id;
    beban = (await prisma.chartAccount.create({ data: { code: `9${token}52`, name: "Beban uji balapan", type: "BEBAN", depth: 1 } })).id;
  });

  afterAll(async () => {
    const langkah: Array<() => Promise<unknown>> = [
      async () => {
        const j = await prisma.journal.findMany({ where: { postedById: seededId(userId) }, select: { id: true } });
        if (!j.length) return;
        const ids = j.map((x) => x.id);
        await prisma.journalLine.deleteMany({ where: { journalId: { in: seededIds(ids) } } });
        await prisma.journal.deleteMany({ where: { id: { in: seededIds(ids) } } });
      },
      () => prisma.auditLog.deleteMany({ where: { userId: seededId(userId) } }),
      async () => {
        const p = await prisma.accountingPeriod.findMany({ where: { year: TAHUN }, select: { id: true } });
        if (p.length) await prisma.accountingPeriod.deleteMany({ where: { id: { in: seededIds(p.map((x) => x.id)) } } });
      },
      () => prisma.chartAccount.deleteMany({ where: { id: { in: [seededId(kas), seededId(beban)] } } }),
      async () => {
        if (userId) await prisma.user.delete({ where: { id: userId } });
      },
    ];
    for (const l of langkah) {
      try {
        await l();
      } catch (e) {
        console.error("[balapan.test] teardown", e);
      }
    }
  }, 60_000);

  const baris = (n: number) => [
    { chartAccountId: beban, debit: n, credit: 0 },
    { chartAccountId: kas, debit: 0, credit: n },
  ];

  it("penutup dan poster yang berbalapan tidak pernah meninggalkan jurnal di bulan tertutup sesudah ditutup", async () => {
    for (const bulan of PUTARAN) {
      const tanggal = new Date(Date.UTC(TAHUN, bulan - 1, 15, 3));
      const [tutup, otomatis, manual] = await Promise.allSettled([
        tutupBulan({ tb: { tahun: TAHUN, bulan }, olehUserId: userId, setujuPeringatan: true, sekarang: SEKARANG, daftarPeriksa: lulus }),
        postJournal(prisma, {
          date: tanggal,
          description: `otomatis ${bulan}`,
          postedById: userId,
          source: { type: "UJI_BALAPAN_PERIODE", id: `${token}-${bulan}` },
          lines: baris(100),
        }),
        postJournal(prisma, { date: tanggal, description: `manual ${bulan}`, postedById: userId, isManual: true, lines: baris(50) }),
      ]);

      expect(tutup.status === "fulfilled" ? tutup.value : tutup.reason).toEqual({ ok: true });
      expect(otomatis.status).toBe("fulfilled");
      if (manual.status === "rejected") {
        expect(manual.reason).toBeInstanceOf(JournalError);
        expect((manual.reason as JournalError).code).toBe("PERIOD_CLOSED");
      }

      const periode = await prisma.accountingPeriod.findUniqueOrThrow({ where: { year_month: { year: TAHUN, month: bulan } } });
      expect(periode.status).toBe("CLOSED");
      const { awal, akhir } = rentangBulan({ tahun: TAHUN, bulan });
      const diBulan = await prisma.journal.findMany({
        where: { postedById: userId, date: { gte: awal, lte: akhir } },
        select: { id: true, createdAt: true, description: true },
      });
      for (const j of diBulan) {
        expect(j.createdAt.getTime(), `${j.description} dibuat sesudah ${kunciBulan({ tahun: TAHUN, bulan })} ditutup`).toBeLessThanOrEqual(
          periode.closedAt!.getTime(),
        );
      }

      // Jurnal otomatis yang kalah balapan pindah ke bulan berikutnya, tanggal aslinya tersimpan.
      const auto = await prisma.journal.findUniqueOrThrow({
        where: { sourceType_sourceId: { sourceType: "UJI_BALAPAN_PERIODE", sourceId: `${token}-${bulan}` } },
      });
      const bulanAuto = bulanWib(auto.date);
      if (bulanAuto.bulan !== bulan) {
        expect(bulanAuto).toEqual({ tahun: TAHUN, bulan: bulan + 1 });
        expect(auto.originalDate?.toISOString()).toBe(tanggal.toISOString());
      }
    }
  }, 120_000);

  it("penutup MENUNGGU posting yang sedang berjalan di bulan itu sampai commit (kunci baris periode)", async () => {
    const bulan = 8;
    const tanggal = new Date(Date.UTC(TAHUN, bulan - 1, 10, 3));
    let posterSelesai = 0;
    let penutupSelesai = 0;
    const poster = prisma.$transaction(
      async (tx) => {
        const r = await postJournal(tx, { date: tanggal, description: "poster lambat", postedById: userId, lines: baris(10) });
        await new Promise((ok) => setTimeout(ok, 600));
        return r;
      },
      { timeout: 10_000 },
    ).then((r) => {
      posterSelesai = Date.now();
      return r;
    });
    await new Promise((ok) => setTimeout(ok, 150));
    const penutup = tutupBulan({ tb: { tahun: TAHUN, bulan }, olehUserId: userId, setujuPeringatan: true, sekarang: SEKARANG, daftarPeriksa: lulus }).then((r) => {
      penutupSelesai = Date.now();
      return r;
    });
    const [p, c] = await Promise.all([poster, penutup]);
    expect(c).toEqual({ ok: true });
    expect(penutupSelesai).toBeGreaterThanOrEqual(posterSelesai);
    const j = await prisma.journal.findUniqueOrThrow({ where: { id: p.journalId } });
    expect(bulanWib(j.date)).toEqual({ tahun: TAHUN, bulan });
  });

  it("dua penutup bersamaan: satu menutup, yang lain SUDAH_DITUTUP — satu jejak", async () => {
    const bulan = 9;
    const hasil = await Promise.all([
      tutupBulan({ tb: { tahun: TAHUN, bulan }, olehUserId: userId, setujuPeringatan: true, sekarang: SEKARANG, daftarPeriksa: lulus }),
      tutupBulan({ tb: { tahun: TAHUN, bulan }, olehUserId: userId, setujuPeringatan: true, sekarang: SEKARANG, daftarPeriksa: lulus }),
    ]);
    expect(hasil.filter((h) => h.ok)).toHaveLength(1);
    expect(hasil.find((h) => !h.ok)).toEqual({ ok: false, kode: "SUDAH_DITUTUP" });
    const p = await prisma.accountingPeriod.findUniqueOrThrow({ where: { year_month: { year: TAHUN, month: bulan } } });
    expect(await prisma.auditLog.count({ where: { entityId: p.id, action: "ACCOUNTING_PERIOD_CLOSED" } })).toBe(1);
  });
});
