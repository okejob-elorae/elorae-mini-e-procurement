import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { aktifkanTemplat, buatTemplat, hapusTemplat, hentikanTemplat, jalankanJurnalBerulang, postingBerulangSatu, ubahTemplat } from "./writer";
import { daftarTemplat, rincianTemplat } from "./queries";
import { cariBerulangTanpaJurnal } from "./sapuan";
import { JEJAK_BERULANG } from "./jejak";
import type { IsianTemplat } from "./aturan";

/*
 * Jurnal berulang di basis data sungguhan, TAHUN 2001 (tidak pernah berisi
 * data sungguhan). Akun dan pengguna milik tes ini; baris periode yang sudah
 * ada sebelum tes tidak dihapus.
 */

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes(":3306") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("jurnal berulang — templat, persetujuan, posting (test bed only, 2001)", () => {
  let token = "";
  let pembuat = "";
  let penyetuju = "";
  let beban = "";
  let akrual = "";
  let periodeLama: string[] = [];
  const templatIds: string[] = [];

  const isian = (x: Partial<IsianTemplat> = {}): IsianTemplat => ({
    nama: `Sewa uji ${token}`,
    hari: 15,
    mulai: "2001-01-15",
    balikOtomatis: true,
    baris: [
      { akunId: beban, debit: 2_000_000, kredit: 0, kanal: "LAINNYA" },
      { akunId: akrual, debit: 0, kredit: 2_000_000 },
    ],
    ...x,
  });

  async function buat(x: Partial<IsianTemplat> = {}) {
    const r = await buatTemplat({ ...isian(x), olehUserId: pembuat });
    if (!r.ok) throw new Error(`buatTemplat: ${r.kode}`);
    templatIds.push(r.id);
    return r.id;
  }

  beforeAll(async () => {
    pembuat = "";
    penyetuju = "";
    beban = "";
    akrual = "";
    periodeLama = [];
    templatIds.length = 0;
    token = Math.floor(Math.random() * 10_000_000).toString();
    periodeLama = (await prisma.accountingPeriod.findMany({ where: { year: 2001 }, select: { id: true } })).map((p) => p.id);
    pembuat = (await prisma.user.create({ data: { email: `uji-brl-a-${token}@test.local`, name: "Pembuat templat" } })).id;
    penyetuju = (await prisma.user.create({ data: { email: `uji-brl-b-${token}@test.local`, name: "Penyetuju templat" } })).id;
    beban = (await prisma.chartAccount.create({ data: { code: `9${token}91`, name: "Beban sewa uji", type: "BEBAN", depth: 1 } })).id;
    akrual = (await prisma.chartAccount.create({ data: { code: `9${token}92`, name: "Beban akrual uji", type: "LIABILITAS", depth: 1 } })).id;
  });

  afterAll(async () => {
    const pengguna = [seededId(pembuat), seededId(penyetuju)];
    const ids = [...templatIds];
    const langkah: Array<() => Promise<unknown>> = [
      async () => {
        const n = await prisma.adminNotification.findMany({ where: { category: { in: ["JOURNAL_PENDING", "JOURNAL_APPROVAL"] } }, select: { id: true, metadata: true } });
        const milik = n
          .filter((x) => {
            const m = (x.metadata as Record<string, unknown> | null) ?? {};
            return ids.some((id) => String(m.docId ?? "").startsWith(`${id}/`) || m.templatId === id);
          })
          .map((x) => x.id);
        if (milik.length) await prisma.adminNotification.deleteMany({ where: { id: { in: seededIds(milik) } } });
      },
      async () => {
        const j = await prisma.journal.findMany({ where: { postedById: { in: seededIds(pengguna) } }, select: { id: true } });
        const jid = j.map((x) => x.id);
        if (!jid.length) return;
        await prisma.journalLine.deleteMany({ where: { journalId: { in: seededIds(jid) } } });
        await prisma.journal.deleteMany({ where: { id: { in: seededIds(jid) }, reversalOfId: { not: null } } });
        await prisma.journal.deleteMany({ where: { id: { in: seededIds(jid) } } });
      },
      async () => {
        if (ids.length) await prisma.recurringJournal.deleteMany({ where: { id: { in: seededIds(ids) } } });
      },
      () => prisma.auditLog.deleteMany({ where: { userId: { in: seededIds(pengguna) } } }),
      async () => {
        const p = await prisma.accountingPeriod.findMany({ where: { year: 2001 }, select: { id: true } });
        const baru = p.map((x) => x.id).filter((id) => !periodeLama.includes(id));
        if (baru.length) await prisma.accountingPeriod.deleteMany({ where: { id: { in: seededIds(baru) } } });
      },
      () => prisma.chartAccount.deleteMany({ where: { id: { in: [seededId(beban), seededId(akrual)] } } }),
      () => prisma.user.deleteMany({ where: { id: { in: seededIds(pengguna) } } }),
    ];
    for (const l of langkah) {
      try {
        await l();
      } catch (e) {
        console.error("[berulang writer.test] teardown", e);
      }
    }
  }, 60_000);

  it("templat baru menunggu persetujuan orang lain; pembuatnya tidak bisa menyetujui", async () => {
    const id = await buat();
    const t = (await daftarTemplat(new Date("2001-01-20T00:00:00Z"))).find((x) => x.id === id);
    expect(t?.keadaan).toBe("MENUNGGU_PERSETUJUAN");
    expect(await aktifkanTemplat({ id, olehUserId: pembuat })).toEqual({ ok: false, kode: "PEMBUAT_SAMA" });
    expect(await aktifkanTemplat({ id, olehUserId: penyetuju })).toEqual({ ok: true, id, disetujui: true });
    expect(await aktifkanTemplat({ id, olehUserId: penyetuju })).toEqual({ ok: false, kode: "SUDAH_AKTIF" });
    // Belum aktif = tidak pernah diposting: templat lain yang menunggu tidak ikut.
    const lain = await buat({ nama: `Menunggu ${token}` });
    const r = await jalankanJurnalBerulang({ sekarang: new Date("2001-02-20T03:00:00Z"), olehUserId: penyetuju, templatIds: [lain], tanggalMulai: null });
    expect(r.diposting).toBe(0);
  });

  it("posting bulan jatuh tempo + pembalik akrual tanggal 1 bulan berikutnya; idempoten; bulan tertutup dilewati dengan catatan", async () => {
    const id = await buat({ nama: `Akrual ${token}` });
    await aktifkanTemplat({ id, olehUserId: penyetuju });
    // Bulan ditutup berurutan (A1): Januari ditutup, Februari dan Maret masih terbuka.
    await prisma.accountingPeriod.upsert({ where: { year_month: { year: 2001, month: 1 } }, create: { year: 2001, month: 1, status: "CLOSED" }, update: { status: "CLOSED" } });
    try {
      const sekarang = new Date("2001-04-10T03:00:00Z");
      const r = await jalankanJurnalBerulang({ sekarang, olehUserId: penyetuju, templatIds: [id], tanggalMulai: null });
      // Feb dan Mar; Jan ditutup; Apr tanggal 15 belum tiba.
      expect(r).toMatchObject({ diposting: 2, dibalik: 2, gagal: [] });
      expect(r.dilewati).toEqual([{ templatId: id, periode: "2001-01" }]);
      const jurnal = await prisma.journal.findMany({
        where: { sourceId: { startsWith: `${id}/` } },
        orderBy: { date: "asc" },
        select: { id: true, sourceType: true, sourceId: true, date: true, postedById: true, approvedById: true, reversalOfId: true, status: true },
      });
      // Tanggal WIB 00:00 = 17:00 UTC hari sebelumnya.
      expect(jurnal.map((j) => [j.sourceType, j.sourceId!.slice(-7), j.date.toISOString().slice(0, 10)])).toEqual([
        ["RECURRING", "2001-02", "2001-02-14"],
        ["RECURRING_REVERSAL", "2001-02", "2001-02-28"],
        ["RECURRING", "2001-03", "2001-03-14"],
        ["RECURRING_REVERSAL", "2001-03", "2001-03-31"],
      ]);
      expect(jurnal.every((j) => j.postedById === pembuat && j.approvedById === penyetuju && j.status === "POSTED")).toBe(true);
      expect(jurnal[1].reversalOfId).toBe(jurnal[0].id);
      const kanal = await prisma.journalLine.findFirst({ where: { journalId: jurnal[0].id, chartAccountId: beban }, select: { channel: true, debit: true } });
      expect(kanal).toMatchObject({ channel: "LAINNYA" });
      expect(Number(kanal?.debit)).toBe(2_000_000);

      const lagi = await jalankanJurnalBerulang({ sekarang, olehUserId: penyetuju, templatIds: [id], tanggalMulai: null });
      expect(lagi.diposting).toBe(0);
      expect(await prisma.auditLog.count({ where: { action: JEJAK_BERULANG.DILEWATI, entityId: id } })).toBe(1);
      const rinci = await rincianTemplat(id, sekarang, null);
      expect(rinci?.bulan.map((b) => [b.periode, b.keadaan])).toEqual([
        ["2001-03", "DIPOSTING"],
        ["2001-02", "DIPOSTING"],
        ["2001-01", "DILEWATI"],
      ]);
      expect(rinci?.postingTerakhir).toBe("2001-03");
    } finally {
      await prisma.accountingPeriod.update({ where: { year_month: { year: 2001, month: 1 } }, data: { status: "OPEN" } });
    }
  });

  it("mengubah isi menonaktifkan templat; persetujuan harus dari selain pengubahnya; lanjut sesudah dihentikan tanpa persetujuan baru", async () => {
    const id = await buat({ nama: `Ubah ${token}`, balikOtomatis: false });
    await aktifkanTemplat({ id, olehUserId: penyetuju });
    expect(await ubahTemplat({ ...isian({ nama: `Ubah ${token}`, balikOtomatis: false, hari: 20 }), id, olehUserId: penyetuju })).toEqual({ ok: true, id });
    const t = await prisma.recurringJournal.findUniqueOrThrow({ where: { id }, select: { active: true, dayOfMonth: true } });
    expect(t).toEqual({ active: false, dayOfMonth: 20 });
    expect(await aktifkanTemplat({ id, olehUserId: penyetuju })).toEqual({ ok: false, kode: "PEMBUAT_SAMA" });
    expect(await aktifkanTemplat({ id, olehUserId: pembuat })).toEqual({ ok: true, id, disetujui: true });
    expect(await hentikanTemplat({ id, olehUserId: pembuat })).toEqual({ ok: true, id });
    expect((await daftarTemplat(new Date("2001-01-20T00:00:00Z"))).find((x) => x.id === id)?.keadaan).toBe("DIHENTIKAN");
    // Dilanjutkan oleh pengubah terakhir pun boleh: isinya tidak berubah sejak disetujui.
    expect(await aktifkanTemplat({ id, olehUserId: penyetuju })).toEqual({ ok: true, id, disetujui: false });
    expect(await prisma.auditLog.count({ where: { action: JEJAK_BERULANG.DILANJUTKAN, entityId: id } })).toBe(1);
  });

  it("menghapus hanya templat yang belum pernah diposting", async () => {
    const id = await buat({ nama: `Hapus ${token}`, balikOtomatis: false, mulai: "2001-05-01", hari: 1 });
    await aktifkanTemplat({ id, olehUserId: penyetuju });
    await jalankanJurnalBerulang({ sekarang: new Date("2001-05-02T03:00:00Z"), olehUserId: penyetuju, templatIds: [id], tanggalMulai: null });
    expect(await hapusTemplat({ id, olehUserId: pembuat })).toEqual({ ok: false, kode: "SUDAH_DIPOSTING" });
    const kosong = await buat({ nama: `Hapus kosong ${token}` });
    expect(await hapusTemplat({ id: kosong, olehUserId: pembuat })).toEqual({ ok: true, id: kosong });
    expect(await prisma.recurringJournal.count({ where: { id: kosong } })).toBe(0);
  });

  it("sapuan: bulan jatuh tempo templat aktif yang belum berjurnal", async () => {
    const id = await buat({ nama: `Sapuan ${token}`, balikOtomatis: false, mulai: "2001-06-01", hari: 5 });
    await aktifkanTemplat({ id, olehUserId: penyetuju });
    const dok = await cariBerulangTanpaJurnal({ sejak: new Date("2001-05-31T17:00:00.000Z"), sampai: new Date("2001-08-03T17:00:00.000Z"), batas: 500 });
    expect(dok.filter((x) => x.id.startsWith(`${id}/`)).map((x) => x.id)).toEqual([`${id}/2001-06`, `${id}/2001-07`]);
  });

  it("menolak baris yang akunnya tidak bisa diposting", async () => {
    const induk = await prisma.chartAccount.create({ data: { code: `9${token}93`, name: "Induk uji", type: "BEBAN", depth: 1 } });
    const anak = await prisma.chartAccount.create({ data: { code: `9${token}931`, name: "Anak uji", type: "BEBAN", depth: 2, parentId: induk.id } });
    try {
      const r = await buatTemplat({
        ...isian({ baris: [{ akunId: induk.id, debit: 5, kredit: 0 }, { akunId: akrual, debit: 0, kredit: 5 }] }),
        olehUserId: pembuat,
      });
      expect(r).toEqual({ ok: false, kode: "NON_POSTABLE_ACCOUNT" });
    } finally {
      await prisma.chartAccount.delete({ where: { id: anak.id } });
      await prisma.chartAccount.delete({ where: { id: induk.id } });
    }
  });

  it("dua posting yang balapan untuk templat-bulan yang sama: satu jurnal (dan satu pembalik)", async () => {
    const id = await buat({ nama: `Balapan ${token}`, mulai: "2001-09-01", hari: 3 });
    await aktifkanTemplat({ id, olehUserId: penyetuju });
    const hasil = await Promise.all([
      postingBerulangSatu(id, { tahun: 2001, bulan: 9 }, penyetuju),
      postingBerulangSatu(id, { tahun: 2001, bulan: 9 }, penyetuju),
    ]);
    expect(hasil.map((h) => h.status).sort()).toEqual(["DIPOSTING", "SUDAH_ADA"]);
    expect(await prisma.journal.count({ where: { sourceId: `${id}/2001-09` } })).toBe(2);
  });
});
