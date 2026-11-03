"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { kaitBayarTambahanSpg, kaitPenerimaanUtangSpg } from "@/lib/finance/operasional/kait";
import { uploadToR2 } from "@/lib/r2";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import {
  batalkanPenerimaanUtangSpg,
  catatPenerimaanUtangSpg,
  catatSisaSpgBerhenti,
  periksaPenerimaanUtangSpg,
  revisiPenerimaanUtangSpg,
  terapkanKoreksiPlusSesudahAkhir,
  type KodeBayarUtang,
  type KodeSesudahAkhir,
} from "@/lib/spg/utang-writer";

/**
 * Utang SPG yang berhenti (P6, P6a, P67, P68) — bagian #utang halaman Komisi SPG.
 *
 * - Mencatat sisa minus sebagai utang, membayar koreksi plus sesudah pembayaran terakhir, mencatat
 *   dan merevisi penerimaan utang = `spg_commission:pay` (B33).
 * - Memeriksa penerimaan terhadap mutasi rekening = `payments:verify` (keputusan 11); pencatat dan
 *   perevisinya tidak pernah memeriksanya (`PEMERIKSA_SAMA`, di penulisnya).
 * - Membatalkan penerimaan yang BELUM dicek = `spg_commission:pay` (atau pencatatnya sendiri);
 *   yang SUDAH terverifikasi = `payments:verify`, karena pembatalannya mengubah kas yang sudah dicek.
 *
 * Tombol di halaman memakai izin yang sama. Foto bukti disimpan di R2.
 */

const MAKS_FOTO = 5 * 1024 * 1024;
const JENIS_FOTO = new Set(["image/jpeg", "image/png", "image/webp"]);

type Tanpa = "TANPA_AKSES" | "INPUT_TIDAK_SAH" | "FOTO_GAGAL_DISIMPAN" | "GAGAL";

export type HasilUtangAksi<T extends object = object> = ({ ok: true } & T) | { ok: false; code: KodeBayarUtang | KodeSesudahAkhir | string | Tanpa };

async function izinPengguna(): Promise<{ userId: string; bayar: boolean; verifikasi: boolean } | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  const izin = session.user.permissions ?? [];
  return { userId: session.user.id, bayar: hasPermission(izin, PERMISSIONS.SPG_COMMISSION_PAY), verifikasi: hasPermission(izin, PERMISSIONS.PAYMENTS_VERIFY) };
}

function segarkan() {
  revalidatePath("/backoffice/komisi-spg");
  revalidatePath("/pwa/spg/gaji");
}

const teks = (x: FormDataEntryValue | unknown) => (typeof x === "string" ? x : "");

async function simpanFoto(spgUserId: string, foto: FormDataEntryValue | null): Promise<{ ok: true; key: string | null } | { ok: false; code: "FOTO_TIDAK_SAH" | "FOTO_GAGAL_DISIMPAN" }> {
  if (!(foto instanceof File) || foto.size === 0) return { ok: true, key: null };
  if (foto.size > MAKS_FOTO || !JENIS_FOTO.has(foto.type)) return { ok: false, code: "FOTO_TIDAK_SAH" };
  const ext = foto.type === "image/png" ? "png" : foto.type === "image/webp" ? "webp" : "jpg";
  const key = `spg-utang/${spgUserId}/${randomUUID()}.${ext}`;
  try {
    await uploadToR2(key, new Uint8Array(await foto.arrayBuffer()), foto.type);
    return { ok: true, key };
  } catch (e) {
    console.error("[spg-komisi-utang] unggah foto", e);
    return { ok: false, code: "FOTO_GAGAL_DISIMPAN" };
  }
}

/** Catat sisa minus SPG yang berhenti sebagai utang (`jumlahDiharapkan` = angka di layar). */
export async function catatSisaSpgBerhentiAction(input: { spgUserId: unknown; jumlahDiharapkan: unknown; kunci: unknown }): Promise<HasilUtangAksi<{ utang: number }>> {
  const p = await izinPengguna();
  if (!p?.bayar) return { ok: false, code: "TANPA_AKSES" };
  const spgUserId = teks(input?.spgUserId);
  const jumlah = input?.jumlahDiharapkan;
  if (!spgUserId || typeof jumlah !== "number" || !Number.isFinite(jumlah)) return { ok: false, code: "INPUT_TIDAK_SAH" };
  try {
    const r = await catatSisaSpgBerhenti({ spgUserId, olehUserId: p.userId, jumlahDiharapkan: jumlah, kunci: input.kunci });
    if (!r.ok) return { ok: false, code: r.kode };
    segarkan();
    return { ok: true, utang: r.utang };
  } catch (e) {
    console.error("[spg-komisi-utang] catat sisa", e);
    return { ok: false, code: "GAGAL" };
  }
}

/** Koreksi plus sesudah pembayaran terakhir: mengimbangi utangnya dulu, sisanya dibayarkan. */
export async function terapkanKoreksiPlusSesudahAkhirAction(form: FormData): Promise<HasilUtangAksi<{ imbang: number; dibayar: number }>> {
  const p = await izinPengguna();
  if (!p?.bayar) return { ok: false, code: "TANPA_AKSES" };
  const spgUserId = teks(form.get("spgUserId"));
  const jumlah = Number(teks(form.get("jumlahDiharapkan")));
  if (!spgUserId || !Number.isFinite(jumlah)) return { ok: false, code: "INPUT_TIDAK_SAH" };
  const foto = await simpanFoto(spgUserId, form.get("foto"));
  if (!foto.ok) return { ok: false, code: foto.code };
  try {
    const r = await terapkanKoreksiPlusSesudahAkhir({
      spgUserId,
      cara: teks(form.get("cara")) || undefined,
      dibayarPada: teks(form.get("dibayarPada")) || undefined,
      fotoR2Key: foto.key,
      kunci: teks(form.get("kunci")),
      jumlahDiharapkan: jumlah,
      olehUserId: p.userId,
    });
    if (!r.ok) return { ok: false, code: r.kode };
    // Setiap bayar tambahan punya jurnal (B38) — juga yang seluruhnya mengimbangi utang (tunai Rp 0):
    // koreksinya tetap beban dan imbangannya tetap pemulihan. Diposting sekali per sumber, jadi
    // kiriman ulang (`ulang`) boleh mencoba lagi kalau jurnal pertamanya gagal.
    await kaitBayarTambahanSpg(r.payoutId, p.userId);
    segarkan();
    return { ok: true, imbang: r.imbang, dibayar: r.dibayar };
  } catch (e) {
    console.error("[spg-komisi-utang] koreksi plus", e);
    return { ok: false, code: "GAGAL" };
  }
}

/** Catat uang yang diterima dari SPG untuk utangnya — MENUNGGU_CEK, belum mengurangi apa pun. */
export async function catatPenerimaanUtangSpgAction(form: FormData): Promise<HasilUtangAksi<{ id: string }>> {
  const p = await izinPengguna();
  if (!p?.bayar) return { ok: false, code: "TANPA_AKSES" };
  const spgUserId = teks(form.get("spgUserId"));
  if (!spgUserId) return { ok: false, code: "INPUT_TIDAK_SAH" };
  const foto = await simpanFoto(spgUserId, form.get("foto"));
  if (!foto.ok) return { ok: false, code: foto.code };
  try {
    const r = await catatPenerimaanUtangSpg({
      spgUserId,
      jumlah: teks(form.get("jumlah")),
      cara: teks(form.get("cara")),
      diterimaPada: teks(form.get("diterimaPada")),
      fotoR2Key: foto.key,
      catatan: teks(form.get("catatan")),
      kunci: teks(form.get("kunci")),
      olehUserId: p.userId,
    });
    if (!r.ok) return { ok: false, code: r.kode };
    segarkan();
    return { ok: true, id: r.id };
  } catch (e) {
    console.error("[spg-komisi-utang] catat penerimaan", e);
    return { ok: false, code: "GAGAL" };
  }
}

/** Perbaiki penerimaan yang dikembalikan pemeriksa (atau yang masih menunggu cek). */
export async function revisiPenerimaanUtangSpgAction(form: FormData): Promise<HasilUtangAksi> {
  const p = await izinPengguna();
  if (!p?.bayar) return { ok: false, code: "TANPA_AKSES" };
  const id = teks(form.get("id"));
  const versi = Number(teks(form.get("versi")));
  const spgUserId = teks(form.get("spgUserId"));
  if (!id || !spgUserId || !Number.isInteger(versi) || versi < 1) return { ok: false, code: "INPUT_TIDAK_SAH" };
  const foto = await simpanFoto(spgUserId, form.get("foto"));
  if (!foto.ok) return { ok: false, code: foto.code };
  try {
    const r = await revisiPenerimaanUtangSpg({
      id,
      versi,
      jumlah: teks(form.get("jumlah")),
      cara: teks(form.get("cara")),
      diterimaPada: teks(form.get("diterimaPada")),
      ...(foto.key ? { fotoR2Key: foto.key } : {}),
      catatan: teks(form.get("catatan")),
      olehUserId: p.userId,
    });
    if (!r.ok) return { ok: false, code: r.kode };
    segarkan();
    return { ok: true };
  } catch (e) {
    console.error("[spg-komisi-utang] revisi penerimaan", e);
    return { ok: false, code: "GAGAL" };
  }
}

/** Periksa penerimaan terhadap mutasi rekening: sah (utang berkurang) atau dikembalikan dengan catatan. */
export async function periksaPenerimaanUtangSpgAction(input: {
  id: unknown;
  versi: unknown;
  keputusan: unknown;
  catatan?: unknown;
}): Promise<HasilUtangAksi> {
  const p = await izinPengguna();
  if (!p?.verifikasi) return { ok: false, code: "TANPA_AKSES" };
  const id = teks(input?.id);
  const versi = input?.versi;
  const keputusan = input?.keputusan === "TERVERIFIKASI" || input?.keputusan === "DIKEMBALIKAN" ? input.keputusan : null;
  if (!id || !keputusan || typeof versi !== "number" || !Number.isInteger(versi) || versi < 1) return { ok: false, code: "INPUT_TIDAK_SAH" };
  try {
    const r = await periksaPenerimaanUtangSpg({ id, versi, keputusan, catatan: input.catatan, olehUserId: p.userId });
    if (!r.ok) return { ok: false, code: r.kode };
    await kaitPenerimaanUtangSpg(id, p.userId);
    segarkan();
    return { ok: true };
  } catch (e) {
    console.error("[spg-komisi-utang] periksa penerimaan", e);
    return { ok: false, code: "GAGAL" };
  }
}

/** Batalkan penerimaan dengan alasan; yang sudah terverifikasi mengembalikan utangnya. */
export async function batalkanPenerimaanUtangSpgAction(input: { id: unknown; alasan: unknown }): Promise<HasilUtangAksi<{ terverifikasi: boolean }>> {
  const p = await izinPengguna();
  if (!p || (!p.bayar && !p.verifikasi)) return { ok: false, code: "TANPA_AKSES" };
  const id = teks(input?.id);
  if (!id) return { ok: false, code: "INPUT_TIDAK_SAH" };
  try {
    const r = await batalkanPenerimaanUtangSpg({ id, olehUserId: p.userId, alasan: input.alasan, bolehBatalkanBelumDicek: p.bayar, bolehBatalkanTerverifikasi: p.verifikasi });
    if (!r.ok) return { ok: false, code: r.kode };
    if (r.terverifikasi) await kaitPenerimaanUtangSpg(id, p.userId);
    segarkan();
    return { ok: true, terverifikasi: r.terverifikasi };
  } catch (e) {
    console.error("[spg-komisi-utang] batalkan penerimaan", e);
    return { ok: false, code: "GAGAL" };
  }
}
