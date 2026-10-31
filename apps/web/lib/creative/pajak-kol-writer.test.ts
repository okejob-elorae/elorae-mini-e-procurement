import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { ringkasPajakKol } from "./pajak-kol-queries";
import { bukaDataSensitifKol, simpanDataSensitifKol, simpanPajakKol } from "./pajak-kol-writer";
import { selaraskanTermin } from "./termin-writer";

/*
 * Data pajak & rekening KOL terhadap basis data sungguhan: tersimpan
 * terenkripsi (tidak pernah teks asli), kunci tidak ada → ditolak tanpa
 * menulis apa pun, pembukaan menulis jejak KOL_SENSITIVE_VIEWED, ringkasan
 * layar hanya tersamar, dan subjek pajak yang berubah menghitung ulang termin
 * yang belum dibayar.
 */

const KUNCI_UJI = "kunci-uji-kol-sensitif-32-karakter";
const tag = `PAJAKUJI-${Math.random().toString(36).slice(2, 7)}`;
let asli: string | undefined;
let userId = "";
let kolId = "";
let kolabIds: string[] = [];

beforeEach(async () => {
  asli = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = KUNCI_UJI;
  userId = "";
  kolId = "";
  kolabIds = [];
  userId = (await prisma.user.findFirstOrThrow({ select: { id: true } })).id;
  kolId = (await prisma.kol.create({ data: { name: `${tag} KOL` }, select: { id: true } })).id;
});

afterEach(async () => {
  if (asli === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = asli;
  await prisma.auditLog.deleteMany({ where: { entityId: { in: seededIds([kolId, ...kolabIds].filter(Boolean)) } } });
  await prisma.kolPaymentTerm.deleteMany({ where: { collabId: { in: seededIds(kolabIds) } } });
  await prisma.kolBrief.deleteMany({ where: { id: { in: seededIds(kolabIds) } } });
  if (kolId) await prisma.kol.delete({ where: { id: seededId(kolId) } });
});

const baca = () => prisma.kol.findUniqueOrThrow({ where: { id: kolId } });

describe("simpanDataSensitifKol — tulis-saja, terenkripsi", () => {
  it("menyimpan terenkripsi, tidak pernah teks asli; empat digit terakhir untuk tampilan", async () => {
    const r = await simpanDataSensitifKol({
      kolId,
      isi: { bankName: "BCA", bankAccount: "123-456-4821", bankHolder: "Siti Aminah", nik: "3174 0123 4567 8901" },
      olehUserId: userId,
    });
    expect(r).toMatchObject({ ok: true, lengkap: true });
    const k = await baca();
    for (const v of [k.bankNameEnc, k.bankAccountEnc, k.bankHolderEnc, k.nikEnc]) {
      expect(v?.startsWith("v1:")).toBe(true);
    }
    const semua = JSON.stringify(k);
    for (const rahasia of ["1234564821", "3174012345678901", "Siti Aminah"]) expect(semua).not.toContain(rahasia);
    expect(k).toMatchObject({ bankLast4: "4821", nikLast4: "8901", dataPajakLengkap: true, npwpEnc: null });

    // Jejak hanya mencatat kolom, tanpa nilai.
    const j = await prisma.auditLog.findFirstOrThrow({ where: { entityId: kolId, action: "KOL_SENSITIVE_UPDATED" } });
    expect(JSON.stringify(j)).not.toContain("4821");
    expect(j.changes).toMatchObject({ after: { diisi: ["bankName", "bankAccount", "bankHolder", "nik"], dihapus: [] } });

    // Ringkasan layar: tersamar.
    const ringkas = await ringkasPajakKol(kolId);
    expect(ringkas).toMatchObject({ bankNama: "BCA", bankLast4: "4821", nikLast4: "8901", ada: { npwp: false, nik: true } });
    expect(JSON.stringify(ringkas)).not.toContain("1234564821");
  });

  it("kolom yang tidak dikirim tidak disentuh; null menghapus", async () => {
    await simpanDataSensitifKol({ kolId, isi: { nik: "3174012345678901", npwp: "012345678901000" }, olehUserId: userId });
    await simpanDataSensitifKol({ kolId, isi: { npwp: null }, olehUserId: userId });
    const k = await baca();
    expect(k.nikEnc).not.toBeNull();
    expect(k.npwpEnc).toBeNull();
  });

  it("isian tidak sah ditolak per kolom", async () => {
    expect(await simpanDataSensitifKol({ kolId, isi: { nik: "123" }, olehUserId: userId })).toEqual({ ok: false, kode: "NIK_TIDAK_VALID", kolom: "nik" });
    expect(await simpanDataSensitifKol({ kolId, isi: {}, olehUserId: userId })).toEqual({ ok: false, kode: "KOSONG" });
  });

  it("kunci server tidak ada: ditolak dengan jelas dan tidak ada yang ditulis", async () => {
    delete process.env.ENCRYPTION_KEY;
    expect(await simpanDataSensitifKol({ kolId, isi: { nik: "3174012345678901" }, olehUserId: userId })).toEqual({ ok: false, kode: "KUNCI_TIDAK_ADA" });
    const k = await baca();
    expect(k.nikEnc).toBeNull();
    expect(k.nikLast4).toBeNull();
    expect(await prisma.auditLog.count({ where: { entityId: kolId, action: "KOL_SENSITIVE_UPDATED" } })).toBe(0);
  });
});

describe("bukaDataSensitifKol", () => {
  it("membuka isi lengkap dan mencatat jejak KOL_SENSITIVE_VIEWED per pembukaan", async () => {
    await simpanDataSensitifKol({ kolId, isi: { bankName: "Mandiri", bankAccount: "9988776655", bankHolder: "Budi", npwp: "01.234.567.8-901.000" }, olehUserId: userId });
    const r = await bukaDataSensitifKol({ kolId, olehUserId: userId, alasan: "bukti potong" });
    expect(r).toEqual({ ok: true, isi: { bankName: "Mandiri", bankAccount: "9988776655", bankHolder: "Budi", nik: null, npwp: "012345678901000" } });
    await bukaDataSensitifKol({ kolId, olehUserId: userId });
    const j = await prisma.auditLog.findMany({ where: { entityId: kolId, action: "KOL_SENSITIVE_VIEWED" } });
    expect(j).toHaveLength(2);
    expect(j.some((x) => x.reason === "bukti potong")).toBe(true);
  });

  it("isi yang diubah di basis data ditolak sebagai rusak", async () => {
    await simpanDataSensitifKol({ kolId, isi: { nik: "3174012345678901" }, olehUserId: userId });
    const k = await baca();
    // Isi kolom NIK dipindah ke kolom NPWP: konteksnya lain → ditolak.
    await prisma.kol.update({ where: { id: kolId }, data: { npwpEnc: k.nikEnc } });
    expect(await bukaDataSensitifKol({ kolId, olehUserId: userId })).toEqual({ ok: false, kode: "DATA_RUSAK" });
  });
});

describe("simpanPajakKol — subjek pajak", () => {
  it("TIDAK_DIPOTONG wajib beralasan; subjek berubah menghitung ulang termin belum dibayar", async () => {
    const c = await prisma.kolBrief.create({ data: { docNo: `${tag}/1`, kolId, fee: 10_000_000, tahap: "DEAL", payStatus: "BELUM" }, select: { id: true } });
    kolabIds.push(c.id);
    await runSerializable((tx) => selaraskanTermin(tx, { kolaborasiId: c.id, olehUserId: userId, sebab: "uji" }));
    const sebelum = await prisma.kolPaymentTerm.findFirstOrThrow({ where: { collabId: c.id } });
    expect(Number(sebelum.pph)).toBe(300_000); // tanpa NPWP: 250.000 × 1,2

    expect(await simpanPajakKol({ kolId, jenisPajak: "TIDAK_DIPOTONG", adaNpwp: false, grossUpBawaan: false, olehUserId: userId })).toEqual({
      ok: false,
      kode: "ALASAN_WAJIB",
    });
    const r = await simpanPajakKol({ kolId, jenisPajak: "BADAN", adaNpwp: true, grossUpBawaan: false, olehUserId: userId });
    expect(r).toMatchObject({ ok: true, berubah: true, dihitungUlang: 1 });
    const sesudah = await prisma.kolPaymentTerm.findFirstOrThrow({ where: { collabId: c.id } });
    expect(sesudah.jenisPajak).toBe("BADAN");
    expect(Number(sesudah.pph)).toBe(200_000);
    expect(await prisma.auditLog.count({ where: { entityId: kolId, action: "KOL_TAX_PROFILE_UPDATED" } })).toBe(1);
  });
});
