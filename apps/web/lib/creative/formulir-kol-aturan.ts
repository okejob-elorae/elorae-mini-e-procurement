/**
 * Aturan formulir data KOL (link yang dikirim lewat WhatsApp) — murni, aman untuk klien. Penulisnya
 * `formulir-kol-writer.ts`; rancangan `docs/superpowers/specs/2026-10-09-formulir-data-kol-design.md`.
 *
 * Isian KOSONG pada kolom opsional berarti "tidak diubah", bukan "hapus": KOL yang tidak mengisi
 * ukuran tidak boleh menghapus ukuran yang sudah dicatat kantor. Rekening/NIK/NPWP diperiksa lagi di
 * server dengan `rapikanSensitif` (aturan digitnya ada di sana).
 */

import { bacaBilanganBulat } from "./angka-masuk";
import type { ProfilUkuran } from "./kol-aturan";
import { normalisasiWa } from "./wa";

/** Masa berlaku link formulir (hari). */
export const HARI_BERLAKU_FORMULIR = 14;

/** Batas panjang, sama dengan penulis profil KOL (`kol-writer.ts`) dan profil ukuran. */
export const BATAS_FORMULIR = {
  recipientName: 120,
  phone: 40,
  email: 120,
  address: 2000,
  city: 120,
  province: 120,
  postalCode: 20,
  atasan: 20,
  bawahan: 20,
  catatanFit: 300,
  bankName: 60,
  bankAccount: 40,
  bankHolder: 100,
  nik: 40,
  npwp: 40,
} as const;

export type IsianFormulirKol = {
  recipientName: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  province: string;
  postalCode: string;
  atasan: string;
  bawahan: string;
  tinggi: string;
  hijab: "" | "ya" | "tidak";
  catatanFit: string;
  bankName: string;
  bankAccount: string;
  bankHolder: string;
  nik: string;
  npwp: string;
  setuju: boolean;
};

export const ISIAN_KOSONG: IsianFormulirKol = {
  recipientName: "",
  phone: "",
  email: "",
  address: "",
  city: "",
  province: "",
  postalCode: "",
  atasan: "",
  bawahan: "",
  tinggi: "",
  hijab: "",
  catatanFit: "",
  bankName: "",
  bankAccount: "",
  bankHolder: "",
  nik: "",
  npwp: "",
  setuju: false,
};

export type KodeGalatFormulir =
  | "WAJIB"
  | "WA_TIDAK_SAH"
  | "EMAIL_TIDAK_SAH"
  | "KODE_POS_TIDAK_SAH"
  | "TINGGI_TIDAK_SAH"
  | "TERLALU_PANJANG"
  | "REKENING_TIDAK_LENGKAP"
  | "BELUM_SETUJU";

/** Kode per isian; rekening/NIK/NPWP juga memakai kode `rapikanSensitif` (mis. NIK_TIDAK_VALID). */
export type GalatFormulir = Partial<Record<keyof IsianFormulirKol, string>>;

export type KolomSensitifFormulir = "bankName" | "bankAccount" | "bankHolder" | "nik" | "npwp";

export type NilaiFormulir = {
  recipientName: string;
  phone: string;
  waNormal: string;
  email: string | null;
  address: string;
  city: string;
  province: string | null;
  postalCode: string;
  /** Kolom ukuran yang DIISI saja; yang kosong tidak menyentuh profil ukuran kantor. */
  ukuran: Partial<ProfilUkuran>;
  /** Teks mentah yang diisi (sudah dipangkas); digit dan bentuknya diperiksa server. */
  sensitif: Partial<Record<KolomSensitifFormulir, string>>;
};

const POLA_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const rapi = (t: string) => t.replace(/[ \t]+/g, " ").trim();

export function periksaIsianFormulir(i: IsianFormulirKol): { ok: true; nilai: NilaiFormulir } | { ok: false; galat: GalatFormulir } {
  const galat: GalatFormulir = {};
  const teks = (k: keyof typeof BATAS_FORMULIR, wajib: boolean): string | null => {
    const v = k === "address" ? (i[k] ?? "").replace(/\r\n/g, "\n").trim() : rapi(i[k] ?? "");
    if (!v) {
      if (wajib) galat[k] = "WAJIB";
      return null;
    }
    if (v.length > BATAS_FORMULIR[k]) {
      galat[k] = "TERLALU_PANJANG";
      return null;
    }
    return v;
  };

  const recipientName = teks("recipientName", true);
  const phone = teks("phone", true);
  const waNormal = phone ? normalisasiWa(phone) : null;
  if (phone && !waNormal) galat.phone = "WA_TIDAK_SAH";
  const email = teks("email", false);
  if (email && !POLA_EMAIL.test(email)) galat.email = "EMAIL_TIDAK_SAH";
  const address = teks("address", true);
  const city = teks("city", true);
  const province = teks("province", false);
  const kodePos = teks("postalCode", true);
  const postalCode = kodePos ? kodePos.replace(/\s/g, "") : null;
  if (postalCode && !/^\d{5}$/.test(postalCode)) galat.postalCode = "KODE_POS_TIDAK_SAH";

  const ukuran: Partial<ProfilUkuran> = {};
  const atasan = teks("atasan", false);
  if (atasan) ukuran.atasan = atasan;
  const bawahan = teks("bawahan", false);
  if (bawahan) ukuran.bawahan = bawahan;
  if (rapi(i.tinggi ?? "")) {
    const n = bacaBilanganBulat(i.tinggi.replace(/cm/gi, ""));
    if (n === null || n < 50 || n > 250) galat.tinggi = "TINGGI_TIDAK_SAH";
    else ukuran.tinggiCm = Math.round(n);
  }
  if (i.hijab === "ya") ukuran.hijab = true;
  else if (i.hijab === "tidak") ukuran.hijab = false;
  const catatanFit = teks("catatanFit", false);
  if (catatanFit) ukuran.catatan = catatanFit;

  const sensitif: Partial<Record<KolomSensitifFormulir, string>> = {};
  for (const k of ["bankName", "bankAccount", "bankHolder", "nik", "npwp"] as const) {
    const v = teks(k, false);
    if (v) sensitif[k] = v;
  }
  // Rekening dipakai untuk transfer: separuh data rekening tidak berguna, jadi ketiganya wajib bersama.
  const bagianRekening = (["bankName", "bankAccount", "bankHolder"] as const).filter((k) => sensitif[k] !== undefined);
  if (bagianRekening.length > 0 && bagianRekening.length < 3) {
    for (const k of ["bankName", "bankAccount", "bankHolder"] as const) if (sensitif[k] === undefined && !galat[k]) galat[k] = "REKENING_TIDAK_LENGKAP";
  }

  if (!i.setuju) galat.setuju = "BELUM_SETUJU";
  if (Object.keys(galat).length || !recipientName || !phone || !waNormal || !address || !city || !postalCode) {
    return { ok: false, galat };
  }
  return {
    ok: true,
    nilai: { recipientName, phone, waNormal, email, address, city, province, postalCode, ukuran, sensitif },
  };
}

/* ───────────────────────── perubahan ───────────────────────── */

export type KolomFormulir =
  | "recipientName"
  | "phone"
  | "email"
  | "address"
  | "city"
  | "province"
  | "postalCode"
  | "atasan"
  | "bawahan"
  | "tinggiCm"
  | "hijab"
  | "catatanFit";

export const URUTAN_KOLOM_FORMULIR: readonly KolomFormulir[] = [
  "recipientName",
  "phone",
  "email",
  "address",
  "city",
  "province",
  "postalCode",
  "atasan",
  "bawahan",
  "tinggiCm",
  "hijab",
  "catatanFit",
];

export type DataKolSekarang = {
  recipientName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  ukuran: ProfilUkuran;
};

/** Satu kolom yang diubah KOL. `menimpa` = kantor sudah mengisi nilai LAIN di kolom itu (perlu dicek). */
export type PerubahanFormulir = { kolom: KolomFormulir; sebelum: string | null; sesudah: string; menimpa: boolean; dikembalikan?: boolean };

const hijabTeks = (h: boolean | null) => (h === null ? null : h ? "ya" : "tidak");

/** Bentuk teks yang disimpan di riwayat pengiriman dan ditampilkan ke kantor. */
export function teksKolom(d: DataKolSekarang, kolom: KolomFormulir): string | null {
  switch (kolom) {
    case "atasan":
      return d.ukuran.atasan;
    case "bawahan":
      return d.ukuran.bawahan;
    case "tinggiCm":
      return d.ukuran.tinggiCm === null ? null : String(d.ukuran.tinggiCm);
    case "hijab":
      return hijabTeks(d.ukuran.hijab);
    case "catatanFit":
      return d.ukuran.catatan;
    default:
      return d[kolom];
  }
}

const samaTeks = (a: string, b: string) => rapi(a).toLocaleLowerCase("id") === rapi(b).toLocaleLowerCase("id");

/** Dua nilai satu kolom dianggap sama: abai huruf besar/spasi; WA dibandingkan sebagai nomor. */
export function samaNilaiFormulir(kolom: KolomFormulir, a: string, b: string): boolean {
  if (kolom === "phone") return normalisasiWa(a) !== null && normalisasiWa(a) === normalisasiWa(b);
  return samaTeks(a, b);
}

/** Kolom yang benar-benar berubah. Isian yang sama (abai huruf besar/spasi; WA dibandingkan sebagai nomor) tidak dihitung. */
export function bandingkanFormulir(sekarang: DataKolSekarang, nilai: NilaiFormulir): PerubahanFormulir[] {
  const baru: Partial<Record<KolomFormulir, string>> = {
    recipientName: nilai.recipientName,
    phone: nilai.phone,
    address: nilai.address,
    city: nilai.city,
    postalCode: nilai.postalCode,
  };
  if (nilai.email) baru.email = nilai.email;
  if (nilai.province) baru.province = nilai.province;
  if (nilai.ukuran.atasan) baru.atasan = nilai.ukuran.atasan;
  if (nilai.ukuran.bawahan) baru.bawahan = nilai.ukuran.bawahan;
  if (nilai.ukuran.tinggiCm !== undefined && nilai.ukuran.tinggiCm !== null) baru.tinggiCm = String(nilai.ukuran.tinggiCm);
  if (nilai.ukuran.hijab !== undefined && nilai.ukuran.hijab !== null) baru.hijab = hijabTeks(nilai.ukuran.hijab)!;
  if (nilai.ukuran.catatan) baru.catatanFit = nilai.ukuran.catatan;

  const hasil: PerubahanFormulir[] = [];
  for (const kolom of URUTAN_KOLOM_FORMULIR) {
    const sesudah = baru[kolom];
    if (sesudah === undefined) continue;
    const sebelum = teksKolom(sekarang, kolom);
    if (sebelum !== null && samaNilaiFormulir(kolom, sebelum, sesudah)) continue;
    hasil.push({ kolom, sebelum, sesudah, menimpa: sebelum !== null && sebelum.trim() !== "" });
  }
  return hasil;
}

/** Riwayat pengiriman tersimpan sebagai JSON teks; isi rusak dibaca kosong. */
export type RiwayatPengiriman = { perubahan: PerubahanFormulir[]; sensitif: KolomSensitifFormulir[]; npwpBaru: boolean };

export function bacaRiwayatPengiriman(teks: string | null | undefined): RiwayatPengiriman {
  const kosong: RiwayatPengiriman = { perubahan: [], sensitif: [], npwpBaru: false };
  if (!teks) return kosong;
  try {
    const o = JSON.parse(teks) as Partial<RiwayatPengiriman>;
    const kolomSah = new Set<string>(URUTAN_KOLOM_FORMULIR);
    const perubahan = Array.isArray(o.perubahan)
      ? o.perubahan.filter(
          (p): p is PerubahanFormulir =>
            !!p && typeof p === "object" && kolomSah.has((p as PerubahanFormulir).kolom) && typeof (p as PerubahanFormulir).sesudah === "string",
        )
      : [];
    const sensitif = Array.isArray(o.sensitif)
      ? o.sensitif.filter((k): k is KolomSensitifFormulir => ["bankName", "bankAccount", "bankHolder", "nik", "npwp"].includes(k as string))
      : [];
    return { perubahan, sensitif, npwpBaru: o.npwpBaru === true };
  } catch {
    return kosong;
  }
}
