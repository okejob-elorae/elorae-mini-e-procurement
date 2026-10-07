import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { alihkanBeban, catatHitunganGudang, putuskanBeban } from "./return-writer";
import { buatKlaimPembayaran } from "./claim-writer";
import { hitungUlangPiutang, pemakaianRetur, putuskanKlaim } from "./writer";
import { JEJAK } from "./jejak";
import { fakturBebanToko, rincianRetur, tagihanBebanTokoTercatat } from "./return-queries";

/**
 * KEPUTUSAN SEMENTARA PEMILIK 2026-10-06 — beban selisih retur yang ditetapkan
 * ke TOKO menagih hanya yang benar-benar diambil toko, terhadap basis data
 * sungguhan.
 *
 * Angka dari audit: faktur 1.000.000, NRT 300.000, gudang menghitung 100.000
 * (selisih 200.000). Yang seharusnya dibayar toko di semua jalur: 900.000
 * (1 jt dikurangi barang yang benar-benar sampai). Aturan lama menagih faktur
 * beban 200.000 walau toko belum memotong apa pun → 1,2 jt.
 *
 * Basis data dipakai bersama data dev: pengguna DIPINJAM, setiap penghapusan
 * lewat `seededId()`/`seededIds()`, id fixture dideklarasikan "" dan direset di
 * awal hook.
 */

const tag = `BTD-${Math.random().toString(36).slice(2, 8)}`;
let pelaporId = "";
let gudangId = "";
let tokoId = "";
let fakturId = "";
let nrtIds: string[] = [];
let nriIds: string[] = [];
let klaimIds: string[] = [];
let urut = 0;

beforeEach(async () => {
  pelaporId = "";
  gudangId = "";
  tokoId = "";
  fakturId = "";
  nrtIds = [];
  nriIds = [];
  klaimIds = [];

  const orang = await prisma.user.findMany({ select: { id: true }, take: 2, orderBy: { createdAt: "asc" } });
  if (orang.length < 2) throw new Error("Basis data uji butuh dua pengguna");
  pelaporId = orang[0].id;
  gudangId = orang[1].id;

  tokoId = (
    await prisma.store.create({
      data: { code: `${tag}-P`, name: `${tag} Putus`, address: "uji", termsType: "PUTUS", paymentTempo: 30 },
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
  const beban = await prisma.returnCharge.findMany({
    where: { storeReturnId: { in: seededIds(nrtIds) } },
    select: { id: true },
  });
  const piutang = tokoId
    ? await prisma.receivable.findMany({ where: { storeId: seededId(tokoId) }, select: { id: true } })
    : [];
  const nriPenulis = nrtIds.length
    ? await prisma.warehouseReturn.findMany({ where: { storeReturnId: { in: seededIds(nrtIds) } }, select: { id: true } })
    : [];
  nriIds = [...new Set([...nriIds, ...nriPenulis.map((n) => n.id)])];
  // BKM yang dibuat penulis tanpa sempat dicatat tes (mis. saat tesnya gagal).
  const klaimToko = tokoId
    ? await prisma.paymentClaim.findMany({ where: { storeId: seededId(tokoId) }, select: { id: true } })
    : [];
  klaimIds = [...new Set([...klaimIds, ...klaimToko.map((k) => k.id)])];
  const entitas = [...nrtIds, ...nriIds, ...klaimIds, ...beban.map((b) => b.id), ...piutang.map((p) => p.id)].filter(Boolean);
  if (entitas.length) await prisma.auditLog.deleteMany({ where: { entityId: { in: seededIds(entitas) } } });
  if (beban.length) await prisma.returnCharge.deleteMany({ where: { id: { in: seededIds(beban.map((b) => b.id)) } } });
  if (klaimIds.length) await prisma.paymentClaim.deleteMany({ where: { id: { in: seededIds(klaimIds) } } });
  if (nriIds.length) await prisma.warehouseReturn.deleteMany({ where: { id: { in: seededIds(nriIds) } } });
  if (nrtIds.length) await prisma.storeReturn.deleteMany({ where: { id: { in: seededIds(nrtIds) } } });
  if (piutang.length) {
    await prisma.receivableItem.deleteMany({ where: { receivableId: { in: seededIds(piutang.map((p) => p.id)) } } });
    await prisma.receivable.deleteMany({ where: { id: { in: seededIds(piutang.map((p) => p.id)) } } });
  }
  if (tokoId) await prisma.store.delete({ where: { id: seededId(tokoId) } });
});

async function buatNrt() {
  urut += 1;
  const n = await prisma.storeReturn.create({
    data: {
      noNrt: `${tag}-NRT-${urut}`,
      storeId: tokoId,
      salesmanId: pelaporId,
      claimDate: new Date("2026-10-01T00:00:00+07:00"),
      claimedAmount: 300_000,
    },
  });
  nrtIds.push(n.id);
  return n;
}

/** BKM terverifikasi atas faktur 1 jt yang memotong `potong` dari NRT. */
async function bkmTerverifikasi(nrtId: string, potong: number) {
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
      deductionTotal: potong,
      receivedAmount: 1_000_000 - potong,
      status: "TERVERIFIKASI",
      verifiedById: gudangId,
      verifiedAt: new Date(),
      receivableLinks: { create: [{ receivableId: fakturId, settledAmount: 1_000_000 }] },
      deductions: { create: [{ name: "Retur", amount: potong, storeReturnId: nrtId }] },
    },
  });
  klaimIds.push(k.id);
  await hitungUlangPiutang(prisma, fakturId);
  return k;
}

/** Gudang menghitung fisik 100.000 → beban TERBUKA 200.000. */
async function hitungKurang(nrtId: string) {
  const h = await catatHitunganGudang({
    storeReturnId: nrtId,
    warehouseUserId: gudangId,
    receivedAt: new Date("2026-10-03T00:00:00+07:00"),
    deliveryMethod: "SALES",
    physicalAmount: 100_000,
  });
  if (!h.ok) throw new Error(`hitungan gagal: ${h.alasan}`);
  nriIds.push(h.id);
  return prisma.returnCharge.findFirstOrThrow({ where: { storeReturnId: seededId(nrtId) } });
}

/** BKM baru (DIKIRIM) lewat penulisnya — umumnya atas faktur 1 jt. */
async function laporBkm(nrtId: string, potong: number, lunasi?: { receivableId: string; nilai: number }) {
  const h = await buatKlaimPembayaran({
    storeId: tokoId,
    salesmanId: pelaporId,
    createdById: pelaporId,
    claimedTransferAt: new Date("2026-10-04T00:00:00+07:00"),
    method: "transfer",
    pelunasan: [lunasi ?? { receivableId: fakturId, nilai: 1_000_000 }],
    potongan: potong > 0 ? [{ nama: "Retur", nilai: potong, storeReturnId: nrtId }] : [],
    transferPhotoUrl: "/api/foto/uji",
  });
  if (h.ok && !klaimIds.includes(h.id)) klaimIds.push(h.id);
  return h;
}

const piutangToko = () => prisma.receivable.findMany({ where: { storeId: seededId(tokoId) } });
const fakturBeban = async () => (await piutangToko()).filter((p) => p.id !== fakturId);
const sisaSemua = async () => {
  for (const p of await piutangToko()) await hitungUlangPiutang(prisma, p.id);
  return (await piutangToko()).reduce((s, p) => s + Number(p.outstanding), 0);
};
const tunaiDiterima = async () => {
  const k = await prisma.paymentClaim.findMany({
    where: { id: { in: seededIds(klaimIds) }, status: "TERVERIFIKASI" },
    select: { receivedAmount: true },
  });
  return k.reduce((s, x) => s + Number(x.receivedAmount), 0);
};

describe("putuskanBeban TOKO — ditagih sebesar yang benar-benar dipotong toko", () => {
  it("toko BELUM memotong: tidak ada faktur beban (dulu 200 rb → 1,2 jt); NRT hanya boleh dipotong 100 rb; total yang dibayar 900 rb", async () => {
    const nrt = await buatNrt();
    const beban = await hitungKurang(nrt.id);
    expect(Number(beban.amount)).toBe(200_000);

    const h = await putuskanBeban({ chargeId: beban.id, bearer: "TOKO", alasan: "toko salah tulis nota", olehUserId: gudangId });
    expect(h.ok).toBe(true);

    expect(await fakturBeban()).toHaveLength(0);
    expect(await sisaSemua()).toBe(1_000_000);
    // Jejak keputusan menyimpan angkanya: selisih, yang sudah dipotong, yang ditagih.
    const jejak = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: seededId(beban.id), action: JEJAK.BEBAN_DIPUTUSKAN },
    });
    expect(jejak.metadata).toMatchObject({ selisih: 200_000, dipotongToko: 0, ditagihKeToko: 0 });
    // Layar membaca angka itu: ditagih 0 → "Tandai sudah diganti" tidak ditawarkan.
    expect(await tagihanBebanTokoTercatat([beban.id])).toEqual({ [beban.id]: 0 });
    expect((await rincianRetur(nrt.id))?.beban).toMatchObject({ faktur: null, tagihTokoTercatat: 0 });
    // Nilai bebannya tetap selisih — yang berubah hanya yang ditagih.
    expect(Number((await prisma.returnCharge.findUniqueOrThrow({ where: { id: seededId(beban.id) } })).amount)).toBe(200_000);

    // Batas potong NRT turun ke barang yang sampai.
    expect((await pemakaianRetur(prisma, [nrt.id])).get(nrt.id)).toMatchObject({ nilai: 100_000, nilaiKlaim: 300_000, terpakai: 0 });
    // Memotong klaim penuh sesudah keputusan ditolak — selisihnya tidak bisa diambil tanpa ditagih.
    expect(await laporBkm(nrt.id, 300_000)).toEqual({ ok: false, alasan: "RETUR_TERPAKAI" });
    expect(await laporBkm(nrt.id, 100_001)).toEqual({ ok: false, alasan: "RETUR_TERPAKAI" });

    // Toko memotong barang yang sampai (100 rb) dan mentransfer 900 rb.
    const bkm = await laporBkm(nrt.id, 100_000);
    if (!bkm.ok) throw new Error(`BKM harus tercatat: ${bkm.alasan}`);
    expect(await putuskanKlaim({ paymentClaimId: bkm.id, keputusan: "TERVERIFIKASI", olehUserId: gudangId })).toEqual({
      ok: true,
      sisaBaru: [0],
    });
    expect(await sisaSemua()).toBe(0);
    expect(await tunaiDiterima()).toBe(900_000);
  });

  it("toko memotong SEBAGIAN 150 rb: ditagih 50 rb — 850 rb tunai + 50 rb beban = 900 rb", async () => {
    const nrt = await buatNrt();
    await bkmTerverifikasi(nrt.id, 150_000);
    const beban = await hitungKurang(nrt.id);
    // Aturan 2 menahan selisih yang diprorata: 150 rb − 150 rb × 100/300 = 100 rb.
    expect(await sisaSemua()).toBe(100_000);

    // Pratinjau di rincian retur memakai aturan yang sama dengan penulis.
    expect((await rincianRetur(nrt.id))?.beban?.perkiraanTagihToko).toBe(50_000);

    expect((await putuskanBeban({ chargeId: beban.id, bearer: "TOKO", alasan: "toko", olehUserId: gudangId })).ok).toBe(true);
    const [p] = await fakturBeban();
    expect(Number(p.amount)).toBe(50_000);
    expect(await sisaSemua()).toBe(50_000);
    expect((await rincianRetur(nrt.id))?.beban?.perkiraanTagihToko).toBeNull();
    expect((await rincianRetur(nrt.id))?.beban?.tagihTokoTercatat).toBe(50_000);
    // Batas potong = fisik + yang ditagih = 150 rb, dan sudah habis dipakai.
    expect((await pemakaianRetur(prisma, [nrt.id])).get(nrt.id)).toMatchObject({ nilai: 150_000, terpakai: 150_000 });
    // Faktur aslinya sudah lunas; potongan baru (atas faktur beban) tetap ditolak.
    expect(await laporBkm(nrt.id, 1, { receivableId: p.id, nilai: 50_000 })).toEqual({ ok: false, alasan: "RETUR_TERPAKAI" });
    expect((await tunaiDiterima()) + Number(p.amount)).toBe(900_000);
  });

  it("toko memotong PENUH 300 rb: ditagih seluruh selisih 200 rb — 700 rb tunai + 200 rb beban = 900 rb", async () => {
    const nrt = await buatNrt();
    await bkmTerverifikasi(nrt.id, 300_000);
    const beban = await hitungKurang(nrt.id);
    expect((await putuskanBeban({ chargeId: beban.id, bearer: "TOKO", alasan: "toko", olehUserId: gudangId })).ok).toBe(true);
    const [p] = await fakturBeban();
    expect(Number(p.amount)).toBe(200_000);
    expect(await sisaSemua()).toBe(200_000);
    expect((await pemakaianRetur(prisma, [nrt.id])).get(nrt.id)).toMatchObject({ nilai: 300_000, terpakai: 300_000 });
    expect((await tunaiDiterima()) + Number(p.amount)).toBe(900_000);
  });

  it("dialihkan dari GUDANG ke TOKO memakai aturan yang sama; kembali ke GUDANG memulihkan batas potong penuh", async () => {
    const nrt = await buatNrt();
    const beban = await hitungKurang(nrt.id);
    await putuskanBeban({ chargeId: beban.id, bearer: "GUDANG", alasan: "awal", olehUserId: gudangId });
    // Ditanggung gudang: toko berhak memotong NRT penuh.
    expect((await pemakaianRetur(prisma, [nrt.id])).get(nrt.id)?.nilai).toBe(300_000);

    expect((await alihkanBeban({ chargeId: beban.id, bearer: "TOKO", alasan: "ke toko", olehUserId: gudangId })).ok).toBe(true);
    expect(await fakturBeban()).toHaveLength(0);
    expect((await pemakaianRetur(prisma, [nrt.id])).get(nrt.id)?.nilai).toBe(100_000);
    const jejak = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: seededId(beban.id), action: JEJAK.BEBAN_DIALIHKAN },
      orderBy: { createdAt: "desc" },
    });
    expect(jejak.metadata).toMatchObject({ selisih: 200_000, dipotongToko: 0, ditagihKeToko: 0 });

    expect(await tagihanBebanTokoTercatat([beban.id])).toEqual({ [beban.id]: 0 });

    expect((await alihkanBeban({ chargeId: beban.id, bearer: "GUDANG", alasan: "balik", olehUserId: gudangId })).ok).toBe(true);
    expect((await pemakaianRetur(prisma, [nrt.id])).get(nrt.id)?.nilai).toBe(300_000);
    // Hanya keputusan terakhir yang berlaku: kini bukan TOKO.
    expect(await tagihanBebanTokoTercatat([beban.id])).toEqual({});
    expect((await rincianRetur(nrt.id))?.beban?.tagihTokoTercatat).toBeNull();
  });

  it("balapan: keputusan TOKO dan BKM yang memotong NRT penuh bersamaan — tidak pernah ada potongan melebihi batas tanpa ditagih", async () => {
    for (let putaran = 0; putaran < 3; putaran += 1) {
      const nrt = await buatNrt();
      const beban = await hitungKurang(nrt.id);
      const [keputusan, bkm] = await Promise.all([
        putuskanBeban({ chargeId: beban.id, bearer: "TOKO", alasan: "balapan", olehUserId: gudangId }),
        laporBkm(nrt.id, 300_000),
      ]);
      expect(keputusan.ok).toBe(true);
      const u = (await pemakaianRetur(prisma, [nrt.id])).get(nrt.id)!;
      // Inilah yang dijaga: potongan tidak pernah melebihi fisik + yang ditagih.
      expect(u.terpakai).toBeLessThanOrEqual(u.nilai);
      const faktur = await fakturBebanToko([beban.id]);
      if (bkm.ok) {
        // BKM lebih dulu: toko memotong 300 rb, keputusan menagih 200 rb.
        expect(faktur[beban.id]).toBeDefined();
        expect(u).toMatchObject({ nilai: 300_000, terpakai: 300_000 });
      } else {
        // Keputusan lebih dulu: tidak ada yang ditagih, NRT hanya boleh dipotong 100 rb.
        expect(bkm).toEqual({ ok: false, alasan: "RETUR_TERPAKAI" });
        expect(faktur).toEqual({});
        expect(u).toMatchObject({ nilai: 100_000, terpakai: 0 });
      }
    }
  });
});
