import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId } from "@elorae/db";
import {
  batalkanKlaimSendiri,
  batalkanReturSendiri,
  KATEGORI_NOTIF_KLAIM_DIBATALKAN_SALES,
  KATEGORI_NOTIF_KOREKSI_BKM,
  KATEGORI_NOTIF_KOREKSI_RETUR,
  KATEGORI_NOTIF_RETUR_DIBATALKAN_SALES,
  koreksiTertunda,
  mintaKoreksi,
  pindahkanNriKeToko,
  pindahkanReturKeToko,
  riwayatDokumen,
} from "./koreksi";
import { buatKlaimPembayaran } from "./claim-writer";
import { batalkanRetur, catatReturToko, jodohkanRetur, lepasPasangan } from "./return-writer";
import { putuskanKlaim } from "./writer";
import { JEJAK } from "./jejak";

/**
 * Koreksi laporan salah toko, terhadap basis data sungguhan.
 *
 * Yang dijaga hidup di transaksi dan batasan tabel, bukan di fungsi murni:
 * compare-and-swap status, `@@unique([storeId, noNrt])` di toko tujuan, NRI
 * yang ikut pindah bersama notanya, dan jejak yang tertulis di transaksi yang
 * sama. Tiruan database tidak bisa membuktikan satu pun dari itu.
 *
 * Basis data dipakai bersama data dev: pengguna DIPINJAM (dua yang sudah ada),
 * setiap penghapusan lewat `seededId()`, id fixture dideklarasikan "" dan
 * direset di awal hook.
 */

const tag = `KRK-${Math.random().toString(36).slice(2, 8)}`;
let salesId = "";
let lainId = "";
let tokoAId = "";
let tokoBId = "";
let tokoMatiId = "";
let piutangId = "";
let klaimIds: string[] = [];
let nrtIds: string[] = [];
let nriIds: string[] = [];
let bebanIds: string[] = [];
let siklusIds: string[] = [];
let urut = 0;

beforeEach(async () => {
  salesId = "";
  lainId = "";
  tokoAId = "";
  tokoBId = "";
  tokoMatiId = "";
  piutangId = "";
  klaimIds = [];
  nrtIds = [];
  nriIds = [];
  bebanIds = [];
  siklusIds = [];

  const orang = await prisma.user.findMany({ select: { id: true }, take: 2, orderBy: { createdAt: "asc" } });
  if (orang.length < 2) throw new Error("Basis data uji butuh dua pengguna");
  salesId = orang[0].id;
  lainId = orang[1].id;

  const buatToko = (akhiran: string, isActive = true) =>
    prisma.store.create({
      data: { code: `${tag}-${akhiran}`, name: `${tag} ${akhiran}`, address: "uji", termsType: "PUTUS", isActive },
    });
  tokoAId = (await buatToko("A")).id;
  tokoBId = (await buatToko("B")).id;
  tokoMatiId = (await buatToko("MATI", false)).id;

  piutangId = (
    await prisma.receivable.create({
      data: {
        invoiceNo: `${tag}/INV`,
        storeId: tokoAId,
        invoiceDate: new Date("2026-09-01T00:00:00Z"),
        dueDate: new Date("2026-10-01T00:00:00Z"),
        amount: 1_000_000,
        outstanding: 1_000_000,
        source: "MANUAL",
      },
    })
  ).id;
});

afterEach(async () => {
  const entitas = [...klaimIds, ...nrtIds, ...nriIds].filter(Boolean).map(seededId);
  if (entitas.length) await prisma.auditLog.deleteMany({ where: { entityId: { in: entitas } } });
  const notif = await prisma.adminNotification.findMany({
    where: {
      category: {
        in: [
          KATEGORI_NOTIF_KLAIM_DIBATALKAN_SALES,
          KATEGORI_NOTIF_RETUR_DIBATALKAN_SALES,
          KATEGORI_NOTIF_KOREKSI_BKM,
          KATEGORI_NOTIF_KOREKSI_RETUR,
        ],
      },
      title: { contains: tag },
    },
    select: { id: true },
  });
  if (notif.length) await prisma.adminNotification.deleteMany({ where: { id: { in: notif.map((n) => seededId(n.id)) } } });
  await prisma.returnCharge.deleteMany({ where: { id: { in: bebanIds.filter(Boolean).map(seededId) } } });
  // Beban yang dibuat penulis (bukan fixture) juga harus pergi sebelum notanya.
  await prisma.returnCharge.deleteMany({
    where: {
      OR: [
        { storeReturnId: { in: nrtIds.filter(Boolean).map(seededId) } },
        { warehouseReturnId: { in: nriIds.filter(Boolean).map(seededId) } },
      ],
    },
  });
  // Pengganti dihapus lebih dulu dari yang digantikan (kolom unik menunjuk ke sana).
  await prisma.paymentClaim.deleteMany({ where: { id: { in: [...klaimIds].reverse().filter(Boolean).map(seededId) } } });
  await prisma.consignmentCycle.deleteMany({ where: { id: { in: siklusIds.filter(Boolean).map(seededId) } } });
  await prisma.warehouseReturn.deleteMany({ where: { id: { in: nriIds.filter(Boolean).map(seededId) } } });
  await prisma.storeReturn.deleteMany({ where: { id: { in: nrtIds.filter(Boolean).map(seededId) } } });
  if (piutangId) await prisma.receivable.delete({ where: { id: seededId(piutangId) } });
  await prisma.store.deleteMany({
    where: { id: { in: [tokoAId, tokoBId, tokoMatiId].filter(Boolean).map(seededId) } },
  });
});

async function buatKlaim(opsi: { status?: "DIKIRIM" | "TERVERIFIKASI" | "DIBATALKAN"; salesmanId?: string; nrtId?: string } = {}) {
  urut += 1;
  const k = await prisma.paymentClaim.create({
    data: {
      docNo: `${tag}/BKM/${urut}`,
      storeId: tokoAId,
      salesmanId: opsi.salesmanId ?? salesId,
      createdById: opsi.salesmanId ?? salesId,
      claimedTransferAt: new Date("2026-10-01T00:00:00+07:00"),
      method: "tunai",
      invoiceAmount: 400_000,
      deductionTotal: opsi.nrtId ? 100_000 : 0,
      receivedAmount: opsi.nrtId ? 300_000 : 400_000,
      status: opsi.status ?? "DIKIRIM",
      receivableLinks: { create: [{ receivableId: piutangId, settledAmount: 400_000 }] },
      ...(opsi.nrtId
        ? { deductions: { create: [{ name: "Retur", amount: 100_000, storeReturnId: opsi.nrtId }] } }
        : {}),
    },
  });
  klaimIds.push(k.id);
  return k;
}

async function buatNrt(opsi: { storeId?: string; noNrt?: string; salesmanId?: string; status?: "MENUNGGU" | "BATAL" } = {}) {
  urut += 1;
  const n = await prisma.storeReturn.create({
    data: {
      noNrt: opsi.noNrt ?? `${tag}-NRT-${urut}`,
      storeId: opsi.storeId ?? tokoAId,
      salesmanId: opsi.salesmanId ?? salesId,
      claimDate: new Date("2026-10-01T00:00:00+07:00"),
      claimedAmount: 300_000,
      status: opsi.status ?? "MENUNGGU",
    },
  });
  nrtIds.push(n.id);
  return n;
}

async function buatNri(opsi: { storeId?: string | null; storeReturnId?: string | null } = {}) {
  urut += 1;
  const n = await prisma.warehouseReturn.create({
    data: {
      noNri: `${tag}-NRI-${urut}`,
      storeId: opsi.storeId === undefined ? tokoAId : opsi.storeId,
      storeReturnId: opsi.storeReturnId ?? null,
      warehouseUserId: salesId,
      receivedAt: new Date("2026-10-01T00:00:00+07:00"),
      physicalAmount: 250_000,
      claimedAmount: opsi.storeReturnId ? 300_000 : 0,
      status: "FINAL",
    },
  });
  nriIds.push(n.id);
  return n;
}

async function buatBeban(opsi: { storeReturnId: string; warehouseReturnId?: string; status?: "TERBUKA" | "DITETAPKAN" }) {
  const b = await prisma.returnCharge.create({
    data: {
      storeReturnId: opsi.storeReturnId,
      warehouseReturnId: opsi.warehouseReturnId ?? null,
      storeId: tokoAId,
      amount: 50_000,
      status: opsi.status ?? "TERBUKA",
      ...(opsi.status === "DITETAPKAN" ? { bearer: "GUDANG" as const, decidedById: lainId, decidedAt: new Date() } : {}),
    },
  });
  bebanIds.push(b.id);
  return b;
}

const jejakUntuk = (entityId: string) =>
  prisma.auditLog.findMany({ where: { entityId: seededId(entityId) }, orderBy: { createdAt: "asc" } });

describe("batalkanKlaimSendiri — sales menarik BKM-nya sendiri", () => {
  it("membatalkan BKM miliknya yang belum diputuskan, mencatat jejak, dan memberi tahu keuangan", async () => {
    const k = await buatKlaim();
    const hasil = await batalkanKlaimSendiri({ paymentClaimId: k.id, salesmanId: salesId, alasan: "salah pilih toko" });
    expect(hasil.ok).toBe(true);

    const sesudah = await prisma.paymentClaim.findUniqueOrThrow({ where: { id: k.id } });
    expect(sesudah.status).toBe("DIBATALKAN");
    expect(sesudah.verifyNote).toBe("salah pilih toko");

    // Klaim yang masih DIKIRIM mengakui nol (Aturan 1): sisa piutang tetap penuh.
    const p = await prisma.receivable.findUniqueOrThrow({ where: { id: piutangId } });
    expect(Number(p.outstanding)).toBe(1_000_000);

    const jejak = await jejakUntuk(k.id);
    expect(jejak).toHaveLength(1);
    expect(jejak[0].action).toBe(JEJAK.KLAIM_DIBATALKAN);
    expect(jejak[0].userId).toBe(salesId);
    expect(jejak[0].metadata).toMatchObject({ olehSales: true });

    // Tidak pernah diam-diam: keuangan tahu sebuah laporan ditarik.
    const notif = await prisma.adminNotification.findMany({
      where: { category: KATEGORI_NOTIF_KLAIM_DIBATALKAN_SALES, title: { contains: k.docNo } },
    });
    expect(notif).toHaveLength(1);
    expect(notif[0].metadata).toMatchObject({ paymentClaimId: k.id });
  });

  it("menolak tanpa alasan dan tidak mengubah apa pun", async () => {
    const k = await buatKlaim();
    expect(await batalkanKlaimSendiri({ paymentClaimId: k.id, salesmanId: salesId, alasan: "  " })).toEqual({
      ok: false,
      alasan: "ALASAN_WAJIB",
    });
    expect((await prisma.paymentClaim.findUniqueOrThrow({ where: { id: k.id } })).status).toBe("DIKIRIM");
  });

  it("menolak BKM milik sales lain", async () => {
    const k = await buatKlaim({ salesmanId: lainId });
    expect(await batalkanKlaimSendiri({ paymentClaimId: k.id, salesmanId: salesId, alasan: "x" })).toEqual({
      ok: false,
      alasan: "BUKAN_MILIK",
    });
    expect((await prisma.paymentClaim.findUniqueOrThrow({ where: { id: k.id } })).status).toBe("DIKIRIM");
  });

  it("menolak BKM yang sudah diverifikasi keuangan — uangnya sudah dicocokkan rekening", async () => {
    const k = await buatKlaim({ status: "TERVERIFIKASI" });
    expect(await batalkanKlaimSendiri({ paymentClaimId: k.id, salesmanId: salesId, alasan: "x" })).toEqual({
      ok: false,
      alasan: "SUDAH_DIPUTUSKAN",
    });
  });

  it("menolak yang sudah dibatalkan, dan id yang tidak ada", async () => {
    const k = await buatKlaim({ status: "DIBATALKAN" });
    expect(await batalkanKlaimSendiri({ paymentClaimId: k.id, salesmanId: salesId, alasan: "x" })).toEqual({
      ok: false,
      alasan: "SUDAH_DIBATALKAN",
    });
    expect(await batalkanKlaimSendiri({ paymentClaimId: `${tag}-tidak-ada`, salesmanId: salesId, alasan: "x" })).toEqual({
      ok: false,
      alasan: "TIDAK_DITEMUKAN",
    });
  });

  it("verifikasi yang datang SESUDAH ditarik sales ditolak, tidak menimpa pembatalannya", async () => {
    const k = await buatKlaim();
    await batalkanKlaimSendiri({ paymentClaimId: k.id, salesmanId: salesId, alasan: "salah toko" });
    const v = await putuskanKlaim({ paymentClaimId: k.id, keputusan: "TERVERIFIKASI", olehUserId: lainId });
    expect(v).toMatchObject({ ok: false, alasan: "SUDAH_DIPUTUSKAN" });
    expect((await prisma.paymentClaim.findUniqueOrThrow({ where: { id: k.id } })).status).toBe("DIBATALKAN");
    const p = await prisma.receivable.findUniqueOrThrow({ where: { id: piutangId } });
    expect(Number(p.outstanding)).toBe(1_000_000);
  });
});

describe("balapan: sales menarik BKM tepat saat keuangan memverifikasinya", () => {
  it("hanya satu yang menang, dan keadaan akhirnya selalu sesuai dengan pemenangnya", async () => {
    // Dijalankan berulang karena urutan dua transaksi tidak bisa dipaksakan dari
    // luar. Tanpa compare-and-swap di kedua penulis, putaran yang keduanya
    // membaca DIKIRIM berakhir dengan keduanya "berhasil" — dan piutang toko
    // yang salah berkurang oleh laporan yang sudah ditarik.
    for (let putaran = 0; putaran < 8; putaran += 1) {
      const k = await buatKlaim();
      const [tarik, verif] = await Promise.all([
        batalkanKlaimSendiri({ paymentClaimId: k.id, salesmanId: salesId, alasan: "salah toko" }),
        putuskanKlaim({ paymentClaimId: k.id, keputusan: "TERVERIFIKASI", olehUserId: lainId }),
      ]);
      expect([tarik.ok, verif.ok].filter(Boolean)).toHaveLength(1);

      const akhir = await prisma.paymentClaim.findUniqueOrThrow({ where: { id: k.id } });
      expect(akhir.status).toBe(tarik.ok ? "DIBATALKAN" : "TERVERIFIKASI");
      // Hanya klaim yang terverifikasi mengurangi piutang (Aturan 1); sisa tidak
      // pernah di bawah nol. Semua putaran memakai faktur yang sama.
      const p = await prisma.receivable.findUniqueOrThrow({ where: { id: piutangId } });
      const terverifikasi = await prisma.paymentClaim.count({
        where: { id: { in: klaimIds.map(seededId) }, status: "TERVERIFIKASI" },
      });
      expect(Number(p.outstanding)).toBe(Math.max(0, 1_000_000 - 400_000 * terverifikasi));
    }
  });
});

describe("batalkanReturSendiri — sales menarik nota returnya sendiri", () => {
  it("membatalkan nota miliknya yang belum dihitung gudang, dengan jejak dan notifikasi", async () => {
    const n = await buatNrt();
    const hasil = await batalkanReturSendiri({ storeReturnId: n.id, salesmanId: salesId, alasan: "salah toko" });
    expect(hasil.ok).toBe(true);
    const sesudah = await prisma.storeReturn.findUniqueOrThrow({ where: { id: n.id } });
    expect(sesudah.status).toBe("BATAL");
    expect(sesudah.note).toContain("salah toko");

    const jejak = await jejakUntuk(n.id);
    expect(jejak.map((j) => j.action)).toEqual([JEJAK.RETUR_DIBATALKAN]);
    expect(jejak[0].metadata).toMatchObject({ olehSales: true });

    const notif = await prisma.adminNotification.findMany({
      where: { category: KATEGORI_NOTIF_RETUR_DIBATALKAN_SALES, title: { contains: n.noNrt } },
    });
    expect(notif).toHaveLength(1);
  });

  it("menolak sesudah gudang menghitung — barangnya sudah masuk, itu urusan kantor", async () => {
    const n = await buatNrt();
    await buatNri({ storeReturnId: n.id });
    expect(await batalkanReturSendiri({ storeReturnId: n.id, salesmanId: salesId, alasan: "x" })).toEqual({
      ok: false,
      alasan: "SUDAH_DIHITUNG",
    });
    expect((await prisma.storeReturn.findUniqueOrThrow({ where: { id: n.id } })).status).toBe("MENUNGGU");
  });

  it("menolak nota yang dipakai potongan di BKM yang masih hidup, dan menyebut BKM-nya", async () => {
    const n = await buatNrt();
    const k = await buatKlaim({ nrtId: n.id });
    expect(await batalkanReturSendiri({ storeReturnId: n.id, salesmanId: salesId, alasan: "x" })).toEqual({
      ok: false,
      alasan: "DIPAKAI_DI_BKM",
      docNo: [k.docNo],
    });
  });

  it("mengizinkan kalau BKM yang memakainya sudah dibatalkan", async () => {
    const n = await buatNrt();
    await buatKlaim({ nrtId: n.id, status: "DIBATALKAN" });
    expect((await batalkanReturSendiri({ storeReturnId: n.id, salesmanId: salesId, alasan: "x" })).ok).toBe(true);
  });

  it("menolak nota milik sales lain dan nota yang sudah batal", async () => {
    const milikLain = await buatNrt({ salesmanId: lainId });
    expect(await batalkanReturSendiri({ storeReturnId: milikLain.id, salesmanId: salesId, alasan: "x" })).toEqual({
      ok: false,
      alasan: "BUKAN_MILIK",
    });
    const batal = await buatNrt({ status: "BATAL" });
    expect(await batalkanReturSendiri({ storeReturnId: batal.id, salesmanId: salesId, alasan: "x" })).toEqual({
      ok: false,
      alasan: "SUDAH_DIBATALKAN",
    });
  });
});

describe("pindahkanReturKeToko — kantor membetulkan toko nota retur", () => {
  it("memindahkan nota, hitungan gudang, dan beban terbukanya bersama; stok tidak bergerak", async () => {
    const n = await buatNrt();
    const nri = await buatNri({ storeReturnId: n.id });
    const beban = await buatBeban({ storeReturnId: n.id, warehouseReturnId: nri.id });
    const stokSebelum = await prisma.stockAdjustment.count();

    const hasil = await pindahkanReturKeToko({ storeReturnId: n.id, tokoTujuanId: tokoBId, alasan: "sales salah pilih", olehUserId: lainId });
    expect(hasil.ok).toBe(true);

    expect((await prisma.storeReturn.findUniqueOrThrow({ where: { id: n.id } })).storeId).toBe(tokoBId);
    expect((await prisma.warehouseReturn.findUniqueOrThrow({ where: { id: nri.id } })).storeId).toBe(tokoBId);
    expect((await prisma.returnCharge.findUniqueOrThrow({ where: { id: beban.id } })).storeId).toBe(tokoBId);
    expect(await prisma.stockAdjustment.count()).toBe(stokSebelum);

    const jejak = await jejakUntuk(n.id);
    expect(jejak).toHaveLength(1);
    expect(jejak[0].action).toBe(JEJAK.RETUR_DIPINDAH_TOKO);
    expect(jejak[0].reason).toBe("sales salah pilih");
    expect(jejak[0].changes).toMatchObject({ before: { storeId: tokoAId }, after: { storeId: tokoBId } });
  });

  it("menolak toko yang sama, toko tidak aktif, dan toko yang tidak ada", async () => {
    const n = await buatNrt();
    const coba = (tokoTujuanId: string) =>
      pindahkanReturKeToko({ storeReturnId: n.id, tokoTujuanId, alasan: "x", olehUserId: lainId });
    expect(await coba(tokoAId)).toEqual({ ok: false, alasan: "TOKO_SAMA" });
    expect(await coba(tokoMatiId)).toEqual({ ok: false, alasan: "TOKO_TIDAK_AKTIF" });
    expect(await coba(`${tag}-tidak-ada`)).toEqual({ ok: false, alasan: "TOKO_TIDAK_DITEMUKAN" });
    expect((await prisma.storeReturn.findUniqueOrThrow({ where: { id: n.id } })).storeId).toBe(tokoAId);
  });

  it("menolak kalau toko tujuan sudah punya nota bernomor sama — dan tidak memindahkan apa pun", async () => {
    const n = await buatNrt({ noNrt: `${tag}-SAMA` });
    await buatNrt({ storeId: tokoBId, noNrt: `${tag}-SAMA` });
    const nri = await buatNri({ storeReturnId: n.id });
    expect(
      await pindahkanReturKeToko({ storeReturnId: n.id, tokoTujuanId: tokoBId, alasan: "x", olehUserId: lainId }),
    ).toEqual({ ok: false, alasan: "NOMOR_DIPAKAI_DI_TUJUAN" });
    expect((await prisma.warehouseReturn.findUniqueOrThrow({ where: { id: nri.id } })).storeId).toBe(tokoAId);
  });

  it("menolak kalau beban selisihnya sudah ditetapkan ke seseorang", async () => {
    const n = await buatNrt();
    await buatBeban({ storeReturnId: n.id, status: "DITETAPKAN" });
    expect(
      await pindahkanReturKeToko({ storeReturnId: n.id, tokoTujuanId: tokoBId, alasan: "x", olehUserId: lainId }),
    ).toEqual({ ok: false, alasan: "BEBAN_SUDAH_DIPUTUSKAN" });
  });

  it("menolak kalau nota dipakai potongan di BKM hidup, dan menyebut BKM-nya", async () => {
    const n = await buatNrt();
    const k = await buatKlaim({ nrtId: n.id, status: "TERVERIFIKASI" });
    expect(
      await pindahkanReturKeToko({ storeReturnId: n.id, tokoTujuanId: tokoBId, alasan: "x", olehUserId: lainId }),
    ).toEqual({ ok: false, alasan: "DIPAKAI_DI_BKM", docNo: [k.docNo] });
  });

  it("menolak nota batal dan alasan kosong", async () => {
    const batal = await buatNrt({ status: "BATAL" });
    expect(
      await pindahkanReturKeToko({ storeReturnId: batal.id, tokoTujuanId: tokoBId, alasan: "x", olehUserId: lainId }),
    ).toEqual({ ok: false, alasan: "SUDAH_DIBATALKAN" });
    const n = await buatNrt();
    expect(
      await pindahkanReturKeToko({ storeReturnId: n.id, tokoTujuanId: tokoBId, alasan: " ", olehUserId: lainId }),
    ).toEqual({ ok: false, alasan: "ALASAN_WAJIB" });
  });
});

describe("pindahkanNriKeToko — hitungan gudang yatim di toko yang salah", () => {
  it("memindahkan NRI yatim, lalu bisa dijodohkan ke nota toko yang benar", async () => {
    const nri = await buatNri({ storeId: tokoAId });
    const nrtB = await buatNrt({ storeId: tokoBId });

    // Sebelum dipindah, menjodohkannya ditolak — inilah celah yang ditutup.
    expect(await jodohkanRetur({ warehouseReturnId: nri.id, storeReturnId: nrtB.id, olehUserId: lainId })).toMatchObject({
      ok: false,
      alasan: "BEDA_TOKO",
    });

    const hasil = await pindahkanNriKeToko({ warehouseReturnId: nri.id, tokoTujuanId: tokoBId, alasan: "gudang salah pilih", olehUserId: lainId });
    expect(hasil.ok).toBe(true);
    expect((await jodohkanRetur({ warehouseReturnId: nri.id, storeReturnId: nrtB.id, olehUserId: lainId })).ok).toBe(true);

    const jejak = await jejakUntuk(nri.id);
    expect(jejak[0].action).toBe(JEJAK.RETUR_DIPINDAH_TOKO);
    expect(jejak[0].changes).toMatchObject({ before: { storeId: tokoAId }, after: { storeId: tokoBId } });
  });

  it("menetapkan toko untuk NRI yang belum punya toko", async () => {
    const nri = await buatNri({ storeId: null });
    expect((await pindahkanNriKeToko({ warehouseReturnId: nri.id, tokoTujuanId: tokoBId, alasan: "x", olehUserId: lainId })).ok).toBe(true);
    expect((await prisma.warehouseReturn.findUniqueOrThrow({ where: { id: nri.id } })).storeId).toBe(tokoBId);
  });

  it("menolak NRI yang sudah berpasangan — pindahkan lewat notanya supaya keduanya tidak pernah beda toko", async () => {
    const n = await buatNrt();
    const nri = await buatNri({ storeReturnId: n.id });
    expect(
      await pindahkanNriKeToko({ warehouseReturnId: nri.id, tokoTujuanId: tokoBId, alasan: "x", olehUserId: lainId }),
    ).toEqual({ ok: false, alasan: "SUDAH_BERPASANGAN" });
  });
});

describe("jebakan lama yang ditutup", () => {
  it("kantor tidak bisa membatalkan nota yang sudah dihitung gudang — lepas pasangan atau pindahkan dulu", async () => {
    const n = await buatNrt();
    await buatNri({ storeReturnId: n.id });
    expect(await batalkanRetur({ storeReturnId: n.id, alasan: "x", olehUserId: lainId })).toEqual({
      ok: false,
      alasan: "SUDAH_DIHITUNG",
    });
    expect((await prisma.storeReturn.findUniqueOrThrow({ where: { id: n.id } })).status).toBe("MENUNGGU");
  });

  it("melepas pasangan dari nota yang sudah batal tidak menghidupkan notanya lagi", async () => {
    // Keadaan warisan: nota dibatalkan saat masih berpasangan (dulu diizinkan).
    const n = await buatNrt({ status: "BATAL" });
    const nri = await buatNri({ storeReturnId: n.id });
    expect((await lepasPasangan({ warehouseReturnId: nri.id, olehUserId: lainId })).ok).toBe(true);
    expect((await prisma.storeReturn.findUniqueOrThrow({ where: { id: n.id } })).status).toBe("BATAL");
    expect((await prisma.warehouseReturn.findUniqueOrThrow({ where: { id: nri.id } })).storeReturnId).toBeNull();
  });
});

describe("nomor nota toko dari nota yang sudah batal bisa dipakai lagi", () => {
  it("salah ketik nilai: nota ditarik, lalu nomor yang SAMA dicatat ulang ke toko yang sama", async () => {
    const lama = await buatNrt({ noNrt: `${tag}-ULANG` });
    await batalkanReturSendiri({ storeReturnId: lama.id, salesmanId: salesId, alasan: "salah nilai" });

    const baru = await catatReturToko({
      noNrt: `${tag}-ULANG`,
      storeId: tokoAId,
      olehUserId: salesId,
      salesmanId: salesId,
      claimDate: new Date("2026-10-01T00:00:00+07:00"),
      deliveryMethod: "SALES",
      claimedAmount: 350_000,
    });
    expect(baru.ok).toBe(true);
    if (!baru.ok) return;
    nrtIds.push(baru.id);
    expect(baru.noNrt).toBe(`${tag}-ULANG`);

    // Yang batal tetap ada, nomornya diberi akhiran — nomor aslinya di jejak.
    const batal = await prisma.storeReturn.findUniqueOrThrow({ where: { id: lama.id } });
    expect(batal.status).toBe("BATAL");
    expect(batal.noNrt).toBe(`${tag}-ULANG (batal)`);
    const jejak = await jejakUntuk(lama.id);
    const lepas = jejak.find((j) => j.action === JEJAK.RETUR_NOMOR_DILEPAS);
    expect(lepas?.changes).toMatchObject({ before: { noNrt: `${tag}-ULANG` }, after: { noNrt: `${tag}-ULANG (batal)` } });
    expect(lepas?.metadata).toMatchObject({ digantikanOleh: baru.id });
  });

  it("menolak tetap kalau nota bernomor sama di toko itu masih hidup", async () => {
    await buatNrt({ noNrt: `${tag}-HIDUP` });
    const ulang = await catatReturToko({
      noNrt: `${tag}-HIDUP`,
      storeId: tokoAId,
      olehUserId: salesId,
      salesmanId: salesId,
      claimDate: new Date("2026-10-01T00:00:00+07:00"),
      deliveryMethod: "SALES",
      claimedAmount: 350_000,
    });
    expect(ulang).toEqual({ ok: false, alasan: "NOMOR_SUDAH_DIPAKAI" });
  });

  it("pembatalan kedua untuk nomor yang sama mendapat akhiran berbeda", async () => {
    const satu = await buatNrt({ noNrt: `${tag}-DUA`, status: "BATAL" });
    const catat = () =>
      catatReturToko({
        noNrt: `${tag}-DUA`,
        storeId: tokoAId,
        olehUserId: salesId,
        salesmanId: salesId,
        claimDate: new Date("2026-10-01T00:00:00+07:00"),
        deliveryMethod: "SALES",
        claimedAmount: 100_000,
      });
    const kedua = await catat();
    if (!kedua.ok) throw new Error("gagal mencatat");
    nrtIds.push(kedua.id);
    await batalkanReturSendiri({ storeReturnId: kedua.id, salesmanId: salesId, alasan: "salah lagi" });
    const ketiga = await catat();
    if (!ketiga.ok) throw new Error("gagal mencatat ulang");
    nrtIds.push(ketiga.id);
    const nomor = (await prisma.storeReturn.findMany({ where: { id: { in: [satu.id, kedua.id].map(seededId) } }, select: { noNrt: true } }))
      .map((n) => n.noNrt)
      .sort();
    expect(nomor).toEqual([`${tag}-DUA (batal 2)`, `${tag}-DUA (batal)`].sort());
  });

  it("pindah ke toko yang punya nota BATAL bernomor sama: nomor batal dilepas, pemindahan jalan", async () => {
    const n = await buatNrt({ noNrt: `${tag}-PINDAH` });
    const batalDiTujuan = await buatNrt({ storeId: tokoBId, noNrt: `${tag}-PINDAH`, status: "BATAL" });
    expect((await pindahkanReturKeToko({ storeReturnId: n.id, tokoTujuanId: tokoBId, alasan: "x", olehUserId: lainId })).ok).toBe(true);
    expect((await prisma.storeReturn.findUniqueOrThrow({ where: { id: batalDiTujuan.id } })).noNrt).toBe(`${tag}-PINDAH (batal)`);
    expect((await prisma.storeReturn.findUniqueOrThrow({ where: { id: n.id } })).storeId).toBe(tokoBId);
  });
});

const FOTO_UJI = "/api/foto/uji-koreksi";

async function bkmPengganti(opsi: { menggantikanId: string; salesmanId?: string; lintasPelapor?: boolean }) {
  const hasil = await buatKlaimPembayaran({
    storeId: tokoAId,
    salesmanId: opsi.salesmanId ?? salesId,
    createdById: opsi.salesmanId ?? salesId,
    claimedTransferAt: new Date("2026-10-01T00:00:00+07:00"),
    method: "transfer",
    pelunasan: [{ receivableId: piutangId, nilai: 300_000 }],
    transferPhotoUrl: FOTO_UJI,
    menggantikanId: opsi.menggantikanId,
    lintasPelapor: opsi.lintasPelapor,
  });
  if (hasil.ok) klaimIds.push(hasil.id);
  return hasil;
}

describe("laporan pengganti — BKM baru tertaut ke yang ditarik", () => {
  it("menautkan BKM pengganti dan mencatat jejak di BKM lama", async () => {
    const lama = await buatKlaim({ status: "DIBATALKAN" });
    const baru = await bkmPengganti({ menggantikanId: lama.id });
    expect(baru.ok).toBe(true);
    if (!baru.ok) return;
    expect((await prisma.paymentClaim.findUniqueOrThrow({ where: { id: baru.id } })).replacesClaimId).toBe(lama.id);
    const jejak = await jejakUntuk(lama.id);
    const diganti = jejak.find((j) => j.action === JEJAK.KLAIM_DIGANTI);
    expect(diganti?.metadata).toMatchObject({ digantiOleh: baru.id, docNoBaru: baru.docNo });
  });

  it("satu BKM lama hanya bisa diganti SEKALI — uang yang sama tidak dilaporkan dua kali", async () => {
    const lama = await buatKlaim({ status: "DIBATALKAN" });
    expect((await bkmPengganti({ menggantikanId: lama.id })).ok).toBe(true);
    expect(await bkmPengganti({ menggantikanId: lama.id })).toEqual({ ok: false, alasan: "SUDAH_DIGANTI" });
  });

  it("menolak mengganti BKM yang masih berlaku", async () => {
    const lama = await buatKlaim({ status: "DIKIRIM" });
    expect(await bkmPengganti({ menggantikanId: lama.id })).toEqual({ ok: false, alasan: "PENGGANTI_MASIH_BERLAKU" });
  });

  it("BKM sales lain hanya bisa diganti dari kantor", async () => {
    const lama = await buatKlaim({ status: "DIBATALKAN", salesmanId: lainId });
    expect(await bkmPengganti({ menggantikanId: lama.id })).toEqual({ ok: false, alasan: "PENGGANTI_BUKAN_MILIK" });
    expect((await bkmPengganti({ menggantikanId: lama.id, lintasPelapor: true })).ok).toBe(true);
  });

  it("menolak id lama yang tidak ada", async () => {
    expect(await bkmPengganti({ menggantikanId: `${tag}-hilang` })).toEqual({ ok: false, alasan: "PENGGANTI_TIDAK_DITEMUKAN" });
  });
});

describe("laporan pengganti — nota retur", () => {
  it("menautkan nota pengganti, melepas nomor yang batal, dan mencatat jejak", async () => {
    const lama = await buatNrt({ noNrt: `${tag}-GANTI`, status: "BATAL" });
    const baru = await catatReturToko({
      noNrt: `${tag}-GANTI`,
      storeId: tokoBId,
      olehUserId: salesId,
      salesmanId: salesId,
      claimDate: new Date("2026-10-01T00:00:00+07:00"),
      deliveryMethod: "SALES",
      claimedAmount: 300_000,
      menggantikanId: lama.id,
    });
    expect(baru.ok).toBe(true);
    if (!baru.ok) return;
    nrtIds.push(baru.id);
    expect((await prisma.storeReturn.findUniqueOrThrow({ where: { id: baru.id } })).replacesReturnId).toBe(lama.id);
    const jejak = await jejakUntuk(lama.id);
    expect(jejak.find((j) => j.action === JEJAK.RETUR_DIGANTI)?.metadata).toMatchObject({ digantiOleh: baru.id });
  });

  it("menolak mengganti nota yang masih berlaku", async () => {
    const lama = await buatNrt();
    const baru = await catatReturToko({
      noNrt: `${tag}-X`,
      storeId: tokoBId,
      olehUserId: salesId,
      salesmanId: salesId,
      claimDate: new Date("2026-10-01T00:00:00+07:00"),
      deliveryMethod: "SALES",
      claimedAmount: 100_000,
      menggantikanId: lama.id,
    });
    expect(baru).toEqual({ ok: false, alasan: "PENGGANTI_MASIH_BERLAKU" });
  });
});

describe("mintaKoreksi — laporan yang sudah diproses kantor", () => {
  it("BKM terverifikasi: tercatat di jejak, kantor diberi tahu, dan tertunda sampai kantor bertindak", async () => {
    const k = await buatKlaim({ status: "TERVERIFIKASI" });
    const hasil = await mintaKoreksi({ jenis: "bkm", id: k.id, salesmanId: salesId, alasan: "tokonya salah" });
    expect(hasil.ok).toBe(true);
    const jejak = await jejakUntuk(k.id);
    expect(jejak.find((j) => j.action === JEJAK.KOREKSI_DIMINTA)?.reason).toBe("tokonya salah");
    const notif = await prisma.adminNotification.findMany({ where: { category: KATEGORI_NOTIF_KOREKSI_BKM, title: { contains: k.docNo } } });
    expect(notif).toHaveLength(1);
    expect((await koreksiTertunda("bkm", [k.id])).get(k.id)?.alasan).toBe("tokonya salah");
    // Permintaan kedua selama yang pertama belum ditangani ditolak.
    expect(await mintaKoreksi({ jenis: "bkm", id: k.id, salesmanId: salesId, alasan: "lagi" })).toEqual({ ok: false, alasan: "SUDAH_DIMINTA" });
  });

  it("BKM yang masih menunggu: ditarik sendiri, bukan minta koreksi", async () => {
    const k = await buatKlaim();
    expect(await mintaKoreksi({ jenis: "bkm", id: k.id, salesmanId: salesId, alasan: "x" })).toEqual({ ok: false, alasan: "TARIK_SENDIRI" });
  });

  it("menolak laporan sales lain, alasan kosong, dan laporan yang sudah ditutup", async () => {
    const milikLain = await buatKlaim({ status: "TERVERIFIKASI", salesmanId: lainId });
    expect(await mintaKoreksi({ jenis: "bkm", id: milikLain.id, salesmanId: salesId, alasan: "x" })).toEqual({ ok: false, alasan: "BUKAN_MILIK" });
    const k = await buatKlaim({ status: "TERVERIFIKASI" });
    expect(await mintaKoreksi({ jenis: "bkm", id: k.id, salesmanId: salesId, alasan: " " })).toEqual({ ok: false, alasan: "ALASAN_WAJIB" });
    const batal = await buatKlaim({ status: "DIBATALKAN" });
    expect(await mintaKoreksi({ jenis: "bkm", id: batal.id, salesmanId: salesId, alasan: "x" })).toEqual({ ok: false, alasan: "SUDAH_DITUTUP" });
  });

  it("nota retur yang sudah dihitung: permintaan selesai begitu kantor memindahkannya", async () => {
    const n = await buatNrt();
    await buatNri({ storeReturnId: n.id });
    expect((await mintaKoreksi({ jenis: "retur", id: n.id, salesmanId: salesId, alasan: "salah toko" })).ok).toBe(true);
    expect((await koreksiTertunda("retur", [n.id])).has(n.id)).toBe(true);
    expect((await prisma.adminNotification.findMany({ where: { category: KATEGORI_NOTIF_KOREKSI_RETUR, title: { contains: n.noNrt } } }))).toHaveLength(1);

    await pindahkanReturKeToko({ storeReturnId: n.id, tokoTujuanId: tokoBId, alasan: "diminta sales", olehUserId: lainId });
    expect((await koreksiTertunda("retur", [n.id])).has(n.id)).toBe(false);
  });

  it("nota retur yang belum dihitung: ditarik sendiri", async () => {
    const n = await buatNrt();
    expect(await mintaKoreksi({ jenis: "retur", id: n.id, salesmanId: salesId, alasan: "x" })).toEqual({ ok: false, alasan: "TARIK_SENDIRI" });
  });
});

async function buatSiklusTerkunci(storeId: string) {
  urut += 1;
  const c = await prisma.consignmentCycle.create({
    data: { noKonsi: `${tag}-K-${urut}`, storeId, periodYear: 2026, periodMonth: 10, lockedAt: new Date(), lockedById: lainId },
  });
  siklusIds.push(c.id);
  return c;
}

describe("pindah toko pada bulan yang siklus konsinyasinya sudah dikunci", () => {
  it("minta konfirmasi dulu, lalu jalan dan mencatat siklusnya di jejak", async () => {
    // NRI diterima 1 Okt 00.00 WIB = 30 Sep 17.00 UTC: bulannya harus dibaca WIB.
    const siklus = await buatSiklusTerkunci(tokoAId);
    const n = await buatNrt();
    await buatNri({ storeReturnId: n.id });

    const tanpa = await pindahkanReturKeToko({ storeReturnId: n.id, tokoTujuanId: tokoBId, alasan: "x", olehUserId: lainId });
    expect(tanpa).toEqual({ ok: false, alasan: "SIKLUS_TERKUNCI", noKonsi: [siklus.noKonsi] });
    expect((await prisma.storeReturn.findUniqueOrThrow({ where: { id: n.id } })).storeId).toBe(tokoAId);

    const dengan = await pindahkanReturKeToko({
      storeReturnId: n.id,
      tokoTujuanId: tokoBId,
      alasan: "x",
      olehUserId: lainId,
      setujuSiklusTerkunci: true,
    });
    expect(dengan.ok).toBe(true);
    const jejak = (await jejakUntuk(n.id)).find((j) => j.action === JEJAK.RETUR_DIPINDAH_TOKO);
    expect(jejak?.metadata).toMatchObject({ siklusTerkunci: [siklus.noKonsi] });
  });

  it("nota yang belum dihitung gudang tidak menyentuh stok titipan — tidak perlu konfirmasi", async () => {
    await buatSiklusTerkunci(tokoAId);
    const n = await buatNrt();
    expect((await pindahkanReturKeToko({ storeReturnId: n.id, tokoTujuanId: tokoBId, alasan: "x", olehUserId: lainId })).ok).toBe(true);
  });

  it("berlaku juga untuk hitungan yatim, termasuk siklus di toko TUJUAN", async () => {
    const siklus = await buatSiklusTerkunci(tokoBId);
    const nri = await buatNri({ storeId: tokoAId });
    expect(await pindahkanNriKeToko({ warehouseReturnId: nri.id, tokoTujuanId: tokoBId, alasan: "x", olehUserId: lainId })).toEqual({
      ok: false,
      alasan: "SIKLUS_TERKUNCI",
      noKonsi: [siklus.noKonsi],
    });
    expect(
      (await pindahkanNriKeToko({ warehouseReturnId: nri.id, tokoTujuanId: tokoBId, alasan: "x", olehUserId: lainId, setujuSiklusTerkunci: true })).ok,
    ).toBe(true);
  });
});

describe("riwayatDokumen", () => {
  it("menampilkan siapa memindahkan nota, dari toko mana ke mana, dan alasannya", async () => {
    const n = await buatNrt();
    await pindahkanReturKeToko({ storeReturnId: n.id, tokoTujuanId: tokoBId, alasan: "sales salah pilih", olehUserId: lainId });
    const r = await riwayatDokumen([n.id]);
    const pindah = r.find((x) => x.action === JEJAK.RETUR_DIPINDAH_TOKO);
    expect(pindah).toMatchObject({ alasan: "sales salah pilih", tokoAsal: `${tag} A`, tokoTujuan: `${tag} B` });
    expect(pindah?.oleh).toBeTruthy();
  });
});
