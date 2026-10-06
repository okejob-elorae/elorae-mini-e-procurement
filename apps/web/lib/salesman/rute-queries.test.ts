import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { ruteHariIni } from "./rute-queries";

/*
 * Rute hari ini (/pwa/rute) memakai toko menurun versi HP (`tokoMenurunHp`),
 * sama dengan rencana kunjungan beranda. Versi kantor (`tokoMenurun`) memuat
 * nilai 90 hari = total pesanan KONSI di toko konsinyasi, dan rencana rute
 * diurutkan dari rasio nilainya — posisi toko konsi di antara toko lain
 * membuka seberapa tajam total konsinya turun.
 *
 * Basis data uji sungguhan, pada tanggal lampau acak (tidak bertabrakan dengan
 * data pengembangan). Teardown hanya lewat id yang diseed.
 */

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const token = Math.random().toString(36).slice(2, 10);
const acak = (min: number, maks: number) => min + Math.floor(Math.random() * (maks - min + 1));
const HARI = `${acak(2001, 2019)}-${String(acak(1, 12)).padStart(2, "0")}-${String(acak(10, 28)).padStart(2, "0")}`;
const SEKARANG = new Date(`${HARI}T20:00:00+07:00`);
const HARI_MS = 86_400_000;
const hariLalu = (n: number) => new Date(SEKARANG.getTime() - n * HARI_MS);

// Empat pesanan di jendela lama (90–179 hari lalu) dan empat di jendela baru:
// jarak biasa 20 hari, terakhir 5 hari lalu — bukan JARANG, hanya NILAI_TURUN.
const LAMA = [170, 150, 130, 110];
const BARU = [65, 45, 25, 5];

d("ruteHariIni: toko menurun versi HP (test bed only)", () => {
  let sales = "";
  let tokoA = "";
  let tokoB = "";

  beforeAll(async () => {
    sales = "";
    tokoA = "";
    tokoB = "";
    sales = (await prisma.user.create({ data: { email: `rq-s-${token}@test.local`, name: `RQ Sales ${token}` } })).id;
    const toko = (kode: string) =>
      prisma.store.create({
        data: {
          code: `T-RQ-${kode}-${token}`,
          name: `RQ ${kode} ${token}`,
          address: `Jl. ${kode}`,
          termsType: "KONSI",
          marginPercent: 25,
          salesmanId: sales,
        },
      });
    tokoA = (await toko("A")).id;
    tokoB = (await toko("B")).id;

    // Toko A turun ke 40% (4 jt → 1,6 jt), toko B turun ke 10% (4 jt → 400 rb).
    // Versi kantor menaruh B di depan (turunnya paling tajam); versi HP tidak
    // punya rasio untuk toko konsi, jadi keduanya urut nama.
    let n = 0;
    const pesan = (storeId: string, hari: number, total: number) => {
      n += 1;
      const t = hariLalu(hari);
      return prisma.fieldSalesOrder.create({
        data: {
          orderNo: `RQ-${token}-${n}`,
          storeId,
          salesmanId: sales,
          orderType: "KONSI",
          status: "APPROVED",
          subtotal: total,
          total,
          approvedAt: t,
          approvedById: sales,
          createdAt: t,
        },
      });
    };
    for (const h of LAMA) {
      await pesan(tokoA, h, 1_000_000);
      await pesan(tokoB, h, 1_000_000);
    }
    for (const h of BARU) {
      await pesan(tokoA, h, 400_000);
      await pesan(tokoB, h, 100_000);
    }
  });

  afterAll(async () => {
    const toko = [tokoA, tokoB].filter(Boolean);
    await prisma.fieldSalesOrder.deleteMany({ where: { storeId: { in: seededIds(toko) } } });
    await prisma.store.deleteMany({ where: { id: { in: seededIds(toko) } } });
    await prisma.user.deleteMany({ where: { id: seededId(sales) } });
  });

  it("toko konsi tidak diurutkan menurut rasio total konsinya — urut nama, seperti beranda", async () => {
    const r = await ruteHariIni(sales, SEKARANG);

    expect(r.rencana).toEqual([tokoA, tokoB]);
    const alasan = new Map(r.toko.map((t) => [t.id, t.alasan?.menurun ?? null]));
    expect(alasan.get(tokoA)).toBe("NILAI_TURUN");
    expect(alasan.get(tokoB)).toBe("NILAI_TURUN");
  });

  it("payload tidak membawa rupiah atau rasio nilai toko", async () => {
    const r = await ruteHariIni(sales, SEKARANG);
    const json = JSON.stringify(r);

    for (const kunci of ["nilai90", "nilai90Sebelumnya", "rasioNilai", "total"]) {
      expect(json).not.toContain(`"${kunci}"`);
    }
    for (const angka of ["4000000", "1600000", "400000", "100000", "1000000"]) {
      expect(json).not.toContain(angka);
    }
  });
});

describe("penjaga sumber: rute hanya memakai toko menurun versi HP", () => {
  it("rute-queries.ts tidak mengimpor tokoMenurun kantor", () => {
    const sumber = readFileSync(join(__dirname, "rute-queries.ts"), "utf8");
    const diimpor = [...sumber.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from/g)].flatMap((m) =>
      m[1].split(",").map((b) => b.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim()),
    );
    expect(diimpor).toContain("tokoMenurunHp");
    expect(diimpor).not.toContain("tokoMenurun");
  });
});
