import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { ajukanJurnalManual, KATEGORI_PERSETUJUAN_JURNAL, setujuiJurnal } from "./writer";

/*
 * Uji akuntansi gelombang 2, bug 4: sesudah bulan pertama buku ditutup,
 * jurnal manual bertanggal SEBELUM tanggal mulai buku besar (31 Juli, tanggal
 * mulai 1 Agustus) diterima sebagai draf dan bisa disetujui — mengubah neraca
 * bulan-bulan yang sudah ditutup. Sekarang: pengajuan ditolak, dan draf yang
 * diajukan sebelum penutupan tidak bisa disetujui sesudahnya.
 *
 * Tahun 2002 (tidak pernah berisi data sungguhan); tanggal mulai buku besar
 * diberikan lewat `UJI_TANGGAL_MULAI_BUKU` (kunci periode tidak membaca
 * pengaturan bersama di bawah vitest). Baris periode yang sudah ada tidak disentuh.
 */

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes(":3306") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("jurnal manual sebelum tanggal mulai buku besar (test bed only, 2002)", () => {
  let token = "";
  let pembuat = "";
  let penyetuju = "";
  let kas = "";
  let beban = "";
  let periodeLama = new Set<string>();

  const baris = (n: number) => [
    { akunId: beban, debit: n, kredit: 0, memo: "uji" },
    { akunId: kas, debit: 0, kredit: n },
  ];

  beforeAll(async () => {
    pembuat = "";
    penyetuju = "";
    kas = "";
    beban = "";
    process.env.UJI_TANGGAL_MULAI_BUKU = "2002-10-01";
    periodeLama = new Set((await prisma.accountingPeriod.findMany({ select: { id: true } })).map((p) => p.id));
    if (await prisma.accountingPeriod.findUnique({ where: { year_month: { year: 2002, month: 10 } }, select: { id: true } })) {
      throw new Error("Periode 2002-10 sudah ada di basis data uji — tes ini butuh bulan itu kosong");
    }
    token = Math.floor(Math.random() * 10_000_000).toString();
    pembuat = (await prisma.user.create({ data: { email: `uji-jmsb-a-${token}@test.local`, name: "Pembuat jurnal" } })).id;
    penyetuju = (await prisma.user.create({ data: { email: `uji-jmsb-b-${token}@test.local`, name: "Penyetuju jurnal" } })).id;
    kas = (await prisma.chartAccount.create({ data: { code: `9${token}51`, name: "Kas uji sebelum buku", type: "ASET", depth: 1 } })).id;
    beban = (await prisma.chartAccount.create({ data: { code: `9${token}52`, name: "Beban uji sebelum buku", type: "BEBAN", depth: 1 } })).id;
  });

  afterAll(async () => {
    delete process.env.UJI_TANGGAL_MULAI_BUKU;
    const pengguna = [seededId(pembuat), seededId(penyetuju)];
    const langkah: Array<() => Promise<unknown>> = [
      async () => {
        const j = await prisma.journal.findMany({ where: { postedById: { in: seededIds(pengguna) } }, select: { id: true } });
        const ids = j.map((x) => x.id);
        if (!ids.length) return;
        const n = await prisma.adminNotification.findMany({ where: { category: KATEGORI_PERSETUJUAN_JURNAL }, select: { id: true, metadata: true } });
        const milik = n.filter((x) => ids.includes(String((x.metadata as Record<string, unknown> | null)?.journalId ?? ""))).map((x) => x.id);
        if (milik.length) await prisma.adminNotification.deleteMany({ where: { id: { in: seededIds(milik) } } });
        await prisma.journalLine.deleteMany({ where: { journalId: { in: seededIds(ids) } } });
        await prisma.journal.deleteMany({ where: { id: { in: seededIds(ids) } } });
      },
      () => prisma.auditLog.deleteMany({ where: { userId: { in: seededIds(pengguna) } } }),
      async () => {
        const baru = (await prisma.accountingPeriod.findMany({ select: { id: true } })).map((p) => p.id).filter((id) => !periodeLama.has(id));
        if (baru.length) await prisma.accountingPeriod.deleteMany({ where: { id: { in: seededIds(baru) } } });
      },
      () => prisma.chartAccount.deleteMany({ where: { id: { in: [seededId(kas), seededId(beban)] } } }),
      () => prisma.user.deleteMany({ where: { id: { in: seededIds(pengguna) } } }),
    ];
    for (const l of langkah) {
      try {
        await l();
      } catch (e) {
        console.error("[jurnal-manual sebelum-buku] teardown", e);
      }
    }
  }, 60_000);

  it("draf 30 Sep diajukan saat Oktober terbuka; sesudah Oktober ditutup, draf itu tidak bisa disetujui dan pengajuan baru ditolak", async () => {
    const r = await ajukanJurnalManual({ tanggal: "2002-09-30", keterangan: "Koreksi sebelum buku", baris: baris(75_000), olehUserId: pembuat });
    if (!r.ok) throw new Error(r.kode);
    await prisma.accountingPeriod.upsert({
      where: { year_month: { year: 2002, month: 10 } },
      create: { year: 2002, month: 10, status: "CLOSED", closedAt: new Date() },
      update: { status: "CLOSED", closedAt: new Date() },
    });
    expect(await setujuiJurnal({ id: r.journalId, olehUserId: penyetuju })).toEqual({ ok: false, kode: "PERIOD_CLOSED" });
    expect(await ajukanJurnalManual({ tanggal: "2002-09-30", keterangan: "Koreksi lain", baris: baris(1), olehUserId: pembuat })).toEqual({
      ok: false,
      kode: "PERIOD_CLOSED",
    });
    expect((await prisma.journal.findUniqueOrThrow({ where: { id: r.journalId }, select: { status: true } })).status).toBe("DRAFT");
  });
});
