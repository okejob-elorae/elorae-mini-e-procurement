"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { formatDisplayDateTime } from "@/lib/date-only";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { hariIniWib } from "@/lib/tanggal-isian";
import { postingUlangJurnalKol } from "@/lib/creative/jurnal-kol";
import { bacaChipTermin } from "@/lib/creative/termin-param";
import { csvTermin, namaBerkasTermin } from "@/lib/creative/termin-csv";
import { semuaTermin } from "@/lib/creative/termin-queries";
import type { DasarRencana, RencanaTermin } from "@/lib/creative/termin-aturan";
import {
  aturTermin,
  batalkanBayarTermin,
  bayarTermin,
  bayarTerminBanyak,
  catatBuktiPotong,
  catatSetorPph,
  ubahModePajak,
  type KodeGagalTermin,
} from "@/lib/creative/termin-writer";

/*
 * Termin pembayaran fee KOL. Setiap ekspor berkas "use server" adalah endpoint
 * yang bisa dipanggil langsung, jadi izin diperiksa di SETIAP aksi dan
 * pengguna selalu diambil dari sesi — tidak pernah dari klien.
 *
 * - Mengatur termin, mode pajak, membayar, dan membatalkan bayar: pengelola
 *   Kreatif (`creative:manage`) atau keuangan (`journals:manage`).
 * - Bukti potong susulan dan setoran PPh: keuangan (`journals:manage`).
 * - Posting ulang jurnal: keuangan.
 */

type KodeAksi = KodeGagalTermin | "TANPA_AKSES" | "GAGAL" | "KOSONG" | "TERLALU_BANYAK";

async function sesi() {
  const s = await auth();
  if (!s?.user?.id) return null;
  const p = s.user.permissions ?? [];
  return {
    userId: s.user.id,
    bolehBayar: hasPermission(p, PERMISSIONS.CREATIVE_MANAGE) || hasPermission(p, PERMISSIONS.JOURNALS_MANAGE),
    bolehLihat: hasPermission(p, PERMISSIONS.CREATIVE_VIEW) || hasPermission(p, PERMISSIONS.JOURNALS_VIEW),
    keuangan: hasPermission(p, PERMISSIONS.JOURNALS_MANAGE),
  };
}

const teks = (v: unknown): string | null => (typeof v === "string" ? v : null);

function segarkan() {
  revalidatePath("/backoffice/kreatif", "layout");
  revalidatePath("/backoffice/finance/pph-dipotong");
}

function bersihRencana(rencana: unknown): RencanaTermin[] {
  if (!Array.isArray(rencana)) return [];
  return rencana.slice(0, 50).map((r) => {
    const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    return {
      label: String(o.label ?? ""),
      persen: num(o.persen),
      jumlah: num(o.jumlah),
      pemicu: String(o.pemicu ?? "") as RencanaTermin["pemicu"],
      hariSesudah: num(o.hariSesudah),
      tanggal: teks(o.tanggal),
      catatan: teks(o.catatan),
    };
  });
}

export async function aturTerminAction(input: { kolaborasiId: string; rencana: RencanaTermin[]; dasar: DasarRencana }) {
  const s = await sesi();
  if (!s?.bolehBayar) return { ok: false as const, kode: "TANPA_AKSES" as KodeAksi };
  try {
    const r = await aturTermin({
      kolaborasiId: String(input?.kolaborasiId ?? ""),
      rencana: bersihRencana(input?.rencana),
      dasar: input?.dasar === "JUMLAH" ? "JUMLAH" : "PERSEN",
      olehUserId: s.userId,
    });
    if (r.ok) segarkan();
    return r;
  } catch (err) {
    console.error("aturTermin gagal:", err);
    return { ok: false as const, kode: "GAGAL" as KodeAksi };
  }
}

export async function ubahModePajakAction(input: { kolaborasiId: string; mode: string }) {
  const s = await sesi();
  if (!s?.bolehBayar) return { ok: false as const, kode: "TANPA_AKSES" as KodeAksi };
  try {
    const r = await ubahModePajak({ kolaborasiId: String(input?.kolaborasiId ?? ""), mode: String(input?.mode ?? ""), olehUserId: s.userId });
    if (r.ok && r.berubah) segarkan();
    return r;
  } catch (err) {
    console.error("ubahModePajak gagal:", err);
    return { ok: false as const, kode: "GAGAL" as KodeAksi };
  }
}

export async function bayarTerminAction(input: {
  terminId: string;
  tanggal: string;
  buktiTransferUrl?: string | null;
  nomorBuktiPotong?: string | null;
  catatan?: string | null;
}) {
  const s = await sesi();
  if (!s?.bolehBayar) return { ok: false as const, kode: "TANPA_AKSES" as KodeAksi };
  try {
    const r = await bayarTermin({
      terminId: String(input?.terminId ?? ""),
      tanggal: String(input?.tanggal ?? ""),
      buktiTransferUrl: teks(input?.buktiTransferUrl),
      nomorBuktiPotong: teks(input?.nomorBuktiPotong),
      catatan: input?.catatan === undefined ? undefined : teks(input.catatan),
      olehUserId: s.userId,
    });
    if (r.ok) segarkan();
    return r;
  } catch (err) {
    console.error("bayarTermin gagal:", err);
    return { ok: false as const, kode: "GAGAL" as KodeAksi };
  }
}

export async function bayarTerminBanyakAction(input: { terminIds: string[]; tanggal: string; buktiTransferUrl?: string | null }) {
  const s = await sesi();
  if (!s?.bolehBayar) return { ok: false as const, kode: "TANPA_AKSES" as KodeAksi };
  try {
    const r = await bayarTerminBanyak({
      terminIds: Array.isArray(input?.terminIds) ? input.terminIds.map((x) => String(x ?? "")) : [],
      tanggal: String(input?.tanggal ?? ""),
      buktiTransferUrl: teks(input?.buktiTransferUrl),
      olehUserId: s.userId,
    });
    if (r.ok) segarkan();
    return r;
  } catch (err) {
    console.error("bayarTerminBanyak gagal:", err);
    return { ok: false as const, kode: "GAGAL" as KodeAksi };
  }
}

export async function batalkanBayarTerminAction(input: { terminId: string; alasan: string }) {
  const s = await sesi();
  if (!s?.bolehBayar) return { ok: false as const, kode: "TANPA_AKSES" as KodeAksi };
  try {
    const r = await batalkanBayarTermin({ terminId: String(input?.terminId ?? ""), alasan: String(input?.alasan ?? ""), olehUserId: s.userId });
    if (r.ok) segarkan();
    return r;
  } catch (err) {
    console.error("batalkanBayarTermin gagal:", err);
    return { ok: false as const, kode: "GAGAL" as KodeAksi };
  }
}

export async function catatBuktiPotongAction(input: { terminId: string; nomor: string | null; tanggal?: string | null }) {
  const s = await sesi();
  if (!s?.keuangan) return { ok: false as const, kode: "TANPA_AKSES" as KodeAksi };
  try {
    const r = await catatBuktiPotong({ terminId: String(input?.terminId ?? ""), nomor: teks(input?.nomor), tanggal: teks(input?.tanggal), olehUserId: s.userId });
    if (r.ok) segarkan();
    return r;
  } catch (err) {
    console.error("catatBuktiPotong gagal:", err);
    return { ok: false as const, kode: "GAGAL" as KodeAksi };
  }
}

export async function catatSetorPphAction(input: { terminId: string; setor: { tanggal: string; ntpn: string } | null }) {
  const s = await sesi();
  if (!s?.keuangan) return { ok: false as const, kode: "TANPA_AKSES" as KodeAksi };
  try {
    const setor = input?.setor ? { tanggal: String(input.setor.tanggal ?? ""), ntpn: String(input.setor.ntpn ?? "") } : null;
    const r = await catatSetorPph({ terminId: String(input?.terminId ?? ""), setor, olehUserId: s.userId });
    if (r.ok) segarkan();
    return r;
  } catch (err) {
    console.error("catatSetorPph gagal:", err);
    return { ok: false as const, kode: "GAGAL" as KodeAksi };
  }
}

/** Posting ulang jurnal KOL yang tertunda untuk satu kolaborasi (keuangan). */
export async function postingUlangJurnalKolAction(kolaborasiId: string) {
  const s = await sesi();
  if (!s?.keuangan) return { ok: false as const, kode: "TANPA_AKSES" as const };
  try {
    const r = await postingUlangJurnalKol(String(kolaborasiId ?? ""), s.userId);
    segarkan();
    revalidatePath("/backoffice/finance/journals");
    return { ok: r.ok, diposting: r.diposting, gagal: r.gagal.map((g) => ({ kode: g.kode, peran: g.peran })) };
  } catch (err) {
    console.error("postingUlangJurnalKol gagal:", err);
    return { ok: false as const, kode: "GAGAL" as const };
  }
}

/** CSV daftar termin untuk saringan yang sedang dibuka (semua halaman). */
export async function eksporTerminAction(input: { chip?: string; cari?: string | null; campaignId?: string | null; kolaborasiId?: string | null }) {
  const s = await sesi();
  if (!s?.bolehLihat) return { ok: false as const, kode: "TANPA_AKSES" as const };
  try {
    const hariIni = hariIniWib();
    const baris = await semuaTermin(
      { chip: bacaChipTermin(input?.chip), cari: teks(input?.cari), campaignId: teks(input?.campaignId), kolaborasiId: teks(input?.kolaborasiId) },
      hariIni,
    );
    const isi = csvTermin(baris, `Termin pembayaran KOL — dibuat ${formatDisplayDateTime(new Date())} WIB`);
    return { ok: true as const, isi, namaBerkas: namaBerkasTermin(hariIni) };
  } catch (err) {
    console.error("eksporTermin gagal:", err);
    return { ok: false as const, kode: "GAGAL" as const };
  }
}
