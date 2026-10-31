import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds, type Prisma } from "@elorae/db";
import { sidikFoto } from "./sidik";
import { periksaFotoKembar } from "./kembar";

/**
 * Foto yang "dicuci" — basis data sungguhan.
 *
 * Skenario: sales A memotret bukti transfer dan memakainya di dokumennya. Sales B
 * mengunduh foto itu lalu mengunggahnya lagi: barisnya baru, pengunggahnya B,
 * jadi pemeriksaan pemilik meloloskannya. Isinya sama persis — sidiknya sama.
 *
 * Dokumen uji = kolom `User.image` (terdaftar di `KOLOM_FOTO`): penunjuk foto
 * paling sederhana untuk dibuat; kolom lain dicari dengan cara yang sama.
 */

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const tag = `KMBR${Math.random().toString(36).slice(2, 8)}`;
const db = prisma as unknown as Prisma.TransactionClient;

d("periksaFotoKembar (test bed only)", () => {
  let salesA = "";
  let salesB = "";
  let dokumenA = "";
  const fotoIds: string[] = [];
  const penggunaIds: string[] = [];

  const isiBukti = Buffer.from(`bukti-transfer-${tag}`);

  async function foto(isi: Buffer<ArrayBuffer>, olehId: string | null, sidik: string | null = sidikFoto(isi)) {
    const f = await prisma.foto.create({
      data: { mime: "image/jpeg", bytes: isi, sizeBytes: isi.byteLength, caption: tag, uploadedById: olehId, sha256: sidik },
      select: { id: true },
    });
    fotoIds.push(f.id);
    return f.id;
  }

  async function dokumen(image: string) {
    const u = await prisma.user.create({
      data: { email: `${tag.toLowerCase()}-dok-${penggunaIds.length}@uji.local`, name: `${tag} dok`, image },
      select: { id: true },
    });
    penggunaIds.push(u.id);
    return u.id;
  }

  beforeAll(async () => {
    salesA = "";
    salesB = "";
    dokumenA = "";
    salesA = (await prisma.user.create({ data: { email: `${tag.toLowerCase()}-a@uji.local`, name: `${tag} A` }, select: { id: true } })).id;
    salesB = (await prisma.user.create({ data: { email: `${tag.toLowerCase()}-b@uji.local`, name: `${tag} B` }, select: { id: true } })).id;
    penggunaIds.push(salesA, salesB);
  });

  afterAll(async () => {
    // Foto dulu: relasi pengunggah (`FotoUploader`) menolak menghapus pengguna yang masih punya foto.
    await prisma.foto.deleteMany({ where: { id: { in: seededIds(fotoIds) } } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds(penggunaIds) } } });
  });

  it("bukti A sudah dipakai dokumen; B mengunggah ulang isi yang sama → FOTO_SUDAH_DIPAKAI", async () => {
    const asli = await foto(isiBukti, salesA);
    dokumenA = await dokumen(`/api/foto/${asli}`);
    const cucian = await foto(isiBukti, salesB);
    expect(await periksaFotoKembar(db, { urls: [`/api/foto/${cucian}`, null], userId: salesB })).toEqual({
      boleh: false,
      kode: "FOTO_SUDAH_DIPAKAI",
      fotoId: cucian,
      kembarId: asli,
    });
  });

  it("dokumen yang sedang dikoreksi sendiri (kecuali) tidak dihitung 'dokumen lain'", async () => {
    const cucian = await foto(isiBukti, salesB);
    expect(
      await periksaFotoKembar(db, { urls: [`/api/foto/${cucian}`], userId: salesB, kecuali: { model: "user", id: dokumenA } }),
    ).toEqual({ boleh: true });
  });

  it("kembaran milik pelapor sendiri (A mengunggah ulang fotonya) → boleh", async () => {
    const ulang = await foto(isiBukti, salesA);
    expect(await periksaFotoKembar(db, { urls: [`/api/foto/${ulang}`], userId: salesA })).toEqual({ boleh: true });
  });

  it("kembaran milik orang lain yang BELUM dipakai dokumen apa pun → boleh", async () => {
    const isi = Buffer.from(`belum-dipakai-${tag}`);
    await foto(isi, salesA);
    const punyaB = await foto(isi, salesB);
    expect(await periksaFotoKembar(db, { urls: [`/api/foto/${punyaB}`], userId: salesB })).toEqual({ boleh: true });
  });

  it("kembaran tanpa pengunggah (tak dikenal) yang dipakai dokumen → ditolak", async () => {
    const isi = Buffer.from(`tanpa-pemilik-${tag}`);
    const lama = await foto(isi, null);
    await dokumen(`/api/foto/${lama}`);
    const punyaB = await foto(isi, salesB);
    expect(await periksaFotoKembar(db, { urls: [`/api/foto/${punyaB}`], userId: salesB })).toMatchObject({
      boleh: false,
      kembarId: lama,
    });
  });

  it("isi berbeda (sidik lain) → boleh; foto lama tanpa sidik → boleh (tidak bisa dibedakan)", async () => {
    const lain = await foto(Buffer.from(`foto-lain-${tag}`), salesB);
    const tanpaSidik = await foto(isiBukti, salesB, null);
    expect(await periksaFotoKembar(db, { urls: [`/api/foto/${lain}`, `/api/foto/${tanpaSidik}`], userId: salesB })).toEqual({
      boleh: true,
    });
  });

  it("dokumen yang menunjuk id lain yang DIAWALI id kembaran tidak dihitung (cocok URL utuh)", async () => {
    const isi = Buffer.from(`awalan-${tag}`);
    const punyaA = await foto(isi, salesA);
    await dokumen(`/api/foto/${punyaA}x`);
    const punyaB = await foto(isi, salesB);
    expect(await periksaFotoKembar(db, { urls: [`/api/foto/${punyaB}`], userId: salesB })).toEqual({ boleh: true });
  });

  it("tanpa URL /api/foto (kosong, R2 lama, bentuk lain) → boleh tanpa kueri dokumen", async () => {
    expect(
      await periksaFotoKembar(db, { urls: [null, undefined, "", "https://r2.example/x.jpg", "/api/foto/"], userId: salesB }),
    ).toEqual({ boleh: true });
  });

  it("satu foto laporan bersih + satu cucian → tetap ditolak, menyebut yang cucian", async () => {
    const bersih = await foto(Buffer.from(`bersih-${tag}`), salesB);
    const cucian = await foto(isiBukti, salesB);
    expect(
      await periksaFotoKembar(db, { urls: [`/api/foto/${bersih}`, `/api/foto/${cucian}`], userId: salesB }),
    ).toMatchObject({ boleh: false, fotoId: cucian });
    expect(await prisma.user.findUnique({ where: { id: seededId(dokumenA) }, select: { id: true } })).not.toBeNull();
  });
});
