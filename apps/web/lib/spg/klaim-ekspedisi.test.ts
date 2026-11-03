import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { periksaKlaimEkspedisi, putuskanKlaimEkspedisi, ubahKeputusanHilang, ubahNilaiKlaimEkspedisi } from "./hilang-writer";

/* Writes stock-loss rows — never run against the shared prod DB (port 3307 tunnel / VPS host). */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/**
 * The expedition claim (R19, R20; P36; decision 11): DIAJUKAN → payment recorded (MENUNGGU_CEK) →
 * checked by someone other than the recorder (DIBAYAR) or sent back (DIAJUKAN), or the expedition
 * refuses (DITOLAK). Every transition is a compare-and-swap on `claimStatus` inside
 * `runSerializable`, with its audit row in the same transaction; the races below prove one writer
 * wins.
 */
d("expedition claim on a lost-goods record (test bed only)", () => {
  let lossId = "";
  let shareId = "";
  let pencatat = "";
  let pemeriksa = "";

  beforeEach(async () => {
    lossId = "";
    shareId = "";
    pencatat = (await prisma.user.findFirstOrThrow({ where: { email: "salesman@elorae.com" } })).id;
    pemeriksa = (await prisma.user.findFirstOrThrow({ where: { email: "admin@elorae.com" } })).id;
    const loss = await prisma.stockLoss.create({
      data: {
        source: "PENERIMAAN",
        sourceDocNo: `TEST-KLAIM-${Math.random().toString(36).slice(2, 10)}`,
        totalQty: 2,
        totalAmount: 20000,
        valueBasis: "HARGA_JUAL",
        status: "DITETAPKAN",
        createdById: pencatat,
        claimValue: 20000,
        shares: { create: [{ bearer: "EKSPEDISI", amount: 20000, claimStatus: "DIAJUKAN", claimSubmittedAt: new Date() }] },
      },
      include: { shares: true },
    });
    lossId = loss.id;
    shareId = loss.shares[0].id;
  });

  afterEach(async () => {
    await prisma.auditLog.deleteMany({ where: { entityId: seededId(lossId) } });
    await prisma.stockLossDeduction.deleteMany({ where: { shareId: seededId(shareId) } });
    await prisma.stockLossShare.deleteMany({ where: { lossId: seededId(lossId) } });
    await prisma.stockLossLine.deleteMany({ where: { lossId: seededId(lossId) } });
    await prisma.stockLoss.deleteMany({ where: { id: seededId(lossId) } });
  });

  const bagian = () => prisma.stockLossShare.findUniqueOrThrow({ where: { id: seededId(shareId) } });

  it("records a payment as MENUNGGU_CEK; potong ongkir needs the shipping-bill number", async () => {
    expect(await putuskanKlaimEkspedisi({ shareId, hasil: "DIBAYAR", cara: "cek", catatan: "", olehUserId: pencatat })).toEqual({
      ok: false,
      kode: "CARA_TIDAK_SAH",
    });
    expect(await putuskanKlaimEkspedisi({ shareId, hasil: "DIBAYAR", cara: "potong_ongkir", referensi: "  ", catatan: "", olehUserId: pencatat })).toEqual({
      ok: false,
      kode: "REFERENSI_WAJIB",
    });
    const r = await putuskanKlaimEkspedisi({ shareId, hasil: "DIBAYAR", cara: "potong_ongkir", referensi: "INV-ONGKIR-7", catatan: "", olehUserId: pencatat });
    expect(r.ok).toBe(true);
    const s = await bagian();
    expect(s).toMatchObject({ claimStatus: "MENUNGGU_CEK", claimPaidMethod: "potong_ongkir", claimReference: "INV-ONGKIR-7", claimRecordedById: pencatat });
    expect(Number(s.settledAmount)).toBe(0);
    expect(await putuskanKlaimEkspedisi({ shareId, hasil: "DITOLAK", catatan: "telat", olehUserId: pencatat })).toEqual({ ok: false, kode: "SUDAH_DIPUTUSKAN" });
  });

  it("the recorder cannot check their own payment; another checker settles it", async () => {
    await putuskanKlaimEkspedisi({ shareId, hasil: "DIBAYAR", cara: "transfer", catatan: "", olehUserId: pencatat });
    expect(await periksaKlaimEkspedisi({ shareId, hasil: "SAH", catatan: "", olehUserId: pencatat })).toEqual({ ok: false, kode: "PEMERIKSA_SAMA" });
    const r = await periksaKlaimEkspedisi({ shareId, hasil: "SAH", catatan: "", olehUserId: pemeriksa });
    expect(r).toMatchObject({ ok: true, dibayar: true });
    const s = await bagian();
    expect(s.claimStatus).toBe("DIBAYAR");
    expect(Number(s.settledAmount)).toBe(20000);
    const potong = await prisma.stockLossDeduction.findMany({ where: { shareId: seededId(shareId) } });
    expect(potong).toHaveLength(1);
    expect(potong[0].refType).toBe("KlaimEkspedisi");
    expect(await prisma.auditLog.count({ where: { entityId: seededId(lossId), action: "STOCK_LOSS_CLAIM_PAID" } })).toBe(1);
  });

  it("sending a payment back needs a note and returns the claim to DIAJUKAN with the payment cleared", async () => {
    await putuskanKlaimEkspedisi({ shareId, hasil: "DIBAYAR", cara: "tunai", catatan: "", olehUserId: pencatat });
    expect(await periksaKlaimEkspedisi({ shareId, hasil: "KEMBALIKAN", catatan: " ", olehUserId: pemeriksa })).toEqual({ ok: false, kode: "ALASAN_WAJIB" });
    await periksaKlaimEkspedisi({ shareId, hasil: "KEMBALIKAN", catatan: "Bukti transfer salah", olehUserId: pemeriksa });
    const s = await bagian();
    expect(s).toMatchObject({ claimStatus: "DIAJUKAN", claimPaidMethod: null, claimRecordedById: null });
    expect(await prisma.stockLossDeduction.count({ where: { shareId: seededId(shareId) } })).toBe(0);
  });

  it("a refusal by the expedition needs a reason; the value can be changed only while DIAJUKAN", async () => {
    expect(await ubahNilaiKlaimEkspedisi({ shareId, nilai: 15000, catatan: "", olehUserId: pencatat })).toEqual({ ok: false, kode: "ALASAN_WAJIB" });
    await ubahNilaiKlaimEkspedisi({ shareId, nilai: 15000, catatan: "Sesuai kesepakatan dengan ekspedisi", olehUserId: pencatat });
    expect(Number((await bagian()).amount)).toBe(15000);
    expect(Number((await prisma.stockLoss.findUniqueOrThrow({ where: { id: seededId(lossId) } })).totalAmount)).toBe(15000);
    expect(await putuskanKlaimEkspedisi({ shareId, hasil: "DITOLAK", catatan: "", olehUserId: pencatat })).toEqual({ ok: false, kode: "ALASAN_WAJIB" });
    await putuskanKlaimEkspedisi({ shareId, hasil: "DITOLAK", catatan: "Ekspedisi menolak", olehUserId: pencatat });
    expect((await bagian()).claimStatus).toBe("DITOLAK");
    expect(await ubahNilaiKlaimEkspedisi({ shareId, nilai: 1000, catatan: "x", olehUserId: pencatat })).toEqual({ ok: false, kode: "BUKAN_DIAJUKAN" });
  });

  it("after the expedition refuses, another bearer's default total returns to the setting value, not the claim value (R19, P42)", async () => {
    /* The setting values the lost pieces at 12.000; the claim (selling price on the nota) is 20.000. */
    await prisma.stockLossLine.create({ data: { lossId, productName: "Barang uji", qty: 2, unitValue: 6000, amount: 12000 } });
    await putuskanKlaimEkspedisi({ shareId, hasil: "DITOLAK", catatan: "Ekspedisi menolak", olehUserId: pencatat });
    const r = await ubahKeputusanHilang({
      lossId,
      bagian: [{ bearer: "ELORAE", bearerUserId: null, amount: 12000 }],
      catatan: "Ekspedisi menolak klaim — ditanggung Elorae",
      olehUserId: pemeriksa,
    });
    expect(r).toMatchObject({ ok: true });
    expect(Number((await prisma.stockLoss.findUniqueOrThrow({ where: { id: seededId(lossId) } })).totalAmount)).toBe(12000);
  });

  it("recording the payment racing the refusal: exactly one wins", async () => {
    const [a, b] = await Promise.all([
      putuskanKlaimEkspedisi({ shareId, hasil: "DIBAYAR", cara: "transfer", catatan: "", olehUserId: pencatat }),
      new Promise((r) => setTimeout(r, 3)).then(() => putuskanKlaimEkspedisi({ shareId, hasil: "DITOLAK", catatan: "Ditolak", olehUserId: pencatat })),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const s = await bagian();
    expect(s.claimStatus).toBe(a.ok ? "MENUNGGU_CEK" : "DITOLAK");
    const jejak = await prisma.auditLog.count({
      where: { entityId: seededId(lossId), action: { in: ["STOCK_LOSS_CLAIM_PAYMENT_RECORDED", "STOCK_LOSS_CLAIM_REJECTED"] } },
    });
    expect(jejak).toBe(1);
  });

  it("checking SAH racing sending it back: exactly one wins, and at most one deduction is written", async () => {
    await putuskanKlaimEkspedisi({ shareId, hasil: "DIBAYAR", cara: "transfer", catatan: "", olehUserId: pencatat });
    const [a, b] = await Promise.all([
      periksaKlaimEkspedisi({ shareId, hasil: "SAH", catatan: "", olehUserId: pemeriksa }),
      new Promise((r) => setTimeout(r, 3)).then(() => periksaKlaimEkspedisi({ shareId, hasil: "KEMBALIKAN", catatan: "Cek lagi", olehUserId: pemeriksa })),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const s = await bagian();
    const potong = await prisma.stockLossDeduction.count({ where: { shareId: seededId(shareId) } });
    if (a.ok) {
      expect(s.claimStatus).toBe("DIBAYAR");
      expect(potong).toBe(1);
    } else {
      expect(s.claimStatus).toBe("DIAJUKAN");
      expect(potong).toBe(0);
    }
  });

  it("changing the value racing the payment record never leaves the record and the share disagreeing", async () => {
    const [a, b] = await Promise.all([
      ubahNilaiKlaimEkspedisi({ shareId, nilai: 12000, catatan: "Kesepakatan", olehUserId: pencatat }),
      new Promise((r) => setTimeout(r, 3)).then(() => putuskanKlaimEkspedisi({ shareId, hasil: "DIBAYAR", cara: "transfer", catatan: "", olehUserId: pencatat })),
    ]);
    expect(b.ok).toBe(true);
    if (!a.ok) expect(["BUKAN_DIAJUKAN", "BERUBAH"]).toContain(a.kode);
    const s = await bagian();
    const loss = await prisma.stockLoss.findUniqueOrThrow({ where: { id: seededId(lossId) } });
    expect(Number(loss.totalAmount)).toBe(Number(s.amount));
    expect(Number(s.amount)).toBe(a.ok ? 12000 : 20000);
  });
});
