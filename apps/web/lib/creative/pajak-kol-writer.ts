import { prisma, type Prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { catatJejak, JEJAK } from "@/lib/receivables/jejak";
import {
  dataPajakLengkap,
  DataSensitifRusak,
  dekripsi,
  empatTerakhir,
  enkripsi,
  KunciEnkripsiTidakAda,
  konteksKol,
  kunciTersedia,
  rapikanSensitif,
  SEMUA_KOLOM_SENSITIF,
  type KodeTolakSensitif,
  type KolomSensitif,
} from "./data-sensitif";
import { SEMUA_JENIS_PAJAK, type JenisPajak } from "./pph";
import { hitungUlangTerminBelumDibayar } from "./termin-writer";

/**
 * Data pajak & rekening KOL — KHUSUS SERVER.
 *
 * - Subjek pajak (jenis, alasan tidak dipotong, ada NPWP, gross-up bawaan):
 *   diubah pengelola Kreatif; termin belum dibayar KOL itu dihitung ulang
 *   sesudah commit.
 * - Rekening/NIK/NPWP: TULIS-SAJA untuk pengelola Kreatif — nilai lama tidak
 *   pernah dikirim ke layar mereka. Disimpan terenkripsi (`data-sensitif.ts`);
 *   jejaknya hanya mencatat KOLOM mana yang diubah, tanpa nilai.
 * - Membuka isi lengkap: aksi keuangan (izin + PIN diperiksa aksinya), setiap
 *   pembukaan menulis jejak `KOL_SENSITIVE_VIEWED`.
 */

const KOLOM_ENC: Record<KolomSensitif, "bankNameEnc" | "bankAccountEnc" | "bankHolderEnc" | "nikEnc" | "npwpEnc"> = {
  bankName: "bankNameEnc",
  bankAccount: "bankAccountEnc",
  bankHolder: "bankHolderEnc",
  nik: "nikEnc",
  npwp: "npwpEnc",
};

export type KodeGagalPajakKol =
  | KodeTolakSensitif
  | "TIDAK_DITEMUKAN"
  | "JENIS_TIDAK_VALID"
  | "ALASAN_WAJIB"
  | "TERLALU_PANJANG"
  | "KUNCI_TIDAK_ADA"
  | "DATA_RUSAK"
  | "KOSONG";

export type HasilPajakKol<T = Record<never, never>> = ({ ok: true } & T) | { ok: false; kode: KodeGagalPajakKol; kolom?: KolomSensitif };

const adaIsi = (v: string | null | undefined) => Boolean(v && v.trim());

/** Ubah subjek pajak KOL. */
export async function simpanPajakKol(input: {
  kolId: string;
  jenisPajak: string;
  alasanTidakDipotong?: string | null;
  adaNpwp: boolean;
  grossUpBawaan: boolean;
  olehUserId: string;
}): Promise<HasilPajakKol<{ berubah: boolean; dihitungUlang: number }>> {
  if (!(SEMUA_JENIS_PAJAK as readonly string[]).includes(input.jenisPajak)) return { ok: false, kode: "JENIS_TIDAK_VALID" };
  const jenis = input.jenisPajak as JenisPajak;
  const alasan = input.alasanTidakDipotong?.trim() || null;
  if (jenis === "TIDAK_DIPOTONG" && !alasan) return { ok: false, kode: "ALASAN_WAJIB" };
  if (alasan && alasan.length > 1000) return { ok: false, kode: "TERLALU_PANJANG" };

  const hasil = await runSerializable(async (tx): Promise<HasilPajakKol<{ berubah: boolean; subjekBerubah: boolean }>> => {
    const k = await tx.kol.findUnique({
      where: { id: input.kolId },
      select: {
        id: true,
        name: true,
        jenisPajak: true,
        alasanTidakDipotong: true,
        adaNpwp: true,
        grossUpBawaan: true,
        bankNameEnc: true,
        bankAccountEnc: true,
        bankHolderEnc: true,
        nikEnc: true,
        npwpEnc: true,
      },
    });
    if (!k) return { ok: false, kode: "TIDAK_DITEMUKAN" };
    const sebelum = { jenisPajak: k.jenisPajak, alasanTidakDipotong: k.alasanTidakDipotong, adaNpwp: k.adaNpwp, grossUpBawaan: k.grossUpBawaan };
    const sesudah = {
      jenisPajak: jenis,
      alasanTidakDipotong: jenis === "TIDAK_DIPOTONG" ? alasan : null,
      adaNpwp: Boolean(input.adaNpwp),
      grossUpBawaan: Boolean(input.grossUpBawaan),
    };
    if (JSON.stringify(sebelum) === JSON.stringify(sesudah)) return { ok: true, berubah: false, subjekBerubah: false };
    const lengkap = dataPajakLengkap(jenis, {
      bankName: adaIsi(k.bankNameEnc),
      bankAccount: adaIsi(k.bankAccountEnc),
      bankHolder: adaIsi(k.bankHolderEnc),
      nik: adaIsi(k.nikEnc),
      npwp: adaIsi(k.npwpEnc),
    });
    await tx.kol.update({ where: { id: k.id }, data: { ...sesudah, dataPajakLengkap: lengkap } });
    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.PAJAK_KOL_DIUBAH,
      entityType: "Kol",
      entityId: k.id,
      changes: { before: sebelum, after: sesudah },
      metadata: { kol: k.name },
    });
    return { ok: true, berubah: true, subjekBerubah: sebelum.jenisPajak !== sesudah.jenisPajak || sebelum.adaNpwp !== sesudah.adaNpwp };
  });
  if (!hasil.ok) return hasil;
  // Subjek berubah → PPh termin belum dibayar KOL ini ikut berubah.
  const dihitungUlang = hasil.subjekBerubah
    ? await hitungUlangTerminBelumDibayar({ olehUserId: input.olehUserId, sebab: "Data pajak KOL diubah", kolId: input.kolId })
    : 0;
  return { ok: true, berubah: hasil.berubah, dihitungUlang };
}

/**
 * Tulis rekening/NIK/NPWP. Kolom yang tidak dikirim (`undefined`) tidak
 * disentuh; `null` atau teks kosong menghapusnya. Kunci server tidak ada →
 * ditolak SEBELUM apa pun ditulis.
 */
export async function simpanDataSensitifKol(input: {
  kolId: string;
  isi: Partial<Record<KolomSensitif, string | null>>;
  olehUserId: string;
}): Promise<HasilPajakKol<{ diubah: KolomSensitif[]; lengkap: boolean }>> {
  const r = rapikanIsiSensitif(input.isi);
  if (!r.ok) return r;
  return runSerializable((tx) => simpanDataSensitifKolDiTx(tx, { kolId: input.kolId, rapi: r.rapi, olehUserId: input.olehUserId }));
}

/**
 * Periksa dan rapikan isian rekening/NIK/NPWP (di luar transaksi). Kolom `undefined` tidak disentuh;
 * `null`/kosong berarti hapus. Mengisi butuh kunci enkripsi.
 */
export function rapikanIsiSensitif(
  isi: Partial<Record<KolomSensitif, string | null>>,
): { ok: true; rapi: Partial<Record<KolomSensitif, string | null>> } | { ok: false; kode: KodeGagalPajakKol; kolom?: KolomSensitif } {
  const kolom = SEMUA_KOLOM_SENSITIF.filter((k) => isi[k] !== undefined);
  if (kolom.length === 0) return { ok: false, kode: "KOSONG" };
  const rapi: Partial<Record<KolomSensitif, string | null>> = {};
  for (const k of kolom) {
    const v = isi[k];
    if (v === null || v === undefined || !v.trim()) {
      rapi[k] = null;
      continue;
    }
    const r = rapikanSensitif(k, v);
    if (!r.ok) return { ok: false, kode: r.kode, kolom: k };
    rapi[k] = r.nilai;
  }
  if (kolom.some((k) => rapi[k] !== null) && !kunciTersedia()) return { ok: false, kode: "KUNCI_TIDAK_ADA" };
  return { ok: true, rapi };
}

/**
 * Tulis rekening/NIK/NPWP yang sudah dirapikan (`rapikanIsiSensitif`) di transaksi pemanggil —
 * dipakai juga formulir data KOL (`sumber: "FORMULIR_KOL"`, jejak ikut transaksi pengirimannya).
 */
export async function simpanDataSensitifKolDiTx(
  tx: Prisma.TransactionClient,
  input: { kolId: string; rapi: Partial<Record<KolomSensitif, string | null>>; olehUserId: string; sumber?: string },
): Promise<HasilPajakKol<{ diubah: KolomSensitif[]; lengkap: boolean }>> {
  const rapi = input.rapi;
  const kolom = SEMUA_KOLOM_SENSITIF.filter((k) => rapi[k] !== undefined);
  const k = await tx.kol.findUnique({
    where: { id: input.kolId },
    select: { id: true, name: true, jenisPajak: true, bankNameEnc: true, bankAccountEnc: true, bankHolderEnc: true, nikEnc: true, npwpEnc: true },
  });
  if (!k) return { ok: false, kode: "TIDAK_DITEMUKAN" };
  const data: Record<string, string | null> = {};
  try {
    for (const kol of kolom) {
      const nilai = rapi[kol];
      data[KOLOM_ENC[kol]] = nilai === null || nilai === undefined ? null : enkripsi(nilai, konteksKol(k.id, kol));
    }
  } catch (e) {
    if (e instanceof KunciEnkripsiTidakAda) return { ok: false, kode: "KUNCI_TIDAK_ADA" };
    throw e;
  }
  if (rapi.bankAccount !== undefined) data.bankLast4 = rapi.bankAccount ? empatTerakhir(rapi.bankAccount) : null;
  if (rapi.nik !== undefined) data.nikLast4 = rapi.nik ? empatTerakhir(rapi.nik) : null;
  const ada = (kol: KolomSensitif) => (KOLOM_ENC[kol] in data ? data[KOLOM_ENC[kol]] !== null : adaIsi(k[KOLOM_ENC[kol]]));
  const lengkap = dataPajakLengkap(k.jenisPajak, {
    bankName: ada("bankName"),
    bankAccount: ada("bankAccount"),
    bankHolder: ada("bankHolder"),
    nik: ada("nik"),
    npwp: ada("npwp"),
  });
  await tx.kol.update({ where: { id: k.id }, data: { ...data, dataPajakLengkap: lengkap } });
  await catatJejak(tx, {
    userId: input.olehUserId,
    action: JEJAK.DATA_SENSITIF_KOL_DIUBAH,
    entityType: "Kol",
    entityId: k.id,
    // TANPA nilai — hanya kolom yang diisi/dihapus.
    changes: { after: { diisi: kolom.filter((x) => rapi[x] !== null), dihapus: kolom.filter((x) => rapi[x] === null) } },
    metadata: { kol: k.name, ...(input.sumber ? { sumber: input.sumber } : {}) },
  });
  return { ok: true, diubah: kolom, lengkap };
}

export type IsiSensitifKol = Record<KolomSensitif, string | null>;

/**
 * Buka isi lengkap rekening/NIK/NPWP satu KOL dan catat jejak
 * `KOL_SENSITIVE_VIEWED` — pemanggil (aksi) sudah memeriksa izin keuangan dan
 * PIN. `alasan` opsional ikut dicatat.
 */
export async function bukaDataSensitifKol(input: { kolId: string; olehUserId: string; alasan?: string | null }): Promise<HasilPajakKol<{ isi: IsiSensitifKol }>> {
  const k = await prisma.kol.findUnique({
    where: { id: input.kolId },
    select: { id: true, name: true, bankNameEnc: true, bankAccountEnc: true, bankHolderEnc: true, nikEnc: true, npwpEnc: true },
  });
  if (!k) return { ok: false, kode: "TIDAK_DITEMUKAN" };
  const isi = {} as IsiSensitifKol;
  try {
    for (const kol of SEMUA_KOLOM_SENSITIF) {
      const v = k[KOLOM_ENC[kol]];
      isi[kol] = v ? dekripsi(v, konteksKol(k.id, kol)) : null;
    }
  } catch (e) {
    if (e instanceof KunciEnkripsiTidakAda) return { ok: false, kode: "KUNCI_TIDAK_ADA" };
    if (e instanceof DataSensitifRusak) return { ok: false, kode: "DATA_RUSAK" };
    throw e;
  }
  await prisma.$transaction(async (tx) => {
    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.DATA_SENSITIF_KOL_DIBUKA,
      entityType: "Kol",
      entityId: k.id,
      metadata: { kol: k.name, kolom: SEMUA_KOLOM_SENSITIF.filter((x) => isi[x] !== null) },
      reason: input.alasan?.trim() || null,
    });
  });
  return { ok: true, isi };
}
