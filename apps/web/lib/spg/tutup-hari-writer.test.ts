import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { bacaTutupHari, KUNCI_TUTUP_HARI, type AturanTutupHari } from "./pengaturan";
import { batasHariWib, ENTITAS_TUTUP_HARI, hariTutupYangBoleh, JEJAK_TUTUP_HARI, ringkasanUntukHp } from "./tutup-hari";
import { daftarTutupHariKantor, pesanWaLaporan, rekapTutupHariKantor, rincianTutupHariKantor, ringkasanTutupHari } from "./tutup-hari-queries";
import { ingatkanTutupHari } from "./tutup-hari-pengingat";
import { kirimTutupHari } from "./tutup-hari-writer";

/*
 * Laporan tutup hari terhadap basis data uji. Semua baris dibuat tes ini dan
 * dihapus lewat id (`seededId`). Sapuan pengingat DIBATASI ke toko buatan tes
 * (`storeIds`) — basis datanya dipakai bersama. Hari = hari ini WIB saat tes
 * berjalan; nota "kemarin" dibuat 26 jam sebelum awal hari ini.
 */

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const tag = `TTH-${Math.random().toString(36).slice(2, 9)}`;
const JAM_MS = 3_600_000;

d("laporan tutup hari SPG (test bed only)", () => {
  let uomId = "";
  let item1 = "";
  let item2 = "";
  let tokoA = "";
  let tokoB = "";
  let tokoC = "";
  let spg1 = "";
  let spg2 = "";
  let spgB = "";
  let spgC = "";
  let fotoSpg1 = "";
  let fotoSpg2 = "";
  let fotoLain = "";
  let saleIds: string[] = [];
  let returIds: string[] = [];
  let receiptIds: string[] = [];
  let lostIds: string[] = [];
  let visitIds: string[] = [];
  let aturan: AturanTutupHari = bacaTutupHari(null);
  let day = "";

  const jual = async (storeId: string, salesmanId: string, createdAt: Date, baris: { itemId: string; nama: string; qty: number; harga: number; bersih: number }[], diskon = 0) => {
    const subtotal = baris.reduce((s, b) => s + b.qty * b.harga, 0);
    const total = baris.reduce((s, b) => s + b.bersih, 0);
    const s = await prisma.spgSale.create({
      data: {
        docNo: `${tag}/${saleIds.length + 1}`,
        salesmanId,
        storeId,
        subtotal,
        total,
        discountTotal: diskon,
        cashReceived: total,
        changeGiven: 0,
        createdById: salesmanId,
        createdAt,
        lines: { create: baris.map((b) => ({ itemId: b.itemId, productName: b.nama, qty: b.qty, unitPrice: b.harga, lineTotal: b.bersih })) },
      },
      select: { id: true, lines: { select: { id: true, itemId: true } } },
    });
    saleIds.push(s.id);
    return s;
  };

  beforeAll(async () => {
    uomId = "";
    item1 = "";
    item2 = "";
    tokoA = "";
    tokoB = "";
    tokoC = "";
    spg1 = "";
    spg2 = "";
    spgB = "";
    spgC = "";
    fotoSpg1 = "";
    fotoSpg2 = "";
    fotoLain = "";
    saleIds = [];
    returIds = [];
    receiptIds = [];
    lostIds = [];
    visitIds = [];

    const setelan = await prisma.systemSetting.findUnique({ where: { key: KUNCI_TUTUP_HARI }, select: { value: true } });
    aturan = bacaTutupHari(setelan?.value);
    day = hariTutupYangBoleh(new Date()).hariIni;
    const { awal } = batasHariWib(day);
    const pagi = new Date(awal.getTime() + 1000);
    const kemarin = new Date(awal.getTime() - 2 * JAM_MS);

    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    item1 = (await prisma.item.create({ data: { sku: `${tag}-1`, nameId: "Kaos Uji", nameEn: "Tee", type: "FINISHED_GOOD", uomId } })).id;
    item2 = (await prisma.item.create({ data: { sku: `${tag}-2`, nameId: "Topi Uji", nameEn: "Cap", type: "FINISHED_GOOD", uomId } })).id;
    const toko = (k: string) => prisma.store.create({ data: { code: `${tag}-${k}`, name: `Toko ${k} ${tag}`, address: "uji", termsType: "PUTUS" } });
    tokoA = (await toko("A")).id;
    tokoB = (await toko("B")).id;
    tokoC = (await toko("C")).id;
    const orang = (k: string, storeId: string) =>
      prisma.user.create({ data: { email: `${tag}-${k}@test.local`.toLowerCase(), name: `SPG ${k}`, assignedStoreId: storeId } });
    spg1 = (await orang("1", tokoA)).id;
    spg2 = (await orang("2", tokoA)).id;
    spgB = (await orang("b", tokoB)).id;
    spgC = (await orang("c", tokoC)).id;
    const foto = (oleh: string) => prisma.foto.create({ data: { mime: "image/jpeg", bytes: Buffer.from([1, 2, 3]), sizeBytes: 3, uploadedById: oleh } });
    fotoSpg1 = (await foto(spg1)).id;
    fotoSpg2 = (await foto(spg2)).id;
    fotoLain = (await foto(spgB)).id;

    // Toko A hari ini: dua SPG menjual. Nota spg1 berpromo (kotor 200rb, bersih 160rb).
    await jual(tokoA, spg1, pagi, [{ itemId: item1, nama: "Kaos Uji — M", qty: 2, harga: 100_000, bersih: 160_000 }], 40_000);
    await jual(tokoA, spg2, pagi, [{ itemId: item2, nama: "Topi Uji", qty: 1, harga: 50_000, bersih: 50_000 }]);
    // Kemarin: tidak ikut hitungan hari ini, tapi barangnya dikembalikan HARI INI.
    const lama = await jual(tokoA, spg1, kemarin, [{ itemId: item1, nama: "Kaos Uji — M", qty: 2, harga: 100_000, bersih: 180_000 }]);
    // Toko lain hari ini: tidak boleh bocor ke toko A.
    await jual(tokoB, spgB, pagi, [{ itemId: item1, nama: "Kaos Uji — M", qty: 5, harga: 100_000, bersih: 500_000 }]);
    // Toko C berjualan hari ini tapi SPG-nya tidak check-in: tidak ada yang diingatkan.
    await jual(tokoC, spgC, pagi, [{ itemId: item2, nama: "Topi Uji", qty: 1, harga: 50_000, bersih: 50_000 }]);

    returIds.push(
      (
        await prisma.spgSaleReturn.create({
          data: {
            spgSaleId: lama.id,
            storeId: tokoA,
            createdById: spg1,
            reason: "uji",
            idempotencyKey: `${tag}-r1`,
            createdAt: pagi,
            lines: { create: [{ spgSaleLineId: lama.lines[0].id, itemId: item1, qty: 1 }] },
          },
        })
      ).id,
    );
    receiptIds.push(
      (
        await prisma.storeReceipt.create({
          data: {
            storeId: tokoA,
            sourceType: "PUTUS_DELIVERY",
            sourceId: `${tag}-src`,
            sourceDocNo: `DLV/${tag}`,
            receivedById: spg2,
            receivedAt: pagi,
            lines: { create: [{ itemId: item1, productName: "Kaos Uji — M", qtySent: 10, qtyReceived: 10, qtyDamaged: 1 }] },
          },
        })
      ).id,
    );
    lostIds.push((await prisma.lostSale.create({ data: { storeId: tokoA, userId: spg1, description: "Kaos XL hitam", qty: 2, createdAt: pagi } })).id);
    const masuk = (storeId: string, userId: string) =>
      prisma.storeVisit.create({ data: { storeId, userId, checkinAt: pagi, checkinLat: 0, checkinLng: 0 } });
    visitIds.push((await masuk(tokoA, spg1)).id);
    visitIds.push((await masuk(tokoB, spgB)).id);
  });

  afterAll(async () => {
    const tutup = await prisma.spgDailyClose.findMany({ where: { storeId: { in: seededIds([tokoA, tokoB, tokoC].filter(Boolean)) } }, select: { id: true } });
    // Teks harfiah (bukan konstanta) supaya penjaga lint teardown tidak salah membaca pengenal.
    await prisma.auditLog.deleteMany({ where: { entityType: "SpgDailyClose", entityId: { in: seededIds(tutup.map((t) => t.id)) } } });
    await prisma.auditLog.deleteMany({ where: { entityType: "Store", entityId: { in: seededIds([tokoA, tokoB, tokoC].filter(Boolean)) } } });
    await prisma.spgDailyClose.deleteMany({ where: { id: { in: seededIds(tutup.map((t) => t.id)) } } });
    await prisma.spgSaleReturn.deleteMany({ where: { id: { in: seededIds(returIds) } } });
    await prisma.spgSalePromo.deleteMany({ where: { spgSaleId: { in: (await prisma.spgSale.findMany({ where: { id: { in: seededIds(saleIds) } }, select: { id: true } })).map((x) => x.id) } } });
    await prisma.spgSale.deleteMany({ where: { id: { in: seededIds(saleIds) } } });
    await prisma.storeReceipt.deleteMany({ where: { id: { in: seededIds(receiptIds) } } });
    await prisma.lostSale.deleteMany({ where: { id: { in: seededIds(lostIds) } } });
    await prisma.storeVisit.deleteMany({ where: { id: { in: seededIds(visitIds) } } });
    await prisma.foto.deleteMany({ where: { id: { in: seededIds([fotoSpg1, fotoSpg2, fotoLain].filter(Boolean)) } } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds([spg1, spg2, spgB, spgC].filter(Boolean)) } } });
    await prisma.store.deleteMany({ where: { id: { in: seededIds([tokoA, tokoB, tokoC].filter(Boolean)) } } });
    await prisma.item.deleteMany({ where: { id: { in: seededIds([item1, item2].filter(Boolean)) } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  it("summarises the whole store's day: every SPG, returns at net price, deliveries and asked-for goods", async () => {
    const r = await ringkasanTutupHari(tokoA, day);
    expect(r).not.toBeNull();
    expect(r!.nota).toBe(2);
    expect(r!.potong).toBe(3);
    expect(r!.nilaiKotor).toBe(250_000);
    expect(r!.potongan).toBe(40_000);
    expect(r!.nilaiNota).toBe(210_000);
    // 1 potong dari baris 2 × bersih Rp 180.000 → Rp 90.000, bukan harga daftar Rp 100.000.
    expect(r!.potongKembali).toBe(1);
    expect(r!.nilaiRetur).toBe(90_000);
    expect(r!.nilaiBersih).toBe(120_000);
    expect(r!.terlaris.map((x) => [x.nama, x.qty])).toEqual([
      ["Kaos Uji — M", 2],
      ["Topi Uji", 1],
    ]);
    expect(r!.perSpg.map((x) => [x.userId, x.nota, x.nilai])).toEqual([
      [spg1, 1, 160_000],
      [spg2, 1, 50_000],
    ]);
    expect(r!.kiriman).toEqual([
      expect.objectContaining({ docNo: `DLV/${tag}`, sourceType: "PUTUS_DELIVERY", diterima: 10, rusak: 1, penerima: "SPG 2" }),
    ]);
    expect(r!.dicari).toEqual([{ description: "Kaos XL hitam", qty: 2 }]);

    // Yang sampai ke HP spg2: rupiah spg1 (Rp 160.000) tidak ada di mana pun di payload.
    const hp = JSON.stringify(ringkasanUntukHp(r!, spg2));
    expect(hp).not.toContain("160000");
    expect(hp).toContain('"nilai":50000');
  });

  it("reminds only stores that sold today without a report, only SPGs who checked in, once per day", async () => {
    const lingkup = { storeIds: [tokoA, tokoB, tokoC] };
    const r1 = await ingatkanTutupHari(lingkup);
    // A dan B berjualan dan ada yang check-in; C tidak ada yang check-in.
    expect(r1).toEqual({ toko: 2, orang: 2 });
    expect(await ingatkanTutupHari(lingkup)).toEqual({ toko: 0, orang: 0 });
    const penanda = await prisma.auditLog.findMany({
      where: { entityType: "Store", entityId: { in: [tokoA, tokoB, tokoC] }, action: JEJAK_TUTUP_HARI.DIINGATKAN },
      select: { entityId: true, metadata: true },
    });
    expect(penanda.map((p) => p.entityId).sort()).toEqual([tokoA, tokoB].sort());
    expect((penanda[0].metadata as { day?: string }).day).toBe(day);
  });

  it("refuses a day other than today or yesterday, and a photo the sender did not upload", async () => {
    const tua = await kirimTutupHari({ userId: spg1, storeId: tokoA, day: "2020-01-01", isi: {}, idempotencyKey: `${tag}-tua-1` });
    expect(tua).toEqual({ ok: false, kode: "HARI_TIDAK_SAH" });
    const curi = await kirimTutupHari({ userId: spg1, storeId: tokoA, day, isi: { foto: [`/api/foto/${fotoLain}`] }, idempotencyKey: `${tag}-curi-1` });
    expect(curi).toEqual({ ok: false, kode: "FOTO_TIDAK_SAH" });
    expect(await prisma.spgDailyClose.count({ where: { storeId: tokoA } })).toBe(0);
  });

  it("writes the report with a system snapshot, replays a lost response without a second trail, and lets a colleague overwrite with before/after", async () => {
    const isi = { pengunjung: 40, totalKasir: 100_000, catatan: "Hujan", foto: [`/api/foto/${fotoSpg1}`] };
    const r1 = await kirimTutupHari({ userId: spg1, storeId: tokoA, day, isi, idempotencyKey: `${tag}-k1-xxxx` });
    expect(r1).toMatchObject({ ok: true, ulangan: false, diperbarui: false });
    const baris = await prisma.spgDailyClose.findUniqueOrThrow({ where: { storeId_day: { storeId: tokoA, day } } });
    expect(baris.closedById).toBe(spg1);
    expect(baris.notaCount).toBe(2);
    expect(baris.pcs).toBe(3);
    expect(baris.returnPcs).toBe(1);
    expect(Number(baris.grossTotal)).toBe(250_000);
    expect(Number(baris.discountTotal)).toBe(40_000);
    expect(Number(baris.netTotal)).toBe(120_000);
    expect(baris.visitorCount).toBe(aturan.tanyaPengunjung ? 40 : null);
    expect(baris.cashierTotal === null ? null : Number(baris.cashierTotal)).toBe(aturan.tanyaTotalKasir ? 100_000 : null);
    expect(baris.note).toBe("Hujan");
    expect(baris.photoUrls).toEqual([`/api/foto/${fotoSpg1}`]);

    // Jawaban hilang di jalan, HP mengirim ulang dengan kunci yang sama.
    const ulang = await kirimTutupHari({ userId: spg1, storeId: tokoA, day, isi: { ...isi, catatan: "lain" }, idempotencyKey: `${tag}-k1-xxxx` });
    expect(ulang).toMatchObject({ ok: true, ulangan: true, id: baris.id });
    expect(await prisma.auditLog.count({ where: { entityType: ENTITAS_TUTUP_HARI, entityId: baris.id } })).toBe(1);

    // Rekan menutup ulang: mempertahankan foto rekannya + fotonya sendiri.
    const r2 = await kirimTutupHari({
      userId: spg2,
      storeId: tokoA,
      day,
      isi: { pengunjung: 45, totalKasir: 120_000, catatan: "", foto: [`/api/foto/${fotoSpg1}`, `/api/foto/${fotoSpg2}`] },
      idempotencyKey: `${tag}-k2-xxxx`,
    });
    expect(r2).toMatchObject({ ok: true, ulangan: false, diperbarui: true, id: baris.id });
    const kini = await prisma.spgDailyClose.findUniqueOrThrow({ where: { id: baris.id } });
    expect(kini.closedById).toBe(spg2);
    expect(kini.note).toBeNull();
    const jejak = await prisma.auditLog.findMany({ where: { entityType: ENTITAS_TUTUP_HARI, entityId: baris.id }, orderBy: { createdAt: "asc" } });
    expect(jejak.map((j) => j.action)).toEqual([JEJAK_TUTUP_HARI.DIKIRIM, JEJAK_TUTUP_HARI.DIPERBARUI]);
    const ch = jejak[1].changes as { before: Record<string, unknown>; after: Record<string, unknown> };
    expect(ch.before).toMatchObject({ closedById: spg1, note: "Hujan", photoUrls: [`/api/foto/${fotoSpg1}`] });
    expect(ch.after).toMatchObject({ closedById: spg2, note: null, netTotal: 120_000 });
    expect((jejak[0].changes as { before: unknown }).before).toBeNull();

    // Kantor: baris toko A sudah tutup, selisih kasir nol; C belum tutup padahal berjualan.
    const kantor = await daftarTutupHariKantor(day);
    const a = kantor.baris.find((b) => b.storeId === tokoA)!;
    expect(a.laporan).toMatchObject({ id: baris.id, oleh: "SPG 2", nota: 2, nilaiBersih: 120_000 });
    if (aturan.tanyaTotalKasir) expect(a.laporan!.selisih).toBe(0);
    expect(a.berubah).toBe(false);
    const c = kantor.baris.find((b) => b.storeId === tokoC)!;
    expect(c.laporan).toBeNull();
    expect(c.sistem.nota).toBe(1);

    const rinci = await rincianTutupHariKantor(baris.id);
    expect(rinci!.jejak).toHaveLength(2);
    expect(rinci!.sistem.perSpg).toHaveLength(2);

    const rekap = await rekapTutupHariKantor(day, day);
    expect(rekap.baris.find((b) => b.storeId === tokoA)).toMatchObject({ hariJual: 1, hariTutup: 1, nota: 2, nilaiBersih: 120_000 });

    const wa = await pesanWaLaporan(tokoA, day);
    expect(wa).toContain("Penjualan bersih: Rp 120.000");
    expect(wa).not.toContain("SPG 1");
  });

  it("two SPGs closing the same store at the same moment end in one report and two trail rows", async () => {
    const kirim = (userId: string, k: string, pengunjung: number) =>
      kirimTutupHari({ userId, storeId: tokoB, day, isi: { pengunjung, foto: [] }, idempotencyKey: `${tag}-${k}-balap` });
    // Toko B hanya punya spgB; spg1 dipinjam sebagai "rekan" — penulis tidak memeriksa toko (itu tugas aksi).
    const [x, y] = await Promise.all([kirim(spgB, "x", 10), kirim(spg1, "y", 11)]);
    expect(x.ok && y.ok).toBe(true);
    const baris = await prisma.spgDailyClose.findMany({ where: { storeId: tokoB, day } });
    expect(baris).toHaveLength(1);
    const jejak = await prisma.auditLog.findMany({ where: { entityType: ENTITAS_TUTUP_HARI, entityId: baris[0].id }, select: { action: true, changes: true } });
    expect(jejak.map((j) => j.action).sort()).toEqual([JEJAK_TUTUP_HARI.DIKIRIM, JEJAK_TUTUP_HARI.DIPERBARUI].sort());
    // Yang menjadi pembaruan membawa `before` = laporan pemenang, bukan null.
    const perbarui = jejak.find((j) => j.action === JEJAK_TUTUP_HARI.DIPERBARUI)!;
    expect((perbarui.changes as { before: unknown }).before).not.toBeNull();
  });
});
