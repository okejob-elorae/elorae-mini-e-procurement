"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { formatDisplayDateTime } from "@/lib/date-only";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { catatJejak, JEJAK } from "@/lib/receivables/jejak";
import { verifyPinForAction } from "@/app/actions/security/pin-auth";
import type { KolomSensitif } from "@/lib/creative/data-sensitif";
import { simpanTarifPajakKreatif } from "@/lib/creative/pajak-pengaturan";
import { bukaDataSensitifKol, simpanDataSensitifKol, simpanPajakKol } from "@/lib/creative/pajak-kol-writer";
import { csvPph, namaBerkasPph } from "@/lib/creative/termin-csv";
import { bacaMasa } from "@/lib/creative/termin-param";
import { daftarPphDipotong, identitasLengkap } from "@/lib/creative/termin-queries";

/*
 * Data pajak KOL, data sensitif, tarif PPh, dan ekspor PPh dipotong. Izin
 * diperiksa di SETIAP aksi, pengguna dari sesi.
 *
 * - Subjek pajak & menulis rekening/NIK/NPWP: pengelola Kreatif
 *   (`creative:manage`). Menulis TIDAK pernah mengembalikan nilai lama.
 * - Membuka isi lengkap: keuangan (`journals:manage`, admin sistem `*` ikut)
 *   + PIN; setiap pembukaan dicatat `KOL_SENSITIVE_VIEWED`.
 * - Tarif PPh: pengelola Kreatif atau keuangan.
 * - Ekspor PPh dipotong: pembaca jurnal; identitas lengkap hanya untuk
 *   keuangan yang memasukkan PIN (dicatat per KOL).
 */

async function sesi() {
  const s = await auth();
  if (!s?.user?.id) return null;
  const p = s.user.permissions ?? [];
  return {
    userId: s.user.id,
    kreatif: hasPermission(p, PERMISSIONS.CREATIVE_MANAGE),
    keuangan: hasPermission(p, PERMISSIONS.JOURNALS_MANAGE),
    bacaJurnal: hasPermission(p, PERMISSIONS.JOURNALS_VIEW),
  };
}

function segarkan(kolId?: string) {
  revalidatePath("/backoffice/kreatif", "layout");
  if (kolId) revalidatePath(`/backoffice/kreatif/kol/${kolId}`);
}

export async function simpanPajakKolAction(input: {
  kolId: string;
  jenisPajak: string;
  alasanTidakDipotong?: string | null;
  adaNpwp: boolean;
  grossUpBawaan: boolean;
}) {
  const s = await sesi();
  if (!s?.kreatif) return { ok: false as const, kode: "TANPA_AKSES" as const };
  try {
    const r = await simpanPajakKol({
      kolId: String(input?.kolId ?? ""),
      jenisPajak: String(input?.jenisPajak ?? ""),
      alasanTidakDipotong: typeof input?.alasanTidakDipotong === "string" ? input.alasanTidakDipotong : null,
      adaNpwp: input?.adaNpwp === true,
      grossUpBawaan: input?.grossUpBawaan === true,
      olehUserId: s.userId,
    });
    if (r.ok && r.berubah) segarkan(input.kolId);
    return r;
  } catch (err) {
    console.error("simpanPajakKol gagal:", err);
    return { ok: false as const, kode: "GAGAL" as const };
  }
}

const KOLOM: readonly KolomSensitif[] = ["bankName", "bankAccount", "bankHolder", "nik", "npwp"];

/** Tulis-saja: hanya kolom yang dikirim yang diubah; string kosong/null menghapus. */
export async function simpanDataSensitifKolAction(input: { kolId: string; isi: Partial<Record<KolomSensitif, string | null>> }) {
  const s = await sesi();
  if (!s?.kreatif) return { ok: false as const, kode: "TANPA_AKSES" as const };
  const isi: Partial<Record<KolomSensitif, string | null>> = {};
  for (const k of KOLOM) {
    const v = input?.isi?.[k];
    if (v === null) isi[k] = null;
    else if (typeof v === "string") isi[k] = v;
  }
  try {
    const r = await simpanDataSensitifKol({ kolId: String(input?.kolId ?? ""), isi, olehUserId: s.userId });
    if (r.ok) segarkan(input.kolId);
    return r;
  } catch (err) {
    console.error("simpanDataSensitifKol gagal:", err);
    return { ok: false as const, kode: "GAGAL" as const };
  }
}

/** Buka rekening/NIK/NPWP lengkap: keuangan + PIN, dicatat. */
export async function bukaDataSensitifKolAction(input: { kolId: string; pin: string; alasan?: string | null }) {
  const s = await sesi();
  if (!s?.keuangan) return { ok: false as const, kode: "TANPA_AKSES" as const };
  if (typeof input?.pin !== "string" || !input.pin.trim()) return { ok: false as const, kode: "PIN" as const, pesan: "pinInvalid" };
  const pin = await verifyPinForAction(s.userId, input.pin, "VIEW_KOL_SENSITIVE", input.alasan ?? undefined, "server-action");
  if (!pin.success) return { ok: false as const, kode: "PIN" as const, pesan: pin.messageKey ?? "pinIncorrect" };
  try {
    return await bukaDataSensitifKol({ kolId: String(input.kolId ?? ""), olehUserId: s.userId, alasan: input.alasan });
  } catch (err) {
    console.error("bukaDataSensitifKol gagal:", err);
    return { ok: false as const, kode: "GAGAL" as const };
  }
}

export async function simpanTarifPajakAction(tarif: unknown) {
  const s = await sesi();
  if (!s?.kreatif && !s?.keuangan) return { ok: false as const, kode: "TANPA_AKSES" as const };
  try {
    const r = await simpanTarifPajakKreatif(tarif, s.userId);
    if (r.ok) segarkan();
    return r;
  } catch (err) {
    console.error("simpanTarifPajak gagal:", err);
    return { ok: false as const, kode: "GAGAL" as const };
  }
}

/**
 * CSV bahan Coretax untuk satu masa. Tanpa PIN: identitas tersamar. Dengan
 * PIN (keuangan): identitas lengkap, dan SETIAP KOL di dalamnya mendapat
 * jejak `KOL_SENSITIVE_VIEWED`.
 */
export async function eksporPphDipotongAction(input: { masa: string; pin?: string | null }) {
  const s = await sesi();
  if (!s?.bacaJurnal) return { ok: false as const, kode: "TANPA_AKSES" as const };
  const masa = bacaMasa(input?.masa);
  if (!masa) return { ok: false as const, kode: "MASA_TIDAK_VALID" as const };
  const lengkap = typeof input?.pin === "string" && input.pin.trim() !== "";
  if (lengkap) {
    if (!s.keuangan) return { ok: false as const, kode: "TANPA_AKSES" as const };
    const pin = await verifyPinForAction(s.userId, input.pin!, "VIEW_KOL_SENSITIVE", `Ekspor PPh dipotong ${masa}`, "server-action");
    if (!pin.success) return { ok: false as const, kode: "PIN" as const, pesan: pin.messageKey ?? "pinIncorrect" };
  }
  try {
    const baris = await daftarPphDipotong(masa);
    const kolIds = [...new Set(baris.map((b) => b.kolId))];
    const identitas = lengkap ? await identitasLengkap(kolIds) : undefined;
    if (lengkap && kolIds.length > 0) {
      await prisma.$transaction(async (tx) => {
        for (const kolId of kolIds) {
          await catatJejak(tx, {
            userId: s.userId,
            action: JEJAK.DATA_SENSITIF_KOL_DIBUKA,
            entityType: "Kol",
            entityId: kolId,
            metadata: { lewat: "ekspor PPh dipotong", masa },
          });
        }
      });
    }
    const isi = csvPph(masa, baris, `PPh dipotong fee KOL — masa ${masa} — dibuat ${formatDisplayDateTime(new Date())} WIB`, identitas);
    return { ok: true as const, isi, namaBerkas: namaBerkasPph(masa), lengkap };
  } catch (err) {
    console.error("eksporPphDipotong gagal:", err);
    return { ok: false as const, kode: "GAGAL" as const };
  }
}
