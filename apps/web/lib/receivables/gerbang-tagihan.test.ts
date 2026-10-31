import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { buatPiutangManual } from "./manual-writer";
import { simpanImpor, tinjauImpor } from "./impor/writer";
import type { BarisImpor } from "./impor/baris";

/**
 * Pemilik (2026-10-08): penagihan barang ke toko hanya lewat nota tagihan dari
 * pengiriman. Sejak tanggal mulai buku besar, "Faktur manual" dan "Impor
 * faktur" menolak tagihan bertanggal pada/sesudah tanggal itu; tagihan lama
 * (sebelumnya) tetap bisa dipindahkan. Tanggal mulai diberikan lewat
 * `UJI_TANGGAL_MULAI_BUKU` — bed bersama punya tanggal mulai sungguhan.
 */

const MULAI = "2003-05-01";
const wib = (ymd: string) => new Date(`${ymd}T00:00:00+07:00`);
const tag = `GERBANG${Date.now().toString(36).toUpperCase()}`;

let tokoId = "";
let userId = "";
const piutangIds: string[] = [];
const envAsli = process.env.UJI_TANGGAL_MULAI_BUKU;

beforeEach(async () => {
  tokoId = "";
  userId = "";
  piutangIds.length = 0;
  process.env.UJI_TANGGAL_MULAI_BUKU = MULAI;
  tokoId = (
    await prisma.store.create({
      data: { code: `${tag}-P`, name: `${tag} Putus`, address: "uji", termsType: "PUTUS", paymentTempo: 30 },
    })
  ).id;
  userId = (await prisma.user.create({ data: { email: `${tag.toLowerCase()}@uji.test`, name: `${tag} pencatat` } })).id;
});

afterEach(async () => {
  if (envAsli === undefined) delete process.env.UJI_TANGGAL_MULAI_BUKU;
  else process.env.UJI_TANGGAL_MULAI_BUKU = envAsli;
  const sisa = tokoId
    ? await prisma.receivable.findMany({ where: { storeId: seededId(tokoId) }, select: { id: true } })
    : [];
  const semua = [...new Set([...piutangIds, ...sisa.map((r) => r.id)])];
  if (semua.length) {
    await prisma.receivableItem.deleteMany({ where: { receivableId: { in: seededIds(semua) } } });
    await prisma.receivable.deleteMany({ where: { id: { in: seededIds(semua) } } });
  }
  if (userId) await prisma.auditLog.deleteMany({ where: { userId: seededId(userId) } });
  if (userId) await prisma.user.delete({ where: { id: userId } });
  if (tokoId) await prisma.store.delete({ where: { id: tokoId } });
});

describe("Faktur manual", () => {
  const isi = (nomor: string, tanggal: string) => ({
    invoiceNo: `${tag}-${nomor}`,
    storeId: tokoId,
    invoiceDate: wib(tanggal),
    dueDate: wib("2003-06-30"),
    olehUserId: userId,
    amount: 500_000,
  });

  it("menolak tagihan PADA tanggal mulai dan sesudahnya, tanpa membuat apa pun", async () => {
    expect(await buatPiutangManual(isi("A", MULAI))).toEqual({ ok: false, alasan: "SESUDAH_TANGGAL_MULAI" });
    expect(await buatPiutangManual(isi("B", "2003-06-15"))).toEqual({ ok: false, alasan: "SESUDAH_TANGGAL_MULAI" });
    expect(await prisma.receivable.count({ where: { storeId: tokoId } })).toBe(0);
  });

  it("tagihan lama (sebelum tanggal mulai) tetap bisa dicatat — itulah pemindahan saldo awal", async () => {
    const hasil = await buatPiutangManual(isi("C", "2003-04-30"));
    expect(hasil.ok).toBe(true);
    if (hasil.ok) piutangIds.push(hasil.id);
  });

  it("tanpa tanggal mulai buku belum ada yang ditolak", async () => {
    delete process.env.UJI_TANGGAL_MULAI_BUKU;
    const hasil = await buatPiutangManual(isi("D", "2003-06-15"));
    expect(hasil.ok).toBe(true);
    if (hasil.ok) piutangIds.push(hasil.id);
  });
});

describe("Impor faktur", () => {
  const baris = (no: number, nomor: string, tanggal: string): BarisImpor => ({
    baris: no,
    noFaktur: `${tag}-${nomor}`,
    kodeToko: `${tag}-P`,
    namaToko: null,
    tglFaktur: wib(tanggal),
    jatuhTempo: wib("2003-06-30"),
    nilai: 300_000,
    sisaTertulis: 300_000,
    sales: null,
    sisa: 300_000,
    masalah: [],
  });

  it("tinjauan dan simpan melewati baris pada/sesudah tanggal mulai dengan alasannya, baris lama tetap masuk", async () => {
    const isi = [baris(2, "LAMA", "2003-04-28"), baris(3, "BARU", MULAI)];

    const tinjau = await tinjauImpor(isi);
    expect(tinjau.siap).toBe(1);
    expect(tinjau.akanDilewati).toEqual([{ baris: 3, noFaktur: `${tag}-BARU`, alasan: "SESUDAH_TANGGAL_MULAI" }]);

    const hasil = await simpanImpor(isi, { olehUserId: userId });
    piutangIds.push(...(hasil.ids ?? []));
    expect(hasil.masuk).toBe(1);
    expect(hasil.dilewati).toEqual([{ baris: 3, noFaktur: `${tag}-BARU`, alasan: "SESUDAH_TANGGAL_MULAI" }]);
    const ada = await prisma.receivable.findMany({ where: { storeId: tokoId }, select: { invoiceNo: true } });
    expect(ada.map((r) => r.invoiceNo)).toEqual([`${tag}-LAMA`]);
  });

  it("baris tanpa tanggal faktur dinilai dari jatuh temponya (tanggal yang dipakai sebagai tanggal faktur)", async () => {
    const tanpaTanggal: BarisImpor = { ...baris(4, "TEMPO", "2003-04-01"), tglFaktur: null, jatuhTempo: wib("2003-05-20") };
    const tinjau = await tinjauImpor([tanpaTanggal]);
    expect(tinjau.akanDilewati[0]?.alasan).toBe("SESUDAH_TANGGAL_MULAI");
  });
});
