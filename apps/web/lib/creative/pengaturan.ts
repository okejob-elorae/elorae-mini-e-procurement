import { prisma, type Prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { catatJejak, JEJAK } from "@/lib/receivables/jejak";
import { bacaAmbang, KUNCI_AMBANG, validasiAmbang, type AmbangKreatif, type HasilValidasiAmbang } from "./ambang";
import {
  BATAS_IDENTITAS,
  bacaIdentitas,
  bacaTemplateWa,
  KUNCI_IDENTITAS,
  KUNCI_TEMPLATE_WA,
  validasiTemplateWa,
  type IdentitasKreatif,
  type TemplateWa,
} from "./wa";

/**
 * Pengaturan Ruang KOL di `SystemSetting` — KHUSUS SERVER (mengimpor Prisma).
 * Klien hanya boleh `import type` dari berkas ini; pembaca murninya ada di
 * `ambang.ts` dan `wa.ts`.
 *
 * Pembaca selalu mengembalikan nilai yang bisa dipakai: baris kosong atau rusak
 * jatuh ke bawaan di kode. Penulis menyimpan bentuk yang sudah dirapikan dan
 * menulis jejak `CREATIVE_SETTINGS_UPDATED` (sebelum/sesudah) di transaksi
 * yang sama.
 */

export { KUNCI_AMBANG, KUNCI_IDENTITAS, KUNCI_TEMPLATE_WA };

export type PengaturanKreatif = { ambang: AmbangKreatif; templateWa: TemplateWa[]; identitas: IdentitasKreatif };

async function nilai(kunci: string): Promise<string | null> {
  const r = await prisma.systemSetting.findUnique({ where: { key: kunci }, select: { value: true } });
  return r?.value ?? null;
}

export async function bacaAmbangKreatif(): Promise<AmbangKreatif> {
  return bacaAmbang(await nilai(KUNCI_AMBANG));
}

export async function bacaTemplateWaKreatif(): Promise<TemplateWa[]> {
  return bacaTemplateWa(await nilai(KUNCI_TEMPLATE_WA));
}

export async function bacaIdentitasKreatif(): Promise<IdentitasKreatif> {
  return bacaIdentitas(await nilai(KUNCI_IDENTITAS));
}

/** Ketiganya sekaligus, satu kueri. */
export async function bacaPengaturanKreatif(): Promise<PengaturanKreatif> {
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: [KUNCI_AMBANG, KUNCI_TEMPLATE_WA, KUNCI_IDENTITAS] } },
    select: { key: true, value: true },
  });
  const ambil = (k: string) => rows.find((r) => r.key === k)?.value ?? null;
  return {
    ambang: bacaAmbang(ambil(KUNCI_AMBANG)),
    templateWa: bacaTemplateWa(ambil(KUNCI_TEMPLATE_WA)),
    identitas: bacaIdentitas(ambil(KUNCI_IDENTITAS)),
  };
}

async function tulis(
  tx: Prisma.TransactionClient,
  kunci: string,
  isi: string,
  olehUserId: string,
): Promise<void> {
  const lama = await tx.systemSetting.findUnique({ where: { key: kunci }, select: { value: true } });
  await tx.systemSetting.upsert({ where: { key: kunci }, create: { key: kunci, value: isi }, update: { value: isi } });
  await catatJejak(tx, {
    userId: olehUserId,
    action: JEJAK.PENGATURAN_KREATIF_DIUBAH,
    entityType: "SystemSetting",
    entityId: kunci,
    changes: { before: lama?.value ?? null, after: isi },
  });
}

export async function simpanAmbangKreatif(
  input: unknown,
  olehUserId: string,
): Promise<{ ok: true; ambang: AmbangKreatif } | { ok: false; kode: "TIDAK_VALID"; galat: Extract<HasilValidasiAmbang, { ok: false }>["galat"] }> {
  const v = validasiAmbang(input);
  if (!v.ok) return { ok: false, kode: "TIDAK_VALID", galat: v.galat };
  await runSerializable((tx) => tulis(tx, KUNCI_AMBANG, JSON.stringify(v.ambang), olehUserId));
  return { ok: true, ambang: v.ambang };
}

export type KodeTolakTemplate = Exclude<ReturnType<typeof validasiTemplateWa>, { ok: true }>["kode"];

export async function simpanTemplateWaKreatif(
  input: unknown,
  olehUserId: string,
): Promise<{ ok: true; templates: TemplateWa[] } | { ok: false; kode: KodeTolakTemplate; indeks?: number }> {
  const v = validasiTemplateWa(input);
  if (!v.ok) return { ok: false, kode: v.kode, ...("indeks" in v ? { indeks: v.indeks } : {}) };
  await runSerializable((tx) => tulis(tx, KUNCI_TEMPLATE_WA, JSON.stringify(v.templates), olehUserId));
  return { ok: true, templates: v.templates };
}

/** Batas panjang tiap isian identitas pesan. */
export { BATAS_IDENTITAS };

export async function simpanIdentitasKreatif(
  input: unknown,
  olehUserId: string,
): Promise<{ ok: true; identitas: IdentitasKreatif } | { ok: false; kode: "TIDAK_VALID" | "TERLALU_PANJANG" }> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, kode: "TIDAK_VALID" };
  const o = input as Record<string, unknown>;
  const isian: Record<keyof IdentitasKreatif, string> = { pengirim: "", brand: "", produk: "" };
  for (const k of Object.keys(isian) as (keyof IdentitasKreatif)[]) {
    const v = o[k];
    if (v !== undefined && v !== null && typeof v !== "string") return { ok: false, kode: "TIDAK_VALID" };
    const t = typeof v === "string" ? v.trim() : "";
    if (t.length > BATAS_IDENTITAS) return { ok: false, kode: "TERLALU_PANJANG" };
    isian[k] = t;
  }
  // Isian kosong disimpan kosong; pembacanya yang mengisinya dengan bawaan.
  await runSerializable((tx) => tulis(tx, KUNCI_IDENTITAS, JSON.stringify(isian), olehUserId));
  return { ok: true, identitas: bacaIdentitas(isian) };
}
