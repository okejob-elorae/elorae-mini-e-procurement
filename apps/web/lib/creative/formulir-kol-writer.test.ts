import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { ISIAN_KOSONG, type IsianFormulirKol } from "./formulir-kol-aturan";
import { kirimanBelumDicekTugas, ringkasFormulirKol } from "./formulir-kol-queries";
import {
  bukaLinkFormulirKol,
  buatLinkFormulirKol,
  cabutLinkFormulirKol,
  dataFormulirPublik,
  kembalikanKolomKiriman,
  kirimFormulirKol,
  tandaiKirimanDicek,
} from "./formulir-kol-writer";

/*
 * Formulir data KOL terhadap basis data sungguhan. Teardown lewat `seededId()`; semua baris milik
 * KOL fixture (link, kiriman, jejak) dihapus lewat kolId-nya.
 */

const tag = `UJIFORMKOL${Math.random().toString(36).slice(2, 7)}`;
let userId = "";
let kolId = "";

const isian = (lain: Partial<IsianFormulirKol> = {}): IsianFormulirKol => ({
  ...ISIAN_KOSONG,
  recipientName: "Rossa Farahdiba",
  phone: "0812 3456 7890",
  address: "Jl. Mawar No. 5",
  city: "Jakarta Selatan",
  postalCode: "12810",
  atasan: "M",
  setuju: true,
  ...lain,
});

beforeEach(async () => {
  userId = "";
  kolId = "";
  userId = (await prisma.user.findFirstOrThrow({ where: { roleDefinition: { isSystem: true } }, select: { id: true } })).id;
  kolId = (
    await prisma.kol.create({
      data: {
        name: `${tag} KOL`,
        address: "Jl. Melati 1",
        sizeProfile: JSON.stringify({ atasan: null, bawahan: "28", tinggiCm: null, hijab: null, catatan: null }),
        accounts: { create: [{ platform: "TIKTOK", handle: `${tag.toLowerCase()}`, followers: 1000 }] },
      },
      select: { id: true },
    })
  ).id;
});

afterEach(async () => {
  await prisma.kolFormSubmission.deleteMany({ where: { kolId: seededId(kolId) } });
  await prisma.kolFormLink.deleteMany({ where: { kolId: seededId(kolId) } });
  await prisma.auditLog.deleteMany({ where: { entityId: seededId(kolId) } });
  await prisma.kolAccount.deleteMany({ where: { kolId: seededId(kolId) } });
  await prisma.kol.deleteMany({ where: { id: seededId(kolId) } });
});

async function link() {
  const r = await buatLinkFormulirKol({ kolId, olehUserId: userId });
  if (!r.ok) throw new Error(r.kode);
  return r;
}

describe("link formulir", () => {
  it("token 43 tanda, hanya hash-nya yang disimpan; link baru mencabut yang lama; jejak tanpa token", async () => {
    const a = await link();
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const baris = await prisma.kolFormLink.findUniqueOrThrow({ where: { id: a.linkId } });
    expect(JSON.stringify(baris)).not.toContain(a.token);
    const b = await link();
    expect((await prisma.kolFormLink.findUniqueOrThrow({ where: { id: a.linkId } })).revokedAt).not.toBeNull();
    expect(await bukaLinkFormulirKol(a.token)).toBeNull();
    expect((await bukaLinkFormulirKol(b.token))?.kolId).toBe(kolId);
    const jejak = await prisma.auditLog.findMany({ where: { entityId: kolId, action: "KOL_FORM_LINK_CREATED" } });
    expect(jejak).toHaveLength(2);
    expect(JSON.stringify(jejak)).not.toContain(b.token);
  });

  it("tidak berlaku: bentuk salah, kedaluwarsa, dicabut, KOL diblokir", async () => {
    const a = await link();
    expect(await bukaLinkFormulirKol("pendek")).toBeNull();
    expect(await bukaLinkFormulirKol(a.token, new Date(a.berlakuSampai.getTime() + 1))).toBeNull();
    await prisma.kol.update({ where: { id: kolId }, data: { blockedAt: new Date() } });
    expect(await bukaLinkFormulirKol(a.token)).toBeNull();
    await prisma.kol.update({ where: { id: kolId }, data: { blockedAt: null } });
    expect(await cabutLinkFormulirKol({ linkId: a.linkId, olehUserId: userId })).toEqual({ ok: true });
    expect(await bukaLinkFormulirKol(a.token)).toBeNull();
    expect(await cabutLinkFormulirKol({ linkId: a.linkId, olehUserId: userId })).toEqual({ ok: false, kode: "SUDAH_DICABUT" });
  });

  it("halaman publik membawa isian non-sensitif yang ada, TANPA isi rekening/NIK/NPWP", async () => {
    const a = await link();
    await prisma.kol.update({ where: { id: kolId }, data: { bankAccountEnc: "v1:rahasia", bankLast4: "6789", nikLast4: "0001" } });
    const d = await dataFormulirPublik((await bukaLinkFormulirKol(a.token))!);
    expect(d?.isian).toMatchObject({ address: "Jl. Melati 1", bawahan: "28", atasan: "" });
    expect(d?.tersimpan).toEqual({ rekeningAkhir: "6789", nikAkhir: "0001", npwp: false });
    expect(JSON.stringify(d)).not.toContain("v1:rahasia");
  });
});

describe("kirim formulir", () => {
  it("isian langsung masuk; ukuran digabung; yang menimpa isian kantor ditandai; jejak atas nama pembuat link", async () => {
    const a = await link();
    expect(await kirimFormulirKol({ token: a.token, isian: isian() })).toEqual({ ok: true, berubah: 6 });
    const k = await prisma.kol.findUniqueOrThrow({ where: { id: kolId } });
    expect(k).toMatchObject({ recipientName: "Rossa Farahdiba", phone: "0812 3456 7890", waNormal: "6281234567890", address: "Jl. Mawar No. 5", city: "Jakarta Selatan", postalCode: "12810" });
    expect(JSON.parse(k.sizeProfile!)).toMatchObject({ atasan: "M", bawahan: "28" });

    const s = await prisma.kolFormSubmission.findFirstOrThrow({ where: { kolId } });
    expect(s.replacedCount).toBe(1);
    expect(JSON.parse(s.changes).perubahan).toContainEqual({ kolom: "address", sebelum: "Jl. Melati 1", sesudah: "Jl. Mawar No. 5", menimpa: true });
    const jejak = await prisma.auditLog.findFirstOrThrow({ where: { entityId: kolId, action: "KOL_UPDATED" } });
    expect(jejak.userId).toBe(userId);
    expect(jejak.metadata).toMatchObject({ sumber: "FORMULIR_KOL", linkId: a.linkId });

    // Kirim ulang isian yang sama: tidak ada kiriman baru.
    expect(await kirimFormulirKol({ token: a.token, isian: isian({ phone: "+62 812-3456-7890" }) })).toEqual({ ok: true, berubah: 0 });
    expect(await prisma.kolFormSubmission.count({ where: { kolId } })).toBe(1);
  });

  it("rekening/NIK/NPWP terenkripsi, tanpa nilai di riwayat; NPWP baru ditandai, status adaNpwp tidak diubah", async () => {
    const a = await link();
    const r = await kirimFormulirKol({
      token: a.token,
      isian: isian({ bankName: "BCA", bankAccount: "123 456 7890", bankHolder: "Rossa F", npwp: "01.234.567.8-901.000" }),
    });
    expect(r.ok).toBe(true);
    const k = await prisma.kol.findUniqueOrThrow({ where: { id: kolId } });
    expect(k.bankAccountEnc).toMatch(/^v1:/);
    expect(k.bankAccountEnc).not.toContain("1234567890");
    expect(k.bankLast4).toBe("7890");
    expect(k.adaNpwp).toBe(false);
    const s = await prisma.kolFormSubmission.findFirstOrThrow({ where: { kolId } });
    expect(s.changes).not.toContain("1234567890");
    expect(JSON.parse(s.changes)).toMatchObject({ sensitif: ["bankName", "bankAccount", "bankHolder", "npwp"], npwpBaru: true });
  });

  it("NIK salah → ditolak per isian dan TIDAK ADA yang tertulis; link tidak berlaku → TIDAK_BERLAKU", async () => {
    const a = await link();
    expect(await kirimFormulirKol({ token: a.token, isian: isian({ nik: "123" }) })).toEqual({ ok: false, kode: "ISIAN_TIDAK_SAH", galat: { nik: "NIK_TIDAK_VALID" } });
    expect((await prisma.kol.findUniqueOrThrow({ where: { id: kolId } })).address).toBe("Jl. Melati 1");
    await cabutLinkFormulirKol({ linkId: a.linkId, olehUserId: userId });
    expect(await kirimFormulirKol({ token: a.token, isian: isian() })).toEqual({ ok: false, kode: "TIDAK_BERLAKU" });
  });
});

describe("pemeriksaan kantor", () => {
  it("Hari ini memuat kiriman belum dicek; tandai dicek sekali", async () => {
    const a = await link();
    await kirimFormulirKol({ token: a.token, isian: isian() });
    const s = await prisma.kolFormSubmission.findFirstOrThrow({ where: { kolId } });
    expect(await kirimanBelumDicekTugas({ kirimanIds: [s.id] })).toMatchObject([{ id: s.id, kolId, jumlahKolom: 6, menimpa: 1, npwpBaru: false }]);
    expect(await tandaiKirimanDicek({ submissionId: s.id, olehUserId: userId })).toEqual({ ok: true });
    expect(await tandaiKirimanDicek({ submissionId: s.id, olehUserId: userId })).toEqual({ ok: false, kode: "SUDAH_DICEK" });
    expect(await kirimanBelumDicekTugas({ kirimanIds: [s.id] })).toEqual([]);
    expect((await ringkasFormulirKol(kolId)).kiriman[0].dicek).not.toBeNull();
  });

  it("Kembalikan: nilai kantor kembali bila masih nilai dari KOL; sudah diubah lagi → BERUBAH_LAGI", async () => {
    const a = await link();
    await kirimFormulirKol({ token: a.token, isian: isian() });
    const s = await prisma.kolFormSubmission.findFirstOrThrow({ where: { kolId } });
    expect(await kembalikanKolomKiriman({ submissionId: s.id, kolom: "city", olehUserId: userId })).toEqual({ ok: false, kode: "TIDAK_BISA_DIKEMBALIKAN" });
    expect(await kembalikanKolomKiriman({ submissionId: s.id, kolom: "address", olehUserId: userId })).toEqual({ ok: true });
    expect((await prisma.kol.findUniqueOrThrow({ where: { id: kolId } })).address).toBe("Jl. Melati 1");
    expect((await ringkasFormulirKol(kolId)).kiriman[0].perubahan.find((p) => p.kolom === "address")?.dikembalikan).toBe(true);
    expect(await kembalikanKolomKiriman({ submissionId: s.id, kolom: "address", olehUserId: userId })).toEqual({ ok: false, kode: "TIDAK_BISA_DIKEMBALIKAN" });

    // Kiriman kedua menimpa lagi, lalu kantor mengetik nilai lain: tidak boleh dikembalikan diam-diam.
    await kirimFormulirKol({ token: a.token, isian: isian({ address: "Jl. Kenanga 9" }) });
    const s2 = await prisma.kolFormSubmission.findFirstOrThrow({ where: { kolId }, orderBy: { submittedAt: "desc" } });
    await prisma.kol.update({ where: { id: kolId }, data: { address: "Jl. Kantor 3" } });
    expect(await kembalikanKolomKiriman({ submissionId: s2.id, kolom: "address", olehUserId: userId })).toEqual({ ok: false, kode: "BERUBAH_LAGI" });
  });
});
