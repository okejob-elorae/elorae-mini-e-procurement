import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { kinerjaSatuSales, kinerjaSemuaSales } from "./metrik-queries";

/*
 * Kueri kinerja lapangan terhadap basis data uji. Semua baris milik dua
 * pengguna buatan tes, pada tanggal lampau yang acak supaya tidak bertabrakan
 * dengan data pengembangan; kueri dipanggil dengan `salesmanIds` sehingga
 * tidak menyentuh sales sungguhan. Teardown hanya lewat id yang diseed.
 */

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const token = Math.random().toString(36).slice(2, 10);
const acak = (min: number, maks: number) => min + Math.floor(Math.random() * (maks - min + 1));
const HARI = `${acak(2001, 2019)}-${String(acak(1, 12)).padStart(2, "0")}-${String(acak(10, 28)).padStart(2, "0")}`;
const jam = (hhmm: string, tanggal = HARI) => new Date(`${tanggal}T${hhmm}:00+07:00`);
// "Sekarang" = malam hari itu, supaya aturan hari ini (rencana) berlaku.
const SEKARANG = jam("20:00");

d("kinerja lapangan — kueri (test bed only)", () => {
  let salesA = "";
  let salesB = "";
  let tokoDipegang = "";
  let tokoLama = "";
  let tokoUsulan = "";
  let tokoKlaim = "";
  let visitIds: string[] = [];
  let orderIds: string[] = [];
  let claimIds: string[] = [];
  let proposalId = "";

  beforeAll(async () => {
    salesA = "";
    salesB = "";
    tokoDipegang = "";
    tokoLama = "";
    tokoUsulan = "";
    tokoKlaim = "";
    visitIds = [];
    orderIds = [];
    claimIds = [];
    proposalId = "";

    salesA = (await prisma.user.create({ data: { email: `metrik-a-${token}@test.local`, name: `Metrik A ${token}` } })).id;
    salesB = (await prisma.user.create({ data: { email: `metrik-b-${token}@test.local`, name: `Metrik B ${token}` } })).id;
    const toko = (kode: string, salesmanId: string | null = null) =>
      prisma.store.create({
        data: { code: `T-MQ-${kode}-${token}`, name: `Toko ${kode}`, address: "x", termsType: "PUTUS", salesmanId },
      });
    tokoDipegang = (await toko("PEGANG", salesA)).id;
    tokoLama = (await toko("LAMA")).id;
    tokoUsulan = (await toko("USUL")).id;
    tokoKlaim = (await toko("KLAIM")).id;

    const kunjungan = async (storeId: string, masuk: string, keluar: string | null, extra: object = {}) => {
      const v = await prisma.storeVisit.create({
        data: {
          storeId,
          userId: salesA,
          checkinAt: jam(masuk),
          checkoutAt: keluar ? jam(keluar) : null,
          checkinLat: -6.2,
          checkinLng: 106.8,
          ...extra,
        },
      });
      visitIds.push(v.id);
      return v.id;
    };
    const vPegang = await kunjungan(tokoDipegang, "09:00", "09:40");
    await kunjungan(tokoLama, "11:00", "11:20", {
      outcome: "HARGA",
      checkinOutOfRadius: true,
      checkinFlags: [{ kode: "AKURASI_BURUK", akurasiMeter: 400, batasMeter: 100 }],
    });
    await kunjungan(tokoKlaim, "13:00", "13:30", { outcome: "PEMILIK_TIDAK_ADA" });

    const pesanan = async (storeId: string, salesmanId: string, createdAt: Date, x: object = {}) => {
      const o = await prisma.fieldSalesOrder.create({
        data: {
          orderNo: `T-MQ-${token}-${orderIds.length}`,
          storeId,
          salesmanId,
          subtotal: 1_500_000,
          total: 1_500_000,
          createdAt,
          ...x,
        },
      });
      orderIds.push(o.id);
    };
    // Pesanan pertama toko yang dipegang — toko baru, efektif lewat visitId.
    await pesanan(tokoDipegang, salesA, jam("09:15"), { visitId: vPegang });
    // Toko lama: pernah pesan tahun lalu (oleh sales lain) — bukan toko baru.
    await pesanan(tokoLama, salesB, jam("10:00", `${Number(HARI.slice(0, 4)) - 1}${HARI.slice(4)}`));
    await pesanan(tokoLama, salesA, jam("15:00"), { orderType: "KONSI", total: 9_000_000 });
    // Ditolak: tidak ikut jumlah pesanan, tidak membuat toko baru.
    await pesanan(tokoUsulan, salesA, jam("16:00"), { status: "REJECTED" });

    proposalId = (
      await prisma.storeProposal.create({
        data: {
          name: "Toko Usul",
          address: "x",
          proposedById: salesA,
          status: "APPROVED",
          reviewedAt: jam("14:00"),
          storeId: tokoUsulan,
        },
      })
    ).id;

    const klaim = async (x: object) => {
      const k = await prisma.paymentClaim.create({
        data: {
          docNo: `T-MQ-BKM-${token}-${claimIds.length}`,
          storeId: tokoKlaim,
          salesmanId: salesA,
          createdById: salesA,
          claimedTransferAt: jam("13:10"),
          receivedAmount: 800_000,
          ...x,
        },
      });
      claimIds.push(k.id);
    };
    // Dilaporkan saat kunjungan ke toko klaim: kunjungan itu efektif.
    await klaim({ createdAt: jam("13:20") });
    // Dilaporkan kemarin, diverifikasi hari itu.
    await klaim({
      createdAt: jam("10:00", "2000-01-01"),
      status: "TERVERIFIKASI",
      verifiedAt: jam("17:00"),
      receivedAmount: 2_000_000,
    });
  });

  afterAll(async () => {
    await prisma.paymentClaim.deleteMany({ where: { id: { in: seededIds(claimIds) } } });
    await prisma.storeProposal.deleteMany({ where: { id: seededId(proposalId) } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: seededIds(orderIds) } } });
    await prisma.storeVisit.deleteMany({ where: { id: { in: seededIds(visitIds) } } });
    await prisma.store.deleteMany({
      where: { id: { in: seededIds([tokoDipegang, tokoLama, tokoUsulan, tokoKlaim].filter(Boolean)) } },
    });
    await prisma.user.deleteMany({ where: { id: { in: seededIds([salesA, salesB].filter(Boolean)) } } });
  });

  it("semua sales (dibatasi ke sales tes): baris per sales, termasuk yang tidak berbuat apa-apa", async () => {
    const tim = await kinerjaSemuaSales({ dari: HARI, sampai: HARI }, { sekarang: SEKARANG, salesmanIds: [salesA, salesB] });
    expect(tim.baris.map((b) => b.salesmanId)).toEqual([salesA, salesB]);

    const a = tim.baris[0].metrik;
    expect(a.kunjungan).toBe(3);
    expect(a.tokoDikunjungi).toBe(3);
    // Pegang (pesanan ber-visitId) + klaim (laporan saat kunjungan); toko lama hanya HARGA.
    expect(a.efektif).toBe(2);
    expect(a.persenEfektif).toBe(67);
    expect(a.pesanan).toEqual({ jumlah: 2, putus: 1, nilaiPutus: 1_500_000, konsi: 1, ditolak: 1, jarakJauh: 0 });
    expect(a.pelunasan).toEqual({
      dilaporkan: 1,
      nilaiDilaporkan: 800_000,
      terverifikasi: 1,
      nilaiTerverifikasi: 2_000_000,
    });
    // Toko yang dipegang (pesanan pertama) + toko usulan yang disetujui.
    expect(a.tokoBaru).toBe(2);
    expect(a.janggal).toBe(1);
    expect(a.lapangan.menit).toBe(270);

    const b = tim.baris[1];
    expect(b.metrik.kunjungan).toBe(0);
    expect(b.metrik.pesanan.jumlah).toBe(0);
    expect(tim.total.kunjungan).toBe(3);
  });

  it("rencana: toko yang dipegang belum pernah didatangi → direncanakan, dan hari itu didatangi", async () => {
    const tim = await kinerjaSemuaSales({ dari: HARI, sampai: HARI }, { sekarang: SEKARANG, salesmanIds: [salesA] });
    const r = tim.baris[0].rencana;
    expect(r?.toko.find((t) => t.storeId === tokoDipegang)).toEqual({
      storeId: tokoDipegang,
      nama: "Toko PEGANG",
      alasan: ["lama"],
      dikunjungi: true,
    });
    expect(tim.baris[0].tokoMenurun).toBe(0);
  });

  it("tanpa rencana (kabar harian): rencana, toko menurun dan target tidak dimuat", async () => {
    const tim = await kinerjaSemuaSales(
      { dari: HARI, sampai: HARI },
      { sekarang: SEKARANG, salesmanIds: [salesA], denganRencana: false },
    );
    expect(tim.baris[0]).toMatchObject({ rencana: null, tokoMenurun: null, target: null });
    expect(tim.baris[0].metrik.kunjungan).toBe(3);
  });

  it("satu sales: baris kunjungan bernama toko + tanda, dan toko baru bernama", async () => {
    const r = await kinerjaSatuSales(salesA, { dari: HARI, sampai: HARI }, { sekarang: SEKARANG });
    expect(r).not.toBeNull();
    expect(r!.kinerja.nama).toBe(`Metrik A ${token}`);
    expect(r!.kunjungan.map((k) => [k.toko, k.kodeHasil, k.efektif])).toEqual([
      ["Toko PEGANG", "TRANSAKSI", true],
      ["Toko LAMA", "HARGA", false],
      ["Toko KLAIM", "PEMILIK_TIDAK_ADA", true],
    ]);
    const lama = r!.kunjungan[1];
    expect(lama.diLuarRadius).toBe(true);
    expect(lama.tanda.map((t) => t.kode)).toEqual(["AKURASI_BURUK"]);
    expect(lama.lat).toBeCloseTo(-6.2);
    expect(r!.tokoBaru.map((t) => [t.nama, t.sumber]).sort()).toEqual([
      ["Toko PEGANG", "PESANAN_PERTAMA"],
      ["Toko USUL", "USULAN"],
    ]);
  });

  it("pengguna yang tidak ada → null", async () => {
    expect(await kinerjaSatuSales("bukan-pengguna", { dari: HARI, sampai: HARI }, { sekarang: SEKARANG })).toBeNull();
  });
});
