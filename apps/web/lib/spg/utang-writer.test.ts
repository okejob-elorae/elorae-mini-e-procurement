import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { REF_BEBAN_KE_UTANG } from "./beban-spg";
import { KomisiBerubahError } from "./koreksi-writer";
import { putuskanBarangReturPembeli } from "./retur-pembeli";
import { KATEGORI_NOTIF_RETUR_PEMBELI } from "./retur-pembeli-status";
import { ENTITAS_BAYAR_UTANG_SPG, KATEGORI_NOTIF_UTANG_SPG, REF_BAYAR_UTANG_SPG } from "./utang";
import { batalkanPenerimaanUtangSpg, catatPenerimaanUtangSpg, periksaPenerimaanUtangSpg, potongUtangSpg, revisiPenerimaanUtangSpg } from "./utang-writer";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;
const tunda = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Pembayaran utang SPG yang sudah berhenti (P68, keputusan 11) terhadap basis data sungguhan:
 * dicatat kantor MENUNGGU_CEK tanpa mengurangi apa pun, diperiksa orang LAIN terhadap mutasi
 * rekening (pencatat dan perevisinya tidak pernah memeriksanya), dialokasikan ke utang terlama
 * dulu dengan tukar-bandingkan per utang, dan pembatalan yang sudah terverifikasi mengembalikan
 * utangnya. Utang diseed langsung; semua baris dihapus lewat `seededId(s)`.
 */
d("pembayaran utang SPG (test bed only)", () => {
  const tag = `USP${Math.random().toString(36).slice(2, 8)}`;
  const sekarang = new Date("2026-11-04T10:00:00+07:00");
  let spg = "";
  let pencatat = "";
  let perevisi = "";
  let pemeriksa = "";
  let nomor = 0;
  const utang: string[] = [];

  const orangIds = () => [spg, pencatat, perevisi, pemeriksa].filter(Boolean);
  const catat = (jumlah: number, olehUserId = pencatat) =>
    catatPenerimaanUtangSpg({ spgUserId: spg, jumlah, cara: "transfer", diterimaPada: "2026-11-03", kunci: `${tag}-${nomor++}`, olehUserId, sekarang });
  const versi = async (id: string) => (await prisma.spgDebtPayment.findUniqueOrThrow({ where: { id }, select: { version: true } })).version;
  const dilunasi = async () =>
    (await prisma.spgDebt.findMany({ where: { id: { in: seededIds(utang) } }, orderBy: { createdAt: "asc" }, select: { settledAmount: true, status: true } })).map((u) => ({
      dilunasi: Number(u.settledAmount),
      status: u.status,
    }));

  beforeAll(async () => {
    const orang = async (nama: string, data: Record<string, unknown> = {}) =>
      (await prisma.user.create({ data: { email: `${tag}-${nama}@test.local`, name: `${nama} ${tag}`, ...data } })).id;
    spg = await orang("spg", { spgStartedOn: "2026-01-01", spgEndedOn: "2026-09-30" });
    pencatat = await orang("pencatat");
    perevisi = await orang("perevisi");
    pemeriksa = await orang("pemeriksa");
  });

  /** Dua utang terbuka: Rp 30.000 (terlama) lalu Rp 20.000. */
  async function duaUtang() {
    for (const [i, amount] of [30_000, 20_000].entries()) {
      const u = await prisma.spgDebt.create({
        data: {
          spgUserId: spg,
          kind: "KOREKSI",
          sourceKey: `${tag}-sumber-${i}`,
          amount,
          createdRefType: "SpgDebtRecording",
          createdRefId: `${tag}-catat-${i}`,
          note: "uji",
          createdById: pencatat,
          createdAt: new Date(Date.UTC(2026, 9, 1 + i)),
        },
        select: { id: true },
      });
      utang.push(u.id);
    }
  }

  afterEach(async () => {
    const bayar = await prisma.spgDebtPayment.findMany({ where: { spgUserId: seededId(spg) }, select: { id: true } });
    const ids = seededIds(bayar.map((b) => b.id));
    await prisma.auditLog.deleteMany({ where: { entityType: ENTITAS_BAYAR_UTANG_SPG, entityId: { in: ids } } });
    const notif = await prisma.adminNotification.findMany({
      where: { category: { in: [KATEGORI_NOTIF_UTANG_SPG.BAYAR_DIAJUKAN, KATEGORI_NOTIF_UTANG_SPG.BAYAR_DIKEMBALIKAN] } },
      select: { id: true, metadata: true },
    });
    await prisma.adminNotification.deleteMany({
      where: { id: { in: seededIds(notif.filter((n) => (n.metadata as Record<string, unknown> | null)?.spgUserId === spg).map((n) => n.id)) } },
    });
    await prisma.spgDebtSettlement.deleteMany({ where: { debtId: { in: seededIds(utang) } } });
    await prisma.spgDebtPayment.deleteMany({ where: { id: { in: ids } } });
    await prisma.spgDebt.deleteMany({ where: { id: { in: seededIds(utang) } } });
    utang.length = 0;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: seededIds(orangIds()) } } });
  });

  it("dicatat MENUNGGU_CEK tanpa mengurangi utang; melebihi sisa ditolak, termasuk yang masih menunggu cek", async () => {
    await duaUtang();
    expect(await catat(50_001)).toEqual({ ok: false, kode: "MELEBIHI_SISA" });
    const a = await catat(30_000);
    expect(a).toMatchObject({ ok: true, ulang: false });
    expect(await dilunasi()).toEqual([
      { dilunasi: 0, status: "TERBUKA" },
      { dilunasi: 0, status: "TERBUKA" },
    ]);
    // 50.000 − 30.000 yang menunggu cek = 20.000 yang masih boleh dicatat.
    expect(await catat(20_001)).toEqual({ ok: false, kode: "MELEBIHI_SISA" });
    expect((await catat(20_000)).ok).toBe(true);
  });

  it("pencatat tidak memeriksa catatannya sendiri; orang lain → dialokasikan ke utang terlama dulu", async () => {
    await duaUtang();
    const a = await catat(40_000);
    if (!a.ok) throw new Error(a.kode);
    expect(await periksaPenerimaanUtangSpg({ id: a.id, versi: await versi(a.id), keputusan: "TERVERIFIKASI", olehUserId: pencatat })).toEqual({ ok: false, kode: "PEMERIKSA_SAMA" });
    expect(await periksaPenerimaanUtangSpg({ id: a.id, versi: await versi(a.id), keputusan: "TERVERIFIKASI", olehUserId: pemeriksa, sekarang })).toEqual({ ok: true });
    expect(await dilunasi()).toEqual([
      { dilunasi: 30_000, status: "LUNAS" },
      { dilunasi: 10_000, status: "TERBUKA" },
    ]);
    const lunasan = await prisma.spgDebtSettlement.findMany({ where: { refType: REF_BAYAR_UTANG_SPG, refId: a.id }, select: { kind: true, amount: true } });
    expect(lunasan.map((l) => [l.kind, Number(l.amount)]).sort()).toEqual([
      ["BAYAR", 10_000],
      ["BAYAR", 30_000],
    ]);
  });

  it("dikembalikan butuh catatan; direvisi → MENUNGGU_CEK lagi, dan perevisinya pun tidak boleh memeriksanya", async () => {
    await duaUtang();
    const a = await catat(25_000);
    if (!a.ok) throw new Error(a.kode);
    expect(await periksaPenerimaanUtangSpg({ id: a.id, versi: 1, keputusan: "DIKEMBALIKAN", olehUserId: pemeriksa, catatan: " " })).toEqual({ ok: false, kode: "ALASAN_WAJIB" });
    expect(await periksaPenerimaanUtangSpg({ id: a.id, versi: 1, keputusan: "DIKEMBALIKAN", olehUserId: pemeriksa, catatan: "tidak ada di mutasi" })).toEqual({ ok: true });
    expect(await revisiPenerimaanUtangSpg({ id: a.id, versi: 1, jumlah: 20_000, cara: "tunai", diterimaPada: "2026-11-03", olehUserId: perevisi, sekarang })).toEqual({ ok: true });
    const p = await prisma.spgDebtPayment.findUniqueOrThrow({ where: { id: a.id }, select: { status: true, version: true, amount: true, method: true, returnNote: true } });
    expect([p.status, p.version, Number(p.amount), p.method, p.returnNote]).toEqual(["MENUNGGU_CEK", 2, 20_000, "tunai", null]);
    expect(await periksaPenerimaanUtangSpg({ id: a.id, versi: 2, keputusan: "TERVERIFIKASI", olehUserId: perevisi })).toEqual({ ok: false, kode: "PEMERIKSA_SAMA" });
    expect((await periksaPenerimaanUtangSpg({ id: a.id, versi: 2, keputusan: "TERVERIFIKASI", olehUserId: pemeriksa, sekarang })).ok).toBe(true);
  });

  it("membatalkan yang sudah terverifikasi mengembalikan utangnya; hanya pemegang izin periksa", async () => {
    await duaUtang();
    const a = await catat(30_000);
    if (!a.ok) throw new Error(a.kode);
    await periksaPenerimaanUtangSpg({ id: a.id, versi: 1, keputusan: "TERVERIFIKASI", olehUserId: pemeriksa, sekarang });
    expect(await batalkanPenerimaanUtangSpg({ id: a.id, olehUserId: pencatat, alasan: "salah", bolehBatalkanBelumDicek: true, bolehBatalkanTerverifikasi: false })).toEqual({
      ok: false,
      kode: "BUKAN_PENCATAT",
    });
    expect(await batalkanPenerimaanUtangSpg({ id: a.id, olehUserId: pemeriksa, alasan: "transfer dibatalkan bank", bolehBatalkanBelumDicek: false, bolehBatalkanTerverifikasi: true })).toEqual({
      ok: true,
      terverifikasi: true,
    });
    expect(await dilunasi()).toEqual([
      { dilunasi: 0, status: "TERBUKA" },
      { dilunasi: 0, status: "TERBUKA" },
    ]);
  });

  it("balapan dua pemeriksaan atas utang yang sama: pelunasannya tidak pernah hilang satu dan tidak pernah lebih", async () => {
    await duaUtang();
    const a = await catat(30_000);
    const b = await catat(20_000);
    if (!a.ok || !b.ok) throw new Error("catat");
    const [ra, rb] = await Promise.all([
      periksaPenerimaanUtangSpg({ id: a.id, versi: 1, keputusan: "TERVERIFIKASI", olehUserId: pemeriksa, sekarang }),
      periksaPenerimaanUtangSpg({ id: b.id, versi: 1, keputusan: "TERVERIFIKASI", olehUserId: pemeriksa, sekarang }),
    ]);
    expect([ra.ok, rb.ok]).toEqual([true, true]);
    expect(await dilunasi()).toEqual([
      { dilunasi: 30_000, status: "LUNAS" },
      { dilunasi: 20_000, status: "LUNAS" },
    ]);
    const total = (await prisma.spgDebtSettlement.findMany({ where: { debtId: { in: seededIds(utang) }, voidedAt: null }, select: { amount: true } })).reduce(
      (n, l) => n + Number(l.amount),
      0,
    );
    expect(total).toBe(50_000);
  });

  it("balapan pemeriksaan vs pembatalan penerimaan yang sama: tepat satu menang, dan keadaannya selalu utuh", async () => {
    await duaUtang();
    const a = await catat(30_000);
    if (!a.ok) throw new Error(a.kode);
    const [periksa, batal] = await Promise.all([
      periksaPenerimaanUtangSpg({ id: a.id, versi: 1, keputusan: "TERVERIFIKASI", olehUserId: pemeriksa, sekarang }),
      // Pencatatnya sendiri membatalkan penerimaan yang belum dicek — tanpa izin membatalkan yang terverifikasi.
      batalkanPenerimaanUtangSpg({ id: a.id, olehUserId: pencatat, alasan: "salah catat", bolehBatalkanBelumDicek: false, bolehBatalkanTerverifikasi: false, sekarang }),
    ]);
    expect([periksa.ok, batal.ok].filter(Boolean)).toHaveLength(1);
    const akhir = await prisma.spgDebtPayment.findUniqueOrThrow({ where: { id: a.id }, select: { status: true } });
    const lunasHidup = (await prisma.spgDebtSettlement.findMany({ where: { refType: REF_BAYAR_UTANG_SPG, refId: a.id, voidedAt: null }, select: { amount: true } })).reduce(
      (n, l) => n + Number(l.amount),
      0,
    );
    if (periksa.ok) {
      // Diperiksa dulu: pembatalan oleh pencatat tanpa izin membatalkan yang terverifikasi ditolak.
      expect(batal).toEqual({ ok: false, kode: "BUKAN_PENCATAT" });
      expect(akhir.status).toBe("TERVERIFIKASI");
      expect(lunasHidup).toBe(30_000);
    } else {
      // Dibatalkan dulu: pemeriksaan melihat keadaan yang berubah dan tidak mengalokasikan apa pun.
      expect(periksa).toEqual({ ok: false, kode: "STATUS_BERUBAH" });
      expect(akhir.status).toBe("DIBATALKAN");
      expect(lunasHidup).toBe(0);
      expect(await dilunasi()).toEqual([
        { dilunasi: 0, status: "TERBUKA" },
        { dilunasi: 0, status: "TERBUKA" },
      ]);
    }
  });

  it("balapan dua pembayaran gaji SPG yang sama-sama memotong utang yang sama: dipotong sekali, tidak pernah lebih (B31)", async () => {
    await duaUtang();
    // Dua baris gaji berbeda SPG itu dibayar bersamaan; masing-masing merencanakan memotong penuh utang Rp 30.000.
    const potong = (refId: string) =>
      runSerializable((tx) => potongUtangSpg(tx, { potong: [{ debtId: utang[0], sen: 3_000_000 }], refType: "SpgCommission", refId, olehUserId: pencatat }));
    const hasil = await Promise.allSettled([potong(`${tag}-baris-a`), potong(`${tag}-baris-b`)]);
    expect(hasil.filter((h) => h.status === "fulfilled").map((h) => (h as PromiseFulfilledResult<number>).value)).toEqual([30_000]);
    const gagal = hasil.find((h) => h.status === "rejected") as PromiseRejectedResult | undefined;
    // Yang kalah melihat utangnya sudah lunas: rencananya basi (ANGKA_BERUBAH di penulis bayar), tidak ada yang tertulis.
    expect(gagal?.reason).toBeInstanceOf(KomisiBerubahError);
    expect(await dilunasi()).toEqual([
      { dilunasi: 30_000, status: "LUNAS" },
      { dilunasi: 0, status: "TERBUKA" },
    ]);
    expect(await prisma.spgDebtSettlement.count({ where: { debtId: seededId(utang[0]), voidedAt: null } })).toBe(1);
  });

  /**
   * Beban retur pembeli yang sisanya dipindah ke utang SPG di pembayaran terakhirnya (DIUTANGKAN):
   * barangnya baru diputuskan sesudah utang itu LUNAS (P79). Nota, laporan DITOLAK, beban, dan
   * potongannya diseed langsung; dihapus lewat `seededId(s)` sebelum utangnya (afterEach luar).
   */
  describe("beban retur pembeli yang dilunasi lewat utang (P79)", () => {
    let tokoIds: string[] = [];
    let notaIds: string[] = [];
    let returIds: string[] = [];
    let bebanIds: string[] = [];

    afterEach(async () => {
      const semua = await prisma.adminNotification.findMany({ where: { category: KATEGORI_NOTIF_RETUR_PEMBELI }, select: { id: true, metadata: true } });
      const milik = semua.filter((n) => bebanIds.includes(String((n.metadata as Record<string, unknown> | null)?.chargeId ?? ""))).map((n) => n.id);
      await prisma.adminNotification.deleteMany({ where: { id: { in: seededIds(milik) } } });
      await prisma.auditLog.deleteMany({ where: { entityId: { in: seededIds([...bebanIds, ...returIds]) } } });
      await prisma.spgChargeDeduction.deleteMany({ where: { chargeId: { in: seededIds(bebanIds) } } });
      await prisma.spgCharge.deleteMany({ where: { id: { in: seededIds(bebanIds) } } });
      await prisma.spgSaleReturn.deleteMany({ where: { id: { in: seededIds(returIds) } } });
      await prisma.spgSale.deleteMany({ where: { id: { in: seededIds(notaIds) } } });
      await prisma.store.deleteMany({ where: { id: { in: seededIds(tokoIds) } } });
      tokoIds = [];
      notaIds = [];
      returIds = [];
      bebanIds = [];
    });

    /** Satu laporan retur DITOLAK dengan beban Rp 30.000 yang seluruhnya pindah ke satu utang SPG. */
    async function bebanLewatUtang() {
      const toko = await prisma.store.create({ data: { code: `${tag}-T${nomor++}`, name: `Toko ${tag}`, address: "uji", termsType: "KONSI" } });
      tokoIds.push(toko.id);
      const nota = await prisma.spgSale.create({
        data: { docNo: `${tag}/SPG/${nomor++}`, salesmanId: spg, storeId: toko.id, subtotal: 30_000, total: 30_000, cashReceived: 30_000, changeGiven: 0, createdById: spg },
      });
      notaIds.push(nota.id);
      const retur = await prisma.spgSaleReturn.create({
        data: {
          spgSaleId: nota.id,
          storeId: toko.id,
          createdById: spg,
          reason: "uji",
          idempotencyKey: `${tag}-retur-${nomor++}`,
          status: "DITOLAK",
          decidedById: pencatat,
          decidedAt: new Date("2026-09-10T03:00:00Z"),
          rejectReason: "uji",
        },
      });
      returIds.push(retur.id);
      const beban = await prisma.spgCharge.create({
        data: {
          spgUserId: spg,
          storeId: toko.id,
          sourceKind: "KONSI",
          source: "RETUR_PEMBELI",
          sourceId: retur.id,
          sourceDocNo: nota.docNo,
          spgSaleId: nota.id,
          reportedAt: new Date("2026-09-10T03:00:00Z"),
          computedAmount: 30_000,
          amount: 30_000,
          settledAmount: 30_000,
          status: "DIUTANGKAN",
          note: "uji",
          createdById: pencatat,
        },
      });
      bebanIds.push(beban.id);
      const u = await prisma.spgDebt.create({
        data: {
          spgUserId: spg,
          kind: "RETUR_PEMBELI",
          sourceKey: beban.id,
          sourceStoreId: toko.id,
          amount: 30_000,
          createdRefType: "SpgDebtRecording",
          createdRefId: `${tag}-catat-beban`,
          note: "uji",
          createdById: pencatat,
        },
      });
      utang.push(u.id);
      await prisma.spgChargeDeduction.create({
        data: { chargeId: beban.id, amount: 30_000, fromCommission: 0, fromSalary: 0, paidRefType: REF_BEBAN_KE_UTANG, paidRefId: u.id, payoutMonth: "2026-10", createdById: pencatat },
      });
      return { returId: retur.id, bebanId: beban.id, utangId: u.id };
    }

    const lonceng = async (bebanId: string) =>
      (await prisma.adminNotification.findMany({ where: { category: KATEGORI_NOTIF_RETUR_PEMBELI }, select: { metadata: true } })).filter(
        (n) => (n.metadata as Record<string, unknown> | null)?.chargeId === bebanId,
      ).length;
    const putuskan = (returId: string) => putuskanBarangReturPembeli({ returnId: returId, keputusan: "DIBELI_SPG", olehUserId: pemeriksa, sekarang });
    const keadaan = async (b: { bebanId: string; utangId: string }, bayarId: string) => ({
      barang: (await prisma.spgCharge.findUniqueOrThrow({ where: { id: seededId(b.bebanId) }, select: { goodsDecision: true } })).goodsDecision,
      utang: (await prisma.spgDebt.findUniqueOrThrow({ where: { id: seededId(b.utangId) }, select: { status: true } })).status,
      bayar: (await prisma.spgDebtPayment.findUniqueOrThrow({ where: { id: seededId(bayarId) }, select: { status: true } })).status,
    });

    it("diperiksa dan melunasi utangnya: SATU lonceng putuskan barangnya; pembayaran sebagian tidak", async () => {
      const b = await bebanLewatUtang();
      const sebagian = await catat(10_000);
      if (!sebagian.ok) throw new Error(sebagian.kode);
      expect(await periksaPenerimaanUtangSpg({ id: sebagian.id, versi: 1, keputusan: "TERVERIFIKASI", olehUserId: pemeriksa, sekarang })).toEqual({ ok: true });
      expect(await lonceng(b.bebanId)).toBe(0);
      expect(await putuskan(b.returId)).toEqual({ ok: false, alasan: "BEBAN_BELUM_LUNAS" });

      const sisa = await catat(20_000);
      if (!sisa.ok) throw new Error(sisa.kode);
      expect(await periksaPenerimaanUtangSpg({ id: sisa.id, versi: 1, keputusan: "TERVERIFIKASI", olehUserId: pemeriksa, sekarang })).toEqual({ ok: true });
      expect(await lonceng(b.bebanId)).toBe(1);
      expect((await putuskan(b.returId)).ok).toBe(true);
    });

    it("membatalkan penerimaan terverifikasi ditolak begitu barangnya diputuskan, tanpa menulis apa pun", async () => {
      const b = await bebanLewatUtang();
      const a = await catat(30_000);
      if (!a.ok) throw new Error(a.kode);
      await periksaPenerimaanUtangSpg({ id: a.id, versi: 1, keputusan: "TERVERIFIKASI", olehUserId: pemeriksa, sekarang });
      expect((await putuskan(b.returId)).ok).toBe(true);
      expect(await batalkanPenerimaanUtangSpg({ id: a.id, olehUserId: pemeriksa, alasan: "salah", bolehBatalkanBelumDicek: false, bolehBatalkanTerverifikasi: true, sekarang })).toEqual({
        ok: false,
        kode: "BEBAN_SUDAH_DIPUTUSKAN",
      });
      expect(await keadaan(b, a.id)).toEqual({ barang: "DIBELI_SPG", utang: "LUNAS", bayar: "TERVERIFIKASI" });
      expect(await prisma.spgDebtSettlement.count({ where: { refType: REF_BAYAR_UTANG_SPG, refId: seededId(a.id), voidedAt: null } })).toBe(1);
    });

    it("balapan pemeriksaan vs keputusan barang: barang tidak pernah diputuskan selagi utangnya terbuka, lonceng tepat satu", async () => {
      const b = await bebanLewatUtang();
      const a = await catat(30_000);
      if (!a.ok) throw new Error(a.kode);
      const [periksa, putus] = await Promise.all([
        periksaPenerimaanUtangSpg({ id: a.id, versi: 1, keputusan: "TERVERIFIKASI", olehUserId: pemeriksa, sekarang }),
        tunda(5).then(() => putuskan(b.returId)),
      ]);
      expect(periksa).toEqual({ ok: true });
      const akhir = await keadaan(b, a.id);
      expect([akhir.utang, akhir.bayar]).toEqual(["LUNAS", "TERVERIFIKASI"]);
      if (putus.ok) expect(akhir.barang).toBe("DIBELI_SPG");
      else {
        // Keputusan lebih dulu: ia melihat utangnya belum lunas dan tidak menulis apa pun.
        expect(putus).toEqual({ ok: false, alasan: "BEBAN_BELUM_LUNAS" });
        expect(akhir.barang).toBeNull();
      }
      expect(await lonceng(b.bebanId)).toBe(1);
    });

    it("balapan pembatalan penerimaan terverifikasi vs keputusan barang: tidak pernah dibatalkan DAN diputuskan", async () => {
      const b = await bebanLewatUtang();
      const a = await catat(30_000);
      if (!a.ok) throw new Error(a.kode);
      await periksaPenerimaanUtangSpg({ id: a.id, versi: 1, keputusan: "TERVERIFIKASI", olehUserId: pemeriksa, sekarang });
      const [batal, putus] = await Promise.all([
        batalkanPenerimaanUtangSpg({ id: a.id, olehUserId: pemeriksa, alasan: "transfer dibatalkan bank", bolehBatalkanBelumDicek: false, bolehBatalkanTerverifikasi: true, sekarang }),
        tunda(5).then(() => putuskan(b.returId)),
      ]);
      const akhir = await keadaan(b, a.id);
      expect([batal.ok, putus.ok].filter(Boolean)).toHaveLength(1);
      if (batal.ok) {
        expect(putus).toEqual({ ok: false, alasan: "BEBAN_BELUM_LUNAS" });
        expect(akhir).toEqual({ barang: null, utang: "TERBUKA", bayar: "DIBATALKAN" });
      } else {
        expect(batal).toEqual({ ok: false, kode: "BEBAN_SUDAH_DIPUTUSKAN" });
        expect(akhir).toEqual({ barang: "DIBELI_SPG", utang: "LUNAS", bayar: "TERVERIFIKASI" });
      }
    });
  });
});
