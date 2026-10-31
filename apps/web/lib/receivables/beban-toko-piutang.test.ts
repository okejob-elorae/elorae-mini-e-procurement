import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { alihkanBeban, catatHitunganGudang, putuskanBeban, tandaiBebanLunas } from "./return-writer";
import { hitungUlangPiutang } from "./writer";
import { JEJAK } from "./jejak";
import { fakturBebanToko, rincianRetur } from "./return-queries";

/**
 * Selisih retur yang ditanggung TOKO menjadi piutang, terhadap basis data sungguhan.
 *
 * Kejadiannya: toko memotong pembayaran 300.000 untuk retur, gudang hanya
 * menerima barang 100.000, kantor memutuskan selisih 200.000 ditanggung toko.
 * Keputusan itu melepas tahanan sehingga faktur aslinya lunas — dan sebelum
 * perbaikan ini, utang 200.000 itu hanya hidup sebagai baris beban yang tidak
 * pernah muncul di penagihan. Sekarang ia menjadi faktur sendiri.
 *
 * Basis data dipakai bersama data dev: pengguna DIPINJAM, setiap penghapusan
 * lewat `seededId()`/`seededIds()`, id fixture dideklarasikan "" dan direset di
 * awal hook.
 */

const tag = `BTP-${Math.random().toString(36).slice(2, 8)}`;
const TEMPO_HARI = 30;
let pelaporId = "";
let gudangId = "";
let tokoId = "";
let tokoKonsiId = "";
let fakturId = "";
let nrtIds: string[] = [];
let nriIds: string[] = [];
let klaimIds: string[] = [];
let kontrabonIds: string[] = [];
let tugasIds: string[] = [];
let urut = 0;

beforeEach(async () => {
  pelaporId = "";
  gudangId = "";
  tokoId = "";
  tokoKonsiId = "";
  fakturId = "";
  nrtIds = [];
  nriIds = [];
  klaimIds = [];
  kontrabonIds = [];
  tugasIds = [];

  const orang = await prisma.user.findMany({ select: { id: true }, take: 2, orderBy: { createdAt: "asc" } });
  if (orang.length < 2) throw new Error("Basis data uji butuh dua pengguna");
  pelaporId = orang[0].id;
  gudangId = orang[1].id;

  tokoId = (
    await prisma.store.create({
      data: { code: `${tag}-P`, name: `${tag} Putus`, address: "uji", termsType: "PUTUS", paymentTempo: TEMPO_HARI },
    })
  ).id;
  tokoKonsiId = (
    await prisma.store.create({
      data: { code: `${tag}-K`, name: `${tag} Konsi`, address: "uji", termsType: "KONSI", markupPercent: 25 },
    })
  ).id;
  fakturId = (
    await prisma.receivable.create({
      data: {
        invoiceNo: `${tag}/INV`,
        storeId: tokoId,
        invoiceDate: new Date("2026-09-01T00:00:00+07:00"),
        dueDate: new Date("2026-10-01T00:00:00+07:00"),
        amount: 1_000_000,
        outstanding: 1_000_000,
        source: "MANUAL",
      },
    })
  ).id;
});

afterEach(async () => {
  const tokoSaya = [tokoId, tokoKonsiId].filter(Boolean).map(seededId);
  const beban = await prisma.returnCharge.findMany({
    where: { storeReturnId: { in: seededIds(nrtIds) } },
    select: { id: true },
  });
  const piutang = tokoSaya.length
    ? await prisma.receivable.findMany({ where: { storeId: { in: tokoSaya } }, select: { id: true } })
    : [];
  // Hitungan yang dibuat penulis tanpa sempat dicatat tes (mis. saat tesnya gagal).
  const nriPenulis = nrtIds.length
    ? await prisma.warehouseReturn.findMany({ where: { storeReturnId: { in: seededIds(nrtIds) } }, select: { id: true } })
    : [];
  nriIds = [...new Set([...nriIds, ...nriPenulis.map((n) => n.id)])];
  const entitas = [...nrtIds, ...nriIds, ...klaimIds, ...beban.map((b) => b.id), ...piutang.map((p) => p.id)].filter(Boolean);
  if (entitas.length) await prisma.auditLog.deleteMany({ where: { entityId: { in: seededIds(entitas) } } });
  if (beban.length) await prisma.returnCharge.deleteMany({ where: { id: { in: seededIds(beban.map((b) => b.id)) } } });
  if (klaimIds.length) await prisma.paymentClaim.deleteMany({ where: { id: { in: seededIds(klaimIds) } } });
  if (kontrabonIds.length) {
    await prisma.collectionNoteReceivable.deleteMany({ where: { collectionNoteId: { in: seededIds(kontrabonIds) } } });
    await prisma.collectionNote.deleteMany({ where: { id: { in: seededIds(kontrabonIds) } } });
  }
  if (tugasIds.length) await prisma.collectionTask.deleteMany({ where: { id: { in: seededIds(tugasIds) } } });
  if (nriIds.length) await prisma.warehouseReturn.deleteMany({ where: { id: { in: seededIds(nriIds) } } });
  if (nrtIds.length) await prisma.storeReturn.deleteMany({ where: { id: { in: seededIds(nrtIds) } } });
  if (piutang.length) {
    await prisma.receivableItem.deleteMany({ where: { receivableId: { in: seededIds(piutang.map((p) => p.id)) } } });
    await prisma.receivable.deleteMany({ where: { id: { in: seededIds(piutang.map((p) => p.id)) } } });
  }
  if (tokoSaya.length) await prisma.store.deleteMany({ where: { id: { in: seededIds(tokoSaya) } } });
});

async function buatNrt(opsi: { storeId?: string; klaim?: number } = {}) {
  urut += 1;
  const n = await prisma.storeReturn.create({
    data: {
      noNrt: `${tag}-NRT-${urut}`,
      storeId: opsi.storeId ?? tokoId,
      salesmanId: pelaporId,
      claimDate: new Date("2026-10-01T00:00:00+07:00"),
      claimedAmount: opsi.klaim ?? 300_000,
    },
  });
  nrtIds.push(n.id);
  return n;
}

/** BKM terverifikasi: toko membayar 700.000 tunai dan memotong 300.000 untuk retur. */
async function buatBkmDenganPotongan(nrtId: string) {
  urut += 1;
  const k = await prisma.paymentClaim.create({
    data: {
      docNo: `${tag}/BKM/${urut}`,
      storeId: tokoId,
      salesmanId: pelaporId,
      createdById: pelaporId,
      claimedTransferAt: new Date("2026-10-02T00:00:00+07:00"),
      method: "tunai",
      invoiceAmount: 1_000_000,
      deductionTotal: 300_000,
      receivedAmount: 700_000,
      status: "TERVERIFIKASI",
      verifiedById: gudangId,
      verifiedAt: new Date(),
      receivableLinks: { create: [{ receivableId: fakturId, settledAmount: 1_000_000 }] },
      deductions: { create: [{ name: "Retur", amount: 300_000, storeReturnId: nrtId }] },
    },
  });
  klaimIds.push(k.id);
  await hitungUlangPiutang(prisma, fakturId);
  return k;
}

/** Gudang menghitung fisik 100.000 → beban TERBUKA 200.000. */
async function hitungKurang(nrtId: string, fisik = 100_000) {
  const h = await catatHitunganGudang({
    storeReturnId: nrtId,
    warehouseUserId: gudangId,
    receivedAt: new Date("2026-10-03T00:00:00+07:00"),
    deliveryMethod: "SALES",
    physicalAmount: fisik,
  });
  if (!h.ok) throw new Error(`hitungan gagal: ${h.alasan}`);
  nriIds.push(h.id);
  const beban = await prisma.returnCharge.findFirstOrThrow({ where: { storeReturnId: seededId(nrtId) } });
  return beban;
}

const sisa = async (id: string) =>
  Number((await prisma.receivable.findUniqueOrThrow({ where: { id: seededId(id) } })).outstanding);

const piutangBeban = (storeId: string) =>
  prisma.receivable.findMany({ where: { storeId: seededId(storeId), id: { not: seededId(fakturId) } } });

describe("putuskanBeban TOKO — selisihnya menjadi piutang toko", () => {
  it("membuat faktur sebesar beban, bernomor NRT, jatuh tempo menurut tempo toko, dalam transaksi yang sama", async () => {
    const nrt = await buatNrt();
    await buatBkmDenganPotongan(nrt.id);
    const beban = await hitungKurang(nrt.id);
    expect(Number(beban.amount)).toBe(200_000);
    // Sebelum diputuskan: selisih 200.000 ditahan di faktur asli.
    expect(await sisa(fakturId)).toBe(200_000);

    const h = await putuskanBeban({ chargeId: beban.id, bearer: "TOKO", alasan: "toko mengaku salah hitung", olehUserId: gudangId });
    expect(h.ok).toBe(true);

    // Faktur asli dilepas, tapi utangnya TIDAK hilang: pindah ke faktur beban.
    expect(await sisa(fakturId)).toBe(0);
    const baru = await piutangBeban(tokoId);
    expect(baru).toHaveLength(1);
    const p = baru[0];
    expect(Number(p.amount)).toBe(200_000);
    expect(Number(p.outstanding)).toBe(200_000);
    expect(p.source).toBe("MANUAL");
    expect(p.invoiceNo).toContain(nrt.noNrt);
    expect(p.salesmanId).toBe(pelaporId);
    const hari = (p.dueDate.getTime() - p.invoiceDate.getTime()) / 86_400_000;
    expect(hari).toBe(TEMPO_HARI);

    // Jumlah utang toko = selisih yang ia tanggung — tidak lebih, tidak kurang.
    const semua = await prisma.receivable.findMany({ where: { storeId: seededId(tokoId) } });
    expect(semua.reduce((s, r) => s + Number(r.outstanding), 0)).toBe(200_000);

    // Jejak keputusan menunjuk fakturnya; jejak faktur menunjuk bebannya.
    const jejakBeban = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: seededId(beban.id), action: JEJAK.BEBAN_DIPUTUSKAN },
    });
    expect(jejakBeban.metadata).toMatchObject({ receivableId: p.id, invoiceNo: p.invoiceNo });
    const jejakFaktur = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: seededId(p.id), action: JEJAK.FAKTUR_MANUAL },
    });
    expect(jejakFaktur.metadata).toMatchObject({ returnChargeId: beban.id });
  });

  it("dua keputusan bersamaan hanya membuat SATU faktur", async () => {
    const nrt = await buatNrt();
    await buatBkmDenganPotongan(nrt.id);
    const beban = await hitungKurang(nrt.id);

    const hasil = await Promise.all([
      putuskanBeban({ chargeId: beban.id, bearer: "TOKO", alasan: "a", olehUserId: gudangId }),
      putuskanBeban({ chargeId: beban.id, bearer: "TOKO", alasan: "b", olehUserId: gudangId }),
    ]);
    expect(hasil.filter((x) => x.ok)).toHaveLength(1);
    expect(hasil.find((x) => !x.ok)).toMatchObject({ alasan: "SUDAH_DIPUTUSKAN" });
    expect(await piutangBeban(tokoId)).toHaveLength(1);
  });

  it("menolak TOKO untuk toko konsinyasi — toko konsi tidak pernah punya piutang", async () => {
    const nrt = await buatNrt({ storeId: tokoKonsiId });
    const beban = await hitungKurang(nrt.id);
    const h = await putuskanBeban({ chargeId: beban.id, bearer: "TOKO", alasan: "x", olehUserId: gudangId });
    expect(h).toEqual({ ok: false, alasan: "TOKO_KONSI" });
    const sesudah = await prisma.returnCharge.findUniqueOrThrow({ where: { id: seededId(beban.id) } });
    expect(sesudah.status).toBe("TERBUKA");
    expect(await piutangBeban(tokoKonsiId)).toHaveLength(0);
  });

  it("menolak SALES tanpa orangnya di server", async () => {
    const nrt = await buatNrt();
    const beban = await hitungKurang(nrt.id);
    const h = await putuskanBeban({ chargeId: beban.id, bearer: "SALES", alasan: "x", olehUserId: gudangId });
    expect(h).toEqual({ ok: false, alasan: "PENANGGUNG_WAJIB" });
    const sesudah = await prisma.returnCharge.findUniqueOrThrow({ where: { id: seededId(beban.id) } });
    expect(sesudah.status).toBe("TERBUKA");
  });
});

describe("alihkanBeban — mengubah keputusan menyesuaikan faktur bebannya", () => {
  it("TOKO → GUDANG menghapus faktur beban yang belum ditagih, dengan jejak; GUDANG → TOKO membuatnya lagi", async () => {
    const nrt = await buatNrt();
    await buatBkmDenganPotongan(nrt.id);
    const beban = await hitungKurang(nrt.id);
    await putuskanBeban({ chargeId: beban.id, bearer: "TOKO", alasan: "awal", olehUserId: gudangId });
    const [lama] = await piutangBeban(tokoId);

    const h1 = await alihkanBeban({ chargeId: beban.id, bearer: "GUDANG", alasan: "ternyata gudang salah hitung", olehUserId: gudangId });
    expect(h1.ok).toBe(true);
    expect(await piutangBeban(tokoId)).toHaveLength(0);
    // Faktur asli tetap lepas: beban sudah ditetapkan, kali ini ke gudang.
    expect(await sisa(fakturId)).toBe(0);
    const jejak = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: seededId(beban.id), action: JEJAK.BEBAN_DIALIHKAN },
    });
    expect(jejak.metadata).toMatchObject({ piutangDihapus: { id: lama.id, invoiceNo: lama.invoiceNo, amount: 200_000 } });

    const h2 = await alihkanBeban({ chargeId: beban.id, bearer: "TOKO", alasan: "kembali ke toko", olehUserId: gudangId });
    expect(h2.ok).toBe(true);
    const baru = await piutangBeban(tokoId);
    expect(baru).toHaveLength(1);
    expect(Number(baru[0].amount)).toBe(200_000);
  });

  it("dua pengalihan ke TOKO bersamaan hanya membuat SATU faktur", async () => {
    const nrt = await buatNrt();
    // Toko sudah memotong NRT penuh — hanya itu yang melahirkan faktur beban.
    await buatBkmDenganPotongan(nrt.id);
    const beban = await hitungKurang(nrt.id);
    await putuskanBeban({ chargeId: beban.id, bearer: "GUDANG", alasan: "awal", olehUserId: gudangId });

    const hasil = await Promise.all([
      alihkanBeban({ chargeId: beban.id, bearer: "TOKO", alasan: "a", olehUserId: gudangId }),
      alihkanBeban({ chargeId: beban.id, bearer: "TOKO", alasan: "b", olehUserId: gudangId }),
    ]);
    expect(hasil.every((x) => x.ok)).toBe(true);
    const faktur = await piutangBeban(tokoId);
    expect(faktur).toHaveLength(1);
    expect(Number(faktur[0].amount)).toBe(200_000);
  });

  it("TOKO → TOKO tidak membuat faktur kedua", async () => {
    const nrt = await buatNrt();
    // Toko sudah memotong NRT penuh — hanya itu yang melahirkan faktur beban.
    await buatBkmDenganPotongan(nrt.id);
    const beban = await hitungKurang(nrt.id);
    await putuskanBeban({ chargeId: beban.id, bearer: "TOKO", alasan: "awal", olehUserId: gudangId });
    const h = await alihkanBeban({ chargeId: beban.id, bearer: "TOKO", alasan: "ulang", olehUserId: gudangId });
    expect(h.ok).toBe(true);
    expect(await piutangBeban(tokoId)).toHaveLength(1);
  });

  it("MENOLAK mengalihkan kalau faktur bebannya sudah dipakai di BKM", async () => {
    const nrt = await buatNrt();
    // Toko sudah memotong NRT penuh — hanya itu yang melahirkan faktur beban.
    await buatBkmDenganPotongan(nrt.id);
    const beban = await hitungKurang(nrt.id);
    await putuskanBeban({ chargeId: beban.id, bearer: "TOKO", alasan: "awal", olehUserId: gudangId });
    const [p] = await piutangBeban(tokoId);
    urut += 1;
    const k = await prisma.paymentClaim.create({
      data: {
        docNo: `${tag}/BKM/${urut}`,
        storeId: tokoId,
        salesmanId: pelaporId,
        createdById: pelaporId,
        claimedTransferAt: new Date("2026-10-04T00:00:00+07:00"),
        method: "tunai",
        invoiceAmount: 200_000,
        receivedAmount: 200_000,
        receivableLinks: { create: [{ receivableId: p.id, settledAmount: 200_000 }] },
      },
    });
    klaimIds.push(k.id);

    const h = await alihkanBeban({ chargeId: beban.id, bearer: "PERUSAHAAN", alasan: "dihapus", olehUserId: gudangId });
    expect(h).toEqual({ ok: false, alasan: "PIUTANG_BEBAN_SUDAH_DITAGIH" });
    const tetap = await prisma.returnCharge.findUniqueOrThrow({ where: { id: seededId(beban.id) } });
    expect(tetap.bearer).toBe("TOKO");
    expect(await piutangBeban(tokoId)).toHaveLength(1);
  });

  it("MENOLAK mengalihkan kalau faktur bebannya ada di kontrabon atau tugas tagih yang terbuka", async () => {
    const nrt = await buatNrt();
    // Toko sudah memotong NRT penuh — hanya itu yang melahirkan faktur beban.
    await buatBkmDenganPotongan(nrt.id);
    const beban = await hitungKurang(nrt.id);
    await putuskanBeban({ chargeId: beban.id, bearer: "TOKO", alasan: "awal", olehUserId: gudangId });
    const [p] = await piutangBeban(tokoId);

    urut += 1;
    const kontrabon = await prisma.collectionNote.create({
      data: {
        docNo: `${tag}/KB/${urut}`,
        storeId: tokoId,
        salesmanId: pelaporId,
        handoverDate: new Date("2026-10-04T00:00:00+07:00"),
        promisedDate: new Date("2026-10-11T00:00:00+07:00"),
        amount: 200_000,
        receivableLinks: { create: [{ receivableId: p.id, amount: 200_000 }] },
      },
    });
    kontrabonIds.push(kontrabon.id);
    expect(
      await alihkanBeban({ chargeId: beban.id, bearer: "GUDANG", alasan: "x", olehUserId: gudangId }),
    ).toEqual({ ok: false, alasan: "PIUTANG_BEBAN_SUDAH_DITAGIH" });

    // Kontrabon dilepas, tapi faktur sudah diberikan sebagai tugas tagih yang masih terbuka.
    await prisma.collectionNote.delete({ where: { id: seededId(kontrabon.id) } });
    kontrabonIds = [];
    const tugas = await prisma.collectionTask.create({
      data: { assigneeId: pelaporId, storeId: tokoId, receivableIds: [p.id], createdById: gudangId },
    });
    tugasIds.push(tugas.id);
    expect(
      await alihkanBeban({ chargeId: beban.id, bearer: "GUDANG", alasan: "x", olehUserId: gudangId }),
    ).toEqual({ ok: false, alasan: "PIUTANG_BEBAN_SUDAH_DITAGIH" });

    // Tugas yang sudah selesai tidak menahan.
    await prisma.collectionTask.update({ where: { id: seededId(tugas.id) }, data: { status: "SELESAI" } });
    expect((await alihkanBeban({ chargeId: beban.id, bearer: "GUDANG", alasan: "x", olehUserId: gudangId })).ok).toBe(true);
    expect(await piutangBeban(tokoId)).toHaveLength(0);
  });

  it("menolak SALES tanpa orangnya", async () => {
    const nrt = await buatNrt();
    const beban = await hitungKurang(nrt.id);
    await putuskanBeban({ chargeId: beban.id, bearer: "GUDANG", alasan: "awal", olehUserId: gudangId });
    const h = await alihkanBeban({ chargeId: beban.id, bearer: "SALES", alasan: "x", olehUserId: gudangId });
    expect(h).toEqual({ ok: false, alasan: "PENANGGUNG_WAJIB" });
  });
});

describe("tandaiBebanLunas — beban toko lunas lewat piutangnya", () => {
  it("menolak menandai lunas beban TOKO yang punya faktur — pelunasannya lewat BKM terverifikasi", async () => {
    const nrt = await buatNrt();
    // Toko sudah memotong NRT penuh — hanya itu yang melahirkan faktur beban.
    await buatBkmDenganPotongan(nrt.id);
    const beban = await hitungKurang(nrt.id);
    await putuskanBeban({ chargeId: beban.id, bearer: "TOKO", alasan: "awal", olehUserId: gudangId });
    const h = await tandaiBebanLunas({ chargeId: beban.id, olehUserId: gudangId });
    expect(h).toEqual({ ok: false, alasan: "DITAGIH_LEWAT_PIUTANG" });
  });
});

describe("catatHitunganGudang — penghitung bukan pelapor", () => {
  it("menolak hitungan oleh orang yang melaporkan nota itu sendiri", async () => {
    const nrt = await buatNrt();
    const h = await catatHitunganGudang({
      storeReturnId: nrt.id,
      warehouseUserId: pelaporId,
      receivedAt: new Date("2026-10-03T00:00:00+07:00"),
      deliveryMethod: "SALES",
      physicalAmount: 300_000,
    });
    expect(h).toEqual({ ok: false, alasan: "PENGHITUNG_SAMA_PELAPOR" });
    expect(await prisma.warehouseReturn.count({ where: { storeReturnId: seededId(nrt.id) } })).toBe(0);
  });
});

describe("pembaca — faktur beban toko terlihat di layar beban dan rincian retur", () => {
  it("menunjukkan nomor faktur dan sisanya untuk beban TOKO, dan tidak untuk yang lain", async () => {
    const nrt = await buatNrt();
    // Toko sudah memotong NRT penuh — hanya itu yang melahirkan faktur beban.
    await buatBkmDenganPotongan(nrt.id);
    const beban = await hitungKurang(nrt.id);
    await putuskanBeban({ chargeId: beban.id, bearer: "TOKO", alasan: "awal", olehUserId: gudangId });

    const peta = await fakturBebanToko([beban.id, "bukan-beban"]);
    expect(Object.keys(peta)).toEqual([beban.id]);
    expect(peta[beban.id]).toMatchObject({ invoiceNo: `BEBAN/${nrt.noNrt}`, outstanding: 200_000 });

    const r = await rincianRetur(nrt.id);
    expect(r?.beban?.faktur).toMatchObject({ invoiceNo: `BEBAN/${nrt.noNrt}`, outstanding: 200_000 });

    await alihkanBeban({ chargeId: beban.id, bearer: "PERUSAHAAN", alasan: "hapus", olehUserId: gudangId });
    expect(await fakturBebanToko([beban.id])).toEqual({});
    expect((await rincianRetur(nrt.id))?.beban?.faktur).toBeNull();
  });

  it("sisa faktur beban DIHITUNG ULANG dari klaimnya, bukan dibaca dari kolom cache", async () => {
    const nrt = await buatNrt();
    // Toko sudah memotong NRT penuh — hanya itu yang melahirkan faktur beban.
    await buatBkmDenganPotongan(nrt.id);
    const beban = await hitungKurang(nrt.id);
    await putuskanBeban({ chargeId: beban.id, bearer: "TOKO", alasan: "awal", olehUserId: gudangId });
    const [p] = await piutangBeban(tokoId);

    // Toko membayar 150.000 dari faktur beban 200.000, terverifikasi — sisa 50.000.
    urut += 1;
    const k = await prisma.paymentClaim.create({
      data: {
        docNo: `${tag}/BKM/${urut}`,
        storeId: tokoId,
        salesmanId: pelaporId,
        createdById: pelaporId,
        claimedTransferAt: new Date("2026-10-04T00:00:00+07:00"),
        method: "tunai",
        invoiceAmount: 150_000,
        receivedAmount: 150_000,
        status: "TERVERIFIKASI",
        verifiedById: gudangId,
        verifiedAt: new Date(),
        receivableLinks: { create: [{ receivableId: p.id, settledAmount: 150_000 }] },
      },
    });
    klaimIds.push(k.id);
    // Kolom cache sengaja SALAH: pembaca yang membacanya akan melaporkan 1.
    await prisma.receivable.update({ where: { id: seededId(p.id) }, data: { outstanding: 1 } });

    expect((await fakturBebanToko([beban.id]))[beban.id]).toMatchObject({ outstanding: 50_000 });
    expect((await rincianRetur(nrt.id))?.beban?.faktur).toMatchObject({ outstanding: 50_000 });
  });
});
