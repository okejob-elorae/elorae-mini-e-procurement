"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { parseDateOnly } from "@/lib/date-only";
import { SEMUA_PLATFORM, type Platform } from "@/lib/creative/aturan";
import { SEMUA_JENIS_KERJA_SAMA, SEMUA_TAHAP, type JenisKerjaSama, type Tahap } from "@/lib/creative/tahap";
import { buatBrief, pindahTahapKolaborasi, type AlasanGagalKreatif, type BarisBarangKirim, type BarisDeliverable } from "@/lib/creative/writer";
import {
  masukkanKeCampaign,
  pindahkanKeCampaign,
  pindahTahapBanyak,
  ubahKolaborasi,
  type GagalMassal,
} from "@/lib/creative/kolaborasi-writer";
import { cariKolUntukKolaborasi, ringkasRiwayatKol, type HasilCariKol, type RiwayatKol } from "@/lib/creative/kolaborasi-queries";
import { pilihanVarianKirim, type PilihanVarianKirim } from "@/lib/konsinyasi/varian-kirim";

/*
 * Aksi Kolaborasi (Ruang KOL). Setiap ekspor berkas "use server" adalah
 * endpoint yang bisa dipanggil langsung, jadi izin diperiksa di SETIAP aksi dan
 * pengguna diambil dari sesi — tidak pernah dari klien. Kegagalan dikembalikan
 * sebagai kode, tidak dilempar (lemparan di produksi tersamar jadi digest).
 */

export type KodeGagalKolaborasi = AlasanGagalKreatif | "TANPA_AKSES" | "GAGAL";

export type HasilAksiKolaborasi<T = Record<never, never>> =
  | ({ ok: true } & T)
  | { ok: false; kode: KodeGagalKolaborasi; detail?: string };

async function izin(): Promise<{ userId: string; bolehUbah: boolean } | null> {
  const s = await auth();
  if (!s?.user?.id) return null;
  const p = s.user.permissions ?? [];
  if (!hasPermission(p, PERMISSIONS.CREATIVE_VIEW)) return null;
  return { userId: s.user.id, bolehUbah: hasPermission(p, PERMISSIONS.CREATIVE_MANAGE) };
}

async function penulis(): Promise<string | null> {
  const i = await izin();
  return i?.bolehUbah ? i.userId : null;
}

function segarkan() {
  revalidatePath("/backoffice/kreatif", "layout");
}

/** "YYYY-MM-DD" → tengah malam WIB; selain itu null. */
function tanggal(v: unknown): Date | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  return parseDateOnly(v) ?? null;
}

const tahapSah = (v: unknown): v is Tahap => typeof v === "string" && (SEMUA_TAHAP as readonly string[]).includes(v);
const jenisSah = (v: unknown): v is JenisKerjaSama =>
  typeof v === "string" && (SEMUA_JENIS_KERJA_SAMA as readonly string[]).includes(v);
const platformSah = (v: unknown): v is Platform => typeof v === "string" && (SEMUA_PLATFORM as readonly string[]).includes(v);
const FORMAT = ["FEED", "REELS", "STORY", "VIDEO", "LIVE", "CAROUSEL"] as const;
const formatSah = (v: unknown): v is (typeof FORMAT)[number] => typeof v === "string" && (FORMAT as readonly string[]).includes(v);
const teks = (v: unknown, maks = 5000): string | null => (typeof v === "string" ? v.slice(0, maks) : null);
const angkaAtauNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export type IsianDeliverable = { platform: string; format: string; qty: number };
export type IsianSampel = { itemId: string; variantSku?: string | null; qty: number };

function deliverables(v: unknown): BarisDeliverable[] | null {
  if (!Array.isArray(v)) return null;
  const hasil: BarisDeliverable[] = [];
  for (const d of v.slice(0, 50)) {
    if (!d || !platformSah(d.platform) || !formatSah(d.format)) return null;
    hasil.push({ platform: d.platform, format: d.format, qty: Number(d.qty) });
  }
  return hasil;
}

function sampel(v: unknown): BarisBarangKirim[] | null {
  if (!Array.isArray(v)) return null;
  const hasil: BarisBarangKirim[] = [];
  for (const b of v.slice(0, 100)) {
    if (!b || typeof b.itemId !== "string") return null;
    hasil.push({ itemId: b.itemId, variantSku: typeof b.variantSku === "string" ? b.variantSku : null, qty: Number(b.qty) });
  }
  return hasil;
}

export type IsianKolaborasi = {
  kolId?: string;
  campaignId?: string | null;
  tahap?: string;
  jenis?: string;
  fee?: number;
  commissionPct?: number | null;
  picId?: string | null;
  /** "YYYY-MM-DD". */
  plannedLiveAt?: string | null;
  briefText?: string | null;
  doList?: string | null;
  dontList?: string | null;
  deliverables?: IsianDeliverable[];
  sampel?: IsianSampel[];
};

export async function buatKolaborasiAction(isi: IsianKolaborasi): Promise<HasilAksiKolaborasi<{ id: string; docNo: string }>> {
  const oleh = await penulis();
  if (!oleh) return { ok: false, kode: "TANPA_AKSES" };
  if (typeof isi?.kolId !== "string" || !isi.kolId) return { ok: false, kode: "TIDAK_DITEMUKAN", detail: "kol" };
  if (isi.tahap !== undefined && !tahapSah(isi.tahap)) return { ok: false, kode: "STATUS_TIDAK_VALID" };
  if (isi.jenis !== undefined && !jenisSah(isi.jenis)) return { ok: false, kode: "TIDAK_VALID" };
  const dl = deliverables(isi.deliverables ?? []);
  const sp = sampel(isi.sampel ?? []);
  if (!dl || !sp) return { ok: false, kode: "TIDAK_VALID" };
  const fee = angkaAtauNull(isi.fee) ?? 0;
  if (fee < 0) return { ok: false, kode: "TIDAK_VALID", detail: "fee" };
  const komisi = angkaAtauNull(isi.commissionPct);
  if (komisi !== null && (komisi < 0 || komisi > 100)) return { ok: false, kode: "TIDAK_VALID", detail: "komisi" };
  try {
    const r = await buatBrief({
      kolId: isi.kolId,
      campaignId: typeof isi.campaignId === "string" && isi.campaignId ? isi.campaignId : null,
      tahap: isi.tahap as Tahap | undefined,
      jenis: isi.jenis as JenisKerjaSama | undefined,
      fee,
      commissionPct: komisi,
      picId: typeof isi.picId === "string" && isi.picId ? isi.picId : null,
      plannedLiveAt: tanggal(isi.plannedLiveAt),
      briefText: teks(isi.briefText),
      doList: teks(isi.doList),
      dontList: teks(isi.dontList),
      deliverables: dl,
      barang: sp,
      olehUserId: oleh,
    });
    if (!r.ok) return { ok: false, kode: r.alasan, detail: r.detail };
    segarkan();
    return { ok: true, id: r.id, docNo: r.docNo };
  } catch (err) {
    console.error("buatKolaborasi gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}

/**
 * Ubah isi kolaborasi. Fee dan jenis kerja sama sesudah tayang wajib beralasan
 * (`ALASAN_WAJIB` dengan detail "fee" — layar lalu meminta alasannya).
 */
export async function ubahKolaborasiAction(
  id: string,
  isi: IsianKolaborasi,
  alasan?: string | null,
): Promise<HasilAksiKolaborasi<{ id: string }>> {
  const oleh = await penulis();
  if (!oleh) return { ok: false, kode: "TANPA_AKSES" };
  if (typeof id !== "string" || !id) return { ok: false, kode: "TIDAK_DITEMUKAN" };
  if (isi.jenis !== undefined && !jenisSah(isi.jenis)) return { ok: false, kode: "TIDAK_VALID" };
  const dl = isi.deliverables === undefined ? undefined : deliverables(isi.deliverables);
  const sp = isi.sampel === undefined ? undefined : sampel(isi.sampel);
  if (dl === null || sp === null) return { ok: false, kode: "TIDAK_VALID" };
  try {
    const r = await ubahKolaborasi({
      id,
      isi: {
        campaignId: isi.campaignId === undefined ? undefined : typeof isi.campaignId === "string" && isi.campaignId ? isi.campaignId : null,
        jenis: isi.jenis as JenisKerjaSama | undefined,
        fee: isi.fee === undefined ? undefined : (angkaAtauNull(isi.fee) ?? -1),
        commissionPct: isi.commissionPct === undefined ? undefined : angkaAtauNull(isi.commissionPct),
        picId: isi.picId === undefined ? undefined : typeof isi.picId === "string" && isi.picId ? isi.picId : null,
        plannedLiveAt: isi.plannedLiveAt === undefined ? undefined : tanggal(isi.plannedLiveAt),
        briefText: isi.briefText === undefined ? undefined : teks(isi.briefText),
        doList: isi.doList === undefined ? undefined : teks(isi.doList),
        dontList: isi.dontList === undefined ? undefined : teks(isi.dontList),
        deliverables: dl,
        barang: sp,
      },
      alasan: teks(alasan, 1000),
      olehUserId: oleh,
    });
    if (!r.ok) return { ok: false, kode: r.alasan, detail: r.detail };
    segarkan();
    return { ok: true, id: r.id };
  } catch (err) {
    console.error("ubahKolaborasi gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}

/** Pindah tahap satu kolaborasi. Mundur, keluar, dan buka lagi wajib beralasan. */
export async function pindahTahapAction(
  id: string,
  ke: string,
  alasan?: string | null,
): Promise<HasilAksiKolaborasi<{ dari: Tahap; ke: Tahap }>> {
  const oleh = await penulis();
  if (!oleh) return { ok: false, kode: "TANPA_AKSES" };
  if (!tahapSah(ke) || typeof id !== "string") return { ok: false, kode: "STATUS_TIDAK_VALID" };
  try {
    const r = await pindahTahapKolaborasi({ kolaborasiId: id, ke, alasan: teks(alasan, 1000), olehUserId: oleh });
    if (!r.ok) return { ok: false, kode: r.alasan, detail: r.detail };
    segarkan();
    return { ok: true, dari: r.dari, ke: r.ke };
  } catch (err) {
    console.error("pindahTahap gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}

export async function pindahTahapBanyakAction(
  ids: string[],
  ke: string,
  alasan?: string | null,
): Promise<HasilAksiKolaborasi<{ dipindah: number; gagal: GagalMassal[] }>> {
  const oleh = await penulis();
  if (!oleh) return { ok: false, kode: "TANPA_AKSES" };
  if (!tahapSah(ke) || !Array.isArray(ids)) return { ok: false, kode: "STATUS_TIDAK_VALID" };
  try {
    const r = await pindahTahapBanyak({
      ids: ids.filter((x): x is string => typeof x === "string"),
      ke,
      alasan: teks(alasan, 1000),
      olehUserId: oleh,
    });
    if (!r.ok) return { ok: false, kode: r.alasan };
    if (r.dipindah.length) segarkan();
    return { ok: true, dipindah: r.dipindah.length, gagal: r.gagal };
  } catch (err) {
    console.error("pindahTahapBanyak gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}

/**
 * Masukkan beberapa KOL ke satu campaign (dipakai daftar KOL dan daftar
 * Kolaborasi). KOL yang sudah ada di campaign itu dan yang diblokir dilewati.
 */
export async function masukkanKeCampaignAction(
  kolIds: string[],
  campaignId: string,
  tahapAwal: string = "PROSPEK",
): Promise<HasilAksiKolaborasi<{ dibuat: number; sudahAda: number; diblokir: number }>> {
  const oleh = await penulis();
  if (!oleh) return { ok: false, kode: "TANPA_AKSES" };
  if (!Array.isArray(kolIds) || typeof campaignId !== "string" || !campaignId) return { ok: false, kode: "TIDAK_VALID" };
  if (!tahapSah(tahapAwal)) return { ok: false, kode: "STATUS_TIDAK_VALID" };
  try {
    const r = await masukkanKeCampaign({
      kolIds: kolIds.filter((x): x is string => typeof x === "string"),
      campaignId,
      tahapAwal,
      olehUserId: oleh,
    });
    if (!r.ok) return { ok: false, kode: r.alasan, detail: r.detail };
    if (r.dibuat) segarkan();
    return { ok: true, dibuat: r.dibuat, sudahAda: r.sudahAda, diblokir: r.diblokir };
  } catch (err) {
    console.error("masukkanKeCampaign gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}

/**
 * Aksi massal daftar Kolaborasi: kolaborasi yang dipilih dipindah ke satu
 * campaign di tempat (tidak membuat kolaborasi baru). Yang sudah di sana atau
 * yang KOL-nya sudah punya kolaborasi lain di campaign itu dilewati.
 */
export async function pindahkanKeCampaignAction(
  ids: string[],
  campaignId: string,
): Promise<HasilAksiKolaborasi<{ dipindah: number; sudahAda: number; kembar: number }>> {
  const oleh = await penulis();
  if (!oleh) return { ok: false, kode: "TANPA_AKSES" };
  if (!Array.isArray(ids) || typeof campaignId !== "string" || !campaignId) return { ok: false, kode: "TIDAK_VALID" };
  try {
    const r = await pindahkanKeCampaign({
      ids: ids.filter((x): x is string => typeof x === "string"),
      campaignId,
      olehUserId: oleh,
    });
    if (!r.ok) return { ok: false, kode: r.alasan, detail: r.detail };
    if (r.dipindah) segarkan();
    return { ok: true, dipindah: r.dipindah, sudahAda: r.sudahAda, kembar: r.kembar };
  } catch (err) {
    console.error("pindahkanKeCampaign gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}

/* ─────────────────────────── Bacaan dialog ─────────────────────────── */

export async function cariKolAction(q: string): Promise<HasilAksiKolaborasi<{ hasil: HasilCariKol[] }>> {
  if (!(await izin())) return { ok: false, kode: "TANPA_AKSES" };
  try {
    return { ok: true, hasil: await cariKolUntukKolaborasi(typeof q === "string" ? q.slice(0, 100) : "") };
  } catch (err) {
    console.error("cariKol gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}

export async function riwayatKolAction(kolId: string): Promise<HasilAksiKolaborasi<{ riwayat: RiwayatKol }>> {
  if (!(await izin())) return { ok: false, kode: "TANPA_AKSES" };
  try {
    const r = typeof kolId === "string" && kolId ? await ringkasRiwayatKol(kolId) : null;
    return r ? { ok: true, riwayat: r } : { ok: false, kode: "TIDAK_DITEMUKAN" };
  } catch (err) {
    console.error("riwayatKol gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}

/** Varian satu barang dengan stok tersedia (qtyOnHand − reservedQty) per varian. */
export async function pilihanVarianSampelAction(itemId: string): Promise<HasilAksiKolaborasi<{ pilihan: PilihanVarianKirim }>> {
  if (!(await izin())) return { ok: false, kode: "TANPA_AKSES" };
  try {
    if (typeof itemId !== "string" || !itemId) return { ok: false, kode: "BARANG_TIDAK_DITEMUKAN" };
    return { ok: true, pilihan: await pilihanVarianKirim(itemId) };
  } catch (err) {
    console.error("pilihanVarianSampel gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}
