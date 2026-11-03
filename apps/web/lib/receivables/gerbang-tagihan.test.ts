import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { buatPiutangManual } from "./manual-writer";
import { simpanImpor, tinjauImpor } from "./impor/writer";
import type { BarisImpor } from "./impor/baris";
import { JEJAK } from "./jejak";

/*
 * Jawaban gerbang bulan siklus pertama yang diantrekan satu tes: tiap panggilan
 * mengambil satu dari antrean, selebihnya lewat penyedia sungguhan (hook
 * `UJI_BULAN_SIKLUS_PERTAMA`). Dengan ini satu tes bisa membuat pratinjau dan
 * transaksi impor membaca pengaturan yang BERBEDA — pengaturan yang disimpan di
 * antara keduanya.
 */
const gerbang = vi.hoisted(() => ({
  antrean: [] as Array<{ diatur: false } | { diatur: true; bulan: string }>,
}));
vi.mock("@/lib/konsinyasi/siklus-pertama", async (importOriginal) => {
  const asli = await importOriginal<typeof import("@/lib/konsinyasi/siklus-pertama")>();
  return {
    ...asli,
    muatBulanSiklusPertama: async (klien: Parameters<typeof asli.muatBulanSiklusPertama>[0]) =>
      gerbang.antrean.length > 0 ? gerbang.antrean.shift()! : asli.muatBulanSiklusPertama(klien),
  };
});

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

/**
 * Utang toko konsinyasi di kertas (P32: "boleh masuk lewat impor Excel / ketik
 * manual") diterima dan ditandai `isConsignment`. Mulai bulan siklus konsinyasi
 * pertama di sistem (P59) bulan itu ditagih siklus, jadi faktur konsi bertanggal
 * pada/sesudah hari pertamanya ditolak. Bulannya diberikan lewat
 * `UJI_BULAN_SIKLUS_PERTAMA` — pengaturan sungguhan di bed bersama tidak disentuh.
 */
describe("Utang toko konsinyasi — P32 + P59", () => {
  const envSiklus = process.env.UJI_BULAN_SIKLUS_PERTAMA;
  let tokoKonsiId = "";

  beforeEach(async () => {
    tokoKonsiId = "";
    process.env.UJI_BULAN_SIKLUS_PERTAMA = "2003-03";
    tokoKonsiId = (
      await prisma.store.create({
        data: { code: `${tag}-K`, name: `${tag} Konsi`, address: "uji", termsType: "KONSI", paymentTempo: 30 },
      })
    ).id;
  });

  afterEach(async () => {
    gerbang.antrean = [];
    if (envSiklus === undefined) delete process.env.UJI_BULAN_SIKLUS_PERTAMA;
    else process.env.UJI_BULAN_SIKLUS_PERTAMA = envSiklus;
    if (tokoKonsiId) {
      const ada = await prisma.receivable.findMany({ where: { storeId: seededId(tokoKonsiId) }, select: { id: true } });
      if (ada.length) await prisma.receivable.deleteMany({ where: { id: { in: seededIds(ada.map((r) => r.id)) } } });
      await prisma.store.delete({ where: { id: tokoKonsiId } });
    }
  });

  const manual = (nomor: string, tanggal: string) => ({
    invoiceNo: `${tag}-${nomor}`,
    storeId: tokoKonsiId,
    invoiceDate: wib(tanggal),
    dueDate: wib("2003-04-30"),
    olehUserId: userId,
    amount: 400_000,
  });

  it("faktur manual toko konsi sebelum bulan siklus pertama masuk dan ditandai konsinyasi", async () => {
    const hasil = await buatPiutangManual(manual("K1", "2003-02-28"));
    expect(hasil.ok).toBe(true);
    if (!hasil.ok) return;
    const r = await prisma.receivable.findUniqueOrThrow({ where: { id: hasil.id }, select: { isConsignment: true } });
    expect(r.isConsignment).toBe(true);
  });

  it("faktur manual toko konsi pada hari pertama bulan siklus pertama ditolak tanpa membuat apa pun", async () => {
    expect(await buatPiutangManual(manual("K2", "2003-03-01"))).toEqual({
      ok: false,
      alasan: "KONSI_SESUDAH_SIKLUS_PERTAMA",
    });
    expect(await prisma.receivable.count({ where: { storeId: tokoKonsiId } })).toBe(0);
  });

  it("gerbang tanggal mulai buku tetap berlaku untuk toko konsi", async () => {
    process.env.UJI_BULAN_SIKLUS_PERTAMA = "2099-01";
    expect(await buatPiutangManual(manual("K3", MULAI))).toEqual({ ok: false, alasan: "SESUDAH_TANGGAL_MULAI" });
  });

  it("impor: baris konsi sebelum bulan pertama masuk bertanda konsi, yang pada/sesudahnya dilewati", async () => {
    const baris = (no: number, nomor: string, tanggal: string): BarisImpor => ({
      baris: no,
      noFaktur: `${tag}-${nomor}`,
      kodeToko: `${tag}-K`,
      namaToko: null,
      tglFaktur: wib(tanggal),
      jatuhTempo: wib("2003-04-30"),
      nilai: 300_000,
      sisaTertulis: 300_000,
      sales: null,
      sisa: 300_000,
      masalah: [],
    });
    const isi = [baris(2, "KLAMA", "2003-02-28"), baris(3, "KBARU", "2003-03-01")];
    const hasil = await simpanImpor(isi, { olehUserId: userId });
    expect(hasil.masuk).toBe(1);
    expect(hasil.dilewati).toEqual([{ baris: 3, noFaktur: `${tag}-KBARU`, alasan: "KONSI_SESUDAH_SIKLUS_PERTAMA" }]);
    const ada = await prisma.receivable.findMany({
      where: { storeId: tokoKonsiId },
      select: { invoiceNo: true, isConsignment: true },
    });
    expect(ada).toEqual([{ invoiceNo: `${tag}-KLAMA`, isConsignment: true }]);
  });

  it("impor: bulan siklus pertama yang tersimpan sesudah pratinjau tetap menolak — gerbangnya dibaca ulang di transaksi", async () => {
    // Bacaan pertama (`muatKonteks`, di luar transaksi): belum diatur. Bacaan kedua
    // (di dalam transaksi simpan): Maret 2003 — disimpan di antara keduanya.
    gerbang.antrean = [{ diatur: false }, { diatur: true, bulan: "2003-03" }];
    const hasil = await simpanImpor(
      [
        {
          baris: 2,
          noFaktur: `${tag}-KSELA`,
          kodeToko: `${tag}-K`,
          namaToko: null,
          tglFaktur: wib("2003-03-05"),
          jatuhTempo: wib("2003-04-30"),
          nilai: 250_000,
          sisaTertulis: 250_000,
          sales: null,
          sisa: 250_000,
          masalah: [],
        },
      ],
      { olehUserId: userId },
    );
    gerbang.antrean = [];
    expect(hasil).toMatchObject({ masuk: 0, ids: [] });
    expect(hasil.dilewati).toEqual([{ baris: 2, noFaktur: `${tag}-KSELA`, alasan: "KONSI_SESUDAH_SIKLUS_PERTAMA" }]);
    expect(await prisma.receivable.count({ where: { storeId: seededId(tokoKonsiId) } })).toBe(0);
    // Impor yang seluruhnya tertolak tidak menulis jejak impor.
    expect(await prisma.auditLog.count({ where: { userId: seededId(userId), action: JEJAK.FAKTUR_IMPOR } })).toBe(0);
  });
});
