import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { daftarTugasTagih, tautanPesanKlaim } from "./tugas-tagih-queries";

/**
 * Kueri tugas tagih dan tautan pesan ke toko, terhadap basis data sungguhan.
 *
 * Yang dijaga di sini hidup di KUERI, bukan di aturan murni: sisa dibaca dari
 * hitung ulang (kolom `outstanding` sengaja diisi angka palsu), dan pesan yang
 * terbentuk dari baris BKM sungguhan tidak pernah menyebut lunas sebelum
 * verifikasi.
 *
 * Basis data dipakai bersama data dev: setiap penghapusan lewat `seededId()`,
 * id fixture dideklarasikan "" dan direset di awal hook. Pengguna TIDAK dibuat
 * — dipinjam satu yang sudah ada, karena BKM menuntut pelapor sungguhan.
 */

const tag = `TGS-${Math.random().toString(36).slice(2, 8)}`;
let tokoId = "";
let r1Id = "";
let r2Id = "";
let tugasId = "";
let klaimId = "";
let penggunaId = "";

const HARI_INI = new Date("2026-10-01T03:00:00Z");

beforeEach(async () => {
  tokoId = "";
  r1Id = "";
  r2Id = "";
  tugasId = "";
  klaimId = "";
  penggunaId = "";

  const pengguna = await prisma.user.findFirst({ select: { id: true } });
  if (!pengguna) throw new Error("Basis data uji tidak punya pengguna sama sekali");
  penggunaId = pengguna.id;

  const toko = await prisma.store.create({
    data: { code: `${tag}-P`, name: `${tag} Putus`, address: "uji", termsType: "PUTUS", isActive: true, phone: "0812-3456-7890" },
  });
  tokoId = toko.id;

  const buatPiutang = (akhiran: string, amount: number) =>
    prisma.receivable.create({
      data: {
        invoiceNo: `${tag}/${akhiran}`,
        storeId: tokoId,
        invoiceDate: new Date("2026-09-01T00:00:00Z"),
        dueDate: new Date("2026-09-15T00:00:00Z"),
        amount,
        // Angka PALSU: kalau kuerinya membaca kolom ini, tesnya gagal.
        outstanding: 999,
        source: "MANUAL",
      },
    });
  r1Id = (await buatPiutang("R1", 400_000)).id;
  r2Id = (await buatPiutang("R2", 100_000)).id;

  const tugas = await prisma.collectionTask.create({
    data: {
      assigneeId: penggunaId,
      storeId: tokoId,
      receivableIds: [r1Id, r2Id, `${tag}-hilang`],
      dueDate: new Date("2026-09-28T00:00:00+07:00"),
      createdById: penggunaId,
      note: "uji",
    },
  });
  tugasId = tugas.id;

  const klaim = await prisma.paymentClaim.create({
    data: {
      docNo: `${tag}/BKM`,
      storeId: tokoId,
      salesmanId: penggunaId,
      createdById: penggunaId,
      claimedTransferAt: new Date("2026-10-01T00:00:00+07:00"),
      method: "transfer",
      invoiceAmount: 400_000,
      receivedAmount: 400_000,
      receivableLinks: { create: [{ receivableId: r1Id, settledAmount: 400_000 }] },
    },
  });
  klaimId = klaim.id;
});

afterEach(async () => {
  // Tautan klaim–piutang ikut terhapus (onDelete Cascade).
  if (klaimId) await prisma.paymentClaim.delete({ where: { id: seededId(klaimId) } });
  if (tugasId) await prisma.collectionTask.delete({ where: { id: seededId(tugasId) } });
  await prisma.receivable.deleteMany({ where: { id: { in: [r1Id, r2Id].filter(Boolean).map(seededId) } } });
  if (tokoId) await prisma.store.delete({ where: { id: seededId(tokoId) } });
});

describe("daftarTugasTagih (basis data)", () => {
  it("sisa dari hitung ulang, bukan kolom cache; faktur hilang dihitung terpisah", async () => {
    const [b] = await daftarTugasTagih({ storeId: tokoId }, HARI_INI);
    expect(b.id).toBe(tugasId);
    expect(b.totalSisa).toBe(500_000);
    expect(b.faktur.map((f) => f.sisa).sort()).toEqual([100_000, 400_000]);
    expect(b.hilang).toBe(1);
    expect(b.storeName).toBe(`${tag} Putus`);
  });

  it("klaim yang masih DIKIRIM membuat fakturnya 'dilaporkan', tapi tugas tetap ditagih (R2 belum)", async () => {
    const [b] = await daftarTugasTagih({ storeId: tokoId }, HARI_INI);
    expect(b.faktur.find((f) => f.id === r1Id)?.keadaan).toBe("klaim");
    // Tenggat 28 Sep, hari ini 1 Okt.
    expect(b.keadaan).toBe("TERLAMBAT");
    expect((await daftarTugasTagih({ storeId: tokoId, hanyaTerlambat: true }, HARI_INI)).map((x) => x.id)).toEqual([
      tugasId,
    ]);
  });

  it("status lain tidak terbawa saringan TERBUKA", async () => {
    expect(await daftarTugasTagih({ storeId: tokoId, status: "SELESAI" }, HARI_INI)).toEqual([]);
  });
});

describe("tautanPesanKlaim (basis data)", () => {
  it("BKM DIKIRIM → tanda terima ke nomor HP toko, TANPA kata lunas", async () => {
    const t = (await tautanPesanKlaim([klaimId])).get(klaimId);
    expect(t?.jenis).toBe("TANDA_TERIMA");
    expect(t?.adaNomor).toBe(true);
    expect(t?.url.startsWith("https://wa.me/6281234567890?text=")).toBe(true);
    const pesan = decodeURIComponent(t!.url.split("?text=")[1]);
    expect(pesan).toContain(`${tag}/BKM`);
    expect(pesan).toContain(`${tag}/R1`);
    expect(pesan).not.toMatch(/lunas/i);
  });

  it("sesudah TERVERIFIKASI → konfirmasi: faktur yang sisanya nol disebut lunas", async () => {
    await prisma.paymentClaim.update({ where: { id: seededId(klaimId) }, data: { status: "TERVERIFIKASI" } });
    const t = (await tautanPesanKlaim([klaimId])).get(klaimId);
    expect(t?.jenis).toBe("KONFIRMASI");
    const pesan = decodeURIComponent(t!.url.split("?text=")[1]);
    expect(pesan).toMatch(new RegExp(`lunas:\\n• ${tag}/R1`));
  });

  it("ditolak tidak mendapat pesan; layar HP hanya membuat tautan untuk BKM pelapornya sendiri", async () => {
    expect((await tautanPesanKlaim([klaimId], { pemilik: "bukan-orang-ini" })).size).toBe(0);
    await prisma.paymentClaim.update({ where: { id: seededId(klaimId) }, data: { status: "DITOLAK" } });
    expect((await tautanPesanKlaim([klaimId])).size).toBe(0);
  });
});
