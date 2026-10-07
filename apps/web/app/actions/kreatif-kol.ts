"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { SEMUA_PLATFORM, type Platform } from "@/lib/creative/aturan";
import { BATAS_TEMPEL, uraiTempelan } from "@/lib/creative/kol-aturan";
import {
  catatanDanRiwayat,
  dataFormKol,
  kelompokKembarKol,
  pratinjauTempelan,
  type BarisPratinjau,
  type DataFormKol,
  type ItemLinimasa,
  type KelompokKembarKol,
} from "@/lib/creative/kol-queries";
import {
  blokirKol,
  buatCatatanKol,
  bukaBlokirKol,
  simpanKolMassal,
  simpanProfilKol,
  type AksiMassal,
  type AlasanGagalKol,
  type BarisSimpanMassal,
  type IsiKol,
  type KembarDitemukan,
} from "@/lib/creative/kol-writer";

/*
 * Aksi database KOL (2026-10-07). Setiap ekspor berkas "use server" adalah
 * endpoint yang bisa dipanggil langsung, jadi izinnya diperiksa di SETIAP aksi,
 * pengguna diambil dari sesi, dan isian dari klien dirapikan ulang di sini.
 * Kegagalan dikembalikan sebagai kode, tidak dilempar.
 */

export type KodeGagalKol = AlasanGagalKol | "TANPA_AKSES" | "GAGAL";

export type GagalKol = { ok: false; kode: KodeGagalKol; detail?: string; kembar?: KembarDitemukan[] };

async function pengguna(perlu: "lihat" | "kelola"): Promise<string | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  const izin = session.user.permissions ?? [];
  const boleh = perlu === "kelola" ? hasPermission(izin, PERMISSIONS.CREATIVE_MANAGE) : hasPermission(izin, PERMISSIONS.CREATIVE_VIEW);
  return boleh ? session.user.id : null;
}

function segarkan() {
  revalidatePath("/backoffice/kreatif", "layout");
}

const PLATFORM_SET: ReadonlySet<string> = new Set(SEMUA_PLATFORM);
const platformSah = (p: unknown): p is Platform => typeof p === "string" && PLATFORM_SET.has(p);
const teksAtau = (v: unknown): string | null | undefined =>
  v === undefined ? undefined : v === null ? null : typeof v === "string" ? v : String(v);
const angkaAtau = (v: unknown): number | null | undefined =>
  v === undefined ? undefined : v === null || v === "" ? null : typeof v === "number" ? v : Number.NaN;

/** Isian dari klien → `IsiKol` yang bentuknya pasti; null bila bentuknya rusak. */
function rapikanIsi(isi: unknown): IsiKol | null {
  if (!isi || typeof isi !== "object") return null;
  const o = isi as Record<string, unknown>;
  if (!Array.isArray(o.akun)) return null;
  const akun: IsiKol["akun"] = [];
  for (const a of o.akun.slice(0, 20)) {
    if (!a || typeof a !== "object") return null;
    const r = a as Record<string, unknown>;
    if (!platformSah(r.platform)) return null;
    akun.push({
      id: typeof r.id === "string" ? r.id : null,
      platform: r.platform,
      handle: typeof r.handle === "string" ? r.handle : "",
      followers: typeof r.followers === "number" ? r.followers : 0,
      url: typeof r.url === "string" ? r.url : null,
    });
  }
  const u = o.ukuran;
  const ukuran =
    u === undefined ? undefined : u && typeof u === "object" ? (u as IsiKol["ukuran"]) : null;
  return {
    name: typeof o.name === "string" ? o.name : "",
    recipientName: teksAtau(o.recipientName),
    niche: teksAtau(o.niche),
    city: teksAtau(o.city),
    province: teksAtau(o.province),
    postalCode: teksAtau(o.postalCode),
    address: teksAtau(o.address),
    phone: teksAtau(o.phone),
    email: teksAtau(o.email),
    rateCard: angkaAtau(o.rateCard),
    rateNote: teksAtau(o.rateNote),
    note: teksAtau(o.note),
    label: teksAtau(o.label),
    engagementRate: angkaAtau(o.engagementRate),
    avgViews: angkaAtau(o.avgViews),
    ukuran,
    akun,
  };
}

/* ───────────────────────────── simpan ───────────────────────────── */

export type HasilSimpanKolAksi = { ok: true; id: string; dibuat: boolean; riwayatPengikut: number } | GagalKol;

/**
 * Tambah/ubah KOL. Kembar (nomor WA atau handle sama dengan KOL lain) ditolak
 * dengan `KEMBAR` beserta daftarnya; kirim ulang dengan `alasanKembar` untuk
 * tetap menyimpan — alasannya tercatat di jejak.
 */
export async function simpanKolAction(input: {
  id: string | null;
  isi: IsiKol;
  alasanKembar?: string | null;
}): Promise<HasilSimpanKolAksi> {
  const oleh = await pengguna("kelola");
  if (!oleh) return { ok: false, kode: "TANPA_AKSES" };
  const isi = rapikanIsi(input?.isi);
  if (!isi) return { ok: false, kode: "TIDAK_VALID" };
  try {
    const r = await simpanProfilKol({
      id: typeof input.id === "string" && input.id ? input.id : null,
      isi,
      olehUserId: oleh,
      periksaKembar: true,
      alasanKembar: typeof input.alasanKembar === "string" ? input.alasanKembar : null,
    });
    if (!r.ok) return { ok: false, kode: r.alasan, detail: r.detail, kembar: r.kembar };
    segarkan();
    return { ok: true, id: r.id, dibuat: r.dibuat, riwayatPengikut: r.riwayatPengikut };
  } catch (err) {
    console.error("simpanKolAction gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}

/** Data formulir ubah untuk satu KOL (dimuat saat tombol Ubah ditekan di daftar). */
export async function ambilFormKolAction(id: string): Promise<{ ok: true; data: DataFormKol } | GagalKol> {
  const oleh = await pengguna("kelola");
  if (!oleh) return { ok: false, kode: "TANPA_AKSES" };
  try {
    const data = typeof id === "string" && id ? await dataFormKol(id) : null;
    return data ? { ok: true, data } : { ok: false, kode: "TIDAK_DITEMUKAN" };
  } catch (err) {
    console.error("ambilFormKolAction gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}

/* ───────────────────────────── blokir ───────────────────────────── */

export async function blokirKolAction(kolId: string, alasan: string): Promise<{ ok: true } | GagalKol> {
  const oleh = await pengguna("kelola");
  if (!oleh) return { ok: false, kode: "TANPA_AKSES" };
  try {
    const r = await blokirKol({ kolId: String(kolId ?? ""), alasan: String(alasan ?? ""), olehUserId: oleh });
    if (!r.ok) return { ok: false, kode: r.alasan, detail: r.detail };
    segarkan();
    return { ok: true };
  } catch (err) {
    console.error("blokirKolAction gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}

export async function bukaBlokirKolAction(kolId: string, alasan: string): Promise<{ ok: true } | GagalKol> {
  const oleh = await pengguna("kelola");
  if (!oleh) return { ok: false, kode: "TANPA_AKSES" };
  try {
    const r = await bukaBlokirKol({ kolId: String(kolId ?? ""), alasan: String(alasan ?? ""), olehUserId: oleh });
    if (!r.ok) return { ok: false, kode: r.alasan, detail: r.detail };
    segarkan();
    return { ok: true };
  } catch (err) {
    console.error("bukaBlokirKolAction gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}

/* ─────────────────────────── tambah massal ─────────────────────────── */

/** Urai tempelan dan tandai yang kembar dengan KOL yang sudah ada. Tidak menulis apa pun. */
export async function pratinjauMassalAction(
  teks: string,
  platform: Platform,
): Promise<{ ok: true; baris: BarisPratinjau[] } | GagalKol> {
  const oleh = await pengguna("kelola");
  if (!oleh) return { ok: false, kode: "TANPA_AKSES" };
  if (!platformSah(platform)) return { ok: false, kode: "TIDAK_VALID" };
  const baris = uraiTempelan(typeof teks === "string" ? teks.slice(0, 200_000) : "");
  if (baris.length === 0) return { ok: false, kode: "TIDAK_VALID" };
  if (baris.length > BATAS_TEMPEL) return { ok: false, kode: "TERLALU_BANYAK", detail: String(BATAS_TEMPEL) };
  try {
    return { ok: true, baris: await pratinjauTempelan(baris, platform) };
  } catch (err) {
    console.error("pratinjauMassalAction gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}

const AKSI_MASSAL: ReadonlySet<string> = new Set<AksiMassal>(["BARU", "PERBARUI", "LEWATI"]);

export type HasilMassalAksi =
  | { ok: true; baru: number; diperbarui: number; dilewati: number; kolIds: string[]; kembarBaru: string[] }
  | GagalKol;

/** Simpan hasil pratinjau dalam satu transaksi. */
export async function simpanMassalAction(baris: BarisSimpanMassal[], platform: Platform): Promise<HasilMassalAksi> {
  const oleh = await pengguna("kelola");
  if (!oleh) return { ok: false, kode: "TANPA_AKSES" };
  if (!platformSah(platform) || !Array.isArray(baris)) return { ok: false, kode: "TIDAK_VALID" };
  const bersih: BarisSimpanMassal[] = [];
  for (const b of baris.slice(0, BATAS_TEMPEL + 1)) {
    if (!b || typeof b !== "object" || typeof b.handle !== "string" || !AKSI_MASSAL.has(b.aksi)) return { ok: false, kode: "TIDAK_VALID" };
    bersih.push({
      handle: b.handle,
      nama: typeof b.nama === "string" ? b.nama : null,
      pengikut: typeof b.pengikut === "number" && Number.isFinite(b.pengikut) ? b.pengikut : null,
      wa: typeof b.wa === "string" ? b.wa : null,
      kota: typeof b.kota === "string" ? b.kota : null,
      aksi: b.aksi,
      targetId: typeof b.targetId === "string" ? b.targetId : null,
    });
  }
  try {
    const r = await simpanKolMassal({ baris: bersih, platform, olehUserId: oleh });
    if (!r.ok) return { ok: false, kode: r.alasan, detail: r.detail };
    segarkan();
    return { ok: true, baru: r.baru, diperbarui: r.diperbarui, dilewati: r.dilewati, kolIds: r.kolIds, kembarBaru: r.kembarBaru };
  } catch (err) {
    console.error("simpanMassalAction gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}

/* ───────────────────────────── kembar ───────────────────────────── */

export async function cekKembarAction(): Promise<{ ok: true; kelompok: KelompokKembarKol[]; terpotong: boolean } | GagalKol> {
  const oleh = await pengguna("lihat");
  if (!oleh) return { ok: false, kode: "TANPA_AKSES" };
  try {
    return { ok: true, ...(await kelompokKembarKol()) };
  } catch (err) {
    console.error("cekKembarAction gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}

/* ───────────────────────────── catatan ───────────────────────────── */

/**
 * Tulis catatan pada KOL atau kolaborasi. Mengatur ulang jam follow-up
 * (kontak terakhir) — aturan yang sama dengan mengirim WhatsApp.
 */
export async function buatCatatanKolAction(input: {
  kolId?: string | null;
  kolaborasiId?: string | null;
  isi: string;
}): Promise<{ ok: true; id: string } | GagalKol> {
  const oleh = await pengguna("kelola");
  if (!oleh) return { ok: false, kode: "TANPA_AKSES" };
  try {
    const r = await buatCatatanKol({
      kolId: typeof input?.kolId === "string" && input.kolId ? input.kolId : null,
      kolaborasiId: typeof input?.kolaborasiId === "string" && input.kolaborasiId ? input.kolaborasiId : null,
      isi: typeof input?.isi === "string" ? input.isi : "",
      olehUserId: oleh,
    });
    if (!r.ok) return { ok: false, kode: r.alasan, detail: r.detail };
    segarkan();
    return { ok: true, id: r.id };
  } catch (err) {
    console.error("buatCatatanKolAction gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}

/** Linimasa catatan & riwayat (dimuat ulang oleh panel sesudah menulis catatan). */
export async function linimasaKolAction(input: {
  kolId?: string | null;
  kolaborasiId?: string | null;
}): Promise<{ ok: true; item: ItemLinimasa[] } | GagalKol> {
  const oleh = await pengguna("lihat");
  if (!oleh) return { ok: false, kode: "TANPA_AKSES" };
  try {
    return {
      ok: true,
      item: await catatanDanRiwayat({
        kolId: typeof input?.kolId === "string" ? input.kolId : null,
        kolaborasiId: typeof input?.kolaborasiId === "string" ? input.kolaborasiId : null,
      }),
    };
  } catch (err) {
    console.error("linimasaKolAction gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}
