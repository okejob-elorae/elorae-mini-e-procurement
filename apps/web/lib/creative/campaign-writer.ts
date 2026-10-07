import { Prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { catatJejak, JEJAK } from "@/lib/receivables/jejak";

/*
 * Penulis campaign KOL. Campaign TIDAK PERNAH dihapus — yang selesai
 * diarsipkan. Kolaborasinya menunjuk campaign dengan `Restrict`, dan angka
 * hasil per campaign hanya bisa dibaca selama campaign-nya ada.
 */

const D = (n: number) => new Prisma.Decimal(n);

export type AlasanGagalCampaign = "NAMA_WAJIB" | "TIDAK_DITEMUKAN" | "PERIODE_TIDAK_VALID" | "ANGKA_TIDAK_VALID";

export type HasilCampaign = { ok: true; id: string } | { ok: false; alasan: AlasanGagalCampaign; detail?: string };

export type IsiCampaign = {
  name: string;
  brand?: string | null;
  product?: string | null;
  objective?: string | null;
  startDate?: Date | null;
  endDate?: Date | null;
  budget?: number | null;
  targetKol?: number | null;
  targetContent?: number | null;
  brief?: string | null;
  note?: string | null;
  /** Centang "Arsipkan campaign ini". */
  arsip?: boolean;
};

const teks = (v: string | null | undefined) => v?.trim() || null;

function periksa(isi: IsiCampaign): { alasan: AlasanGagalCampaign; detail?: string } | null {
  if (!isi.name?.trim()) return { alasan: "NAMA_WAJIB" };
  if (isi.startDate && isi.endDate && isi.endDate < isi.startDate) return { alasan: "PERIODE_TIDAK_VALID" };
  if (isi.budget != null && !(Number.isFinite(isi.budget) && isi.budget >= 0)) {
    return { alasan: "ANGKA_TIDAK_VALID", detail: "budget" };
  }
  for (const [k, v] of [
    ["targetKol", isi.targetKol],
    ["targetContent", isi.targetContent],
  ] as const) {
    if (v != null && !(Number.isInteger(v) && v >= 0)) return { alasan: "ANGKA_TIDAK_VALID", detail: k };
  }
  return null;
}

type Bentuk = {
  name: string;
  brand: string | null;
  product: string | null;
  objective: string | null;
  startDate: string | null;
  endDate: string | null;
  budget: number | null;
  targetKol: number | null;
  targetContent: number | null;
  brief: string | null;
  note: string | null;
};

function bentuk(v: {
  name: string;
  brand: string | null;
  product: string | null;
  objective: string | null;
  startDate: Date | null;
  endDate: Date | null;
  budget: Prisma.Decimal | number | null;
  targetKol: number | null;
  targetContent: number | null;
  brief: string | null;
  note: string | null;
}): Bentuk {
  return {
    name: v.name,
    brand: v.brand,
    product: v.product,
    objective: v.objective,
    startDate: v.startDate?.toISOString() ?? null,
    endDate: v.endDate?.toISOString() ?? null,
    budget: v.budget == null ? null : Number(v.budget),
    targetKol: v.targetKol,
    targetContent: v.targetContent,
    brief: v.brief,
    note: v.note,
  };
}

/**
 * Simpan campaign (baru atau ubah). Centang "arsip" mengisi `archivedAt` sekali
 * (dicatat sebagai pengarsipan tersendiri); melepasnya mengembalikan campaign
 * ke daftar aktif. Jejak memuat hanya kolom yang berubah, sebelum/sesudah.
 */
export async function simpanCampaign(input: {
  id?: string | null;
  isi: IsiCampaign;
  olehUserId: string;
}): Promise<HasilCampaign> {
  const salah = periksa(input.isi);
  if (salah) return { ok: false, ...salah };
  const isi = input.isi;
  const data = {
    name: isi.name.trim(),
    brand: teks(isi.brand),
    product: teks(isi.product),
    objective: teks(isi.objective),
    startDate: isi.startDate ?? null,
    endDate: isi.endDate ?? null,
    budget: isi.budget == null ? null : D(isi.budget),
    targetKol: isi.targetKol ?? null,
    targetContent: isi.targetContent ?? null,
    brief: teks(isi.brief),
    note: teks(isi.note),
  };

  return runSerializable(async (tx) => {
    const sekarang = new Date();
    if (!input.id) {
      const dibuat = await tx.kolCampaign.create({
        data: { ...data, archivedAt: isi.arsip ? sekarang : null, createdById: input.olehUserId },
        select: { id: true },
      });
      await catatJejak(tx, {
        userId: input.olehUserId,
        action: JEJAK.CAMPAIGN_DIBUAT,
        entityType: "KolCampaign",
        entityId: dibuat.id,
        changes: { after: bentuk(data) },
      });
      return { ok: true as const, id: dibuat.id };
    }

    const lama = await tx.kolCampaign.findUnique({ where: { id: input.id } });
    if (!lama) return { ok: false as const, alasan: "TIDAK_DITEMUKAN" as const };

    const jadiArsip = isi.arsip === undefined ? lama.archivedAt !== null : isi.arsip;
    const archivedAt = jadiArsip ? (lama.archivedAt ?? sekarang) : null;
    await tx.kolCampaign.update({ where: { id: lama.id }, data: { ...data, archivedAt } });

    const a = bentuk(lama);
    const b = bentuk(data);
    const sebelum: Record<string, unknown> = {};
    const sesudah: Record<string, unknown> = {};
    for (const k of Object.keys(b) as (keyof Bentuk)[]) {
      if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) {
        sebelum[k] = a[k];
        sesudah[k] = b[k];
      }
    }
    const baruDiarsip = !lama.archivedAt && archivedAt !== null;
    const dibukaArsip = lama.archivedAt !== null && archivedAt === null;
    if (dibukaArsip) {
      sebelum.archivedAt = lama.archivedAt!.toISOString();
      sesudah.archivedAt = null;
    }
    if (Object.keys(sesudah).length > 0) {
      await catatJejak(tx, {
        userId: input.olehUserId,
        action: JEJAK.CAMPAIGN_DIUBAH,
        entityType: "KolCampaign",
        entityId: lama.id,
        changes: { before: sebelum, after: sesudah },
        metadata: { nama: data.name },
      });
    }
    if (baruDiarsip) {
      await catatJejak(tx, {
        userId: input.olehUserId,
        action: JEJAK.CAMPAIGN_DIARSIPKAN,
        entityType: "KolCampaign",
        entityId: lama.id,
        changes: { before: { archivedAt: null }, after: { archivedAt: archivedAt!.toISOString() } },
        metadata: { nama: data.name },
      });
    }
    return { ok: true as const, id: lama.id };
  });
}
