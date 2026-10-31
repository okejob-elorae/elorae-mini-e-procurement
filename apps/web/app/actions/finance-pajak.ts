"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { runSerializable } from "@/lib/db/tx-retry";
import { parseDateOnly } from "@/lib/date-only";
import { KUNCI_PENGATURAN_PPN, periksaPengaturanPpn, type PengaturanPpn } from "@/lib/finance/pajak/ppn";
import { bacaPengaturanPpn } from "@/lib/finance/pajak/ppn-pengaturan";
import { KUNCI_PROFIL_PAJAK, periksaProfilPajak, type ProfilPajak } from "@/lib/finance/pajak/profil";
import { bacaProfilPajak } from "@/lib/finance/pajak/profil-pengaturan";
import { KUNCI_IDENTITAS_PAJAK, periksaIdentitasPajak, rapikanNpwp, type IdentitasPajak } from "@/lib/finance/pajak/identitas";
import { bacaIdentitasPajak } from "@/lib/finance/pajak/identitas-pengaturan";
import { JEJAK_PAJAK, catatJejakPajak, type JejakPajak } from "@/lib/finance/pajak/jejak-pajak";
import { bukaRekapPpn, finalkanRekapPpn } from "@/lib/finance/pajak/masa-writer";
import { batalkanSetoran, catatSetoran } from "@/lib/finance/pajak/setoran-writer";
import { bukaPphFinal, postingPphFinal } from "@/lib/finance/pajak/pph-final-writer";
import { xmlFakturKeluaran } from "@/lib/finance/pajak/coretax";
import { notaUntukEkspor, type SertakanFaktur } from "@/lib/finance/pajak/coretax-queries";

/*
 * Aksi modul pajak. Izin diperiksa di SETIAP aksi; pelaku dari sesi; hasil
 * `{ ok:false, kode }`, tidak pernah melempar ke layar.
 *
 * - Rekap masa PPN, PPh final, setoran pajak: keuangan (`journals:manage`).
 * - Ekspor faktur keluaran Coretax: pembaca faktur pajak (`tax_invoices:view`).
 * - Pengaturan PPN, profil & identitas pajak: `settings_tax:manage` (membaca:
 *   `settings_tax:view`).
 */

type Gagal<K extends string> = { ok: false; kode: K; peran?: string };

async function sesi() {
  const s = await auth();
  if (!s?.user?.id) return null;
  const p = s.user.permissions ?? [];
  return {
    userId: s.user.id,
    keuangan: hasPermission(p, PERMISSIONS.JOURNALS_MANAGE),
    faktur: hasPermission(p, PERMISSIONS.TAX_INVOICES_VIEW),
    lihatPengaturan: hasPermission(p, PERMISSIONS.SETTINGS_TAX_VIEW) || hasPermission(p, PERMISSIONS.SETTINGS_TAX_MANAGE),
    ubahPengaturan: hasPermission(p, PERMISSIONS.SETTINGS_TAX_MANAGE),
  };
}

function segarkanPajak() {
  revalidatePath("/backoffice/finance/pajak", "layout");
  revalidatePath("/backoffice/finance/journals");
  revalidatePath("/backoffice");
}

// ───────────────────── Rekap masa PPN ─────────────────────

export async function finalkanRekapPpnAction(input: { masa: string; catatan?: string | null }) {
  const s = await sesi();
  if (!s?.keuangan) return { ok: false, kode: "TANPA_AKSES" } as Gagal<"TANPA_AKSES">;
  try {
    const r = await finalkanRekapPpn({ masa: String(input?.masa ?? ""), olehUserId: s.userId, catatan: input?.catatan ?? null });
    if (r.ok) segarkanPajak();
    return r;
  } catch (e) {
    console.error("[finalkanRekapPpn] gagal", e);
    return { ok: false, kode: "GAGAL" } as Gagal<"GAGAL">;
  }
}

export async function bukaRekapPpnAction(input: { masa: string; alasan: string }) {
  const s = await sesi();
  if (!s?.keuangan) return { ok: false, kode: "TANPA_AKSES" } as Gagal<"TANPA_AKSES">;
  try {
    const r = await bukaRekapPpn({ masa: String(input?.masa ?? ""), olehUserId: s.userId, alasan: String(input?.alasan ?? "") });
    if (r.ok) segarkanPajak();
    return r;
  } catch (e) {
    console.error("[bukaRekapPpn] gagal", e);
    return { ok: false, kode: "GAGAL" } as Gagal<"GAGAL">;
  }
}

// ───────────────────── PPh final UMKM ─────────────────────

export async function postingPphFinalAction(input: { masa: string }) {
  const s = await sesi();
  if (!s?.keuangan) return { ok: false, kode: "TANPA_AKSES" } as Gagal<"TANPA_AKSES">;
  try {
    const r = await postingPphFinal({ masa: String(input?.masa ?? ""), olehUserId: s.userId });
    if (r.ok) segarkanPajak();
    return r;
  } catch (e) {
    console.error("[postingPphFinal] gagal", e);
    return { ok: false, kode: "GAGAL" } as Gagal<"GAGAL">;
  }
}

export async function bukaPphFinalAction(input: { masa: string; alasan: string }) {
  const s = await sesi();
  if (!s?.keuangan) return { ok: false, kode: "TANPA_AKSES" } as Gagal<"TANPA_AKSES">;
  try {
    const r = await bukaPphFinal({ masa: String(input?.masa ?? ""), olehUserId: s.userId, alasan: String(input?.alasan ?? "") });
    if (r.ok) segarkanPajak();
    return r;
  } catch (e) {
    console.error("[bukaPphFinal] gagal", e);
    return { ok: false, kode: "GAGAL" } as Gagal<"GAGAL">;
  }
}

// ───────────────────── Setoran pajak ─────────────────────

export async function catatSetoranAction(input: {
  jenis: string;
  masa: string;
  jumlah: number | string;
  tanggalBayar: string;
  ntpn: string;
  kodeBilling?: string | null;
  rekeningId?: string | null;
  catatan?: string | null;
  idempotencyKey?: string | null;
}) {
  const s = await sesi();
  if (!s?.keuangan) return { ok: false, kode: "TANPA_AKSES" } as Gagal<"TANPA_AKSES">;
  try {
    const r = await catatSetoran({ ...input, olehUserId: s.userId });
    if (r.ok) segarkanPajak();
    return r;
  } catch (e) {
    console.error("[catatSetoran] gagal", e);
    return { ok: false, kode: "GAGAL" } as Gagal<"GAGAL">;
  }
}

export async function batalkanSetoranAction(input: { id: string; alasan: string }) {
  const s = await sesi();
  if (!s?.keuangan) return { ok: false, kode: "TANPA_AKSES" } as Gagal<"TANPA_AKSES">;
  try {
    const r = await batalkanSetoran({ id: String(input?.id ?? ""), olehUserId: s.userId, alasan: String(input?.alasan ?? "") });
    if (r.ok) segarkanPajak();
    return r;
  } catch (e) {
    console.error("[batalkanSetoran] gagal", e);
    return { ok: false, kode: "GAGAL" } as Gagal<"GAGAL">;
  }
}

// ───────────────────── Ekspor faktur keluaran Coretax ─────────────────────

const POLA_TANGGAL = /^\d{4}-\d{2}-\d{2}$/;

export async function eksporFakturKeluaranAction(input: { dari: string; sampai: string; sertakan?: SertakanFaktur }) {
  const s = await sesi();
  if (!s?.faktur) return { ok: false, kode: "TANPA_AKSES" } as Gagal<"TANPA_AKSES">;
  const dari = String(input?.dari ?? "");
  const sampai = String(input?.sampai ?? "");
  if (!POLA_TANGGAL.test(dari) || !POLA_TANGGAL.test(sampai) || sampai < dari) return { ok: false, kode: "RENTANG_TIDAK_SAH" } as Gagal<"RENTANG_TIDAK_SAH">;
  try {
    const [pengaturan, identitas] = await Promise.all([bacaPengaturanPpn(), bacaIdentitasPajak()]);
    if (!rapikanNpwp(identitas.npwp)) return { ok: false, kode: "NPWP_PERUSAHAAN_KOSONG" } as Gagal<"NPWP_PERUSAHAAN_KOSONG">;
    const mulai = parseDateOnly(dari) as Date;
    const akhir = new Date((parseDateOnly(sampai) as Date).getTime() + 86_400_000);
    const sertakan: SertakanFaktur = input?.sertakan === "SEMUA" ? "SEMUA" : "MENUNGGU";
    const { baris, faktur, terpotong } = await notaUntukEkspor({ mulai, sampai: akhir, sertakan, pengaturan });
    if (faktur.length === 0) return { ok: false, kode: "KOSONG" } as Gagal<"KOSONG">;
    const isi = xmlFakturKeluaran(faktur, identitas);
    await runSerializable((tx) =>
      catatJejakPajak(tx, {
        userId: s.userId,
        action: JEJAK_PAJAK.FAKTUR_DIEKSPOR,
        entityType: "TaxInvoiceExport",
        entityId: `${dari}_${sampai}`,
        metadata: { dari, sampai, sertakan, jumlah: faktur.length, nomor: baris.map((b) => b.nomor), terpotong },
      }),
    );
    return {
      ok: true as const,
      isi,
      namaBerkas: `faktur-keluaran-${dari}_${sampai}.xml`,
      jumlah: faktur.length,
      terpotong,
      peringatan: baris.flatMap((b) => b.peringatan),
    };
  } catch (e) {
    console.error("[eksporFakturKeluaran] gagal", e);
    return { ok: false, kode: "GAGAL" } as Gagal<"GAGAL">;
  }
}

// ───────────────────── Pengaturan → Pajak ─────────────────────

export async function ambilPengaturanPajakAction(): Promise<
  { ok: true; ppn: PengaturanPpn; profil: ProfilPajak; identitas: IdentitasPajak; bolehUbah: boolean } | Gagal<"TANPA_AKSES" | "GAGAL">
> {
  const s = await sesi();
  if (!s?.lihatPengaturan) return { ok: false, kode: "TANPA_AKSES" };
  try {
    const [ppn, profil, identitas] = await Promise.all([bacaPengaturanPpn(), bacaProfilPajak(), bacaIdentitasPajak()]);
    return { ok: true, ppn, profil, identitas, bolehUbah: s.ubahPengaturan };
  } catch (e) {
    console.error("[ambilPengaturanPajak] gagal", e);
    return { ok: false, kode: "GAGAL" };
  }
}

/** Simpan satu baris `SystemSetting` + jejak sebelum/sesudah, satu transaksi. */
async function simpanSetelan(kunci: string, nilai: unknown, userId: string, aksi: JejakPajak): Promise<void> {
  const teks = JSON.stringify(nilai);
  await runSerializable(async (tx) => {
    const lama = await tx.systemSetting.findUnique({ where: { key: kunci }, select: { value: true } });
    if (lama?.value === teks) return;
    await tx.systemSetting.upsert({ where: { key: kunci }, create: { key: kunci, value: teks }, update: { value: teks } });
    let sebelum: unknown = null;
    try {
      sebelum = lama ? JSON.parse(lama.value) : null;
    } catch {
      sebelum = lama?.value ?? null;
    }
    await catatJejakPajak(tx, { userId, action: aksi, entityType: "SystemSetting", entityId: kunci, changes: { before: sebelum, after: nilai } });
  });
}

function segarkanPengaturan() {
  revalidatePath("/backoffice/settings/tax");
  segarkanPajak();
  revalidatePath("/backoffice/finance", "layout");
}

export async function simpanPengaturanPpnAction(input: unknown) {
  const s = await sesi();
  if (!s?.ubahPengaturan) return { ok: false, kode: "TANPA_AKSES" } as Gagal<"TANPA_AKSES">;
  const r = periksaPengaturanPpn(input);
  if (!r.ok) return { ok: false, kode: r.galat[0] } as Gagal<string>;
  try {
    await simpanSetelan(KUNCI_PENGATURAN_PPN, r.pengaturan, s.userId, JEJAK_PAJAK.PENGATURAN_PPN_DIUBAH);
    segarkanPengaturan();
    return { ok: true as const, ppn: r.pengaturan };
  } catch (e) {
    console.error("[simpanPengaturanPpn] gagal", e);
    return { ok: false, kode: "GAGAL" } as Gagal<"GAGAL">;
  }
}

export async function simpanProfilPajakAction(input: unknown) {
  const s = await sesi();
  if (!s?.ubahPengaturan) return { ok: false, kode: "TANPA_AKSES" } as Gagal<"TANPA_AKSES">;
  const r = periksaProfilPajak(input);
  if (!r.ok) return { ok: false, kode: r.galat } as Gagal<string>;
  try {
    await simpanSetelan(KUNCI_PROFIL_PAJAK, r.profil, s.userId, JEJAK_PAJAK.PROFIL_PAJAK_DIUBAH);
    segarkanPengaturan();
    return { ok: true as const, profil: r.profil };
  } catch (e) {
    console.error("[simpanProfilPajak] gagal", e);
    return { ok: false, kode: "GAGAL" } as Gagal<"GAGAL">;
  }
}

export async function simpanIdentitasPajakAction(input: unknown) {
  const s = await sesi();
  if (!s?.ubahPengaturan) return { ok: false, kode: "TANPA_AKSES" } as Gagal<"TANPA_AKSES">;
  const r = periksaIdentitasPajak(input);
  if (!r.ok) return { ok: false, kode: r.galat } as Gagal<string>;
  try {
    await simpanSetelan(KUNCI_IDENTITAS_PAJAK, r.identitas, s.userId, JEJAK_PAJAK.IDENTITAS_PAJAK_DIUBAH);
    segarkanPengaturan();
    return { ok: true as const, identitas: r.identitas };
  } catch (e) {
    console.error("[simpanIdentitasPajak] gagal", e);
    return { ok: false, kode: "GAGAL" } as Gagal<"GAGAL">;
  }
}
