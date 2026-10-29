import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { kunciBaris } from "@/lib/spg/stok";
import { bacaDiskonManual, KUNCI_DISKON_MANUAL } from "@/lib/spg/pengaturan";
import { promoKonterUntukToko } from "@/lib/spg/promo-konter-queries";
import { getSellableCatalogForSpg } from "@/lib/spg/sale-queries";
import { recordSpgSale } from "@/lib/spg/sale-writer";
import { muatanKirimNotaSpg, muatanPembeli, susunNotaTertahan } from "@/lib/pwa/offline/spg-jual-muatan";
import { KUNCI_MEMBER, MEMBER_BAWAAN, type AturanMember } from "@/lib/spg/member";
import { bacaAturanMemberDb } from "@/lib/spg/member-queries";
import { memberPembeliPerNomor } from "@/lib/spg/member-hp-queries";
import { memberKeranjang, pembeliUntukKirim, pratinjauKeranjang, type BarisKeranjang, type PembeliKeranjang } from "./keranjang";

/**
 * Layar jual ↔ penulis nota, di basis data sungguhan: total yang dilihat SPG di
 * HP (katalog + daftar promo yang ikut halaman + mesin promo yang sama) harus
 * sama dengan total yang dicatat server — untuk promo kategori, promo belanja,
 * dan diskon SPG — juga saat nota dikirim belakangan dari antrean HP.
 *
 * Promo uji HANYA untuk toko uji (`allStores: false`); pengaturan member dan
 * diskon manual (global) dipotret dan dipulihkan PALING DULU. Member uji
 * memakai nomor acak yang dicatat untuk dihapus, bersama jejaknya.
 */

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("pratinjau keranjang SPG = nota tercatat (test bed only)", () => {
  const tag = `JUAL-${Math.random().toString(36).slice(2, 10)}`;
  let uomId = "";
  let kategoriId = "";
  let kaosId = "";
  let topiId = "";
  let salesmanId = "";
  let storeId = "";
  let promoIds: string[] = [];
  let setelanLama: string | null | undefined = undefined;
  let memberLama: string | null | undefined = undefined;
  let nomor: string[] = [];

  /** Nomor HP acak (bentuk ketik `0812…`); bentuk simpannya dicatat untuk dihapus. */
  const nomorBaru = () => {
    const n = `62813${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
    nomor.push(n);
    return `0${n.slice(2)}`;
  };

  async function aturMember(ubah: Partial<AturanMember>) {
    const nilai = JSON.stringify({ ...MEMBER_BAWAAN, ...ubah });
    await prisma.systemSetting.upsert({ where: { key: KUNCI_MEMBER }, create: { key: KUNCI_MEMBER, value: nilai }, update: { value: nilai } });
  }

  beforeEach(async () => {
    uomId = "";
    kategoriId = "";
    kaosId = "";
    topiId = "";
    storeId = "";
    promoIds = [];
    setelanLama = undefined;
    memberLama = undefined;
    nomor = [];
    const m = await prisma.systemSetting.findUnique({ where: { key: KUNCI_MEMBER } });
    memberLama = m ? m.value : null;
    const s = await prisma.systemSetting.findUnique({ where: { key: KUNCI_DISKON_MANUAL } });
    setelanLama = s ? s.value : null;
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    kategoriId = (await prisma.itemCategory.create({ data: { name: `Kaos ${tag}` } })).id;
    kaosId = (
      await prisma.item.create({
        data: { sku: tag, nameId: "Kaos Uji", nameEn: "Test Tee", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 99_900, categoryId: kategoriId },
      })
    ).id;
    topiId = (
      await prisma.item.create({
        data: { sku: `${tag}-T`, nameId: "Topi Uji", nameEn: "Test Cap", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 45_500 },
      })
    ).id;
    salesmanId = (await prisma.user.findFirstOrThrow({ where: { email: "salesman@elorae.com" } })).id;
    storeId = (await prisma.store.create({ data: { code: tag, name: "Toko Jual Uji", address: "Jl. Uji", termsType: "PUTUS", isActive: true } })).id;
  });

  afterEach(async () => {
    // Pengaturan global dipulihkan PALING DULU — langkah lain boleh gagal, yang ini tidak.
    if (memberLama === null) {
      await prisma.systemSetting.delete({ where: { key: KUNCI_MEMBER } }).catch(() => undefined);
    } else if (memberLama !== undefined) {
      await prisma.systemSetting.update({ where: { key: KUNCI_MEMBER }, data: { value: memberLama } });
    }
    if (setelanLama === null) {
      await prisma.systemSetting.delete({ where: { key: KUNCI_DISKON_MANUAL } }).catch(() => undefined);
    } else if (setelanLama !== undefined) {
      await prisma.systemSetting.update({ where: { key: KUNCI_DISKON_MANUAL }, data: { value: setelanLama } });
    }
    const member = (await prisma.member.findMany({ where: { phone: { in: seededIds(nomor) } }, select: { id: true } })).map((x) => x.id);
    await prisma.auditLog.deleteMany({ where: { entityType: "Member", entityId: { in: seededIds(member) } } });
    await prisma.member.deleteMany({ where: { id: { in: seededIds(member) } } });
    await prisma.counterPromoTarget.deleteMany({ where: { promoId: { in: promoIds.map((id) => seededId(id)) } } });
    await prisma.counterPromo.deleteMany({ where: { id: { in: promoIds.map((id) => seededId(id)) } } });
    await prisma.storeCustomer.deleteMany({ where: { storeId: seededId(storeId) } });
    await prisma.storeStockMovement.deleteMany({ where: { itemId: { in: [seededId(kaosId), seededId(topiId)] } } });
    await prisma.salesHistory.deleteMany({ where: { itemId: { in: [seededId(kaosId), seededId(topiId)] } } });
    await prisma.spgSaleLine.deleteMany({ where: { itemId: { in: [seededId(kaosId), seededId(topiId)] } } });
    await prisma.spgSalePromo.deleteMany({ where: { spgSaleId: { in: (await prisma.spgSale.findMany({ where: { storeId: seededId(storeId) }, select: { id: true } })).map((x) => x.id) } } });
    await prisma.spgSale.deleteMany({ where: { storeId: seededId(storeId) } });
    await prisma.item.deleteMany({ where: { id: { in: [seededId(kaosId), seededId(topiId)] } } });
    await prisma.itemCategory.deleteMany({ where: { id: seededId(kategoriId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
  });

  async function buatPromo(data: { name: string; type: string; value: number; minSubtotal?: number; kategori?: string }) {
    const p = await prisma.counterPromo.create({
      data: {
        name: data.name,
        type: data.type,
        value: data.value,
        minSubtotal: data.minSubtotal ?? null,
        allItems: !data.kategori,
        allStores: false,
        createdById: salesmanId,
        targets: { create: [{ kind: "STORE", refId: storeId }, ...(data.kategori ? [{ kind: "CATEGORY", refId: data.kategori }] : [])] },
      },
    });
    promoIds.push(p.id);
  }

  /** Persis yang dilakukan halaman jual + layar: katalog toko, promo toko, pengaturan diskon. */
  async function bukaLayarJual(qty: Record<string, number>) {
    const [katalog, promos, setelan] = await Promise.all([
      getSellableCatalogForSpg(storeId),
      promoKonterUntukToko(storeId, new Date()),
      prisma.systemSetting.findUnique({ where: { key: KUNCI_DISKON_MANUAL }, select: { value: true } }),
    ]);
    const baris: BarisKeranjang[] = katalog
      .filter((r) => qty[r.itemId])
      .map((r) => ({ kunci: kunciBaris(r.itemId, r.variantSku), row: r, qty: qty[r.itemId] }));
    expect(baris).toHaveLength(Object.keys(qty).length);
    expect(baris.find((b) => b.row.itemId === kaosId)?.row.categoryId).toBe(kategoriId);
    return { baris, promos, aturan: bacaDiskonManual(setelan?.value) };
  }

  it("records the total the phone showed — category promo plus spend promo, sent later from the offline queue", async () => {
    await buatPromo({ name: "Kaos 15%", type: "PERSEN", value: 15, kategori: kategoriId });
    await buatPromo({ name: "Belanja 200rb", type: "MIN_BELANJA_POTONGAN", value: 12_500, minSubtotal: 200_000 });
    const layar = await bukaLayarJual({ [kaosId]: 3, [topiId]: 1 });
    const waktuJual = new Date(Date.now() - 60 * 60_000);
    const p = pratinjauKeranjang({ baris: layar.baris, promos: layar.promos, storeId, waktu: waktuJual, aturan: layar.aturan, diskon: null });
    expect(p?.galatMesin).toBeNull();
    // Promo global di basis data bersama boleh ikut berlaku (di HP dan di server sama-sama) —
    // yang dipasak hanya bahwa ada promo barang dan promo belanja di hitungan ini.
    expect(p!.hasil.potonganBaris).toBeGreaterThan(0);
    expect(p!.hasil.promoNota).not.toBeNull();

    const nota = susunNotaTertahan({
      idempotencyKey: `kunci-${tag}`,
      storeId,
      storeName: "Toko Jual Uji",
      visitId: null,
      waktuJual,
      baris: layar.baris.map((b) => ({ itemId: b.row.itemId, variantSku: null, qty: b.qty, productName: "x", unitPrice: b.row.price ?? 0 })),
      pembeli: pembeliUntukKirim({ jenis: "baru", nama: "Ani Uji", hp: "0812 0000 1234", setuju: true, daftarMember: false, member: null }, { aktif: true }),
      diskonManual: null,
      totalPratinjau: p!.hasil.total,
      potonganPratinjau: p!.hasil.potonganTotal,
    });
    const m = muatanKirimNotaSpg(nota!);
    const kirim = () =>
      recordSpgSale({
        salesmanId,
        storeId,
        lines: m.lines,
        idempotencyKey: m.idempotencyKey,
        pembeli: m.pembeli,
        diskonManual: m.diskonManual,
        luring: m.luring,
        waktuJual: new Date(m.waktuJual!),
        visitId: m.visitId,
      });

    const res = await kirim();
    if (!res.ok) throw new Error(res.code);
    expect(res.total).toBe(p!.hasil.total);
    const tercatat = await prisma.spgSale.findUniqueOrThrow({ where: { id: res.spgSaleId } });
    expect(Number(tercatat.discountTotal)).toBe(p!.hasil.potonganTotal);
    expect(tercatat.capturedOffline).toBe(true);
    expect(tercatat.createdAt.toISOString()).toBe(waktuJual.toISOString());
    expect(tercatat.customerId).not.toBeNull();

    // Jawaban hilang di jalan → antrean mengirim lagi dengan kunci yang sama: nota yang sama, bukan nota kedua.
    const ulang = await kirim();
    if (!ulang.ok) throw new Error(ulang.code);
    expect(ulang.spgSaleId).toBe(res.spgSaleId);
    expect(await prisma.spgSale.count({ where: { storeId } })).toBe(1);
  });

  it("records the SPG discount the phone showed, and the phone refuses the same limit the server does", async () => {
    await prisma.systemSetting.upsert({
      where: { key: KUNCI_DISKON_MANUAL },
      create: { key: KUNCI_DISKON_MANUAL, value: JSON.stringify({ aktif: true, maksPersen: 10, alasanWajib: true }) },
      update: { value: JSON.stringify({ aktif: true, maksPersen: 10, alasanWajib: true }) },
    });
    await buatPromo({ name: "Semua 5%", type: "PERSEN", value: 5 });
    const layar = await bukaLayarJual({ [kaosId]: 1, [topiId]: 2 });
    const waktu = new Date();

    const lewat = pratinjauKeranjang({ ...layar, storeId, waktu, diskon: { jenis: "PERSEN", nilai: "11", alasan: "x" } });
    expect(lewat?.galatMesin).toBe("DISKON_MANUAL_LEWAT_BATAS");
    const tolak = await recordSpgSale({
      salesmanId,
      storeId,
      lines: layar.baris.map((b) => ({ itemId: b.row.itemId, variantSku: null, qty: b.qty })),
      diskonManual: { jenis: "PERSEN", nilai: 11, alasan: "x" },
    });
    expect(tolak).toEqual({ ok: false, code: "DISKON_MANUAL_LEWAT_BATAS" });

    const p = pratinjauKeranjang({ ...layar, storeId, waktu, diskon: { jenis: "RUPIAH", nilai: "7.500", alasan: "jahitan" } });
    expect(p?.galatMesin).toBeNull();
    expect(p!.hasil.diskonManual).toBe(7_500);
    const res = await recordSpgSale({
      salesmanId,
      storeId,
      lines: layar.baris.map((b) => ({ itemId: b.row.itemId, variantSku: null, qty: b.qty })),
      diskonManual: { jenis: "RUPIAH", nilai: 7_500, alasan: "jahitan" },
    });
    if (!res.ok) throw new Error(res.code);
    expect(res.total).toBe(p!.hasil.total);
  });

  it("toko konsinyasi: layar menampilkan dan mencatat HARGA DI TOKO, promo dihitung dari harga itu", async () => {
    // Margin 25%: kaos 99.900 → 133.200, topi 45.500 → 60.666,67 → 60.667 (rupiah utuh).
    await prisma.store.update({ where: { id: storeId }, data: { termsType: "KONSI", marginPercent: 25 } });
    await buatPromo({ name: "Kaos 10%", type: "PERSEN", value: 10, kategori: kategoriId });
    const layar = await bukaLayarJual({ [kaosId]: 1, [topiId]: 1 });
    expect(layar.baris.find((b) => b.row.itemId === kaosId)?.row.price).toBe(133_200);
    expect(layar.baris.find((b) => b.row.itemId === topiId)?.row.price).toBe(60_667);

    const waktu = new Date();
    const p = pratinjauKeranjang({ ...layar, storeId, waktu, diskon: null });
    expect(p?.galatMesin).toBeNull();
    expect(p!.hasil.subtotal).toBe(193_867);

    const res = await recordSpgSale({
      salesmanId,
      storeId,
      lines: layar.baris.map((b) => ({ itemId: b.row.itemId, variantSku: null, qty: b.qty })),
    });
    if (!res.ok) throw new Error(res.code);
    expect(res.total).toBe(p!.hasil.total);
    const tercatat = await prisma.spgSale.findUniqueOrThrow({ where: { id: res.spgSaleId }, include: { lines: true } });
    expect(Number(tercatat.subtotal)).toBe(193_867);
    expect(Number(tercatat.lines.find((l) => l.itemId === kaosId)?.unitPrice)).toBe(133_200);
    expect(Number(tercatat.lines.find((l) => l.itemId === topiId)?.unitPrice)).toBe(60_667);
  });
  /**
   * Persis yang dilakukan layar untuk pembeli: tanya keanggotaan nomornya
   * (`cekMemberNomorAction` → `memberPembeliPerNomor`), lalu pratinjau dengan
   * aturan member halaman.
   */
  type PembeliTanpaMember = PembeliKeranjang extends infer P ? (P extends unknown ? Omit<P, "member"> : never) : never;
  async function pembeliDiLayar(p: PembeliTanpaMember): Promise<PembeliKeranjang> {
    const hp = p.jenis === "ada" ? p.hp : `62${p.hp.slice(1)}`;
    const info = (await memberPembeliPerNomor([hp])).get(hp) ?? null;
    return { ...p, member: info ? { hp, info } : null } as PembeliKeranjang;
  }

  it("member discount on: the phone shows the total the server records — registering, then a returning member", async () => {
    await aturMember({
      diskonAktif: true,
      tingkat: [
        { kode: "MEMBER", nama: "Member", minBelanja: 0, diskonPersen: 5 },
        { kode: "GOLD", nama: "Gold", minBelanja: 250_000, diskonPersen: 10 },
      ],
    });
    await buatPromo({ name: "Kaos 15%", type: "PERSEN", value: 15, kategori: kategoriId });
    const aturanMember = await bacaAturanMemberDb();
    const hp = nomorBaru();

    // 1) Pembeli baru minta didaftarkan: tingkat pertama, diskon 5% dari potong yang tidak kena promo barang.
    const layar = await bukaLayarJual({ [kaosId]: 2, [topiId]: 3 });
    const baru = await pembeliDiLayar({ jenis: "baru", nama: "Mira Uji", hp, setuju: true, daftarMember: true });
    expect(baru.member?.info).toEqual({ status: "BUKAN", tingkatDaftar: "Member", diskonPersenDaftar: 5 });
    const waktu = new Date();
    const p1 = pratinjauKeranjang({ ...layar, storeId, waktu, diskon: null, member: memberKeranjang(baru, aturanMember) });
    expect(p1?.hasil.member).toMatchObject({ tingkat: "Member" });
    expect(p1!.hasil.member!.potongan).toBeGreaterThan(0);
    const kirim1 = muatanPembeli(pembeliUntukKirim(baru, aturanMember));
    expect(kirim1).toMatchObject({ daftarMember: true });
    const r1 = await recordSpgSale({
      salesmanId,
      storeId,
      lines: layar.baris.map((b) => ({ itemId: b.row.itemId, variantSku: null, qty: b.qty })),
      pembeli: kirim1,
      idempotencyKey: `m1-${tag}`,
    });
    if (!r1.ok) throw new Error(r1.code);
    expect(r1.total).toBe(p1!.hasil.total);
    expect(r1.member).toEqual({ tingkat: "Member", potongan: p1!.hasil.member!.potongan, baru: true });

    // 2) Datang lagi, dipilih dari pencarian sebagai pelanggan toko: belanjanya sudah ≥ 250 rb → Gold.
    const pelanggan = await prisma.storeCustomer.findFirstOrThrow({ where: { storeId, phone: nomor[0] }, select: { id: true, name: true, phone: true } });
    const ada = await pembeliDiLayar({ jenis: "ada", id: pelanggan.id, nama: pelanggan.name, hp: pelanggan.phone, daftarMember: false });
    expect(ada.member?.info).toEqual({ status: "MEMBER", tingkat: "Gold", diskonPersen: 10 });
    const layar2 = await bukaLayarJual({ [kaosId]: 1, [topiId]: 1 });
    const p2 = pratinjauKeranjang({ ...layar2, storeId, waktu: new Date(), diskon: null, member: memberKeranjang(ada, aturanMember) });
    const r2 = await recordSpgSale({
      salesmanId,
      storeId,
      lines: layar2.baris.map((b) => ({ itemId: b.row.itemId, variantSku: null, qty: b.qty })),
      pembeli: muatanPembeli(pembeliUntukKirim(ada, aturanMember)),
      idempotencyKey: `m2-${tag}`,
    });
    if (!r2.ok) throw new Error(r2.code);
    expect(r2.total).toBe(p2!.hasil.total);
    expect(r2.member).toEqual({ tingkat: "Gold", potongan: p2!.hasil.member!.potongan, baru: false });
    const nota = await prisma.spgSale.findUniqueOrThrow({ where: { id: r2.spgSaleId } });
    expect(nota.memberTier).toBe("Gold");
    expect(Number(nota.memberDiscount)).toBe(p2!.hasil.member!.potongan);
  });

  it("registration from the offline queue: the request travels with the receipt, and a receipt below the minimum is recorded without member, as the phone showed", async () => {
    await aturMember({ diskonAktif: true, minBelanjaDaftar: 400_000, tingkat: [{ kode: "MEMBER", nama: "Member", minBelanja: 0, diskonPersen: 10 }] });
    const aturanMember = await bacaAturanMemberDb();
    const layar = await bukaLayarJual({ [kaosId]: 1, [topiId]: 1 });
    // Tanpa sinyal: keanggotaan nomor ini belum bisa ditanyakan → tingkat pertama.
    const pembeli: PembeliKeranjang = { jenis: "baru", nama: "Nia Uji", hp: nomorBaru(), setuju: true, daftarMember: true, member: null };
    const waktuJual = new Date(Date.now() - 30 * 60_000);
    const p = pratinjauKeranjang({ ...layar, storeId, waktu: waktuJual, diskon: null, member: memberKeranjang(pembeli, aturanMember) });
    expect(p?.daftarKurang).toEqual({ minimal: 400_000, kurang: 400_000 - p!.hasil.subtotal });
    expect(p?.hasil.member).toBeNull();

    const nota = susunNotaTertahan({
      idempotencyKey: `kunci-m-${tag}`,
      storeId,
      storeName: "Toko Jual Uji",
      visitId: null,
      waktuJual,
      baris: layar.baris.map((b) => ({ itemId: b.row.itemId, variantSku: null, qty: b.qty, productName: "x", unitPrice: b.row.price ?? 0 })),
      pembeli: pembeliUntukKirim(pembeli, aturanMember),
      diskonManual: null,
      totalPratinjau: p!.hasil.total,
      potonganPratinjau: p!.hasil.potonganTotal,
    });
    const m = muatanKirimNotaSpg(nota!);
    expect(m.pembeli).toMatchObject({ daftarMember: true });
    const res = await recordSpgSale({
      salesmanId,
      storeId,
      lines: m.lines,
      idempotencyKey: m.idempotencyKey,
      pembeli: m.pembeli,
      luring: m.luring,
      waktuJual: new Date(m.waktuJual!),
    });
    if (!res.ok) throw new Error(res.code);
    expect(res.total).toBe(p!.hasil.total);
    expect(res.tanpaMember).toBe("BELANJA_KURANG");
    expect(await prisma.member.count({ where: { phone: nomor[0] } })).toBe(0);
  });
});
