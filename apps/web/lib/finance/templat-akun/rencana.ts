import type { AccountType } from "@/lib/constants/enums";
import type { PostingRole } from "@/lib/constants/journal-roles";
import { isAccountTypeValidForRole } from "@/lib/finance/journals/role-account-types";
import { tipeAkunTemplat, type AkunTemplat } from "./templat";

/*
 * Rencana pemasangan templat bagan akun — murni, dipakai pratinjau (layar) DAN
 * pemasang (di dalam transaksi), supaya yang dijanjikan layar sama persis
 * dengan yang ditulis.
 *
 * Aturan:
 * - Akun dicocokkan lewat KODE. Kode yang sudah ada tidak dibuat ulang dan
 *   namanya tidak diubah.
 * - Peran yang sudah dipetakan (ke akun apa pun) tidak pernah disentuh.
 * - Akun yang sudah ada dengan tipe berbeda dari templat → konflik; anak-anak
 *   templatnya tidak dibuat (kode anak harus berawalan kode induk, dan anak
 *   mewarisi tipe induk — keduanya tidak bisa dipenuhi).
 * - Menambah anak di bawah akun daun yang SUDAH DIPAKAI (punya baris jurnal atau
 *   pemetaan peran) ditolak: akun itu akan berhenti bisa diposting, dan jurnal
 *   otomatis perannya mulai gagal.
 * - Peran hanya dipetakan ke akun aktif tanpa turunan (yang bisa diposting).
 */

export const KEDALAMAN_MAKS = 4;

export type AkunAda = {
  id: string;
  kode: string;
  nama: string;
  tipe: AccountType;
  kedalaman: number;
  aktif: boolean;
  punyaAnak: boolean;
  /** Punya baris jurnal atau dipetakan ke sebuah peran. */
  dipakai: boolean;
};

export type KeadaanBagan = {
  akun: readonly AkunAda[];
  peranTerpetakan: readonly string[];
};

export type AkunBaru = { kode: string; nama: string; tipe: AccountType; kodeInduk: string | null; kedalaman: number };

export type PemetaanBaru = { peran: PostingRole; kode: string; nama: string; akunBaru: boolean };

export const SEBAB_KONFLIK_TEMPLAT = [
  "TIPE_BERBEDA",
  "INDUK_GAGAL",
  "INDUK_NONAKTIF",
  "INDUK_DIPAKAI",
  "TERLALU_DALAM",
  "AKUN_NONAKTIF",
  "BUKAN_DAUN",
  "TIPE_PERAN_SALAH",
] as const;
export type SebabKonflikTemplat = (typeof SEBAB_KONFLIK_TEMPLAT)[number];

export type KonflikTemplat = {
  kode: string;
  nama: string;
  sebab: SebabKonflikTemplat;
  /** Peran templat yang karena konflik ini TIDAK dipetakan. */
  peran: PostingRole[];
};

export type RencanaTemplat = {
  /** Urut induk dulu — urutan pembuatan. */
  akunBaru: AkunBaru[];
  pemetaanBaru: PemetaanBaru[];
  akunSudahAda: number;
  peranSudahDipetakan: PostingRole[];
  konflik: KonflikTemplat[];
};

export function rencanaKosong(r: RencanaTemplat): boolean {
  return r.akunBaru.length === 0 && r.pemetaanBaru.length === 0;
}

type Status = { jenis: "ADA"; akun: AkunAda } | { jenis: "BARU"; kedalaman: number } | { jenis: "GAGAL" };

export function rencanaPasangTemplat(templat: readonly AkunTemplat[], keadaan: KeadaanBagan): RencanaTemplat {
  const adaPerKode = new Map(keadaan.akun.map((a) => [a.kode, a]));
  const terpetakan = new Set(keadaan.peranTerpetakan);
  const status = new Map<string, Status>();

  const akunBaru: AkunBaru[] = [];
  const pemetaanBaru: PemetaanBaru[] = [];
  const peranSudahDipetakan: PostingRole[] = [];
  const konflik: KonflikTemplat[] = [];
  let akunSudahAda = 0;

  const catatKonflik = (t: AkunTemplat, sebab: SebabKonflikTemplat, peran: PostingRole[] = []) => {
    konflik.push({ kode: t.kode, nama: t.nama, sebab, peran });
  };

  for (const t of templat) {
    const peranKosong = (t.peran ?? []).filter((p) => !terpetakan.has(p));
    for (const p of t.peran ?? []) if (terpetakan.has(p)) peranSudahDipetakan.push(p);

    const tipe = tipeAkunTemplat(templat, t.kode);
    const ada = adaPerKode.get(t.kode);

    if (tipe === null) {
      // Templat rusak (induk tidak ada / berputar) — dijaga tes, tidak pernah terjadi.
      status.set(t.kode, { jenis: "GAGAL" });
      catatKonflik(t, "INDUK_GAGAL", peranKosong);
      continue;
    }

    if (ada) {
      if (ada.tipe !== tipe) {
        status.set(t.kode, { jenis: "GAGAL" });
        catatKonflik(t, "TIPE_BERBEDA", peranKosong);
        continue;
      }
      status.set(t.kode, { jenis: "ADA", akun: ada });
      akunSudahAda += 1;
      if (peranKosong.length === 0) continue;
      if (!ada.aktif) {
        catatKonflik(t, "AKUN_NONAKTIF", peranKosong);
        continue;
      }
      if (ada.punyaAnak) {
        catatKonflik(t, "BUKAN_DAUN", peranKosong);
        continue;
      }
      const salahTipe = peranKosong.filter((p) => !isAccountTypeValidForRole(p, ada.tipe));
      if (salahTipe.length > 0) catatKonflik(t, "TIPE_PERAN_SALAH", salahTipe);
      for (const p of peranKosong) {
        if (salahTipe.includes(p)) continue;
        pemetaanBaru.push({ peran: p, kode: ada.kode, nama: ada.nama, akunBaru: false });
      }
      continue;
    }

    // Kode belum ada → dibuat, bila induknya memungkinkan.
    let kedalaman = 1;
    if (t.induk !== null) {
      const induk = status.get(t.induk);
      if (!induk || induk.jenis === "GAGAL") {
        status.set(t.kode, { jenis: "GAGAL" });
        catatKonflik(t, "INDUK_GAGAL", peranKosong);
        continue;
      }
      if (induk.jenis === "ADA") {
        const a = induk.akun;
        if (!a.aktif) {
          status.set(t.kode, { jenis: "GAGAL" });
          catatKonflik(t, "INDUK_NONAKTIF", peranKosong);
          continue;
        }
        if (!a.punyaAnak && a.dipakai) {
          status.set(t.kode, { jenis: "GAGAL" });
          catatKonflik(t, "INDUK_DIPAKAI", peranKosong);
          continue;
        }
        kedalaman = a.kedalaman + 1;
      } else {
        kedalaman = induk.kedalaman + 1;
      }
      if (kedalaman > KEDALAMAN_MAKS) {
        status.set(t.kode, { jenis: "GAGAL" });
        catatKonflik(t, "TERLALU_DALAM", peranKosong);
        continue;
      }
    }

    status.set(t.kode, { jenis: "BARU", kedalaman });
    akunBaru.push({ kode: t.kode, nama: t.nama, tipe, kodeInduk: t.induk, kedalaman });
    for (const p of peranKosong) pemetaanBaru.push({ peran: p, kode: t.kode, nama: t.nama, akunBaru: true });
  }

  return { akunBaru, pemetaanBaru, akunSudahAda, peranSudahDipetakan, konflik };
}
