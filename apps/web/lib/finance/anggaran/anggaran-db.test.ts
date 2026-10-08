import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { simpanAnggaran, JEJAK_ANGGARAN } from "./writer";
import { bacaAnggaranTahun, bacaRealisasiBulanan, muatRealisasiVsAnggaran } from "./queries";
import { barisPohon, type SimpulNilai } from "@/lib/finance/reports/tampil-pohon";

/*
 * Anggaran di basis data sungguhan, TAHUN 2002 (jauh dari data uji UJIAKUN).
 * Akun, pengguna, dan jurnal milik tes sendiri; teardown lewat `seededId()`.
 */

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes(":3306") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const TAHUN = 2002;
const kosong = () => new Array<number | null>(12).fill(null);

function cari(akar: SimpulNilai[], id: string): SimpulNilai | null {
  for (const s of akar) {
    if (s.accountId === id) return s;
    const c = cari(s.children, id);
    if (c) return c;
  }
  return null;
}

d("anggaran (test bed only, tahun 2002)", () => {
  let token = "";
  let userId = "";
  let induk = "";
  let beban = "";
  let pendapatan = "";
  let aset = "";
  const jurnal: string[] = [];

  beforeAll(async () => {
    userId = "";
    induk = "";
    beban = "";
    pendapatan = "";
    aset = "";
    jurnal.length = 0;
    token = Math.floor(Math.random() * 10_000_000).toString();
    userId = (await prisma.user.create({ data: { email: `uji-anggaran-${token}@test.local`, name: "Uji anggaran" } })).id;
    induk = (await prisma.chartAccount.create({ data: { code: `9${token}60`, name: "Beban induk uji", type: "BEBAN", depth: 1 } })).id;
    beban = (await prisma.chartAccount.create({ data: { code: `9${token}61`, name: "Beban sewa uji", type: "BEBAN", depth: 2, parentId: induk } })).id;
    pendapatan = (await prisma.chartAccount.create({ data: { code: `9${token}62`, name: "Pendapatan uji", type: "PENDAPATAN", depth: 1 } })).id;
    aset = (await prisma.chartAccount.create({ data: { code: `9${token}63`, name: "Kas uji", type: "ASET", depth: 1 } })).id;

    // Maret 2002: beban 300 dibayar kas; penjualan 1.000 tunai.
    for (const [tanggal, baris] of [
      ["2002-03-15T05:00:00.000Z", [{ chartAccountId: beban, debit: 300, credit: 0 }, { chartAccountId: aset, debit: 0, credit: 300 }]],
      ["2002-03-20T05:00:00.000Z", [{ chartAccountId: aset, debit: 1000, credit: 0 }, { chartAccountId: pendapatan, debit: 0, credit: 1000 }]],
    ] as const) {
      const j = await prisma.journal.create({
        data: {
          date: new Date(tanggal),
          description: `Uji anggaran ${token}`,
          isManual: true,
          postedById: userId,
          lines: { create: baris.map((b) => ({ ...b })) },
        },
      });
      jurnal.push(j.id);
    }
  });

  afterAll(async () => {
    const langkah: Array<() => Promise<unknown>> = [
      async () => {
        if (!jurnal.length) return;
        await prisma.journalLine.deleteMany({ where: { journalId: { in: seededIds(jurnal) } } });
        await prisma.journal.deleteMany({ where: { id: { in: seededIds(jurnal) } } });
      },
      () => prisma.budget.deleteMany({ where: { chartAccountId: { in: [seededId(beban), seededId(pendapatan), seededId(induk)] } } }),
      () => prisma.auditLog.deleteMany({ where: { userId: seededId(userId) } }),
      () => prisma.chartAccount.deleteMany({ where: { id: { in: [seededId(beban), seededId(pendapatan), seededId(aset)] } } }),
      () => prisma.chartAccount.deleteMany({ where: { id: seededId(induk) } }),
      async () => {
        if (userId) await prisma.user.delete({ where: { id: userId } });
      },
    ];
    for (const l of langkah) {
      try {
        await l();
      } catch (e) {
        console.error("[anggaran-db.test] teardown", e);
      }
    }
  }, 60_000);

  it("menyimpan hanya sel yang berubah, dengan satu jejak per simpan", async () => {
    const bulanBeban = kosong();
    bulanBeban[0] = 250;
    bulanBeban[2] = 250;
    const bulanJual = kosong();
    bulanJual[2] = 1200;
    const r1 = await simpanAnggaran(
      { tahun: TAHUN, baris: [{ chartAccountId: beban, bulan: bulanBeban }, { chartAccountId: pendapatan, bulan: bulanJual }] },
      { olehUserId: userId },
    );
    expect(r1).toEqual({ ok: true, diubah: 3 });

    // Simpan ulang tanpa perubahan: tidak ada yang ditulis, tidak ada jejak baru.
    const r2 = await simpanAnggaran({ tahun: TAHUN, baris: [{ chartAccountId: beban, bulan: bulanBeban }] }, { olehUserId: userId });
    expect(r2).toEqual({ ok: true, diubah: 0 });

    // Kosongkan Januari, ubah Maret.
    const ubah = [...bulanBeban];
    ubah[0] = null;
    ubah[2] = 280;
    const r3 = await simpanAnggaran({ tahun: TAHUN, baris: [{ chartAccountId: beban, bulan: ubah }] }, { olehUserId: userId });
    expect(r3).toEqual({ ok: true, diubah: 2 });

    const tersimpan = await bacaAnggaranTahun(TAHUN);
    expect(tersimpan.get(beban)).toEqual([null, null, 280, null, null, null, null, null, null, null, null, null]);
    expect(tersimpan.get(pendapatan)?.[2]).toBe(1200);

    const jejak = await prisma.auditLog.findMany({
      where: { userId: seededId(userId), action: JEJAK_ANGGARAN.DIUBAH },
      orderBy: { createdAt: "asc" },
      select: { entityId: true, changes: true },
    });
    expect(jejak).toHaveLength(2);
    expect(jejak[1].entityId).toBe(String(TAHUN));
    expect((jejak[1].changes as { sel: unknown[] }).sel).toEqual(
      expect.arrayContaining([expect.objectContaining({ akun: beban, bulan: 1, sebelum: 250, sesudah: null })]),
    );
  });

  it("menolak akun induk dan akun neraca", async () => {
    expect(await simpanAnggaran({ tahun: TAHUN, baris: [{ chartAccountId: induk, bulan: kosong() }] }, { olehUserId: userId })).toEqual({
      ok: false,
      kode: "AKUN_TIDAK_SAH",
    });
    expect(await simpanAnggaran({ tahun: TAHUN, baris: [{ chartAccountId: aset, bulan: kosong() }] }, { olehUserId: userId })).toEqual({
      ok: false,
      kode: "AKUN_TIDAK_SAH",
    });
  });

  it("realisasi vs anggaran: Maret saja dan sejak Januari", async () => {
    const maret = await muatRealisasiVsAnggaran({ tahun: TAHUN, bulan: 3, cakupan: "bulan" });
    expect(cari(maret.beban, beban)?.subtotal).toEqual([280, 300]);
    expect(cari(maret.pendapatan, pendapatan)?.subtotal).toEqual([1200, 1000]);
    // Induk menjumlah anak.
    expect(cari(maret.beban, induk)?.subtotal).toEqual([280, 300]);
    expect(maret.akunBeranggaran).toEqual(expect.arrayContaining([beban, induk, pendapatan]));

    const ytd = await muatRealisasiVsAnggaran({ tahun: TAHUN, bulan: 2, cakupan: "ytd" });
    // Januari–Februari: anggaran beban Januari sudah dikosongkan, realisasi belum ada.
    expect(cari(ytd.beban, beban)?.subtotal).toEqual([0, 0]);
    expect(ytd.akunBeranggaran).not.toContain(beban);
    // Akun tanpa angka tidak tampil.
    expect(barisPohon(ytd.beban).some((b) => b.accountId === beban)).toBe(false);
  });

  it("realisasi bulanan untuk salin dari realisasi tahun lalu", async () => {
    const r = await bacaRealisasiBulanan(TAHUN);
    expect(r.get(beban)?.[2]).toBe(300);
    expect(r.get(pendapatan)?.[2]).toBe(1000);
    expect(r.get(beban)?.[0]).toBe(0);
  });
});
