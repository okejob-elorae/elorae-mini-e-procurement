import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { KUNCI_MEMBER, MEMBER_BAWAAN, type AturanMember } from "./member";
import { memberPembeliPerNomor } from "./member-hp-queries";
import { aturAktifMember } from "./member-writer";
import { daftarPelangganHp, rincianPelangganHp } from "./pelanggan-queries";
import { recordSpgSale } from "./sale-writer";

/**
 * Member di HP SPG, di basis data sungguhan: keadaan per nomor untuk layar jual
 * (hanya tingkat dan diskon), dan bagian member / status / barang favorit di
 * daftar dan rincian pelanggan. Pengaturan member (global) dipotret dan
 * dipulihkan PALING DULU; member uji memakai nomor acak yang dicatat untuk dihapus.
 */

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("member di HP SPG (test bed only)", () => {
  const tag = `MHP-${Math.random().toString(36).slice(2, 10)}`;
  let uomId = "";
  let kaosId = "";
  let celanaId = "";
  let topiId = "";
  let jaketId = "";
  let spgId = "";
  let tokoA = "";
  let tokoB = "";
  let nomor: string[] = [];
  let setelanLama: string | null | undefined = undefined;

  /** Nomor acak dalam bentuk simpan `62…`. */
  const nomorBaru = () => {
    const n = `62815${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
    nomor.push(n);
    return n;
  };

  async function aturMember(ubah: Partial<AturanMember>) {
    const nilai = JSON.stringify({ ...MEMBER_BAWAAN, ...ubah });
    await prisma.systemSetting.upsert({ where: { key: KUNCI_MEMBER }, create: { key: KUNCI_MEMBER, value: nilai }, update: { value: nilai } });
  }

  const barang = (sku: string, nama: string, harga: number) =>
    prisma.item.create({ data: { sku: `${tag}-${sku}`, nameId: nama, nameEn: nama, type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: harga } });

  beforeEach(async () => {
    uomId = "";
    kaosId = "";
    celanaId = "";
    topiId = "";
    jaketId = "";
    tokoA = "";
    tokoB = "";
    nomor = [];
    setelanLama = undefined;
    const s = await prisma.systemSetting.findUnique({ where: { key: KUNCI_MEMBER } });
    setelanLama = s ? s.value : null;
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    kaosId = (await barang("K", "Kaos Uji", 100_000)).id;
    celanaId = (await barang("C", "Celana Uji", 200_000)).id;
    topiId = (await barang("T", "Topi Uji", 50_000)).id;
    jaketId = (await barang("J", "Jaket Uji", 300_000)).id;
    spgId = (await prisma.user.findFirstOrThrow({ where: { email: "salesman@elorae.com" } })).id;
    tokoA = (await prisma.store.create({ data: { code: `${tag}-A`, name: "Toko A Uji", address: "Jl. Uji", termsType: "PUTUS", isActive: true } })).id;
    tokoB = (await prisma.store.create({ data: { code: `${tag}-B`, name: "Toko B Rahasia", address: "Jl. Uji", termsType: "PUTUS", isActive: true } })).id;
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
    await prisma.salesHistory.deleteMany({ where: { itemId: { in: [seededId(kaosId), seededId(celanaId), seededId(topiId), seededId(jaketId)] } } });
    await prisma.spgSaleLine.deleteMany({ where: { spgSaleId: { in: seededIds(nota) } } });
    await prisma.spgSale.deleteMany({ where: { id: { in: seededIds(nota) } } });
    await prisma.storeCustomer.deleteMany({ where: { storeId: { in: [seededId(tokoA), seededId(tokoB)] } } });
    await prisma.item.deleteMany({ where: { id: { in: [seededId(kaosId), seededId(celanaId), seededId(topiId), seededId(jaketId)] } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.store.deleteMany({ where: { id: { in: [seededId(tokoA), seededId(tokoB)] } } });
  });

  const jual = async (
    storeId: string,
    lines: { itemId: string; qty: number }[],
    pembeli: Parameters<typeof recordSpgSale>[0]["pembeli"],
  ) => {
    const r = await recordSpgSale({ salesmanId: spgId, storeId, lines: lines.map((l) => ({ ...l, variantSku: null })), pembeli, idempotencyKey: `${tag}-${Math.random()}` });
    if (!r.ok) throw new Error(r.code);
    return r;
  };

  it("tells the counter only the tier and discount of a number — member, deactivated, or the tier a newcomer would get", async () => {
    await aturMember({
      diskonAktif: true,
      tingkat: [
        { kode: "MEMBER", nama: "Member", minBelanja: 0, diskonPersen: 0 },
        { kode: "SILVER", nama: "Silver", minBelanja: 250_000, diskonPersen: 5 },
      ],
    });
    const anggota = nomorBaru();
    const tidurNomor = nomorBaru();
    const pendatang = nomorBaru();
    await jual(tokoA, [{ itemId: celanaId, qty: 2 }], { nama: "Ani", hp: `0${anggota.slice(2)}`, setuju: true, daftarMember: true });
    await jual(tokoA, [{ itemId: kaosId, qty: 1 }], { nama: "Budi", hp: `0${tidurNomor.slice(2)}`, setuju: true, daftarMember: true });
    const m = await prisma.member.findUniqueOrThrow({ where: { phone: tidurNomor } });
    expect((await aturAktifMember({ memberId: m.id, aktif: false, userId: spgId, alasan: "uji" })).ok).toBe(true);
    // Pendatang belanja di toko LAIN tanpa mendaftar: belanjanya tetap dasar tingkatnya bila mendaftar.
    await jual(tokoB, [{ itemId: jaketId, qty: 1 }], { nama: "Cici Rahasia", hp: `0${pendatang.slice(2)}`, setuju: true });

    const peta = await memberPembeliPerNomor([anggota, tidurNomor, pendatang]);
    expect(peta.get(anggota)).toEqual({ status: "MEMBER", tingkat: "Silver", diskonPersen: 5 });
    expect(peta.get(tidurNomor)).toEqual({ status: "NONAKTIF" });
    expect(peta.get(pendatang)).toEqual({ status: "BUKAN", tingkatDaftar: "Silver", diskonPersenDaftar: 5 });
    const muatan = JSON.stringify([...peta.values()]);
    expect(muatan).not.toContain("Rahasia");
    expect(muatan).not.toContain("300000");
    expect(muatan).not.toContain(tokoB);
  });

  it("customer detail shows the member section, status, favourite items and whether it can register", async () => {
    await aturMember({
      diskonAktif: false,
      hariTidur: 30,
      tingkat: [
        { kode: "MEMBER", nama: "Member", minBelanja: 0, diskonPersen: 0 },
        { kode: "GOLD", nama: "Gold", minBelanja: 1_000_000, diskonPersen: 10 },
      ],
    });
    const hp = nomorBaru();
    await jual(tokoA, [{ itemId: kaosId, qty: 3 }, { itemId: topiId, qty: 1 }], { nama: "Dewi", hp: `0${hp.slice(2)}`, setuju: true, daftarMember: true });
    const c = await prisma.storeCustomer.findFirstOrThrow({ where: { storeId: tokoA, phone: hp } });
    const kedua = await jual(tokoA, [{ itemId: celanaId, qty: 2 }, { itemId: jaketId, qty: 1 }], { id: c.id });
    // Pembeli mengembalikan kedua celana: favorit dihitung dari potong bersih, celana hilang dari daftar.
    await prisma.spgSaleLine.updateMany({ where: { spgSaleId: seededId(kedua.spgSaleId), itemId: seededId(celanaId) }, data: { returnedQty: 2 } });

    const r = await rincianPelangganHp(tokoA, c.id);
    expect(r?.member).toMatchObject({ aktif: true, tingkat: "Member", diskonPersen: 0, diskonDinyalakan: false, periodeBulan: 12 });
    expect(r?.member?.belanjaPeriode).toBe(350_000 + 300_000);
    expect(r?.member?.berikut).toEqual({ nama: "Gold", kurang: 350_000 });
    expect(r?.status).toBe("KEMBALI");
    expect(r?.favorit).toEqual([
      { itemId: kaosId, nama: "Kaos Uji", qty: 3 },
      { itemId: jaketId, nama: "Jaket Uji", qty: 1 },
      { itemId: topiId, nama: "Topi Uji", qty: 1 },
    ]);

    // 45 hari kemudian: tidur (pengaturan 30 hari), juga di daftar.
    const nanti = new Date(Date.now() + 45 * 86_400_000);
    expect((await rincianPelangganHp(tokoA, c.id, { sekarang: nanti }))?.status).toBe("TIDUR");
    const daftar = await daftarPelangganHp(tokoA, { sekarang: nanti });
    expect(daftar.baris.find((b) => b.id === c.id)).toMatchObject({ member: { tingkat: "Member", aktif: true }, status: "TIDUR" });

    // Pelanggan yang belum member: boleh didaftarkan, kecuali kantor memasang belanja minimal.
    const lain = await prisma.storeCustomer.create({ data: { storeId: tokoA, name: "Eko", phone: nomorBaru(), consentAt: new Date(), createdById: spgId } });
    const belum = await rincianPelangganHp(tokoA, lain.id);
    expect(belum?.member).toBeNull();
    expect(belum?.daftarMember).toEqual({ boleh: true });
    expect(belum?.status).toBe("BELUM_BELANJA");
    expect(belum?.favorit).toEqual([]);
    await aturMember({ minBelanjaDaftar: 200_000 });
    expect((await rincianPelangganHp(tokoA, lain.id))?.daftarMember).toEqual({ boleh: false, alasan: "LEWAT_NOTA", minimal: 200_000 });
    await aturMember({ aktif: false });
    expect((await rincianPelangganHp(tokoA, lain.id))?.daftarMember).toMatchObject({ boleh: false, alasan: "PROGRAM_MATI" });
  });
});
