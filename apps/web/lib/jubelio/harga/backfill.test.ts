import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, usePostgres as pakaiPostgres } from "@elorae/db";
import { daftarHargaMenunggu } from "./queries";
import { buatFixtureHarga } from "./test-fixtures";

/*
 * Isian awal migrasi `20261102140000_jubelio_price_confirmation`: setiap barang yang sudah di
 * Jubelio dengan harga > 0 dikonfirmasi pada harga jualnya sekarang, supaya tidak ada yang menunggu
 * di hari pertama dan tidak ada yang pernah mengirim 0. Pernyataan UPDATE-nya dibaca dari berkas
 * migrasi itu sendiri lalu DIBATASI ke barang yang disemai tes ini — tanpa batas itu ia menyapu
 * seluruh tabel Item basis data uji, yang juga berisi data pengembangan sungguhan.
 */

const MIGRASI = resolve(
  __dirname,
  "../../../../../packages/db/prisma/migrations/20261102140000_jubelio_price_confirmation/migration.sql",
);

function pernyataanIsianAwal(): string {
  const tanpaKomentar = readFileSync(MIGRASI, "utf8")
    .split("\n")
    .filter((baris) => !baris.trimStart().startsWith("--"))
    .join("\n");
  const cocok = tanpaKomentar.match(/UPDATE `Item` i[\s\S]*?;/);
  if (!cocok) throw new Error("pernyataan isian awal tidak ditemukan di berkas migrasi");
  return cocok[0];
}

describe("teks isian awal migrasi konfirmasi harga Jubelio", () => {
  it("dijaga kedua kolom konfirmasi masih kosong, hanya harga > 0, hanya barang yang sudah di Jubelio", () => {
    const sql = pernyataanIsianAwal();
    expect(sql).toContain("i.`jubelioConfirmedAt` IS NULL");
    expect(sql).toContain("i.`jubelioConfirmedPrice` IS NULL");
    expect(sql).toContain("i.`sellingPrice` > 0");
    expect(sql).toMatch(/EXISTS \(SELECT 1 FROM `JubelioProductMapping` m WHERE m\.`itemId` = i\.`id`\)/);
    expect(sql).not.toMatch(/sellingPrice`\s*=/);
  });
});

const url = process.env.DATABASE_URL ?? "";
const prod = url.includes(":3307") || url.includes(":3306") || url.includes("api.elorae.cloud");
const d = prod || pakaiPostgres() ? describe.skip : describe;

d("isian awal migrasi konfirmasi harga Jubelio (MariaDB, test bed only)", () => {
  const fx = buatFixtureHarga();

  beforeEach(async () => {
    await fx.siapkan();
  });

  afterEach(async () => {
    await fx.bersihkan();
  });

  async function jalankan(ids: string[]) {
    if (ids.length === 0) throw new Error("tanpa barang yang disemai, isian awal akan menyapu seluruh tabel");
    const sql = pernyataanIsianAwal().replace(/\bWHERE\b/, `WHERE i.\`id\` IN (${ids.map(() => "?").join(", ")}) AND`);
    expect(sql).toContain("i.`id` IN (");
    return prisma.$executeRawUnsafe(sql, ...ids);
  }

  it("barang di Jubelio berharga dikonfirmasi pada harga jualnya dan TIDAK menunggu; yang lain tidak tersentuh", async () => {
    const berharga = await fx.barang({ terpetakan: true, sellingPrice: 100_000 });
    const tanpaHarga = await fx.barang({ terpetakan: true, sellingPrice: null });
    const nol = await fx.barang({ terpetakan: true, sellingPrice: 0 });
    const belumDiJubelio = await fx.barang({ sellingPrice: 100_000 });
    const ids = [berharga, tanpaHarga, nol, belumDiJubelio];

    expect(await jalankan(ids)).toBe(1);

    const b = await fx.baca(berharga);
    expect(b).toMatchObject({ harga: 100_000, dikonfirmasi: 100_000, dikonfirmasiOleh: null });
    expect(b.dikonfirmasiPada).toBeInstanceOf(Date);
    for (const id of [tanpaHarga, nol, belumDiJubelio]) expect((await fx.baca(id)).dikonfirmasi, id).toBeNull();

    const { baris } = await daftarHargaMenunggu({ hanyaBarang: ids });
    expect(baris.map((r) => r.itemId)).not.toContain(berharga);
  });

  it("dijalankan dua kali tidak mengubah apa pun", async () => {
    const id = await fx.barang({ terpetakan: true, sellingPrice: 100_000 });
    await jalankan([id]);
    const pertama = await fx.baca(id);
    await prisma.item.update({ where: { id }, data: { sellingPrice: 120_000 } });

    expect(await jalankan([id])).toBe(0);
    const kedua = await fx.baca(id);
    expect(kedua.dikonfirmasi).toBe(100_000);
    expect(kedua.dikonfirmasiPada?.toISOString()).toBe(pertama.dikonfirmasiPada?.toISOString());
  });
});
