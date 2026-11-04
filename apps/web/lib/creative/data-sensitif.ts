import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * Enkripsi data sensitif KOL (rekening, NIK, NPWP) — KHUSUS SERVER.
 *
 * AES-256-GCM dengan kunci SERVER yang diturunkan (HKDF-SHA256) dari
 * `process.env.ENCRYPTION_KEY`. Sengaja TIDAK memakai `lib/encryption.ts`
 * (`encryptBankAccount`), yang menurunkan kunci dari PIN satu pengguna — data
 * KOL harus bisa dibuka beberapa orang keuangan, masing-masing dengan PIN-nya
 * sendiri sebagai pintu, bukan sebagai kunci.
 *
 * Bentuk tersimpan: `v1:<base64url(iv 12 | tag 16 | ciphertext)>`. Data
 * tambahan terautentikasi (AAD) = `konteks` (mis. `kol:<id>:nik`), jadi isi
 * yang dipindah ke baris atau kolom lain ditolak saat dibuka, sama seperti isi
 * yang diubah satu bit pun.
 *
 * Kunci tidak ada → MENOLAK dengan jelas (`KunciEnkripsiTidakAda`); tidak
 * pernah menyimpan teks asli sebagai cadangan.
 */

const VERSI = "v1";
const PANJANG_IV = 12;
const PANJANG_TAG = 16;
const INFO_HKDF = "elorae/kol-data-sensitif/v1";
const GARAM_HKDF = "elorae-kol";
export const PANJANG_KUNCI_MIN = 16;

export class KunciEnkripsiTidakAda extends Error {
  constructor() {
    super("ENCRYPTION_KEY belum diisi (minimal 16 karakter) — data sensitif tidak bisa disimpan atau dibuka.");
    this.name = "KunciEnkripsiTidakAda";
  }
}

export class DataSensitifRusak extends Error {
  constructor() {
    super("Data sensitif tidak bisa dibuka: isinya rusak, diubah, atau bukan milik baris/kolom ini.");
    this.name = "DataSensitifRusak";
  }
}

function bahanKunci(): string | null {
  const k = process.env.ENCRYPTION_KEY ?? "";
  return k.length >= PANJANG_KUNCI_MIN ? k : null;
}

export function kunciTersedia(): boolean {
  return bahanKunci() !== null;
}

function kunci(): Buffer {
  const bahan = bahanKunci();
  if (!bahan) throw new KunciEnkripsiTidakAda();
  return Buffer.from(hkdfSync("sha256", bahan, GARAM_HKDF, INFO_HKDF, 32));
}

/** Enkripsi `teks` untuk `konteks` (`kol:<id>:<kolom>`). */
export function enkripsi(teks: string, konteks: string): string {
  const k = kunci();
  const iv = randomBytes(PANJANG_IV);
  const c = createCipheriv("aes-256-gcm", k, iv);
  c.setAAD(Buffer.from(konteks, "utf8"));
  const isi = Buffer.concat([c.update(teks, "utf8"), c.final()]);
  return `${VERSI}:${Buffer.concat([iv, c.getAuthTag(), isi]).toString("base64url")}`;
}

/** Buka isi terenkripsi; melempar `DataSensitifRusak` bila diubah atau konteksnya lain. */
export function dekripsi(tersimpan: string, konteks: string): string {
  const k = kunci();
  const [versi, badan] = tersimpan.split(":", 2);
  if (versi !== VERSI || !badan) throw new DataSensitifRusak();
  const buf = Buffer.from(badan, "base64url");
  if (buf.length < PANJANG_IV + PANJANG_TAG) throw new DataSensitifRusak();
  try {
    const d = createDecipheriv("aes-256-gcm", k, buf.subarray(0, PANJANG_IV));
    d.setAAD(Buffer.from(konteks, "utf8"));
    d.setAuthTag(buf.subarray(PANJANG_IV, PANJANG_IV + PANJANG_TAG));
    return Buffer.concat([d.update(buf.subarray(PANJANG_IV + PANJANG_TAG)), d.final()]).toString("utf8");
  } catch {
    throw new DataSensitifRusak();
  }
}

export type KolomSensitif = "bankName" | "bankAccount" | "bankHolder" | "nik" | "npwp";
export const SEMUA_KOLOM_SENSITIF: readonly KolomSensitif[] = ["bankName", "bankAccount", "bankHolder", "nik", "npwp"];

export const konteksKol = (kolId: string, kolom: KolomSensitif) => `kol:${kolId}:${kolom}`;

/** Hanya angka. */
export const angkaSaja = (teks: string) => teks.replace(/\D/g, "");

/** Empat digit terakhir untuk tampilan tersamar. */
export function empatTerakhir(teks: string): string {
  return angkaSaja(teks).slice(-4);
}

export type KodeTolakSensitif = "BANK_NAMA_TIDAK_VALID" | "REKENING_TIDAK_VALID" | "ATAS_NAMA_TIDAK_VALID" | "NIK_TIDAK_VALID" | "NPWP_TIDAK_VALID";

/**
 * Rapikan & periksa satu isian. NIK 16 digit; NPWP 15 atau 16 digit (NPWP 16
 * digit = NIK); rekening 5–20 digit; nama bank ≤ 60, atas nama ≤ 100 huruf.
 */
export function rapikanSensitif(kolom: KolomSensitif, nilai: string): { ok: true; nilai: string } | { ok: false; kode: KodeTolakSensitif } {
  const t = nilai.trim().replace(/\s+/g, " ");
  switch (kolom) {
    case "bankName":
      return t.length >= 2 && t.length <= 60 ? { ok: true, nilai: t } : { ok: false, kode: "BANK_NAMA_TIDAK_VALID" };
    case "bankHolder":
      return t.length >= 2 && t.length <= 100 ? { ok: true, nilai: t } : { ok: false, kode: "ATAS_NAMA_TIDAK_VALID" };
    case "bankAccount": {
      const a = angkaSaja(t);
      return a.length >= 5 && a.length <= 20 && /^[\d\s.-]+$/.test(t) ? { ok: true, nilai: a } : { ok: false, kode: "REKENING_TIDAK_VALID" };
    }
    case "nik": {
      const a = angkaSaja(t);
      return a.length === 16 && /^[\d\s.-]+$/.test(t) ? { ok: true, nilai: a } : { ok: false, kode: "NIK_TIDAK_VALID" };
    }
    case "npwp": {
      const a = angkaSaja(t);
      return (a.length === 15 || a.length === 16) && /^[\d\s.-]+$/.test(t) ? { ok: true, nilai: a } : { ok: false, kode: "NPWP_TIDAK_VALID" };
    }
  }
}

/**
 * Lengkap untuk pajak: rekening (bank, nomor, atas nama) dan identitas —
 * perorangan NIK atau NPWP, badan NPWP. Tidak dipotong: cukup rekening.
 */
export function dataPajakLengkap(jenis: string, ada: Record<KolomSensitif, boolean>): boolean {
  const rekening = ada.bankName && ada.bankAccount && ada.bankHolder;
  if (!rekening) return false;
  if (jenis === "TIDAK_DIPOTONG") return true;
  if (jenis === "BADAN") return ada.npwp;
  return ada.nik || ada.npwp;
}
