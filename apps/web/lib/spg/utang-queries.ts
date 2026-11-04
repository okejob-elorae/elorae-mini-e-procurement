import { prisma, type Prisma } from "@elorae/db";
import { formatDisplayDate } from "@/lib/date-only";
import { keSen } from "./hilang";
import { bagianHilangTerbukaSpg } from "./hilang-db";
import { bebanPadaPembayaran, bebanSpgTerbukaPerOrang, kembaliBebanTerbukaPerOrang } from "./beban-spg-queries";
import { selisihUnitRinci, type UnitKomisiSpg } from "./koreksi";
import { unitKomisiSpg } from "./koreksi-queries";
import { pembayaranAkhir } from "./koreksi-akhir";
import { REF_KOMISI_KONSI, REF_KOMISI_SPG_PUTUS } from "./hilang";
import type { JenisUtangSpg, StatusBayarUtangSpg } from "./utang";

/**
 * Pembaca utang SPG yang sudah berhenti: pengurang yang ikut setiap pembayaran (utang terbuka, beban
 * retur pembeli, pengembalian beban), kartu Komisi SPG #utang, dan angka Beranda.
 */

type Klien = Prisma.TransactionClient | typeof prisma;

const angka = (v: unknown) => Number(v ?? 0);

/** Utang SPG yang masih terbuka, terlama dulu — dipotong penuh di pembayaran mana pun (B22d, B31). */
export async function utangTerbukaSpg(klien: Klien, userId: string): Promise<{ debtId: string; jenis: JenisUtangSpg; storeId: string | null; sisaSen: number }[]> {
  const rows = await klien.spgDebt.findMany({
    where: { spgUserId: userId, status: "TERBUKA" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, kind: true, sourceStoreId: true, amount: true, settledAmount: true },
  });
  return rows
    .map((r) => ({ debtId: r.id, jenis: r.kind as JenisUtangSpg, storeId: r.sourceStoreId, sisaSen: keSen(angka(r.amount)) - keSen(angka(r.settledAmount)) }))
    .filter((r) => r.sisaSen > 0);
}

/**
 * Beban retur pembeli SPG ini yang masih terbuka (P13a), terlama dulu — dari modul beban retur
 * pembeli (`bebanSpgTerbukaPerOrang`), satu pembaca untuk kedua modul.
 */
export async function bebanReturTerbukaSpg(klien: Klien, userId: string): Promise<{ chargeId: string; storeId: string; sisaSen: number }[]> {
  const daftar = (await bebanSpgTerbukaPerOrang(klien, [userId])).get(userId) ?? [];
  return daftar.map((b) => ({ chargeId: b.id, storeId: b.storeId, sisaSen: keSen(b.sisa) })).filter((b) => b.sisaSen > 0);
}

/** Uang beban retur yang dikembalikan ke SPG (barangnya kembali ke stok, P79) dan belum dibayarkan. */
export async function kembaliBebanTerbukaSpg(klien: Klien, userId: string): Promise<{ chargeId: string; storeId: string; sen: number }[]> {
  const daftar = (await kembaliBebanTerbukaPerOrang(klien, [userId])).get(userId) ?? [];
  return daftar.map((k) => ({ chargeId: k.id, storeId: k.storeId, sen: keSen(k.jumlah) })).filter((k) => k.sen > 0);
}

export type KeadaanSesudahAkhir = {
  berhenti: boolean;
  /** Masih ada baris gaji & komisi yang belum dibayar — baris itu yang membawa sisa dan plusnya. */
  adaBarisBelumDibayar: boolean;
  /** Setiap bulan pesertanya sudah ditutup dan dibayar: pembayaran terakhirnya sudah terjadi. */
  akhirDibayar: boolean;
};

/** Keadaan SPG terhadap pembayaran terakhirnya (B29). */
export async function keadaanSesudahAkhir(klien: Klien, userId: string): Promise<KeadaanSesudahAkhir> {
  const u = await klien.user.findUnique({ where: { id: userId }, select: { spgEndedOn: true } });
  if (!u?.spgEndedOn) return { berhenti: false, adaBarisBelumDibayar: false, akhirDibayar: false };
  const [konsi, putus] = await Promise.all([
    klien.consignmentCommission.findFirst({ where: { spgUserId: userId, paidAt: null }, select: { id: true } }),
    klien.spgCommission.findFirst({ where: { userId, paidAt: null }, select: { id: true } }),
  ]);
  if (konsi || putus) return { berhenti: true, adaBarisBelumDibayar: true, akhirDibayar: false };
  // Tanpa baris belum dibayar: pembayaran terakhir terjadi kalau setiap bulan pesertanya ditutup.
  const a = await pembayaranAkhir(klien, { userId, refType: REF_KOMISI_KONSI, refId: "" });
  return { berhenti: true, adaBarisBelumDibayar: false, akhirDibayar: a.akhir };
}

/** Selisih plus dan minus unit SPG (komisi + gaji) sesudah pembayaran terakhirnya. */
export function selisihSesudahAkhir(units: readonly UnitKomisiSpg[]): {
  minus: { sumber: string; jenis: "KONSI" | "PUTUS"; storeId: string; namaToko: string; bulanJual: string; jumlah: number; gaji: number }[];
  plus: { sumber: string; jenis: "KONSI" | "PUTUS"; storeId: string; namaToko: string; bulanJual: string; jumlah: number; gaji: number }[];
} {
  const minus: ReturnType<typeof selisihSesudahAkhir>["minus"] = [];
  const plus: ReturnType<typeof selisihSesudahAkhir>["plus"] = [];
  for (const u of units) {
    const r = selisihUnitRinci(u);
    const negK = r.komisi < 0 ? -r.komisi : 0;
    const negG = r.gaji < 0 ? -r.gaji : 0;
    const posK = r.komisi > 0 ? r.komisi : 0;
    const posG = r.gaji > 0 ? r.gaji : 0;
    const dasar = { sumber: u.kunci, jenis: u.jenis, storeId: u.storeId, namaToko: u.namaToko, bulanJual: u.bulanJual };
    if (negK + negG > 0) minus.push({ ...dasar, jumlah: Math.round((negK + negG) * 100) / 100, gaji: negG });
    if (posK + posG > 0) plus.push({ ...dasar, jumlah: Math.round((posK + posG) * 100) / 100, gaji: posG });
  }
  return { minus, plus };
}

export type BarisUtangSpgKantor = {
  spgUserId: string;
  nama: string;
  toko: string | null;
  berhentiPada: string;
  akhirDibayar: boolean;
  adaBarisBelumDibayar: boolean;
  utang: { id: string; jenis: JenisUtangSpg; sumber: string; jumlah: number; dilunasi: number; sisa: number; lunas: boolean; dibuat: string; catatan: string }[];
  sisaUtang: number;
  belumDicatat: { koreksi: number; hilang: number; beban: number; jumlah: number };
  plusMenunggu: { sumber: string; bulanJual: string; namaToko: string; jumlah: number; gaji: number }[];
  jumlahPlus: number;
  pembayaran: { id: string; jumlah: number; cara: string; tanggal: string; status: StatusBayarUtangSpg; versi: number; pencatat: string; pencatatId: string; catatan: string | null; catatanKembali: string | null }[];
  /** Pembayaran yang masih menunggu cek — mengurangi yang boleh dicatat (MELEBIHI_SISA). */
  menungguCek: number;
};

/** Kartu Komisi SPG #utang: setiap SPG yang sudah berhenti dan punya utang, sisa, plus, atau pembayaran. */
export async function daftarUtangSpgKantor(sekarang: Date = new Date(), cakupan?: { userIds?: string[] }): Promise<BarisUtangSpgKantor[]> {
  const orang = await prisma.user.findMany({
    where: { spgEndedOn: { not: null }, ...(cakupan?.userIds !== undefined ? { id: { in: cakupan.userIds } } : {}) },
    select: { id: true, name: true, email: true, spgEndedOn: true, spgEndedStoreId: true },
  });
  if (orang.length === 0) return [];
  const ids = orang.map((o) => o.id);
  const [utang, bayar, toko, petaUnit, beban] = await Promise.all([
    prisma.spgDebt.findMany({ where: { spgUserId: { in: ids } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    prisma.spgDebtPayment.findMany({ where: { spgUserId: { in: ids } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] }),
    prisma.store.findMany({ where: { id: { in: orang.map((o) => o.spgEndedStoreId).filter((x): x is string => Boolean(x)) } }, select: { id: true, name: true } }),
    unitKomisiSpg(prisma, ids, sekarang),
    bebanSpgTerbukaPerOrang(prisma, ids),
  ]);
  const pencatatIds = [...new Set(bayar.map((b) => b.createdById))];
  const pencatat = pencatatIds.length ? await prisma.user.findMany({ where: { id: { in: pencatatIds } }, select: { id: true, name: true, email: true } }) : [];
  const namaPencatat = new Map(pencatat.map((u) => [u.id, u.name?.trim() || u.email]));
  const namaToko = new Map(toko.map((t) => [t.id, t.name]));
  const hasil: BarisUtangSpgKantor[] = [];
  for (const o of orang) {
    const keadaan = await keadaanSesudahAkhir(prisma, o.id);
    const utangSaya = utang.filter((u) => u.spgUserId === o.id);
    const bayarSaya = bayar.filter((b) => b.spgUserId === o.id);
    const units = petaUnit.get(o.id) ?? [];
    const sesudah = keadaan.akhirDibayar ? selisihSesudahAkhir(units) : { minus: [], plus: [] };
    const hilang = keadaan.akhirDibayar ? await bagianHilangTerbukaSpg(prisma, o.id) : [];
    const bebanRetur = keadaan.akhirDibayar ? (beban.get(o.id) ?? []) : [];
    const belum = {
      koreksi: sesudah.minus.reduce((n, m) => n + m.jumlah, 0),
      hilang: hilang.reduce((n, h) => n + h.sisaSen, 0) / 100,
      beban: bebanRetur.reduce((n, b) => n + b.sisa, 0),
      jumlah: 0,
    };
    belum.jumlah = Math.round((belum.koreksi + belum.hilang + belum.beban) * 100) / 100;
    const daftarUtang = utangSaya.map((u) => {
      const jumlah = angka(u.amount);
      const dilunasi = angka(u.settledAmount);
      return {
        id: u.id,
        jenis: u.kind as JenisUtangSpg,
        sumber: u.sourceKey,
        jumlah,
        dilunasi,
        sisa: Math.round((jumlah - dilunasi) * 100) / 100,
        lunas: u.status === "LUNAS",
        dibuat: formatDisplayDate(u.createdAt),
        catatan: u.note,
      };
    });
    const sisaUtang = Math.round(daftarUtang.reduce((n, u) => n + (u.lunas ? 0 : u.sisa), 0) * 100) / 100;
    if (daftarUtang.length === 0 && belum.jumlah === 0 && sesudah.plus.length === 0 && bayarSaya.length === 0) continue;
    hasil.push({
      spgUserId: o.id,
      nama: o.name?.trim() || o.email,
      toko: o.spgEndedStoreId ? (namaToko.get(o.spgEndedStoreId) ?? null) : null,
      berhentiPada: o.spgEndedOn ?? "",
      akhirDibayar: keadaan.akhirDibayar,
      adaBarisBelumDibayar: keadaan.adaBarisBelumDibayar,
      utang: daftarUtang,
      sisaUtang,
      belumDicatat: belum,
      plusMenunggu: sesudah.plus.map((p) => ({ sumber: p.sumber, bulanJual: p.bulanJual, namaToko: p.namaToko, jumlah: p.jumlah, gaji: p.gaji })),
      jumlahPlus: Math.round(sesudah.plus.reduce((n, p) => n + p.jumlah, 0) * 100) / 100,
      pembayaran: bayarSaya.map((b) => ({
        id: b.id,
        jumlah: angka(b.amount),
        cara: b.method,
        tanggal: b.receivedOn,
        status: b.status as StatusBayarUtangSpg,
        versi: b.version,
        pencatat: namaPencatat.get(b.createdById) ?? b.createdById,
        pencatatId: b.createdById,
        catatan: b.note,
        catatanKembali: b.returnNote,
      })),
      menungguCek: Math.round(bayarSaya.filter((b) => b.status === "MENUNGGU_CEK").reduce((n, b) => n + angka(b.amount), 0) * 100) / 100,
    });
  }
  return hasil.sort((a, b) => a.nama.localeCompare(b.nama));
}

/** Angka Beranda `spgDebtsOpen`: SPG berhenti dengan utang terbuka, sisa yang belum dicatat, atau plus yang belum dibayar. */
export async function jumlahUtangSpgTerbuka(sekarang: Date = new Date(), cakupan?: { userIds?: string[] }): Promise<number> {
  return (await daftarUtangSpgKantor(sekarang, cakupan)).filter((r) => r.sisaUtang > 0 || r.belumDicatat.jumlah > 0 || r.jumlahPlus > 0).length;
}

/** Angka Beranda `spgDebtPaymentsToCheck`: pembayaran utang SPG yang menunggu cek mutasi bank. */
export async function jumlahBayarUtangSpgMenungguCek(cakupan?: { userIds?: string[] }): Promise<number> {
  return prisma.spgDebtPayment.count({ where: { status: "MENUNGGU_CEK", ...(cakupan?.userIds !== undefined ? { spgUserId: { in: cakupan.userIds } } : {}) } });
}

/** Baris gaji & komisi yang dibayar dalam satu pembayaran — untuk jejak; ada di sini supaya pembaca utang tidak perlu penulis. */
export const REF_BARIS_GAJI = [REF_KOMISI_KONSI, REF_KOMISI_SPG_PUTUS] as const;

/**
 * Pengurang selain beban barang hilang yang diambil pada pembayaran yang SUDAH dibayar — beban retur
 * pembeli, utang SPG — dan uang pengembalian beban yang ikut, menurut id barisnya. Untuk menampilkan
 * yang benar-benar diterima pada baris yang sudah dibayar (barisnya hanya menyimpan potongan beban
 * barang hilang di `deduction`).
 */
export async function potonganLainPadaPembayaran(
  klien: Klien,
  refs: ReadonlyArray<{ refType: string; refId: string }>,
): Promise<Map<string, { retur: number; utang: number; kembali: number }>> {
  const hasil = new Map<string, { retur: number; utang: number; kembali: number }>();
  const ids = [...new Set(refs.map((r) => r.refId).filter(Boolean))];
  if (ids.length === 0) return hasil;
  const [beban, lunasan] = await Promise.all([
    bebanPadaPembayaran(klien, refs),
    klien.spgDebtSettlement.findMany({ where: { refId: { in: ids }, kind: "POTONG", voidedAt: null }, select: { refType: true, refId: true, amount: true } }),
  ]);
  const jenis = new Map(refs.map((r) => [r.refId, r.refType]));
  for (const id of ids) hasil.set(id, { retur: 0, utang: 0, kembali: 0 });
  for (const [refId, b] of beban) {
    const h = hasil.get(refId);
    if (!h) continue;
    h.retur = Math.round((h.retur + b.potong.reduce((n, p) => n + p.jumlah, 0)) * 100) / 100;
    h.kembali = Math.round((h.kembali + b.kembali.reduce((n, k) => n + k.jumlah, 0)) * 100) / 100;
  }
  for (const l of lunasan) {
    if (jenis.get(l.refId) !== l.refType) continue;
    const h = hasil.get(l.refId);
    if (h) h.utang = Math.round((h.utang + angka(l.amount)) * 100) / 100;
  }
  return hasil;
}
