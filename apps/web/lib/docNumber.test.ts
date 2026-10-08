import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DocType, prisma, seededId, seededIds } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { generateDocNumber, KOLOM_NOMOR_DOKUMEN, nomorSudahTerpakai } from "./docNumber";

/*
 * Penomoran dokumen terhadap basis data uji sungguhan.
 *
 * Yang dibuktikan:
 *  - generator melompati nomor yang SUDAH terpakai di tabel dokumennya (data
 *    lama yang dinomori dengan cara lain, mis. "nomor terbesar + 1"), alih-alih
 *    mengembalikannya lagi dan membuat transaksi pemanggil gagal unik terus;
 *  - panggilan paralel — dengan maupun tanpa transaksi — tidak pernah
 *    mendapat nomor yang sama;
 *  - periode reset NEVER (bisa dipilih di Pengaturan → Nomor Dokumen) terus
 *    menaikkan nomor, bukan kembali ke 1 di setiap panggilan;
 *  - setiap DocType terdaftar tabel + kolom nomornya, dan pemeriksanya jalan.
 *
 * Penghitung ADJ adalah baris bersama; tes ini hanya MENAIKKANNYA (celah nomor
 * tidak apa-apa), tidak pernah menurunkannya. Baris dokumen yang dibuat tes
 * dihapus hanya lewat id yang diseed.
 */

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const tag = `DOCN-${Math.random().toString(36).slice(2, 9)}`;

/** "ADJ/2026/10/0074" → { awalan: "ADJ/2026/10/", angka: 74, lebar: 4 } */
function urai(nomor: string) {
  const potong = nomor.lastIndexOf("/") + 1;
  const ekor = nomor.slice(potong);
  return { awalan: nomor.slice(0, potong), angka: Number.parseInt(ekor, 10), lebar: ekor.length };
}

d("penomoran dokumen (test bed only)", () => {
  let uomId = "";
  let itemId = "";
  let adjIds: string[] = [];

  beforeAll(async () => {
    uomId = "";
    itemId = "";
    adjIds = [];
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    itemId = (
      await prisma.item.create({
        data: { sku: tag, nameId: `Barang ${tag}`, nameEn: "Test", type: "FINISHED_GOOD", uomId, isActive: true },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.stockAdjustment.deleteMany({ where: { id: { in: seededIds(adjIds) } } });
    if (itemId) await prisma.item.delete({ where: { id: seededId(itemId) } });
    if (uomId) await prisma.uOM.delete({ where: { id: seededId(uomId) } });
  });

  async function seedPenyesuaian(docNumber: string) {
    const row = await prisma.stockAdjustment.create({
      data: {
        docNumber,
        itemId,
        type: "POSITIVE",
        qtyChange: 1,
        reason: `uji ${tag}`,
        prevQty: 0,
        newQty: 1,
        prevAvgCost: 0,
        newAvgCost: 0,
      },
      select: { id: true },
    });
    adjIds.push(row.id);
  }

  it("melompati nomor yang sudah terpakai di tabel dokumennya", async () => {
    const awal = urai(await generateDocNumber("ADJ"));
    const pad = (n: number) => String(n).padStart(awal.lebar, "0");
    // Data lama yang dinomori di luar penghitung: tiga nomor tepat di depannya.
    for (const n of [awal.angka + 1, awal.angka + 2, awal.angka + 3]) {
      await seedPenyesuaian(`${awal.awalan}${pad(n)}`);
    }

    const nomor = await generateDocNumber("ADJ");

    expect(await prisma.stockAdjustment.count({ where: { docNumber: nomor } })).toBe(0);
    const hasil = urai(nomor);
    expect(hasil.awalan).toBe(awal.awalan);
    expect(hasil.angka).toBeGreaterThan(awal.angka + 3);
  });

  it("nomor yang dilompati tidak dibagikan lagi oleh panggilan berikutnya", async () => {
    const a = urai(await generateDocNumber("ADJ"));
    await seedPenyesuaian(`${a.awalan}${String(a.angka + 1).padStart(a.lebar, "0")}`);
    const b = await generateDocNumber("ADJ");
    const c = await generateDocNumber("ADJ");
    expect(b).not.toBe(c);
    for (const n of [b, c]) {
      expect(await prisma.stockAdjustment.count({ where: { docNumber: n } })).toBe(0);
    }
  });

  it("panggilan paralel tanpa transaksi tidak pernah mendapat nomor yang sama", async () => {
    const nomor = await Promise.all(Array.from({ length: 12 }, () => generateDocNumber("ADJ")));
    expect(new Set(nomor).size).toBe(nomor.length);
  });

  it("panggilan paralel di transaksi masing-masing tidak pernah mendapat nomor yang sama", async () => {
    const nomor = await Promise.all(
      Array.from({ length: 8 }, () => prisma.$transaction((tx) => generateDocNumber("ADJ", tx))),
    );
    expect(new Set(nomor).size).toBe(nomor.length);
  });

  it("konflik serialisasi di penghitung diulang runSerializable, bukan dilempar", async () => {
    // Setiap transaksi membaca dulu (snapshot), lalu baru menaikkan penghitung:
    // di Serializable yang belakangan pasti bentrok di UPDATE penghitung. Galat
    // itu harus bisa diulang — dulu keluar sebagai P2010 mentah dan lolos dari
    // `isRetryableTxError`, jadi muat van / opname / NRI gagal alih-alih mengulang.
    const nomor = await Promise.all(
      Array.from({ length: 4 }, () =>
        runSerializable(async (tx) => {
          await tx.docNumberConfig.findUnique({ where: { docType: "ADJ" }, select: { id: true } });
          await new Promise((r) => setTimeout(r, 30));
          return generateDocNumber("ADJ", tx);
        }),
      ),
    );
    expect(new Set(nomor).size).toBe(nomor.length);
  });

  it("periode NEVER terus menaikkan nomor, tidak kembali ke 1", async () => {
    // RECEIPT jarang dipakai; hanya resetPeriod yang diubah lalu dikembalikan.
    // Satu panggilan biasa dulu supaya penghitung pasti ≥ 1 (dan barisnya ada).
    await generateDocNumber("RECEIPT");
    const sebelum = await prisma.docNumberConfig.findUniqueOrThrow({ where: { docType: "RECEIPT" } });
    try {
      await prisma.docNumberConfig.update({ where: { docType: "RECEIPT" }, data: { resetPeriod: "NEVER" } });
      const satu = urai(await generateDocNumber("RECEIPT"));
      const dua = urai(await generateDocNumber("RECEIPT"));
      expect(dua.angka).toBe(satu.angka + 1);
      expect(satu.angka).toBeGreaterThan(1);
    } finally {
      await prisma.docNumberConfig.update({
        where: { docType: "RECEIPT" },
        data: { resetPeriod: sebelum.resetPeriod },
      });
    }
  });

  it("setiap DocType punya tabel + kolom nomor yang bisa diperiksa", async () => {
    for (const jenis of Object.values(DocType)) {
      // Entri wajib ada: tanpa entri `nomorSudahTerpakai` diam-diam menjawab
      // false, jadi pemeriksaan di bawah saja tidak menangkap DocType baru.
      expect(KOLOM_NOMOR_DOKUMEN[jenis], jenis).toBeDefined();
      await expect(nomorSudahTerpakai(prisma, jenis, `${tag}-tidak-ada`), jenis).resolves.toBe(false);
    }
    const ada = urai(await generateDocNumber("ADJ"));
    const nomorAda = `${ada.awalan}${String(ada.angka + 1).padStart(ada.lebar, "0")}`;
    await seedPenyesuaian(nomorAda);
    await expect(nomorSudahTerpakai(prisma, "ADJ", nomorAda)).resolves.toBe(true);
  });

  it("nomor menurut tanggal DOKUMEN (bulan WIB), bukan bulan pencatatan; kembali ke bulan berjalan tanpa tabrakan", async () => {
    // Voucher bertanggal 31 Okt dicatat 1 Nov dulu bernomor BKK/…/11/…. CASHOUT: penghitung dikembalikan bila tidak disentuh orang lain.
    await generateDocNumber("CASHOUT");
    const sebelum = await prisma.docNumberConfig.findUniqueOrThrow({ where: { docType: "CASHOUT" } });
    let akhir: { year: number; month: number; lastNumber: number } | null = null;
    try {
      const maret = await generateDocNumber("CASHOUT", undefined, { tanggal: new Date("2002-03-31T20:00:00+07:00") });
      expect(maret.startsWith("BKK/2002/03/")).toBe(true);
      // 31 Mar 17:30 UTC = 1 Apr 00:30 WIB.
      const april = await prisma.$transaction((tx) => generateDocNumber("CASHOUT", tx, { tanggal: new Date("2002-03-31T17:30:00.000Z") }));
      expect(april.startsWith("BKK/2002/04/")).toBe(true);
      // Tanpa tanggal: bulan berjalan seperti dulu.
      const kini = new Date();
      const awalan = `BKK/${kini.getFullYear()}/${String(kini.getMonth() + 1).padStart(2, "0")}/`;
      const biasa = await generateDocNumber("CASHOUT");
      expect(biasa.startsWith(awalan)).toBe(true);
      // Kembali ke bulan berjalan: lanjut SESUDAH nomor terbesar yang sudah dipakai, tidak mengisi celah di bawahnya.
      const terpakai = await prisma.cashVoucher.findMany({ where: { docNumber: { startsWith: awalan } }, select: { docNumber: true } });
      const terbesar = Math.max(0, ...terpakai.map((v) => urai(v.docNumber).angka));
      expect(urai(biasa).angka).toBeGreaterThan(terbesar);
      const r = await prisma.docNumberConfig.findUniqueOrThrow({ where: { docType: "CASHOUT" } });
      akhir = { year: r.year, month: r.month, lastNumber: r.lastNumber };
    } finally {
      const kini = await prisma.docNumberConfig.findUniqueOrThrow({ where: { docType: "CASHOUT" } });
      if (akhir && kini.year === akhir.year && kini.month === akhir.month && kini.lastNumber === akhir.lastNumber && sebelum.year === akhir.year && sebelum.month === akhir.month) {
        await prisma.docNumberConfig.updateMany({
          where: { docType: "CASHOUT", lastNumber: akhir.lastNumber },
          data: { lastNumber: Math.max(sebelum.lastNumber, 0) },
        });
      }
    }
  });
});
