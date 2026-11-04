/**
 * Identitas pajak PERUSAHAAN (`SystemSetting["pajak.identitas"]`) — murni,
 * aman untuk komponen klien. Dipakai ekspor faktur keluaran Coretax
 * (`TIN` dan `SellerIDTKU`).
 *
 * - NPWP 16 angka (sejak 2024 NPWP badan 16 digit; NPWP 15 digit lama
 *   didahului "0").
 * - NITKU = NPWP + 6 angka kode tempat usaha ("000000" = pusat). Kosong →
 *   NPWP + "000000".
 *
 * NPWP perusahaan bukan rahasia (tercetak di setiap faktur), jadi disimpan
 * apa adanya — berbeda dengan NPWP/NIK pemasok dan KOL yang dienkripsi.
 */

export const KUNCI_IDENTITAS_PAJAK = "pajak.identitas";

export type IdentitasPajak = {
  npwp: string | null;
  nitku: string | null;
  /** Nama wajib pajak seperti di Coretax. */
  nama: string | null;
};

export const IDENTITAS_PAJAK_KOSONG: Readonly<IdentitasPajak> = Object.freeze({ npwp: null, nitku: null, nama: null });

const angkaSaja = (v: unknown) => (typeof v === "string" ? v.replace(/[\s.\-]/g, "") : "");

/** NPWP sah → 16 angka (15 angka lama didahului "0"); selain itu null. */
export function rapikanNpwp(v: unknown): string | null {
  const t = angkaSaja(v);
  if (/^\d{16}$/.test(t)) return t;
  if (/^\d{15}$/.test(t)) return `0${t}`;
  return null;
}

/** NITKU sah → 22 angka; selain itu null. */
export function rapikanNitku(v: unknown): string | null {
  const t = angkaSaja(v);
  return /^\d{22}$/.test(t) ? t : null;
}

export function nitkuEfektif(i: IdentitasPajak): string | null {
  return i.nitku ?? (i.npwp ? `${i.npwp}000000` : null);
}

function objek(nilai: unknown): Record<string, unknown> | null {
  let v = nilai;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function bacaIdentitasPajakMentah(nilai: unknown): IdentitasPajak {
  const o = objek(nilai);
  if (!o) return { ...IDENTITAS_PAJAK_KOSONG };
  const nama = typeof o.nama === "string" && o.nama.trim() ? o.nama.trim().slice(0, 200) : null;
  return { npwp: rapikanNpwp(o.npwp), nitku: rapikanNitku(o.nitku), nama };
}

export type GalatIdentitas = "NPWP_TIDAK_SAH" | "NITKU_TIDAK_SAH" | "NITKU_BEDA_NPWP" | "NAMA_PANJANG";

/** Pemeriksaan ketat untuk menyimpan. Isian kosong boleh (belum diisi). */
export function periksaIdentitasPajak(input: unknown): { ok: true; identitas: IdentitasPajak } | { ok: false; galat: GalatIdentitas } {
  const o = objek(input) ?? {};
  const npwpTeks = angkaSaja(o.npwp);
  const nitkuTeks = angkaSaja(o.nitku);
  const npwp = npwpTeks ? rapikanNpwp(npwpTeks) : null;
  if (npwpTeks && !npwp) return { ok: false, galat: "NPWP_TIDAK_SAH" };
  const nitku = nitkuTeks ? rapikanNitku(nitkuTeks) : null;
  if (nitkuTeks && !nitku) return { ok: false, galat: "NITKU_TIDAK_SAH" };
  if (nitku && npwp && !nitku.startsWith(npwp)) return { ok: false, galat: "NITKU_BEDA_NPWP" };
  const nama = typeof o.nama === "string" && o.nama.trim() ? o.nama.trim() : null;
  if (nama && nama.length > 200) return { ok: false, galat: "NAMA_PANJANG" };
  return { ok: true, identitas: { npwp, nitku, nama } };
}
