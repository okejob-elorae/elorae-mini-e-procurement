import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { runSerializable } from "@/lib/db/tx-retry";
import { hariIniWib } from "@/lib/tanggal-isian";
import { bacaTarifPajakKreatif } from "./pajak-pengaturan";
import { hitungDariNeto, hitungPph, type TarifPajakKreatif } from "./pph";
import {
  aturTermin,
  bayarTermin,
  batalkanBayarTermin,
  catatBuktiPotong,
  catatSetorPph,
  periksaFeeBaru,
  selaraskanTermin,
  ubahModePajak,
} from "./termin-writer";

/*
 * Penulis termin pembayaran KOL terhadap basis data sungguhan: termin bawaan,
 * pecah termin, bayar (terkunci sesudahnya, balapan dua pembayar), batal
 * bayar (jejak + alasan), keadaan bayar kolaborasi yang diturunkan, gross-up,
 * dan penolakan setor/bukti potong.
 */

const tag = `TERMINUJI-${Math.random().toString(36).slice(2, 7)}`;
let userId = "";
let kolId = "";
let kolabIds: string[] = [];
let tarif: TarifPajakKreatif;

async function kolaborasi(akhiran: string, data: { fee: number; tahap?: "DEAL" | "TAYANG"; liveAt?: Date | null }) {
  const c = await prisma.kolBrief.create({
    data: {
      docNo: `${tag}/${akhiran}`,
      kolId,
      fee: data.fee,
      tahap: data.tahap ?? "DEAL",
      dealAt: new Date(),
      liveAt: data.liveAt ?? (data.tahap === "TAYANG" ? new Date() : null),
      payStatus: data.fee > 0 ? "BELUM" : "TIDAK_PERLU",
    },
    select: { id: true },
  });
  kolabIds.push(c.id);
  return c.id;
}

const selaras = (id: string) => runSerializable((tx) => selaraskanTermin(tx, { kolaborasiId: id, olehUserId: userId, sebab: "tes" }));
const termin = (id: string) => prisma.kolPaymentTerm.findMany({ where: { collabId: id }, orderBy: { urutan: "asc" } });
const baca = (id: string) => prisma.kolBrief.findUniqueOrThrow({ where: { id } });
const jejak = (id: string, action: string) => prisma.auditLog.findMany({ where: { entityId: id, action }, orderBy: { createdAt: "asc" } });
const OP_TANPA_NPWP = { jenis: "ORANG_PRIBADI" as const, adaNpwp: false };

beforeEach(async () => {
  userId = "";
  kolId = "";
  kolabIds = [];
  userId = (await prisma.user.findFirstOrThrow({ select: { id: true } })).id;
  kolId = (await prisma.kol.create({ data: { name: `${tag} KOL` }, select: { id: true } })).id;
  tarif = await bacaTarifPajakKreatif();
});

afterEach(async () => {
  await prisma.auditLog.deleteMany({ where: { entityId: { in: seededIds([...kolabIds, kolId].filter(Boolean)) } } });
  await prisma.kolPaymentTerm.deleteMany({ where: { collabId: { in: seededIds(kolabIds) } } });
  await prisma.kolBrief.deleteMany({ where: { id: { in: seededIds(kolabIds) } } });
  if (kolId) await prisma.kol.delete({ where: { id: seededId(kolId) } });
});

describe("selaraskanTermin — termin bawaan", () => {
  it("kolaborasi berbayar mendapat satu Pelunasan 100% sesudah tayang dengan PPh dihitung", async () => {
    const id = await kolaborasi("bawaan", { fee: 10_000_000 });
    const r = await selaras(id);
    expect(r).toMatchObject({ ok: true });
    const t = await termin(id);
    expect(t).toHaveLength(1);
    const harap = hitungPph(10_000_000, OP_TANPA_NPWP, tarif);
    expect(t[0]).toMatchObject({ label: "Pelunasan", pemicu: "TAYANG", status: "BELUM", hariSesudah: 14, grossUp: false, jenisPajak: "ORANG_PRIBADI" });
    expect(Number(t[0].bruto)).toBe(10_000_000);
    expect(Number(t[0].pph)).toBe(harap.pph);
    expect(Number(t[0].neto)).toBe(harap.neto);
    expect(t[0].tarifInfo).toContain('"pasal":"21"');
    expect(t[0].jatuhTempo).toBeNull(); // belum tayang
    expect((await baca(id)).payStatus).toBe("BELUM");
  });

  it("fee nol: termin belum dibayar dibuang, keadaan TIDAK_PERLU", async () => {
    const id = await kolaborasi("nol", { fee: 1_000_000 });
    await selaras(id);
    await prisma.kolBrief.update({ where: { id }, data: { fee: 0 } });
    await selaras(id);
    expect(await termin(id)).toHaveLength(0);
    expect((await baca(id)).payStatus).toBe("TIDAK_PERLU");
  });
});

describe("aturTermin — pecah dan ubah", () => {
  it("DP 50% deal + Pelunasan 50% tayang, jumlahnya persis fee, jejak tercatat", async () => {
    const id = await kolaborasi("dp", { fee: 9_999_999 });
    await selaras(id);
    const r = await aturTermin({
      kolaborasiId: id,
      dasar: "PERSEN",
      rencana: [
        { label: "DP", persen: 50, pemicu: "DEAL" },
        { label: "Pelunasan", persen: 50, pemicu: "TAYANG", hariSesudah: 14 },
      ],
      olehUserId: userId,
    });
    expect(r).toMatchObject({ ok: true, berubah: true });
    const t = await termin(id);
    expect(t.map((x) => x.label)).toEqual(["DP", "Pelunasan"]);
    expect(t.reduce((s, x) => s + Number(x.bruto), 0)).toBe(9_999_999);
    expect(formatDateOnlyJakarta(t[0].jatuhTempo!)).toBe(hariIniWib()); // deal hari ini + 0
    expect(await jejak(id, "KOL_PAYMENT_TERMS_SET")).toHaveLength(1);
  });

  it("menolak total persen yang bukan 100", async () => {
    const id = await kolaborasi("salah", { fee: 1_000_000 });
    await selaras(id);
    expect(await aturTermin({ kolaborasiId: id, dasar: "PERSEN", rencana: [{ label: "A", persen: 40, pemicu: "DEAL" }], olehUserId: userId })).toEqual({
      ok: false,
      kode: "TOTAL_PERSEN",
    });
  });
});

describe("bayarTermin / batalkanBayarTermin", () => {
  async function siapDp(akhiran: string, fee = 10_000_000) {
    const id = await kolaborasi(akhiran, { fee });
    await selaras(id);
    await aturTermin({
      kolaborasiId: id,
      dasar: "PERSEN",
      rencana: [
        { label: "DP", persen: 50, pemicu: "DEAL" },
        { label: "Pelunasan", persen: 50, pemicu: "TAYANG", hariSesudah: 14 },
      ],
      olehUserId: userId,
    });
    return { id, t: await termin(id) };
  }

  it("bayar satu termin → SEBAGIAN, termin terkunci, jejak; membayar lagi ditolak", async () => {
    const { id, t } = await siapDp("bayar");
    const r = await bayarTermin({ terminId: t[0].id, tanggal: "2026-10-01", nomorBuktiPotong: " BP-001 ", olehUserId: userId });
    expect(r).toMatchObject({ ok: true, kolaborasiId: id, payStatus: "SEBAGIAN", tahap: null });
    const b = await baca(id);
    expect(b.payStatus).toBe("SEBAGIAN");
    expect(Number(b.paidAmount)).toBe(5_000_000);
    expect(formatDateOnlyJakarta(b.paidAt!)).toBe("2026-10-01");
    const dibayar = (await termin(id))[0];
    expect(dibayar).toMatchObject({ status: "DIBAYAR", bayarKe: 1, nomorBuktiPotong: "BP-001", dibayarOlehId: userId });
    expect(await jejak(id, "KOL_PAYMENT_TERM_PAID")).toHaveLength(1);

    expect(await bayarTermin({ terminId: t[0].id, tanggal: "2026-10-02", olehUserId: userId })).toEqual({ ok: false, kode: "SUDAH_DIBAYAR" });

    // Rencana baru hanya membagi sisa — termin yang dibayar tidak tersentuh.
    const r2 = await aturTermin({ kolaborasiId: id, dasar: "PERSEN", rencana: [{ label: "Sisa", persen: 100, pemicu: "TAYANG" }], olehUserId: userId });
    expect(r2).toMatchObject({ ok: true });
    const t2 = await termin(id);
    expect(t2.map((x) => [x.label, x.status, Number(x.bruto)])).toEqual([
      ["DP", "DIBAYAR", 5_000_000],
      ["Sisa", "BELUM", 5_000_000],
    ]);
  });

  it("dua pembayar serentak pada termin yang sama: tepat satu berhasil", async () => {
    const { id, t } = await siapDp("balapan");
    const hasil = await Promise.all([
      bayarTermin({ terminId: t[0].id, tanggal: "2026-10-01", olehUserId: userId }),
      bayarTermin({ terminId: t[0].id, tanggal: "2026-10-02", olehUserId: userId }),
    ]);
    expect(hasil.filter((h) => h.ok)).toHaveLength(1);
    expect(hasil.filter((h) => !h.ok)).toEqual([{ ok: false, kode: "SUDAH_DIBAYAR" }]);
    expect((await termin(id))[0].bayarKe).toBe(1);
    expect(await jejak(id, "KOL_PAYMENT_TERM_PAID")).toHaveLength(1);
    expect(Number((await baca(id)).paidAmount)).toBe(5_000_000);
  });

  it("tanggal di depan ditolak; tanggal rusak ditolak", async () => {
    const { t } = await siapDp("depan");
    expect(await bayarTermin({ terminId: t[0].id, tanggal: "2999-01-01", olehUserId: userId })).toEqual({ ok: false, kode: "TANGGAL_DEPAN" });
    expect(await bayarTermin({ terminId: t[0].id, tanggal: "kemarin", olehUserId: userId })).toEqual({ ok: false, kode: "TANGGAL_TIDAK_VALID" });
  });

  it("batal bayar: alasan wajib, kembali BELUM, bayarKe tetap (untuk jurnal pembalik), jejak beralasan", async () => {
    const { id, t } = await siapDp("batal");
    await bayarTermin({ terminId: t[0].id, tanggal: "2026-10-01", olehUserId: userId });
    expect(await batalkanBayarTermin({ terminId: t[0].id, alasan: " ", olehUserId: userId })).toEqual({ ok: false, kode: "ALASAN_WAJIB" });
    const r = await batalkanBayarTermin({ terminId: t[0].id, alasan: "Salah transfer", olehUserId: userId });
    expect(r).toMatchObject({ ok: true, payStatus: "BELUM" });
    const x = (await termin(id))[0];
    expect(x).toMatchObject({ status: "BELUM", bayarKe: 1, dibayarAt: null });
    const j = await jejak(id, "KOL_PAYMENT_TERM_PAYMENT_CANCELLED");
    expect(j).toHaveLength(1);
    expect(j[0].reason).toBe("Salah transfer");
    expect(await batalkanBayarTermin({ terminId: t[0].id, alasan: "lagi", olehUserId: userId })).toEqual({ ok: false, kode: "BELUM_DIBAYAR" });
    // Dibayar lagi → instans kedua.
    await bayarTermin({ terminId: t[0].id, tanggal: "2026-10-03", olehUserId: userId });
    expect((await termin(id))[0].bayarKe).toBe(2);
  });

  it("PPh yang sudah disetor mengunci pembatalan; bukti potong hanya untuk termin dibayar ber-PPh", async () => {
    const { t } = await siapDp("setor");
    expect(await catatBuktiPotong({ terminId: t[0].id, nomor: "BP-1", olehUserId: userId })).toEqual({ ok: false, kode: "BELUM_DIBAYAR" });
    await bayarTermin({ terminId: t[0].id, tanggal: "2026-10-01", olehUserId: userId });
    expect(await catatBuktiPotong({ terminId: t[0].id, nomor: "BP-1", tanggal: "2026-10-02", olehUserId: userId })).toMatchObject({ ok: true });
    expect(await catatSetorPph({ terminId: t[0].id, setor: { tanggal: "2026-10-05", ntpn: "NTPN123" }, olehUserId: userId })).toMatchObject({ ok: true });
    expect(await batalkanBayarTermin({ terminId: t[0].id, alasan: "x", olehUserId: userId })).toEqual({ ok: false, kode: "SUDAH_DISETOR" });
    await catatSetorPph({ terminId: t[0].id, setor: null, olehUserId: userId });
    expect(await batalkanBayarTermin({ terminId: t[0].id, alasan: "x", olehUserId: userId })).toMatchObject({ ok: true });
  });

  it("melunasi semua termin sesudah tayang memajukan tahap ke DIBAYAR", async () => {
    const id = await kolaborasi("lunas", { fee: 2_000_000, tahap: "TAYANG" });
    await selaras(id);
    const [t] = await termin(id);
    const r = await bayarTermin({ terminId: t.id, tanggal: hariIniWib(), olehUserId: userId });
    expect(r).toMatchObject({ ok: true, payStatus: "LUNAS", tahap: { dari: "TAYANG", ke: "DIBAYAR" } });
    expect((await baca(id)).tahap).toBe("DIBAYAR");
  });

  it("fee baru di bawah yang sudah dibayar ditolak", async () => {
    const { id, t } = await siapDp("fee");
    await bayarTermin({ terminId: t[0].id, tanggal: "2026-10-01", olehUserId: userId });
    expect(await runSerializable((tx) => periksaFeeBaru(tx, id, 4_000_000))).toEqual({ ok: false, dibayar: 5_000_000 });
    expect(await runSerializable((tx) => periksaFeeBaru(tx, id, 6_000_000))).toEqual({ ok: true });
    // Fee naik: sisa dibagi ulang ke termin yang belum dibayar.
    await prisma.kolBrief.update({ where: { id }, data: { fee: 12_000_000 } });
    await selaras(id);
    const sesudah = await termin(id);
    expect(sesudah.map((x) => [x.status, Number(x.bruto)])).toEqual([
      ["DIBAYAR", 5_000_000],
      ["BELUM", 7_000_000],
    ]);
  });
});

describe("ubahModePajak — gross-up", () => {
  it("GROSS_UP: jumlah termin = neto yang diterima KOL, bruto dicari; kembali DIPOTONG menghitung ulang", async () => {
    const id = await kolaborasi("gross", { fee: 9_700_000 });
    await selaras(id);
    const r = await ubahModePajak({ kolaborasiId: id, mode: "GROSS_UP", olehUserId: userId });
    expect(r).toMatchObject({ ok: true, berubah: true });
    const [t] = await termin(id);
    const harap = hitungDariNeto(9_700_000, OP_TANPA_NPWP, tarif);
    expect(t.grossUp).toBe(true);
    expect(Number(t.neto)).toBe(harap.neto);
    expect(Number(t.bruto)).toBe(harap.bruto);
    expect(Number(t.neto)).toBeGreaterThanOrEqual(9_700_000);
    expect(await jejak(id, "KOL_COLLAB_TAX_MODE_CHANGED")).toHaveLength(1);

    await ubahModePajak({ kolaborasiId: id, mode: "DIPOTONG", olehUserId: userId });
    const [t2] = await termin(id);
    expect(t2.grossUp).toBe(false);
    expect(Number(t2.bruto)).toBe(9_700_000);
    expect(await ubahModePajak({ kolaborasiId: id, mode: "LAIN", olehUserId: userId })).toEqual({ ok: false, kode: "MODE_TIDAK_VALID" });
  });

  it("KOL dengan gross-up bawaan: kolaborasi berbayar barunya langsung GROSS_UP", async () => {
    await prisma.kol.update({ where: { id: kolId }, data: { grossUpBawaan: true } });
    const id = await kolaborasi("bawaan-gu", { fee: 1_000_000 });
    await selaras(id);
    expect((await baca(id)).modePajak).toBe("GROSS_UP");
    expect((await termin(id))[0].grossUp).toBe(true);
  });
});
