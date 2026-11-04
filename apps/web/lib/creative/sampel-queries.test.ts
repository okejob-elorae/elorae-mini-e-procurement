import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { parseDateOnly } from "@/lib/date-only";
import { geserHari, hariIniWib } from "@/lib/tanggal-isian";
import { barisAlamatKirim, cariBarangSampel, dataPanelPengiriman, daftarSampel, peringatanKirimDobel } from "./sampel-queries";

/*
 * Kueri layar Sampel terhadap basis data uji. Basis data berisi data lain,
 * jadi setiap pernyataan disaring ke campaign/kata kunci milik fixture ini.
 */

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3306") || url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const tag = `SMQ${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

d("kueri sampel KOL (test bed only)", () => {
  let uomId = "";
  let kaos = "";
  let kolA = "";
  let kolB = "";
  let kolC = "";
  let c1 = "";
  let c2 = "";
  const kolab: Record<string, string> = {};
  const hariIni = hariIniWib();
  const tanggal = (h: string) => parseDateOnly(h)!;

  beforeAll(async () => {
    uomId = "";
    kaos = "";
    kolA = "";
    kolB = "";
    kolC = "";
    c1 = "";
    c2 = "";
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    kaos = (
      await prisma.item.create({
        data: {
          sku: `${tag}-KAOS`,
          nameId: `Kaos ${tag}`,
          nameEn: `Tee ${tag}`,
          type: "FINISHED_GOOD",
          uomId,
          variants: [
            { sku: `${tag}-KAOS-M`, size: "M" },
            { sku: `${tag}-KAOS-L`, size: "L" },
          ],
        },
      })
    ).id;
    await prisma.inventoryValue.createMany({
      data: [
        { itemId: kaos, variantSku: `${tag}-KAOS-M`, qtyOnHand: 4, reservedQty: 1, avgCost: 30_000, totalValue: 120_000 },
        { itemId: kaos, variantSku: `${tag}-KAOS-L`, qtyOnHand: 0, reservedQty: 0, avgCost: 30_000, totalValue: 0 },
      ],
    });
    const kol = async (n: string, wa: string | null) =>
      (
        await prisma.kol.create({
          data: {
            name: `${n} ${tag}`,
            waNormal: wa,
            address: `Jl. ${n} 1`,
            city: "Bandung",
            accounts: { create: [{ platform: "TIKTOK", handle: `${n.toLowerCase()}${tag.toLowerCase()}`, followers: 5000 }] },
          },
        })
      ).id;
    kolA = await kol("Ani", "6281299900001");
    kolB = await kol("Ana", "6281299900001");
    kolC = await kol("Cici", null);
    c1 = (await prisma.kolCampaign.create({ data: { name: `Satu ${tag}` } })).id;
    c2 = (await prisma.kolCampaign.create({ data: { name: `Dua ${tag}` } })).id;

    let n = 0;
    const buat = async (
      nama: string,
      data: { kolId: string; campaignId: string; tahap: "DEAL" | "BRIEF_DIKIRIM" | "SAMPEL_DIKIRIM" | "SAMPEL_DITERIMA" | "TAYANG" },
      kiriman?: { trackingNo?: string; sentAt?: Date; stockIssuedAt?: Date; receivedAt?: Date },
    ) => {
      const id = (
        await prisma.kolBrief.create({
          data: {
            docNo: `${tag}/${++n}`,
            ...data,
            dealAt: tanggal(geserHari(hariIni, -5)),
            items: { create: [{ itemId: kaos, itemName: `Kaos ${tag}`, variantSku: null, qty: 1 }] },
          },
        })
      ).id;
      kolab[nama] = id;
      if (kiriman) {
        await prisma.kolShipment.create({
          data: {
            collabId: id,
            courier: "JNE",
            ...kiriman,
            lines: { create: [{ itemId: kaos, itemName: `Kaos ${tag}`, variantSku: `${tag}-KAOS-M`, qty: 1, unitCost: 30_000 }] },
          },
        });
      }
    };
    const kirim = tanggal(geserHari(hariIni, -9));
    await buat("perlu", { kolId: kolA, campaignId: c1, tahap: "DEAL" });
    await buat("jalan", { kolId: kolA, campaignId: c1, tahap: "SAMPEL_DIKIRIM" }, { trackingNo: `R${tag}`, sentAt: kirim, stockIssuedAt: kirim });
    await buat(
      "sampai",
      { kolId: kolB, campaignId: c2, tahap: "SAMPEL_DITERIMA" },
      { trackingNo: "S1", sentAt: kirim, stockIssuedAt: kirim, receivedAt: tanggal(geserHari(hariIni, -2)) },
    );
    await buat(
      "tayang",
      { kolId: kolC, campaignId: c2, tahap: "TAYANG" },
      { trackingNo: "T1", sentAt: kirim, stockIssuedAt: kirim, receivedAt: tanggal(geserHari(hariIni, -3)) },
    );
    // Rencana yang sudah dibuat pengirimannya, tapi belum berangkat.
    await buat("draf", { kolId: kolC, campaignId: c2, tahap: "BRIEF_DIKIRIM" }, {});
  });

  afterAll(async () => {
    await prisma.kolBrief.deleteMany({ where: { id: { in: seededIds(Object.values(kolab)) } } });
    await prisma.kolCampaign.deleteMany({ where: { id: { in: seededIds([c1, c2].filter(Boolean)) } } });
    await prisma.kol.deleteMany({ where: { id: { in: seededIds([kolA, kolB, kolC].filter(Boolean)) } } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(kaos) } });
    await prisma.item.deleteMany({ where: { id: seededId(kaos) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  it("chip dan daftar memakai saringan yang sama; Perlu dikirim satu baris per kolaborasi", async () => {
    const satu = await daftarSampel({ tab: "perlu-dikirim", campaignId: c1 });
    expect(satu.jumlah).toEqual({ "perlu-dikirim": 1, "dalam-perjalanan": 1, "sudah-sampai": 0 });
    expect(satu.perlu.map((r) => r.kolaborasiId)).toEqual([kolab.perlu]);
    const baris = satu.perlu[0];
    expect(baris.umurHari).toBe(5);
    expect(baris.kol.handle).toBe(`ani${tag.toLowerCase()}`);
    expect(baris.rencana).toEqual([expect.objectContaining({ itemId: kaos, qty: 1, perluVarian: true })]);
    expect(baris.draf).toBeNull();
    // Stok tersedia per varian ikut untuk pemilih di baris: M 4 − 1 dicadangkan.
    expect(satu.varianBarang[kaos].varian.find((v) => v.sku === `${tag}-KAOS-M`)?.tersedia).toBe(3);

    const dua = await daftarSampel({ tab: "perlu-dikirim", campaignId: c2 });
    // Kolaborasi TAYANG dengan paket yang sudah diterima tidak menunggu apa pun di sini.
    expect(dua.jumlah).toEqual({ "perlu-dikirim": 1, "dalam-perjalanan": 0, "sudah-sampai": 1 });
    expect(dua.perlu[0].draf).toMatchObject({ courier: "JNE", trackingNo: null });
    expect(dua.perlu[0].draf?.baris[0]).toMatchObject({ variantSku: `${tag}-KAOS-M`, perluVarian: false });
  });

  it("Dalam perjalanan dan Sudah sampai satu baris per paket, dengan umur sejak kirim/terima", async () => {
    const jalan = await daftarSampel({ tab: "dalam-perjalanan", campaignId: c1 });
    expect(jalan.pengiriman.map((p) => [p.kolaborasiId, p.trackingNo, p.umurHari])).toEqual([[kolab.jalan, `R${tag}`, 9]]);
    const sampai = await daftarSampel({ tab: "sudah-sampai", campaignId: c2 });
    expect(sampai.pengiriman.map((p) => [p.kolaborasiId, p.umurHari])).toEqual([[kolab.sampai, 2]]);
  });

  it("kata kunci mencocokkan resi, nama KOL, dan nomor kolaborasi", async () => {
    const resi = await daftarSampel({ tab: "dalam-perjalanan", cari: `r${tag.toLowerCase()}` });
    expect(resi.pengiriman.map((p) => p.kolaborasiId)).toEqual([kolab.jalan]);
    const nama = await daftarSampel({ tab: "perlu-dikirim", cari: `Cici ${tag}` });
    expect(nama.perlu.map((p) => p.kolaborasiId)).toEqual([kolab.draf]);
    const halamanJauh = await daftarSampel({ tab: "perlu-dikirim", cari: tag, halaman: 99 });
    // Halaman di luar jangkauan jatuh ke halaman terakhir yang ada.
    expect(halamanJauh.halaman).toBe(1);
    expect(halamanJauh.perlu).toHaveLength(2);
  });

  it("?kolaborasi= (tautan Hari ini) menyaring satu kolaborasi di daftar dan di setiap chip", async () => {
    const r = await daftarSampel({ tab: "perlu-dikirim", kolaborasiId: kolab.perlu });
    expect(r.perlu.map((p) => p.kolaborasiId)).toEqual([kolab.perlu]);
    expect(r.jumlah).toEqual({ "perlu-dikirim": 1, "dalam-perjalanan": 0, "sudah-sampai": 0 });
    expect(r.kolaborasiDisaring).toEqual({ id: kolab.perlu, docNo: expect.stringContaining(tag) });
    const jalan = await daftarSampel({ tab: "dalam-perjalanan", kolaborasiId: kolab.jalan });
    expect(jalan.pengiriman.map((p) => p.kolaborasiId)).toEqual([kolab.jalan]);
  });

  it("peringatan kirim dobel: KOL sama (campaign sama) dan nomor WA sama", async () => {
    const peta = await peringatanKirimDobel([kolab.perlu, kolab.draf]);
    expect(peta.get(kolab.perlu)?.map((p) => [p.kolaborasiId, p.sebab, p.campaignSama])).toEqual([
      [kolab.jalan, "KOL_SAMA", true],
      [kolab.sampai, "WA_SAMA", false],
    ]);
    // Cici tanpa nomor WA: hanya kolaborasinya sendiri yang pernah dikirimi.
    expect(peta.get(kolab.draf)?.map((p) => [p.kolaborasiId, p.sebab])).toEqual([[kolab.tayang, "KOL_SAMA"]]);
  });

  it("panel pengiriman: keadaan per paket dan HPP total", async () => {
    const panel = await dataPanelPengiriman(kolab.jalan);
    expect(panel?.pengiriman).toEqual([
      expect.objectContaining({ keadaan: "DALAM_PERJALANAN", trackingNo: `R${tag}`, totalHpp: 30_000 }),
    ]);
    // Paketnya sendiri bukan dobel; Ana (nomor WA sama) pernah dikirimi.
    expect(panel?.dobel.map((p) => [p.kolaborasiId, p.sebab])).toEqual([[kolab.sampai, "WA_SAMA"]]);
    expect(await dataPanelPengiriman("tidak-ada")).toBeNull();
  });

  it("ekspor alamat berisi barang dari pengiriman yang belum berangkat bila ada, selain itu rencana", async () => {
    const { baris, terpotong } = await barisAlamatKirim({ campaignId: c2 });
    expect(terpotong).toBe(false);
    expect(baris).toEqual([
      expect.objectContaining({ name: `Cici ${tag}`, address: "Jl. Cici 1", barang: [{ nama: `Kaos ${tag}`, varian: `M (${tag}-KAOS-M)`, qty: 1 }] }),
    ]);
  });

  it("pemilih barang mencari barang jadi aktif beserta varian dan stok tersedianya", async () => {
    const hasil = await cariBarangSampel(`${tag}-KAOS`);
    expect(hasil).toHaveLength(1);
    expect(hasil[0].pilihan.perluVarian).toBe(true);
    expect(hasil[0].pilihan.varian.map((v) => [v.sku, v.tersedia])).toEqual([
      [`${tag}-KAOS-M`, 3],
      [`${tag}-KAOS-L`, 0],
    ]);
    expect(await cariBarangSampel("   ")).toEqual([]);
  });
});
