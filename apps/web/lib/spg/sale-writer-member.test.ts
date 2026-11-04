import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { KUNCI_MEMBER, MEMBER_BAWAAN, type AturanMember } from "./member";
import { keadaanMemberPerNomor } from "./member-queries";
import { aturAktifMember, daftarkanMemberPelanggan } from "./member-writer";
import { recordSpgSale } from "./sale-writer";

/**
 * Nota SPG dengan member dan promo paket, di basis data sungguhan. Pengaturan
 * member (global) dipotret dan dipulihkan PALING DULU. Promo uji hanya untuk
 * toko uji; member uji memakai nomor acak yang dicatat untuk dihapus.
 */

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("nota SPG dengan member dan paket (test bed only)", () => {
  const tag = `MBR-${Math.random().toString(36).slice(2, 10)}`;
  let uomId = "";
  let kategoriId = "";
  let kaosId = "";
  let celanaId = "";
  let spgId = "";
  let tokoA = "";
  let tokoB = "";
  let promoIds: string[] = [];
  let nomor: string[] = [];
  let setelanLama: string | null | undefined = undefined;

  const nomorBaru = () => {
    const n = `62812${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
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
    celanaId = "";
    tokoA = "";
    tokoB = "";
    promoIds = [];
    nomor = [];
    setelanLama = undefined;
    const s = await prisma.systemSetting.findUnique({ where: { key: KUNCI_MEMBER } });
    setelanLama = s ? s.value : null;
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    kategoriId = (await prisma.itemCategory.create({ data: { name: `Kaos ${tag}` } })).id;
    kaosId = (
      await prisma.item.create({
        data: { sku: `${tag}-K`, nameId: "Kaos Uji", nameEn: "Tee", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 120_000, categoryId: kategoriId },
      })
    ).id;
    celanaId = (
      await prisma.item.create({ data: { sku: `${tag}-C`, nameId: "Celana Uji", nameEn: "Pants", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 180_000 } })
    ).id;
    spgId = (await prisma.user.findFirstOrThrow({ where: { email: "salesman@elorae.com" } })).id;
    tokoA = (await prisma.store.create({ data: { code: `${tag}-A`, name: "Toko A Uji", address: "Jl. Uji", termsType: "PUTUS", isActive: true } })).id;
    tokoB = (await prisma.store.create({ data: { code: `${tag}-B`, name: "Toko B Uji", address: "Jl. Uji", termsType: "PUTUS", isActive: true } })).id;
  });

  afterEach(async () => {
    if (setelanLama === null) await prisma.systemSetting.delete({ where: { key: KUNCI_MEMBER } }).catch(() => undefined);
    else if (setelanLama !== undefined) await prisma.systemSetting.update({ where: { key: KUNCI_MEMBER }, data: { value: setelanLama } });
    const nota = (await prisma.spgSale.findMany({ where: { storeId: { in: [seededId(tokoA), seededId(tokoB)] } }, select: { id: true } })).map((n) => n.id);
    const member = (await prisma.member.findMany({ where: { phone: { in: seededIds(nomor) } }, select: { id: true } })).map((m) => m.id);
    await prisma.auditLog.deleteMany({ where: { entityType: "Member", entityId: { in: seededIds(member) } } });
    await prisma.member.deleteMany({ where: { id: { in: seededIds(member) } } });
    await prisma.spgSalePromo.deleteMany({ where: { spgSaleId: { in: seededIds(nota) } } });
    await prisma.storeStockMovement.deleteMany({ where: { storeId: { in: [seededId(tokoA), seededId(tokoB)] } } });
    await prisma.salesHistory.deleteMany({ where: { itemId: { in: [seededId(kaosId), seededId(celanaId)] } } });
    await prisma.spgSaleLine.deleteMany({ where: { spgSaleId: { in: seededIds(nota) } } });
    await prisma.spgSale.deleteMany({ where: { id: { in: seededIds(nota) } } });
    await prisma.storeCustomer.deleteMany({ where: { storeId: { in: [seededId(tokoA), seededId(tokoB)] } } });
    await prisma.counterPromoTarget.deleteMany({ where: { promoId: { in: seededIds(promoIds) } } });
    await prisma.counterPromo.deleteMany({ where: { id: { in: seededIds(promoIds) } } });
    await prisma.item.deleteMany({ where: { id: { in: [seededId(kaosId), seededId(celanaId)] } } });
    await prisma.itemCategory.deleteMany({ where: { id: seededId(kategoriId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.store.deleteMany({ where: { id: { in: [seededId(tokoA), seededId(tokoB)] } } });
  });

  const jual = (storeId: string, lines: { itemId: string; qty: number }[], pembeli: Parameters<typeof recordSpgSale>[0]["pembeli"]) =>
    recordSpgSale({ salesmanId: spgId, storeId, lines: lines.map((l) => ({ ...l, variantSku: null })), pembeli, idempotencyKey: `${tag}-${Math.random()}` });

  it("registers a new buyer as a member on the receipt and gives the first-tier discount at once", async () => {
    await aturMember({ diskonAktif: true, tingkat: [{ kode: "MEMBER", nama: "Member", minBelanja: 0, diskonPersen: 5 }] });
    const hp = nomorBaru();
    const r = await jual(tokoA, [{ itemId: kaosId, qty: 1 }], { nama: "Ani", hp, setuju: true, daftarMember: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.member).toEqual({ tingkat: "Member", potongan: 6_000, baru: true });
    expect(r.total).toBe(114_000);
    const nota = await prisma.spgSale.findUniqueOrThrow({ where: { id: r.spgSaleId } });
    expect(nota.memberTier).toBe("Member");
    expect(Number(nota.memberDiscount)).toBe(6_000);
    const m = await prisma.member.findUniqueOrThrow({ where: { phone: nomor[0] } });
    expect(m.joinedStoreId).toBe(tokoA);
    expect(nota.memberId).toBe(m.id);
    expect(await prisma.auditLog.count({ where: { entityType: "Member", entityId: m.id, action: "MEMBER_REGISTERED" } })).toBe(1);
  });

  it("recognises the member at another store and reads the tier from spend at every store", async () => {
    await aturMember({
      diskonAktif: true,
      tingkat: [
        { kode: "MEMBER", nama: "Member", minBelanja: 0, diskonPersen: 0 },
        { kode: "GOLD", nama: "Gold", minBelanja: 300_000, diskonPersen: 10 },
      ],
    });
    const hp = nomorBaru();
    const a = await jual(tokoA, [{ itemId: celanaId, qty: 2 }], { nama: "Budi", hp, setuju: true, daftarMember: true });
    expect(a.ok && a.member?.tingkat).toBe("Member");
    // Toko B belum mengenal pelanggan ini — dicatat baru, tapi nomornya member, belanjanya 360 rb → Gold.
    const b = await jual(tokoB, [{ itemId: kaosId, qty: 1 }], { nama: "Budi", hp, setuju: true });
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    expect(b.member).toEqual({ tingkat: "Gold", potongan: 12_000, baru: false });
    const keadaan = (await keadaanMemberPerNomor([nomor[0]])).get(nomor[0]);
    expect(keadaan?.tingkat).toBe("Gold");
    expect(keadaan?.belanjaPeriode).toBe(360_000 + 108_000);
  });

  it("keeps the receipt but skips registration when the minimum spend to join is not met", async () => {
    await aturMember({ diskonAktif: true, minBelanjaDaftar: 200_000, tingkat: [{ kode: "MEMBER", nama: "Member", minBelanja: 0, diskonPersen: 10 }] });
    nomorBaru();
    const r = await jual(tokoA, [{ itemId: kaosId, qty: 1 }], { nama: "Cici", hp: `0${nomor[0].slice(2)}`, setuju: true, daftarMember: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tanpaMember).toBe("BELANJA_KURANG");
    expect(r.member).toBeNull();
    expect(r.total).toBe(120_000);
    expect(await prisma.member.count({ where: { phone: nomor[0] } })).toBe(0);
    expect(await prisma.storeCustomer.count({ where: { storeId: tokoA, phone: nomor[0] } })).toBe(1);
  });

  it("an office-deactivated member gets no member price and cannot be re-registered from the counter", async () => {
    await aturMember({ diskonAktif: true, tingkat: [{ kode: "MEMBER", nama: "Member", minBelanja: 0, diskonPersen: 10 }] });
    const hp = nomorBaru();
    const a = await jual(tokoA, [{ itemId: kaosId, qty: 1 }], { nama: "Dodi", hp, setuju: true, daftarMember: true });
    expect(a.ok && a.member?.baru).toBe(true);
    const m = await prisma.member.findUniqueOrThrow({ where: { phone: nomor[0] } });
    expect((await aturAktifMember({ memberId: m.id, aktif: false, userId: spgId })).ok).toBe(false);
    expect(await aturAktifMember({ memberId: m.id, aktif: false, userId: spgId, alasan: "Nomor dipakai bersama" })).toEqual({ ok: true, berubah: true });
    const b = await jual(tokoA, [{ itemId: kaosId, qty: 1 }], { nama: "Dodi", hp, setuju: true, daftarMember: true });
    expect(b.ok && b.tanpaMember).toBe("MEMBER_NONAKTIF");
    expect(b.ok && b.total).toBe(120_000);
  });

  it("refuses new members while the programme is off, but the receipt is recorded", async () => {
    await aturMember({ aktif: false });
    nomorBaru();
    const r = await jual(tokoA, [{ itemId: kaosId, qty: 1 }], { nama: "Eka", hp: `0${nomor[0].slice(2)}`, setuju: true, daftarMember: true });
    expect(r.ok && r.tanpaMember).toBe("PROGRAM_MATI");
    expect(await prisma.member.count({ where: { phone: nomor[0] } })).toBe(0);
  });

  it("an SPG registers an existing customer of the store from the customer page", async () => {
    nomorBaru();
    const c = await prisma.storeCustomer.create({ data: { storeId: tokoA, name: "Fani", phone: nomor[0], consentAt: new Date(), createdById: spgId } });
    const r = await daftarkanMemberPelanggan({ customerId: c.id, storeId: tokoA, userId: spgId });
    expect(r.ok && r.baru).toBe(true);
    // Pelanggan toko lain tidak bisa didaftarkan dari toko ini.
    expect(await daftarkanMemberPelanggan({ customerId: c.id, storeId: tokoB, userId: spgId })).toEqual({ ok: false, code: "PELANGGAN_TIDAK_ADA" });
  });

  it("registration from the customer page is refused while a minimum spend to join is set", async () => {
    await aturMember({ minBelanjaDaftar: 100_000 });
    nomorBaru();
    const c = await prisma.storeCustomer.create({ data: { storeId: tokoA, name: "Hana", phone: nomor[0], consentAt: new Date(), createdById: spgId } });
    expect(await daftarkanMemberPelanggan({ customerId: c.id, storeId: tokoA, userId: spgId })).toEqual({ ok: false, code: "LEWAT_NOTA" });
    expect(await prisma.member.count({ where: { phone: nomor[0] } })).toBe(0);
  });

  it("records a bundle per line in the promo detail, and member-only promos apply to members only", async () => {
    await aturMember({ diskonAktif: false });
    const paket = await prisma.counterPromo.create({
      data: {
        name: `Paket ${tag}`,
        type: "PAKET",
        value: 250_000,
        allItems: false,
        allStores: false,
        createdById: spgId,
        targets: {
          create: [
            { kind: "STORE", refId: tokoA },
            { kind: "CATEGORY", refId: kategoriId, qty: 1 },
            { kind: "ITEM", refId: celanaId, qty: 1 },
          ],
        },
      },
    });
    promoIds.push(paket.id);
    const khusus = await prisma.counterPromo.create({
      data: {
        name: `Member ${tag}`,
        type: "POTONGAN",
        value: 10_000,
        allItems: true,
        allStores: false,
        memberOnly: true,
        createdById: spgId,
        targets: { create: [{ kind: "STORE", refId: tokoA }] },
      },
    });
    promoIds.push(khusus.id);

    const bukan = await jual(tokoA, [{ itemId: kaosId, qty: 2 }, { itemId: celanaId, qty: 1 }], null);
    expect(bukan.ok).toBe(true);
    if (!bukan.ok) return;
    // Paket (300 → 250 rb) + satu kaos tanpa promo (khusus member tidak berlaku).
    expect(bukan.total).toBe(250_000 + 120_000);
    const rincian = await prisma.spgSalePromo.findMany({ where: { spgSaleId: bukan.spgSaleId } });
    expect(rincian.map((r) => [r.promoId, r.kind, r.qty, Number(r.discount)]).sort()).toEqual(
      [
        [paket.id, "BARANG", 1, 20_000],
        [paket.id, "BARANG", 1, 30_000],
      ].sort(),
    );
    const nota = await prisma.spgSale.findUniqueOrThrow({ where: { id: bukan.spgSaleId } });
    expect(rincian.reduce((s, r) => s + Number(r.discount), 0)).toBe(Number(nota.discountTotal));

    const hp = nomorBaru();
    const anggota = await jual(tokoA, [{ itemId: kaosId, qty: 2 }, { itemId: celanaId, qty: 1 }], { nama: "Gita", hp, setuju: true, daftarMember: true });
    expect(anggota.ok && anggota.total).toBe(250_000 + 110_000);
  });
});
