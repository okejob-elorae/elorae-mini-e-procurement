import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { postJournal, prisma, seededId, seededIds } from "@elorae/db";
import { ajukanJurnalManual, ajukanPembalik, KATEGORI_PERSETUJUAN_JURNAL, setujuiJurnal, tolakJurnal, ubahDrafJurnal } from "./writer";
import { JEJAK_JURNAL_MANUAL } from "./jejak";

/*
 * Jurnal manual ber-persetujuan di basis data sungguhan, TAHUN 2003 bulan
 * Juli–Agustus (tidak pernah berisi data sungguhan). Akun dan pengguna milik
 * tes ini; baris periode yang SUDAH ada sebelum tes tidak disentuh.
 */

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes(":3306") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const BULAN_UJI = [7, 8];

d("jurnal manual — persetujuan & pembalikan (test bed only, 2003)", () => {
  let token = "";
  let pembuat = "";
  let penyetuju = "";
  let penyetuju2 = "";
  let kas = "";
  let beban = "";
  let periodeLama: string[] = [];

  const baris = (n: number) => [
    { akunId: beban, debit: n, kredit: 0, memo: "uji" },
    { akunId: kas, debit: 0, kredit: n },
  ];

  beforeAll(async () => {
    pembuat = "";
    penyetuju = "";
    penyetuju2 = "";
    kas = "";
    beban = "";
    periodeLama = [];
    token = Math.floor(Math.random() * 10_000_000).toString();
    const ada = await prisma.accountingPeriod.findMany({ where: { year: 2003, month: { in: BULAN_UJI } }, select: { id: true } });
    periodeLama = ada.map((p) => p.id);
    pembuat = (await prisma.user.create({ data: { email: `uji-jm-a-${token}@test.local`, name: "Pembuat jurnal" } })).id;
    penyetuju = (await prisma.user.create({ data: { email: `uji-jm-b-${token}@test.local`, name: "Penyetuju jurnal" } })).id;
    penyetuju2 = (await prisma.user.create({ data: { email: `uji-jm-c-${token}@test.local`, name: "Penyetuju kedua" } })).id;
    kas = (await prisma.chartAccount.create({ data: { code: `9${token}71`, name: "Kas uji jurnal manual", type: "ASET", depth: 1 } })).id;
    beban = (await prisma.chartAccount.create({ data: { code: `9${token}72`, name: "Beban uji jurnal manual", type: "BEBAN", depth: 1 } })).id;
  });

  afterAll(async () => {
    const pengguna = [seededId(pembuat), seededId(penyetuju), seededId(penyetuju2)];
    let jurnalIds: string[] = [];
    const langkah: Array<() => Promise<unknown>> = [
      async () => {
        const j = await prisma.journal.findMany({ where: { postedById: { in: seededIds(pengguna) } }, select: { id: true } });
        jurnalIds = j.map((x) => x.id);
      },
      async () => {
        if (!jurnalIds.length) return;
        const n = await prisma.adminNotification.findMany({ where: { category: KATEGORI_PERSETUJUAN_JURNAL }, select: { id: true, metadata: true } });
        const ids = n.filter((x) => jurnalIds.includes(String((x.metadata as Record<string, unknown> | null)?.journalId ?? ""))).map((x) => x.id);
        if (ids.length) await prisma.adminNotification.deleteMany({ where: { id: { in: seededIds(ids) } } });
      },
      async () => {
        if (!jurnalIds.length) return;
        await prisma.journalLine.deleteMany({ where: { journalId: { in: seededIds(jurnalIds) } } });
        await prisma.journal.deleteMany({ where: { id: { in: seededIds(jurnalIds) }, reversalOfId: { not: null } } });
        await prisma.journal.deleteMany({ where: { id: { in: seededIds(jurnalIds) } } });
      },
      () => prisma.auditLog.deleteMany({ where: { userId: { in: seededIds(pengguna) } } }),
      async () => {
        const p = await prisma.accountingPeriod.findMany({ where: { year: 2003, month: { in: BULAN_UJI } }, select: { id: true } });
        const baru = p.map((x) => x.id).filter((id) => !periodeLama.includes(id));
        if (baru.length) await prisma.accountingPeriod.deleteMany({ where: { id: { in: seededIds(baru) } } });
      },
      () => prisma.chartAccount.deleteMany({ where: { id: { in: [seededId(kas), seededId(beban)] } } }),
      () => prisma.user.deleteMany({ where: { id: { in: seededIds(pengguna) } } }),
    ];
    for (const l of langkah) {
      try {
        await l();
      } catch (e) {
        console.error("[jurnal-manual.test] teardown", e);
      }
    }
  }, 60_000);

  it("pengajuan menjadi DRAF yang tidak dihitung; kiriman ulang dengan kunci yang sama mengembalikan draf yang sama", async () => {
    const kunci = `k-${token}-1`;
    const r = await ajukanJurnalManual({ tanggal: "2003-07-10", keterangan: "Penyesuaian uji", baris: baris(150_000), olehUserId: pembuat, idempotencyKey: kunci });
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    const j = await prisma.journal.findUniqueOrThrow({ where: { id: r.journalId }, select: { status: true, isManual: true, postedById: true } });
    expect(j).toEqual({ status: "DRAFT", isManual: true, postedById: pembuat });
    const saldo = await prisma.journalLine.aggregate({ where: { chartAccountId: kas, journal: { status: "POSTED" } }, _sum: { credit: true } });
    expect(Number(saldo._sum.credit ?? 0)).toBe(0);
    const ulang = await ajukanJurnalManual({ tanggal: "2003-07-10", keterangan: "Penyesuaian uji", baris: baris(150_000), olehUserId: pembuat, idempotencyKey: kunci });
    expect(ulang).toEqual({ ok: true, journalId: r.journalId, ulang: true });
    const jejak = await prisma.auditLog.count({ where: { action: JEJAK_JURNAL_MANUAL.DIAJUKAN, entityId: r.journalId } });
    expect(jejak).toBe(1);
  });

  it("menolak baris yang tidak seimbang dan keterangan lebih dari 191 karakter", async () => {
    expect(
      await ajukanJurnalManual({ tanggal: "2003-07-10", keterangan: "x", baris: [{ akunId: beban, debit: 5, kredit: 0 }, { akunId: kas, debit: 0, kredit: 4 }], olehUserId: pembuat }),
    ).toEqual({ ok: false, kode: "TIDAK_SEIMBANG" });
    expect(await ajukanJurnalManual({ tanggal: "2003-07-10", keterangan: "x".repeat(192), baris: baris(5), olehUserId: pembuat })).toEqual({
      ok: false,
      kode: "TEKS_TERLALU_PANJANG",
    });
  });

  it("pembuat tidak bisa menyetujui jurnalnya sendiri; orang lain bisa, sekali", async () => {
    const r = await ajukanJurnalManual({ tanggal: "2003-07-11", keterangan: "Uji setujui", baris: baris(10_000), olehUserId: pembuat });
    if (!r.ok) throw new Error(r.kode);
    const notifikasi = async () =>
      (await prisma.adminNotification.findMany({ where: { category: KATEGORI_PERSETUJUAN_JURNAL }, select: { readAt: true, metadata: true } })).filter(
        (n) => (n.metadata as Record<string, unknown> | null)?.journalId === r.journalId,
      );
    expect((await notifikasi()).map((n) => n.readAt)).toEqual([null]);
    expect(await setujuiJurnal({ id: r.journalId, olehUserId: pembuat })).toEqual({ ok: false, kode: "PEMBUAT_SAMA" });
    expect(await setujuiJurnal({ id: r.journalId, olehUserId: penyetuju })).toEqual({ ok: true, journalId: r.journalId });
    expect((await notifikasi()).every((n) => n.readAt != null)).toBe(true);
    const j = await prisma.journal.findUniqueOrThrow({ where: { id: r.journalId }, select: { status: true, approvedById: true, approvedAt: true } });
    expect(j.status).toBe("POSTED");
    expect(j.approvedById).toBe(penyetuju);
    expect(j.approvedAt).not.toBeNull();
    expect(await setujuiJurnal({ id: r.journalId, olehUserId: penyetuju2 })).toEqual({ ok: false, kode: "BUKAN_DRAF" });
    expect(await prisma.auditLog.count({ where: { action: JEJAK_JURNAL_MANUAL.DISETUJUI, entityId: r.journalId } })).toBe(1);
  });

  it("dua penyetuju yang balapan: tepat satu berhasil", async () => {
    const r = await ajukanJurnalManual({ tanggal: "2003-07-12", keterangan: "Uji balapan", baris: baris(20_000), olehUserId: pembuat });
    if (!r.ok) throw new Error(r.kode);
    const hasil = await Promise.all([setujuiJurnal({ id: r.journalId, olehUserId: penyetuju }), setujuiJurnal({ id: r.journalId, olehUserId: penyetuju2 })]);
    expect(hasil.filter((h) => h.ok)).toHaveLength(1);
    expect(hasil.filter((h) => !h.ok)).toEqual([{ ok: false, kode: "BUKAN_DRAF" }]);
    expect(await prisma.auditLog.count({ where: { action: JEJAK_JURNAL_MANUAL.DISETUJUI, entityId: r.journalId } })).toBe(1);
  });

  it("hanya pembuatnya yang mengubah draf; tolak wajib beralasan; penarikan oleh pembuat tercatat sebagai ditarik", async () => {
    const r = await ajukanJurnalManual({ tanggal: "2003-07-13", keterangan: "Uji ubah", baris: baris(30_000), olehUserId: pembuat });
    if (!r.ok) throw new Error(r.kode);
    expect(await ubahDrafJurnal({ id: r.journalId, tanggal: "2003-07-14", keterangan: "Diubah orang lain", baris: baris(31_000), olehUserId: penyetuju })).toEqual({
      ok: false,
      kode: "HANYA_PEMBUAT",
    });
    expect(await ubahDrafJurnal({ id: r.journalId, tanggal: "2003-07-14", keterangan: "Uji ubah 2", baris: baris(31_000), olehUserId: pembuat })).toEqual({
      ok: true,
      journalId: r.journalId,
    });
    const lines = await prisma.journalLine.findMany({ where: { journalId: r.journalId }, select: { debit: true } });
    expect(lines.reduce((s, l) => s + Number(l.debit), 0)).toBe(31_000);
    expect(await tolakJurnal({ id: r.journalId, alasan: "  ", olehUserId: penyetuju })).toEqual({ ok: false, kode: "ALASAN_WAJIB" });
    expect(await tolakJurnal({ id: r.journalId, alasan: "Salah akun, ajukan ulang", olehUserId: pembuat })).toEqual({ ok: true, journalId: r.journalId });
    const j = await prisma.journal.findUniqueOrThrow({ where: { id: r.journalId }, select: { status: true, rejectReason: true, rejectedById: true } });
    expect(j).toEqual({ status: "REJECTED", rejectReason: "Salah akun, ajukan ulang", rejectedById: pembuat });
    expect(await prisma.auditLog.count({ where: { action: JEJAK_JURNAL_MANUAL.DITARIK, entityId: r.journalId } })).toBe(1);
    expect(await setujuiJurnal({ id: r.journalId, olehUserId: penyetuju })).toEqual({ ok: false, kode: "BUKAN_DRAF" });
  });

  it("bulan yang sudah ditutup: pengajuan ditolak, dan draf di bulan yang ditutup sesudahnya tidak bisa disetujui", async () => {
    const r = await ajukanJurnalManual({ tanggal: "2003-08-05", keterangan: "Uji periode", baris: baris(40_000), olehUserId: pembuat });
    if (!r.ok) throw new Error(r.kode);
    await prisma.accountingPeriod.update({ where: { year_month: { year: 2003, month: 8 } }, data: { status: "CLOSED" } });
    try {
      expect(await setujuiJurnal({ id: r.journalId, olehUserId: penyetuju })).toEqual({ ok: false, kode: "PERIOD_CLOSED" });
      expect(await ajukanJurnalManual({ tanggal: "2003-08-06", keterangan: "Uji periode 2", baris: baris(1), olehUserId: pembuat })).toEqual({
        ok: false,
        kode: "PERIOD_CLOSED",
      });
    } finally {
      await prisma.accountingPeriod.update({ where: { year_month: { year: 2003, month: 8 } }, data: { status: "OPEN" } });
    }
    expect(await setujuiJurnal({ id: r.journalId, olehUserId: penyetuju })).toMatchObject({ ok: true });
  });

  it("pembalik: tanggal tidak sebelum aslinya, satu pembalik per jurnal, ditolak melepas tautan, disetujui membalik saldo", async () => {
    const r = await ajukanJurnalManual({ tanggal: "2003-07-20", keterangan: "Uji balik", baris: baris(55_000), olehUserId: pembuat });
    if (!r.ok) throw new Error(r.kode);
    expect(await ajukanPembalik({ id: r.journalId, tanggal: "2003-07-25", alasan: "Belum disetujui", olehUserId: pembuat })).toEqual({
      ok: false,
      kode: "TIDAK_BISA_DIBALIK",
    });
    await setujuiJurnal({ id: r.journalId, olehUserId: penyetuju });
    expect(await ajukanPembalik({ id: r.journalId, tanggal: "2003-07-19", alasan: "Salah catat", olehUserId: pembuat })).toEqual({
      ok: false,
      kode: "TANGGAL_SEBELUM_ASLI",
    });
    const p1 = await ajukanPembalik({ id: r.journalId, tanggal: "2003-07-25", alasan: "Salah catat", olehUserId: pembuat });
    if (!p1.ok) throw new Error(p1.kode);
    const draf = await prisma.journal.findUniqueOrThrow({
      where: { id: p1.journalId },
      select: { status: true, reversalOfId: true, isManual: true, lines: { select: { chartAccountId: true, debit: true, credit: true } } },
    });
    expect(draf.status).toBe("DRAFT");
    expect(draf.reversalOfId).toBe(r.journalId);
    expect(draf.lines.find((l) => l.chartAccountId === kas)).toMatchObject({ debit: expect.anything() });
    expect(Number(draf.lines.find((l) => l.chartAccountId === kas)!.debit)).toBe(55_000);
    expect(await ajukanPembalik({ id: r.journalId, tanggal: "2003-07-26", alasan: "Kedua kali", olehUserId: penyetuju })).toEqual({
      ok: false,
      kode: "PEMBALIK_MENUNGGU",
    });
    expect(await tolakJurnal({ id: p1.journalId, alasan: "Tanggal salah", olehUserId: penyetuju })).toMatchObject({ ok: true });
    expect((await prisma.journal.findUniqueOrThrow({ where: { id: p1.journalId }, select: { reversalOfId: true } })).reversalOfId).toBeNull();

    const p2 = await ajukanPembalik({ id: r.journalId, tanggal: "2003-07-31", alasan: "Salah catat", olehUserId: pembuat });
    if (!p2.ok) throw new Error(p2.kode);
    expect(await setujuiJurnal({ id: p2.journalId, olehUserId: penyetuju })).toEqual({ ok: true, journalId: p2.journalId });
    const saldo = await prisma.journalLine.aggregate({
      where: { chartAccountId: beban, journalId: { in: [r.journalId, p2.journalId] }, journal: { status: "POSTED" } },
      _sum: { debit: true, credit: true },
    });
    expect(Number(saldo._sum.debit) - Number(saldo._sum.credit)).toBe(0);
    expect(await ajukanPembalik({ id: r.journalId, tanggal: "2003-07-31", alasan: "Dibalik lagi", olehUserId: pembuat })).toEqual({ ok: false, kode: "SUDAH_DIBALIK" });
    expect(await prisma.journal.count({ where: { id: r.journalId } })).toBe(1);
  });

  it("jurnal otomatis tidak bisa dibalik lewat tombol Balik", async () => {
    const auto = await postJournal(prisma, {
      date: new Date("2003-07-05T03:00:00Z"),
      description: `uji otomatis ${token}`,
      postedById: pembuat,
      source: { type: "UJI_JM", id: `auto-${token}` },
      lines: [
        { chartAccountId: beban, debit: 1, credit: 0 },
        { chartAccountId: kas, debit: 0, credit: 1 },
      ],
    });
    expect(await ajukanPembalik({ id: auto.journalId, tanggal: "2003-07-06", alasan: "Coba balik", olehUserId: pembuat })).toEqual({
      ok: false,
      kode: "TIDAK_BISA_DIBALIK",
    });
  });
});
