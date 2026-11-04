import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { parseDateOnly, parseDateOnlyEnd } from "@/lib/date-only";
import { muatNeracaSaldo } from "./neraca-saldo-queries";
import { muatLabaKanal } from "./laba-kanal-queries";
import { muatPerbandinganLabaRugi, muatPerbandinganNeraca } from "./perbandingan-queries";
import { muatRasio } from "./rasio-queries";
import type { SimpulNilai } from "./tampil-pohon";

/*
 * Pemuat laporan D6 di basis data sungguhan, Juni–Juli 2002 (jauh dari data
 * uji UJIAKUN). Laporan membaca seluruh buku besar, jadi tes hanya menilai
 * baris AKUN/KELOMPOK MILIKNYA sendiri — tidak pernah total seluruh buku.
 */

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes(":3306") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

function cari(akar: SimpulNilai[], id: string): SimpulNilai | null {
  for (const s of akar) {
    if (s.accountId === id) return s;
    const c = cari(s.children, id);
    if (c) return c;
  }
  return null;
}

d("laporan lanjutan (test bed only, 2002)", () => {
  let token = "";
  let userId = "";
  let kas = "";
  let modal = "";
  let beban = "";
  let pendapatan = "";
  let toko = "";
  const jurnal: string[] = [];

  beforeAll(async () => {
    userId = "";
    kas = "";
    modal = "";
    beban = "";
    pendapatan = "";
    jurnal.length = 0;
    token = Math.floor(Math.random() * 10_000_000).toString();
    toko = `toko-uji-d6-${token}`;
    userId = (await prisma.user.create({ data: { email: `uji-laporan-d6-${token}@test.local`, name: "Uji laporan D6" } })).id;
    kas = (await prisma.chartAccount.create({ data: { code: `9${token}71`, name: "Kas uji D6", type: "ASET", depth: 1 } })).id;
    modal = (await prisma.chartAccount.create({ data: { code: `9${token}72`, name: "Modal uji D6", type: "EKUITAS", depth: 1 } })).id;
    beban = (await prisma.chartAccount.create({ data: { code: `9${token}73`, name: "Beban uji D6", type: "BEBAN", depth: 1 } })).id;
    pendapatan = (await prisma.chartAccount.create({ data: { code: `9${token}74`, name: "Pendapatan uji D6", type: "PENDAPATAN", depth: 1 } })).id;

    const tulis = async (
      tanggal: string,
      baris: { chartAccountId: string; debit: number; credit: number; channel?: string; storeId?: string }[],
      sumber?: { sourceType: string; sourceId: string },
    ) => {
      const j = await prisma.journal.create({
        data: {
          date: new Date(tanggal),
          description: `Uji laporan D6 ${token}`,
          isManual: !sumber,
          ...(sumber ?? {}),
          postedById: userId,
          lines: { create: baris },
        },
      });
      jurnal.push(j.id);
    };

    // Saldo awal 30 Juni 2002.
    await tulis("2002-06-30T05:00:00.000Z", [
      { chartAccountId: kas, debit: 5000, credit: 0 },
      { chartAccountId: modal, debit: 0, credit: 5000 },
    ]);
    // Juli: beban tunai 350 (tanpa kanal), penjualan KOL 1.000 di toko uji, beban KOL 100.
    await tulis("2002-07-10T05:00:00.000Z", [
      { chartAccountId: beban, debit: 350, credit: 0 },
      { chartAccountId: kas, debit: 0, credit: 350 },
    ]);
    await tulis("2002-07-15T05:00:00.000Z", [
      { chartAccountId: kas, debit: 1000, credit: 0 },
      { chartAccountId: pendapatan, debit: 0, credit: 1000, channel: "KOL", storeId: toko },
      { chartAccountId: beban, debit: 100, credit: 0, channel: "KOL", storeId: toko },
      { chartAccountId: kas, debit: 0, credit: 100 },
    ]);
    // Jurnal KOL lama tanpa kanal: kanalnya diturunkan dari sumbernya.
    await tulis(
      "2002-07-20T05:00:00.000Z",
      [
        { chartAccountId: beban, debit: 50, credit: 0 },
        { chartAccountId: kas, debit: 0, credit: 50 },
      ],
      { sourceType: "KOL_FEE", sourceId: `uji-d6-${token}` },
    );
  });

  afterAll(async () => {
    const langkah: Array<() => Promise<unknown>> = [
      async () => {
        if (!jurnal.length) return;
        await prisma.journalLine.deleteMany({ where: { journalId: { in: seededIds(jurnal) } } });
        await prisma.journal.deleteMany({ where: { id: { in: seededIds(jurnal) } } });
      },
      () => prisma.chartAccount.deleteMany({ where: { id: { in: [seededId(kas), seededId(modal), seededId(beban), seededId(pendapatan)] } } }),
      async () => {
        if (userId) await prisma.user.delete({ where: { id: userId } });
      },
    ];
    for (const l of langkah) {
      try {
        await l();
      } catch (e) {
        console.error("[laporan-lanjutan-db.test] teardown", e);
      }
    }
  }, 60_000);

  it("Neraca Saldo Juli: saldo awal dari Juni, akun tanpa mutasi tetap tampil, saldo akhir positif", async () => {
    const tb = await muatNeracaSaldo({ from: parseDateOnly("2002-07-01"), to: parseDateOnlyEnd("2002-07-31")! });
    const baris = (id: string) => tb.rows.find((r) => r.accountId === id);
    expect(baris(kas)).toMatchObject({ opening: 5000, debit: 1000, credit: 500, closing: 5500 });
    expect(baris(modal)).toMatchObject({ opening: 5000, debit: 0, credit: 0, closing: 5000 });
    expect(baris(beban)).toMatchObject({ opening: 0, debit: 500, credit: 0, closing: 500 });
  });

  it("laba per kanal: baris berkanal + baris lama yang kanalnya diturunkan dari sumbernya", async () => {
    const r = await muatLabaKanal({ from: parseDateOnly("2002-07-01"), to: parseDateOnlyEnd("2002-07-31")!, kelompok: "kanal" });
    const kol = r.baris.find((b) => b.kunci === "KOL");
    expect(kol).toBeDefined();
    expect(kol!.pendapatanBersih).toBeGreaterThanOrEqual(1000);
    // 100 berkanal + 50 turunan dari KOL_FEE.
    expect(kol!.beban).toBeGreaterThanOrEqual(150);
    expect(r.barisTurunan).toBeGreaterThanOrEqual(1);
  });

  it("laba per toko dan saringan kanal", async () => {
    const r = await muatLabaKanal({ from: parseDateOnly("2002-07-01"), to: parseDateOnlyEnd("2002-07-31")!, kelompok: "toko", kanal: "KOL" });
    expect(r.baris.find((b) => b.kunci === toko)).toMatchObject({ pendapatanBersih: 1000, beban: 100, labaKotor: 1000, labaKontribusi: 900 });
  });

  it("perbandingan Laba Rugi: Juli 2002 vs Juni 2002 vs Juli 2001", async () => {
    const r = await muatPerbandinganLabaRugi({ dari: "2002-07-01", sampai: "2002-07-31" });
    expect(r.kolom.map((k) => k.dari)).toEqual(["2002-07-01", "2002-06-01", "2001-07-01"]);
    expect(cari(r.pendapatan, pendapatan)?.subtotal).toEqual([1000, 0, 0]);
    expect(cari(r.beban, beban)?.subtotal).toEqual([500, 0, 0]);
  });

  it("perbandingan Neraca: per 31 Juli vs per 30 Juni vs per 31 Juli tahun lalu", async () => {
    const r = await muatPerbandinganNeraca("2002-07-31");
    expect(r.kolom).toEqual(["2002-07-31", "2002-06-30", "2001-07-31"]);
    expect(cari(r.aset, kas)?.subtotal).toEqual([5500, 5000, 0]);
    expect(cari(r.ekuitas, modal)?.subtotal).toEqual([5000, 5000, 0]);
  });

  it("rasio: struktur lengkap untuk periode dan pembandingnya", async () => {
    const r = await muatRasio({ dari: "2002-07-01", sampai: "2002-07-31" });
    expect(r.sebelumnya).toEqual({ dari: "2002-06-01", sampai: "2002-06-30" });
    expect(r.ini.komponen.hari).toBe(31);
    expect(r.ini.komponen.pendapatan).toBeGreaterThanOrEqual(1000);
  });
});
