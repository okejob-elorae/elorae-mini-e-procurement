import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { buatKlaimPembayaran } from "./claim-writer";
import { buatKontrabon, pasangFotoKontrabon } from "./collection-writer";
import { catatReturToko } from "./return-writer";

/**
 * Pencucian foto: BKM, kontrabon, dan NRT hanya menerima foto `/api/foto/<id>`
 * yang DIUNGGAH pencatatnya sendiri — kecuali pencatat orang kantor modul itu.
 *
 * Tanpa syarat ini sales bisa menempelkan bukti transfer sales lain (atau nota
 * retur toko lain) sebagai buktinya sendiri: fotonya sah, hanya bukan miliknya.
 * Terhadap basis data sungguhan; peran, pengguna, dan foto dibuat sendiri dan
 * setiap penghapusan lewat `seededId()`.
 */

const tag = `FPC-${Math.random().toString(36).slice(2, 8)}`;
const tagEmail = tag.toLowerCase();

let izinDibuat: string[] = [];
let peranIds: string[] = [];
let salesA = "";
let salesB = "";
let kantor = "";
let keuangan = "";
let admin = "";
let fotoA = "";
let fotoB = "";
let tokoId = "";
let piutangId = "";
let klaimIds: string[] = [];
let notaIds: string[] = [];
let nrtIds: string[] = [];
let urut = 0;

async function izin(code: string): Promise<string> {
  const ada = await prisma.permission.findUnique({ where: { code }, select: { id: true } });
  if (ada) return ada.id;
  const [modul, aksi] = code.split(":");
  const baru = await prisma.permission.create({ data: { code, module: modul, action: aksi } });
  izinDibuat.push(baru.id);
  return baru.id;
}

async function peran(nama: string, kode: string[]): Promise<string> {
  const ids = await Promise.all(kode.map(izin));
  const p = await prisma.roleDefinition.create({
    data: { name: `${tag}-${nama}`, isSystem: false, permissions: { create: ids.map((permissionId) => ({ permissionId })) } },
  });
  peranIds.push(p.id);
  return p.id;
}

const foto = async (uploadedById: string) =>
  (await prisma.foto.create({ data: { mime: "image/jpeg", bytes: Buffer.from([1, 2, 3]), sizeBytes: 3, uploadedById } })).id;

beforeEach(async () => {
  izinDibuat = [];
  peranIds = [];
  salesA = "";
  salesB = "";
  kantor = "";
  keuangan = "";
  admin = "";
  fotoA = "";
  fotoB = "";
  tokoId = "";
  piutangId = "";
  klaimIds = [];
  notaIds = [];
  nrtIds = [];

  const peranSales = await peran("SALES", ["pwa:access"]);
  const peranKantor = await peran("KANTOR", ["receivables:manage"]);
  const orang = (akhiran: string, roleId: string) =>
    prisma.user.create({ data: { email: `${tagEmail}-${akhiran}@uji.local`, name: `${tag} ${akhiran}`, roleId } });
  salesA = (await orang("a", peranSales)).id;
  salesB = (await orang("b", peranSales)).id;
  kantor = (await orang("k", peranKantor)).id;
  fotoA = await foto(salesA);
  fotoB = await foto(salesB);

  tokoId = (
    await prisma.store.create({
      data: { code: `${tag}-S`, name: `${tag} Toko`, address: "uji", termsType: "PUTUS", isActive: true },
    })
  ).id;
  piutangId = (
    await prisma.receivable.create({
      data: {
        invoiceNo: `${tag}/INV`,
        storeId: tokoId,
        invoiceDate: new Date("2026-09-01T00:00:00+07:00"),
        dueDate: new Date("2026-10-01T00:00:00+07:00"),
        amount: 2_000_000,
        outstanding: 2_000_000,
        source: "MANUAL",
      },
    })
  ).id;
});

afterEach(async () => {
  const entitas = [...klaimIds, ...notaIds, ...nrtIds].filter(Boolean).map(seededId);
  if (entitas.length) await prisma.auditLog.deleteMany({ where: { entityId: { in: seededIds(entitas) } } });
  const pengguna = seededIds([salesA, salesB, kantor, keuangan, admin].filter(Boolean));
  if (pengguna.length) await prisma.auditLog.deleteMany({ where: { userId: { in: seededIds(pengguna) } } });
  if (klaimIds.length) await prisma.paymentClaim.deleteMany({ where: { id: { in: klaimIds.filter(Boolean).map(seededId) } } });
  if (notaIds.length) await prisma.collectionNote.deleteMany({ where: { id: { in: notaIds.filter(Boolean).map(seededId) } } });
  if (nrtIds.length) await prisma.storeReturn.deleteMany({ where: { id: { in: nrtIds.filter(Boolean).map(seededId) } } });
  if (piutangId) await prisma.receivable.delete({ where: { id: seededId(piutangId) } });
  if (tokoId) await prisma.store.delete({ where: { id: seededId(tokoId) } });
  const fotoIds = [fotoA, fotoB].filter(Boolean).map(seededId);
  if (fotoIds.length) await prisma.foto.deleteMany({ where: { id: { in: seededIds(fotoIds) } } });
  if (pengguna.length) await prisma.user.deleteMany({ where: { id: { in: seededIds(pengguna) } } });
  if (peranIds.length) {
    await prisma.rolePermission.deleteMany({ where: { roleId: { in: peranIds.filter(Boolean).map(seededId) } } });
    await prisma.roleDefinition.deleteMany({ where: { id: { in: peranIds.filter(Boolean).map(seededId) } } });
  }
  if (izinDibuat.length) await prisma.permission.deleteMany({ where: { id: { in: izinDibuat.filter(Boolean).map(seededId) } } });
});

const url = (id: string) => `/api/foto/${id}`;

const klaim = (oleh: string, foto: { transfer: string; rincian?: string | null }) =>
  buatKlaimPembayaran({
    storeId: tokoId,
    salesmanId: oleh,
    createdById: oleh,
    claimedTransferAt: new Date("2026-10-02T00:00:00+07:00"),
    method: "transfer",
    pelunasan: [{ receivableId: piutangId, nilai: 500_000 }],
    transferPhotoUrl: foto.transfer,
    breakdownPhotoUrl: foto.rincian ?? null,
  });

const nrt = (oleh: string, photoUrl: string) => {
  urut += 1;
  return catatReturToko({
    noNrt: `${tag}-NRT-${urut}`,
    storeId: tokoId,
    olehUserId: oleh,
    salesmanId: oleh,
    claimDate: new Date("2026-10-02T00:00:00+07:00"),
    deliveryMethod: "SALES",
    claimedAmount: 150_000,
    photoUrl,
  });
};

describe("BKM — foto bukti milik pencatat", () => {
  it("menolak bukti transfer yang diunggah sales lain", async () => {
    const h = await klaim(salesA, { transfer: url(fotoB) });
    if (h.ok) klaimIds.push(h.id);
    expect(h).toEqual({ ok: false, alasan: "FOTO_BUKAN_MILIK" });
    expect(await prisma.paymentClaim.count({ where: { storeId: seededId(tokoId) } })).toBe(0);
  });

  it("menolak foto rincian potongan yang diunggah sales lain", async () => {
    const h = await klaim(salesA, { transfer: url(fotoA), rincian: url(fotoB) });
    if (h.ok) klaimIds.push(h.id);
    expect(h).toEqual({ ok: false, alasan: "FOTO_BUKAN_MILIK" });
  });

  it("menerima foto yang diunggah pencatatnya sendiri", async () => {
    const h = await klaim(salesA, { transfer: url(fotoA), rincian: url(fotoA) });
    if (h.ok) klaimIds.push(h.id);
    expect(h.ok).toBe(true);
  });

  it("orang kantor (receivables:manage) boleh memakai foto orang lain — mis. 'Buat ulang' dari BKM sales", async () => {
    const h = await klaim(kantor, { transfer: url(fotoB) });
    if (h.ok) klaimIds.push(h.id);
    expect(h.ok).toBe(true);
  });

  it("alamat foto yang disamarkan tidak bisa diperiksa pemiliknya, jadi ditolak", async () => {
    for (const samar of [
      `${url(fotoB)}?v=1`,
      `https://elorae.cloud${url(fotoB)}`,
      `/api/foto/${fotoB}/`,
      // Peramban menormalkan bentuk-bentuk ini menjadi `/api/foto/<id>` sebelum
      // meminta — gambarnya tetap tampil sebagai bukti.
      `/api/./foto/${fotoB}`,
      `/api/%2e/foto/${fotoB}`,
      `/x/../api/foto/${fotoB}`,
      `/api\\foto\\${fotoB}`,
      `//elorae.cloud/api/foto/${fotoB}`,
      `/%61pi/foto/${fotoB}`,
    ]) {
      const h = await klaim(salesA, { transfer: samar });
      if (h.ok) klaimIds.push(h.id);
      expect({ samar, h }).toEqual({ samar, h: { ok: false, alasan: "FOTO_BUKAN_MILIK" } });
    }
  });

  it("pemegang journals:manage termasuk kantor untuk BKM, tetapi tidak untuk NRT", async () => {
    const peranKeuangan = await peran("KEUANGAN", ["journals:manage"]);
    keuangan = (
      await prisma.user.create({ data: { email: `${tagEmail}-f@uji.local`, name: `${tag} f`, roleId: peranKeuangan } })
    ).id;

    const bkm = await klaim(keuangan, { transfer: url(fotoB) });
    if (bkm.ok) klaimIds.push(bkm.id);
    expect(bkm.ok).toBe(true);

    const retur = await nrt(keuangan, url(fotoB));
    if (retur.ok) nrtIds.push(retur.id);
    expect(retur).toEqual({ ok: false, alasan: "FOTO_BUKAN_MILIK" });
  });

  it("peran sistem (admin) termasuk kantor tanpa tautan izin apa pun, sama seperti `*` di lib/auth.ts", async () => {
    const p = await prisma.roleDefinition.create({ data: { name: `${tag}-ADMIN`, isSystem: true } });
    peranIds.push(p.id);
    admin = (await prisma.user.create({ data: { email: `${tagEmail}-adm@uji.local`, name: `${tag} adm`, roleId: p.id } })).id;

    const bkm = await klaim(admin, { transfer: url(fotoB) });
    if (bkm.ok) klaimIds.push(bkm.id);
    expect(bkm.ok).toBe(true);

    const retur = await nrt(admin, url(fotoB));
    if (retur.ok) nrtIds.push(retur.id);
    expect(retur.ok).toBe(true);
  });

  it("alamat lama (R2) dibiarkan seperti sebelumnya", async () => {
    const h = await klaim(salesA, { transfer: "https://pub-uji.r2.dev/bkm/lama.jpg" });
    if (h.ok) klaimIds.push(h.id);
    expect(h.ok).toBe(true);
  });
});

describe("kontrabon — foto lembar tanda terima milik pencatat", () => {
  it("janji bayar lapangan menolak foto yang diunggah sales lain", async () => {
    const h = await buatKontrabon({
      receivableIds: [piutangId],
      salesmanId: salesA,
      handoverDate: new Date("2026-10-02T00:00:00+07:00"),
      promisedDate: new Date("2026-10-15T00:00:00+07:00"),
      receivedBy: "Bu Ani",
      photoUrl: url(fotoB),
      source: "FIELD",
    });
    if (h.ok) notaIds.push(h.id);
    expect(h).toEqual({ ok: false, alasan: "FOTO_BUKAN_MILIK" });
  });

  it("janji bayar lapangan dengan foto sendiri diterima", async () => {
    const h = await buatKontrabon({
      receivableIds: [piutangId],
      salesmanId: salesA,
      handoverDate: new Date("2026-10-02T00:00:00+07:00"),
      promisedDate: new Date("2026-10-15T00:00:00+07:00"),
      receivedBy: "Bu Ani",
      photoUrl: url(fotoA),
      source: "FIELD",
    });
    if (h.ok) notaIds.push(h.id);
    expect(h.ok).toBe(true);
  });

  it("memasang foto susulan: foto orang lain ditolak bagi bukan-kantor, diterima bagi kantor", async () => {
    const nota = await buatKontrabon({
      receivableIds: [piutangId],
      salesmanId: kantor,
      handoverDate: new Date("2026-10-02T00:00:00+07:00"),
      promisedDate: new Date("2026-10-15T00:00:00+07:00"),
    });
    if (!nota.ok) throw new Error(`gagal: ${nota.alasan}`);
    notaIds.push(nota.id);

    expect(await pasangFotoKontrabon({ collectionNoteId: nota.id, photoUrl: url(fotoB), olehUserId: salesA })).toEqual({
      ok: false,
      alasan: "FOTO_BUKAN_MILIK",
    });
    expect((await prisma.collectionNote.findUniqueOrThrow({ where: { id: seededId(nota.id) } })).photoUrl).toBeNull();

    expect(await pasangFotoKontrabon({ collectionNoteId: nota.id, photoUrl: url(fotoA), olehUserId: salesA })).toEqual({ ok: true });
    expect(await pasangFotoKontrabon({ collectionNoteId: nota.id, photoUrl: url(fotoB), olehUserId: kantor })).toEqual({ ok: true });
  });
});

describe("NRT — foto nota retur milik pencatat", () => {
  it("menolak foto nota yang diunggah sales lain", async () => {
    const h = await nrt(salesA, url(fotoB));
    if (h.ok) nrtIds.push(h.id);
    expect(h).toEqual({ ok: false, alasan: "FOTO_BUKAN_MILIK" });
  });

  it("menerima foto sendiri, dan foto orang lain bila dicatat kantor", async () => {
    const sendiri = await nrt(salesA, url(fotoA));
    if (sendiri.ok) nrtIds.push(sendiri.id);
    expect(sendiri.ok).toBe(true);

    const olehKantor = await nrt(kantor, url(fotoB));
    if (olehKantor.ok) nrtIds.push(olehKantor.id);
    expect(olehKantor.ok).toBe(true);
  });
});
