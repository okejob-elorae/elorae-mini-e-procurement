import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { buatKlaimPembayaran } from "./claim-writer";
import { putuskanKlaim, tautkanUlangPotongan } from "./writer";
import { bahanKlaimBaru, rincianKlaim } from "./claim-queries";

/**
 * Uang yang sama dipakai dua kali, terhadap basis data sungguhan.
 *
 * - Satu nota retur (NRT) dipotongkan penuh di dua BKM.
 * - Pelapor BKM memverifikasi BKM-nya sendiri.
 * - Dua BKM tertunda masing-masing melunasi seluruh faktur, lalu keduanya
 *   diverifikasi — yang kedua dulu dijepit diam-diam ke nol.
 *
 * Penjaganya hidup di transaksi serializable, jadi tiruan tidak bisa
 * membuktikannya. Basis data dipakai bersama data dev: pengguna DIPINJAM,
 * setiap penghapusan lewat `seededId()`.
 */

const tag = `GANDA-${Math.random().toString(36).slice(2, 8)}`;
const wib = (t: string) => new Date(`${t}T00:00:00+07:00`);

let salesId = "";
let keuanganId = "";
let kantorId = "";
let tokoId = "";
let tokoLainId = "";
let piutangId = "";
let piutangLainId = "";
let klaimIds: string[] = [];
let nrtIds: string[] = [];
let urut = 0;

beforeEach(async () => {
  salesId = "";
  keuanganId = "";
  kantorId = "";
  tokoId = "";
  tokoLainId = "";
  piutangId = "";
  piutangLainId = "";
  klaimIds = [];
  nrtIds = [];

  const orang = await prisma.user.findMany({ select: { id: true }, take: 3, orderBy: { createdAt: "asc" } });
  if (orang.length < 3) throw new Error("Basis data uji butuh tiga pengguna");
  salesId = orang[0].id;
  keuanganId = orang[1].id;
  kantorId = orang[2].id;

  tokoId = (
    await prisma.store.create({
      data: { code: `${tag}-A`, name: `${tag} A`, address: "uji", termsType: "PUTUS", isActive: true, salesmanId: salesId },
    })
  ).id;
  tokoLainId = (
    await prisma.store.create({
      data: { code: `${tag}-B`, name: `${tag} B`, address: "uji", termsType: "PUTUS", isActive: true, salesmanId: keuanganId },
    })
  ).id;

  piutangId = (
    await prisma.receivable.create({
      data: {
        invoiceNo: `${tag}/INV`,
        storeId: tokoId,
        salesmanId: salesId,
        invoiceDate: wib("2026-09-01"),
        dueDate: wib("2026-10-01"),
        amount: 10_000_000,
        outstanding: 10_000_000,
        source: "MANUAL",
      },
    })
  ).id;
  // Faktur kedua toko yang sama: dua BKM yang melunasi faktur BERBEDA tidak
  // saling mengunci lewat baris piutangnya.
  piutangLainId = (
    await prisma.receivable.create({
      data: {
        invoiceNo: `${tag}/INV-2`,
        storeId: tokoId,
        salesmanId: salesId,
        invoiceDate: wib("2026-09-01"),
        dueDate: wib("2026-10-01"),
        amount: 10_000_000,
        outstanding: 10_000_000,
        source: "MANUAL",
      },
    })
  ).id;
});

afterEach(async () => {
  const potongan = klaimIds.length
    ? await prisma.paymentClaimDeduction.findMany({
        where: { paymentClaimId: { in: seededIds(klaimIds).filter(Boolean) } },
        select: { id: true },
      })
    : [];
  // Jejak klaim, NRT, dan potongan (penautan ulang menulis jejak per potongan).
  await prisma.auditLog.deleteMany({
    where: {
      entityId: { in: [...klaimIds, ...nrtIds, ...potongan.map((p) => p.id)].filter(Boolean).map(seededId) },
    },
  });
  if (klaimIds.length) await prisma.paymentClaim.deleteMany({ where: { id: { in: seededIds(klaimIds).filter(Boolean) } } });
  if (nrtIds.length) await prisma.storeReturn.deleteMany({ where: { id: { in: seededIds(nrtIds).filter(Boolean) } } });
  if (piutangId) await prisma.receivable.delete({ where: { id: seededId(piutangId) } });
  if (piutangLainId) await prisma.receivable.delete({ where: { id: seededId(piutangLainId) } });
  await prisma.store.deleteMany({ where: { id: { in: [tokoId, tokoLainId].filter(Boolean).map(seededId) } } });
});

async function nrt(nilai: number, storeId = tokoId) {
  urut += 1;
  const n = await prisma.storeReturn.create({
    data: {
      noNrt: `${tag}-NRT-${urut}`,
      storeId,
      salesmanId: salesId,
      claimDate: wib("2026-09-20"),
      claimedAmount: nilai,
    },
  });
  nrtIds.push(n.id);
  return n.id;
}

async function lapor(opsi: {
  nilai: number;
  potongan?: { nilai: number; nrtId?: string | null }[];
  salesmanId?: string;
  createdById?: string;
  tanggal?: string;
  receivableId?: string;
}) {
  const h = await buatKlaimPembayaran({
    storeId: tokoId,
    salesmanId: opsi.salesmanId ?? salesId,
    createdById: opsi.createdById ?? opsi.salesmanId ?? salesId,
    claimedTransferAt: wib(opsi.tanggal ?? "2026-09-25"),
    method: "transfer",
    pelunasan: [{ receivableId: opsi.receivableId ?? piutangId, nilai: opsi.nilai }],
    potongan: (opsi.potongan ?? []).map((p) => ({ nama: "Retur", nilai: p.nilai, storeReturnId: p.nrtId ?? null })),
    transferPhotoUrl: "/api/foto/uji",
  });
  if (h.ok && !klaimIds.includes(h.id)) klaimIds.push(h.id);
  return h;
}

/** BKM lama yang tercatat sebelum penjaga ini ada — langsung ke tabel. */
async function bkmLama(nilai: number, nrtId: string, potong: number) {
  urut += 1;
  const k = await prisma.paymentClaim.create({
    data: {
      docNo: `${tag}/BKM/${urut}`,
      storeId: tokoId,
      salesmanId: salesId,
      createdById: salesId,
      claimedTransferAt: wib("2026-09-25"),
      method: "transfer",
      invoiceAmount: nilai,
      deductionTotal: potong,
      receivedAmount: nilai - potong,
      transferPhotoUrl: "/api/foto/uji",
      status: "DIKIRIM",
      receivableLinks: { create: [{ receivableId: piutangId, settledAmount: nilai }] },
      deductions: { create: [{ name: "Retur", amount: potong, storeReturnId: nrtId }] },
    },
  });
  klaimIds.push(k.id);
  return k.id;
}

const verifikasi = (id: string, olehUserId = keuanganId) =>
  putuskanKlaim({ paymentClaimId: id, keputusan: "TERVERIFIKASI", olehUserId });

describe("satu nota retur tidak boleh dipotongkan melebihi nilainya", () => {
  it("BKM kedua yang memotong NRT yang sudah habis dipakai ditolak", async () => {
    const n = await nrt(1_000_000);
    expect((await lapor({ nilai: 2_000_000, potongan: [{ nilai: 1_000_000, nrtId: n }] })).ok).toBe(true);
    expect(await lapor({ nilai: 2_000_000, potongan: [{ nilai: 1_000_000, nrtId: n }] })).toEqual({
      ok: false,
      alasan: "RETUR_TERPAKAI",
    });
  });

  it("boleh dipotong sebagian-sebagian sampai habis, tidak lebih satu rupiah pun", async () => {
    const n = await nrt(1_000_000);
    expect((await lapor({ nilai: 2_000_000, potongan: [{ nilai: 600_000, nrtId: n }] })).ok).toBe(true);
    expect((await lapor({ nilai: 2_000_000, potongan: [{ nilai: 400_000, nrtId: n }] })).ok).toBe(true);
    expect(await lapor({ nilai: 2_000_000, potongan: [{ nilai: 1, nrtId: n }] })).toEqual({
      ok: false,
      alasan: "RETUR_TERPAKAI",
    });
  });

  it("dua baris potongan di BKM yang sama dijumlahkan", async () => {
    const n = await nrt(1_000_000);
    expect(
      await lapor({
        nilai: 3_000_000,
        potongan: [
          { nilai: 600_000, nrtId: n },
          { nilai: 600_000, nrtId: n },
        ],
      }),
    ).toEqual({ ok: false, alasan: "RETUR_TERPAKAI" });
  });

  it("BKM yang ditolak keuangan melepas pemakaian NRT-nya", async () => {
    const n = await nrt(1_000_000);
    const k = await lapor({ nilai: 2_000_000, potongan: [{ nilai: 1_000_000, nrtId: n }] });
    if (!k.ok) throw new Error("BKM pertama harus tercatat");
    const tolak = await putuskanKlaim({
      paymentClaimId: k.id,
      keputusan: "DITOLAK",
      olehUserId: keuanganId,
      catatan: "uang tidak ada di rekening",
    });
    expect(tolak.ok).toBe(true);
    expect((await lapor({ nilai: 2_000_000, potongan: [{ nilai: 1_000_000, nrtId: n }] })).ok).toBe(true);
  });

  it("balapan: dua BKM bersamaan memotong NRT yang sama penuh — hanya satu tercatat", async () => {
    for (let putaran = 0; putaran < 4; putaran += 1) {
      const n = await nrt(1_000_000);
      // Faktur berbeda dan tahun transfer berbeda (BKM/2026 vs BKM/2027). Kalau
      // fakturnya sama, kunci baris piutang (hitung ulang menulisnya) sudah
      // mengurutkan keduanya; kalau nomornya sama, bentrok nomor unik + coba
      // ulang yang mengurutkan. Dengan keduanya disingkirkan, yang tersisa
      // hanyalah penjaga NRT di transaksi serializable — tes ini gagal kalau
      // transaksinya diganti READ COMMITTED.
      const hasil = await Promise.all([
        lapor({ nilai: 1_500_000, potongan: [{ nilai: 1_000_000, nrtId: n }], tanggal: "2026-12-30" }),
        lapor({
          nilai: 1_500_000,
          potongan: [{ nilai: 1_000_000, nrtId: n }],
          tanggal: "2027-01-04",
          receivableId: piutangLainId,
        }),
      ]);
      expect(hasil.filter((h) => h.ok)).toHaveLength(1);
      expect(hasil.find((h) => !h.ok)).toEqual({ ok: false, alasan: "RETUR_TERPAKAI" });
      const total = await prisma.paymentClaimDeduction.aggregate({
        where: { storeReturnId: seededId(n) },
        _sum: { amount: true },
      });
      expect(Number(total._sum.amount)).toBe(1_000_000);
    }
  });

  it("verifikasi menolak BKM lama yang memakai NRT melebihi nilainya, sampai salah satunya ditolak", async () => {
    const n = await nrt(1_000_000);
    const a = await bkmLama(2_000_000, n, 1_000_000);
    const b = await bkmLama(2_000_000, n, 1_000_000);
    expect(await verifikasi(a)).toEqual({ ok: false, alasan: "RETUR_TERPAKAI" });
    expect((await prisma.paymentClaim.findUniqueOrThrow({ where: { id: seededId(a) } })).status).toBe("DIKIRIM");

    const tolak = await putuskanKlaim({
      paymentClaimId: b,
      keputusan: "DITOLAK",
      olehUserId: keuanganId,
      catatan: "nota retur sudah dipakai BKM lain",
    });
    expect(tolak.ok).toBe(true);
    expect((await verifikasi(a)).ok).toBe(true);
  });

  it("potongan yang menunjuk NRT yang tidak ada tidak memblokir verifikasi — ia ditahan penuh", async () => {
    // Penunjuk menggantung (`relationMode = "prisma"`): Aturan 2 sudah menahannya
    // penuh lewat `potonganRetur`. Menolaknya "sudah terpakai di BKM lain" salah
    // alamat dan membuat transfer yang sah tidak pernah bisa diakui.
    const k = await bkmLama(2_000_000, `${tag}-nrt-yang-hilang`, 500_000);
    expect(await verifikasi(k)).toEqual({ ok: true, sisaBaru: [8_500_000] });
  });

  it("menautkan ulang potongan ke NRT yang sudah habis ditolak", async () => {
    const n = await nrt(1_000_000);
    const a = await lapor({ nilai: 2_000_000, potongan: [{ nilai: 1_000_000, nrtId: n }] });
    const b = await lapor({ nilai: 2_000_000, potongan: [{ nilai: 300_000 }] });
    if (!a.ok || !b.ok) throw new Error("BKM harus tercatat");
    const potB = await prisma.paymentClaimDeduction.findFirstOrThrow({ where: { paymentClaimId: seededId(b.id) } });
    expect(
      await tautkanUlangPotongan({ deductionId: potB.id, storeReturnId: n, alasan: "lupa ditautkan", olehUserId: keuanganId }),
    ).toEqual({ ok: false, alasan: "RETUR_TERPAKAI" });

    // Potongan yang sudah memakai NRT itu sendiri boleh ditautkan ulang ke NRT yang sama.
    const potA = await prisma.paymentClaimDeduction.findFirstOrThrow({ where: { paymentClaimId: seededId(a.id) } });
    expect(
      (await tautkanUlangPotongan({ deductionId: potA.id, storeReturnId: n, alasan: "tetap", olehUserId: keuanganId })).ok,
    ).toBe(true);
  });

  it("pilihan potongan menampilkan sisa NRT yang belum dipakai dan menyembunyikan yang habis", async () => {
    const sebagian = await nrt(1_000_000);
    const habis = await nrt(500_000);
    const k = await lapor({
      nilai: 3_000_000,
      potongan: [
        { nilai: 300_000, nrtId: sebagian },
        { nilai: 500_000, nrtId: habis },
      ],
    });
    if (!k.ok) throw new Error("BKM harus tercatat");

    const bahan = await bahanKlaimBaru({ penagihId: salesId });
    const retur = bahan.returPerToko[tokoId] ?? [];
    expect(retur.find((r) => r.id === sebagian)).toMatchObject({ nilaiKlaim: 1_000_000, sisa: 700_000 });
    expect(retur.some((r) => r.id === habis)).toBe(false);

    const rinci = await rincianKlaim(k.id);
    expect(rinci?.returToko.find((r) => r.id === sebagian)).toMatchObject({ nilaiKlaim: 1_000_000, sisa: 700_000 });
  });

  it("layar HP hanya menerima nota retur toko yang boleh ia tagih", async () => {
    await nrt(1_000_000);
    await nrt(800_000, tokoLainId);
    const bahan = await bahanKlaimBaru({ penagihId: salesId });
    expect(Object.keys(bahan.returPerToko)).toContain(tokoId);
    expect(Object.keys(bahan.returPerToko)).not.toContain(tokoLainId);
    // Setiap toko yang membawa nota retur ada di daftar toko yang boleh ditagih.
    const toko = new Set(bahan.toko.map((t) => t.id));
    expect(Object.keys(bahan.returPerToko).every((id) => toko.has(id))).toBe(true);
  });
});

describe("pelapor BKM tidak boleh memeriksa BKM-nya sendiri", () => {
  it("sales yang melapor tidak bisa memverifikasi maupun menolak laporannya", async () => {
    const k = await lapor({ nilai: 1_000_000 });
    if (!k.ok) throw new Error("BKM harus tercatat");
    expect(await verifikasi(k.id, salesId)).toEqual({ ok: false, alasan: "PEMERIKSA_SAMA" });
    expect(
      await putuskanKlaim({ paymentClaimId: k.id, keputusan: "DITOLAK", olehUserId: salesId, catatan: "x" }),
    ).toEqual({ ok: false, alasan: "PEMERIKSA_SAMA" });
    expect((await prisma.paymentClaim.findUniqueOrThrow({ where: { id: seededId(k.id) } })).status).toBe("DIKIRIM");
  });

  it("orang kantor yang mencatatkan BKM untuk sales juga tidak bisa memverifikasinya", async () => {
    const k = await lapor({ nilai: 1_000_000, createdById: kantorId });
    if (!k.ok) throw new Error("BKM harus tercatat");
    expect(await verifikasi(k.id, kantorId)).toEqual({ ok: false, alasan: "PEMERIKSA_SAMA" });
    // Sales yang namanya tercatat sebagai pelapor juga tidak — walau bukan ia
    // yang mengetiknya di kantor.
    expect(await verifikasi(k.id, salesId)).toEqual({ ok: false, alasan: "PEMERIKSA_SAMA" });
    expect(await verifikasi(k.id, keuanganId)).toEqual({ ok: true, sisaBaru: [9_000_000] });
  });
});

describe("dua BKM tertunda tidak bisa melunasi satu faktur dua kali", () => {
  it("verifikasi kedua ditolak MELEBIHI_SISA, bukan dijepit diam-diam", async () => {
    const a = await lapor({ nilai: 10_000_000 });
    const b = await lapor({ nilai: 10_000_000 });
    if (!a.ok || !b.ok) throw new Error("kedua BKM harus tercatat (tertunda belum mengurangi sisa)");
    expect(await verifikasi(a.id)).toEqual({ ok: true, sisaBaru: [0] });
    expect(await verifikasi(b.id)).toEqual({ ok: false, alasan: "MELEBIHI_SISA" });
    expect((await prisma.paymentClaim.findUniqueOrThrow({ where: { id: seededId(b.id) } })).status).toBe("DIKIRIM");
  });

  it("sebagian: 6 jt terverifikasi, BKM 6 jt berikutnya ditolak, 4 jt diterima", async () => {
    const a = await lapor({ nilai: 6_000_000 });
    const b = await lapor({ nilai: 6_000_000 });
    const c = await lapor({ nilai: 4_000_000 });
    if (!a.ok || !b.ok || !c.ok) throw new Error("BKM harus tercatat");
    expect((await verifikasi(a.id)).ok).toBe(true);
    expect(await verifikasi(b.id)).toEqual({ ok: false, alasan: "MELEBIHI_SISA" });
    expect(await verifikasi(c.id)).toEqual({ ok: true, sisaBaru: [0] });
  });

  it("balapan: dua verifikasi bersamaan — hanya satu yang melunasi", async () => {
    for (let putaran = 0; putaran < 3; putaran += 1) {
      await prisma.paymentClaim.updateMany({
        where: { id: { in: seededIds(klaimIds).filter(Boolean) } },
        data: { status: "DIBATALKAN" },
      });
      await prisma.receivable.update({ where: { id: seededId(piutangId) }, data: { outstanding: 10_000_000, settledAt: null } });
      const a = await lapor({ nilai: 10_000_000 });
      const b = await lapor({ nilai: 10_000_000 });
      if (!a.ok || !b.ok) throw new Error("kedua BKM harus tercatat");
      const hasil = await Promise.all([verifikasi(a.id), verifikasi(b.id)]);
      expect(hasil.filter((h) => h.ok)).toHaveLength(1);
      expect(hasil.find((h) => !h.ok)).toEqual({ ok: false, alasan: "MELEBIHI_SISA" });
      const terverifikasi = await prisma.paymentClaim.count({
        where: { id: { in: [a.id, b.id].map(seededId) }, status: "TERVERIFIKASI" },
      });
      expect(terverifikasi).toBe(1);
      const p = await prisma.receivable.findUniqueOrThrow({ where: { id: seededId(piutangId) } });
      expect(Number(p.outstanding)).toBe(0);
    }
  });
});
