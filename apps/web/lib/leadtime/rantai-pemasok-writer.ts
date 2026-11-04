import { type Prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";

/*
 * Rantai proses pemasok (Lead Time → Papan Pemasok) — penulis untuk seret-lepas
 * dan "Centang pemasok…" (2026-10-07).
 *
 *  - `sisipkanLangkahPemasok`: proses dari palet dilepas DI ANTARA dua langkah
 *    kartu pemasok → langkah baru di posisi itu, langkah lain bergeser.
 *  - `aturProsesBanyakPemasok`: satu proses dipasang ke banyak pemasok dan/atau
 *    dilepas dari banyak pemasok sekaligus.
 *
 * Setiap penulis berjalan di `runSerializable` (dua orang yang mengubah rantai
 * pemasok yang sama tidak menghasilkan urutan ganda — salah satunya diulang) dan
 * menulis jejaknya DI DALAM transaksi itu, dengan nama tindakan yang sama dengan
 * aksi Papan Pemasok lain (`ADD`/`REMOVE` pada `SupplierProcess`) supaya
 * riwayatnya terbaca seragam. Penolakan dikembalikan sebagai `{ ok:false, code }`.
 *
 * `SupplierProcess` unik per (supplierId, sequence), jadi urutan ditulis ulang
 * dua fase: semua ke negatif dulu, baru ke 1..n.
 */

type Tx = Prisma.TransactionClient;

export const KODE_GALAT_RANTAI = [
  "TANPA_AKSES",
  "ISIAN_TIDAK_SAH",
  "PROSES_TIDAK_ADA",
  "PEMASOK_TIDAK_ADA",
  "GAGAL",
] as const;

export type KodeGalatRantai = (typeof KODE_GALAT_RANTAI)[number];

export type HasilRantai<T extends object = object> = ({ ok: true } & T) | { ok: false; code: KodeGalatRantai };

/** `AuditLog.action` — sama dengan `addSupplierProcessStep`/`removeSupplierProcessStep`. */
export const JEJAK_RANTAI = { DITAMBAH: "ADD", DILEPAS: "REMOVE" } as const;
export const ENTITAS_RANTAI = "SupplierProcess";

/** Batas pemasok dalam satu "Centang pemasok…". */
export const MAKS_PEMASOK_MASSAL = 500;

type Gagal = { ok: false; code: KodeGalatRantai };
const gagal = (code: KodeGalatRantai): Gagal => ({ ok: false, code });
const id = (teks: unknown): teks is string => typeof teks === "string" && teks.length > 0;

async function catatJejak(
  tx: Tx,
  data: { userId: string; action: string; entityId: string; changes: unknown; metadata: unknown },
) {
  await tx.auditLog.create({
    data: {
      userId: data.userId,
      action: data.action,
      entityType: ENTITAS_RANTAI,
      entityId: data.entityId,
      changes: data.changes as Prisma.InputJsonValue,
      metadata: data.metadata as Prisma.InputJsonValue,
    },
  });
}

/**
 * Tulis urutan baru: `urutan[i]` = id langkah di posisi i, atau `null` untuk
 * celah yang akan diisi langkah baru. Dua fase karena (supplierId, sequence) unik.
 */
async function tulisUrutan(tx: Tx, urutan: readonly (string | null)[]): Promise<void> {
  const ada = urutan.map((u, i) => ({ u, i })).filter((x): x is { u: string; i: number } => x.u !== null);
  for (const [n, { u }] of ada.entries()) {
    await tx.supplierProcess.update({ where: { id: u }, data: { sequence: -(n + 1) } });
  }
  for (const { u, i } of ada) {
    await tx.supplierProcess.update({ where: { id: u }, data: { sequence: i + 1 } });
  }
}

const rantaiPemasok = (tx: Tx, supplierId: string) =>
  tx.supplierProcess.findMany({
    where: { supplierId },
    orderBy: [{ sequence: "asc" }, { id: "asc" }],
    select: { id: true, sequence: true, processTemplateId: true },
  });

/**
 * Sisipkan proses ke rantai pemasok di `celah` (0 = paling depan; lewat akhir =
 * di belakang). Proses harus aktif; proses yang sama boleh muncul dua kali
 * (mis. QC sebelum dan sesudah jahit), sama dengan "+" di palet.
 */
export async function sisipkanLangkahPemasok(masukan: {
  supplierId: string;
  processTemplateId: string;
  celah: number;
  olehUserId: string;
}): Promise<HasilRantai<{ id: string; sequence: number }>> {
  const { supplierId, processTemplateId, celah, olehUserId } = masukan;
  if (!id(supplierId)) return gagal("PEMASOK_TIDAK_ADA");
  if (!id(processTemplateId)) return gagal("PROSES_TIDAK_ADA");
  if (!Number.isInteger(celah) || celah < 0) return gagal("ISIAN_TIDAK_SAH");

  return runSerializable(async (tx): Promise<HasilRantai<{ id: string; sequence: number }>> => {
    const proses = await tx.processTemplate.findUnique({
      where: { id: processTemplateId },
      select: { id: true, name: true, isActive: true },
    });
    if (!proses || !proses.isActive) return gagal("PROSES_TIDAK_ADA");
    if (!(await tx.supplier.findUnique({ where: { id: supplierId }, select: { id: true } }))) {
      return gagal("PEMASOK_TIDAK_ADA");
    }
    const sebelum = await rantaiPemasok(tx, supplierId);
    const c = Math.min(celah, sebelum.length);
    const urutan: (string | null)[] = sebelum.map((l) => l.id);
    urutan.splice(c, 0, null);
    await tulisUrutan(tx, urutan);
    const dibuat = await tx.supplierProcess.create({
      data: { supplierId, processTemplateId, sequence: c + 1 },
      select: { id: true },
    });
    await catatJejak(tx, {
      userId: olehUserId,
      action: JEJAK_RANTAI.DITAMBAH,
      entityId: dibuat.id,
      changes: { after: { supplierId, templateName: proses.name, sequence: c + 1 } },
      metadata: {
        cara: "SERET",
        celah,
        urutanSebelum: sebelum.map((l) => l.id),
        urutanSesudah: urutan.map((u) => u ?? dibuat.id),
      },
    });
    return { ok: true, id: dibuat.id, sequence: c + 1 };
  });
}

/**
 * "Centang pemasok…": pasang `processTemplateId` di AKHIR rantai setiap pemasok
 * `tambah` yang belum punya proses itu, dan lepas SEMUA langkah proses itu dari
 * setiap pemasok `lepas` (urutan sisanya dirapikan 1..n).
 *
 * Layar mengirim selisih terhadap keadaan yang ditampilkannya, bukan keadaan
 * akhir — perubahan orang lain pada pemasok yang tidak disentuh tetap utuh.
 * Pemasok yang ternyata sudah punya (tambah) atau sudah tidak punya (lepas)
 * dilewati tanpa jejak. Memasang butuh proses aktif; melepas tetap boleh untuk
 * proses yang sudah diarsipkan.
 */
export async function aturProsesBanyakPemasok(masukan: {
  processTemplateId: string;
  tambah: readonly string[];
  lepas: readonly string[];
  olehUserId: string;
}): Promise<HasilRantai<{ ditambah: string[]; dilepas: string[] }>> {
  const { processTemplateId, olehUserId } = masukan;
  if (!id(processTemplateId)) return gagal("PROSES_TIDAK_ADA");
  if (!Array.isArray(masukan.tambah) || !Array.isArray(masukan.lepas)) return gagal("ISIAN_TIDAK_SAH");
  if (![...masukan.tambah, ...masukan.lepas].every(id)) return gagal("ISIAN_TIDAK_SAH");
  const tambah = [...new Set(masukan.tambah)];
  const lepas = [...new Set(masukan.lepas)];
  if (tambah.length + lepas.length > MAKS_PEMASOK_MASSAL) return gagal("ISIAN_TIDAK_SAH");
  if (tambah.some((s) => lepas.includes(s))) return gagal("ISIAN_TIDAK_SAH");
  if (tambah.length === 0 && lepas.length === 0) return { ok: true, ditambah: [], dilepas: [] };

  return runSerializable(async (tx): Promise<HasilRantai<{ ditambah: string[]; dilepas: string[] }>> => {
    const proses = await tx.processTemplate.findUnique({
      where: { id: processTemplateId },
      select: { id: true, name: true, isActive: true },
    });
    if (!proses || (tambah.length > 0 && !proses.isActive)) return gagal("PROSES_TIDAK_ADA");
    const semua = [...tambah, ...lepas];
    const pemasok = await tx.supplier.findMany({ where: { id: { in: semua } }, select: { id: true } });
    if (pemasok.length !== semua.length) return gagal("PEMASOK_TIDAK_ADA");

    const ditambah: string[] = [];
    for (const supplierId of tambah) {
      const rantai = await rantaiPemasok(tx, supplierId);
      if (rantai.some((l) => l.processTemplateId === processTemplateId)) continue;
      const sequence = (rantai.at(-1)?.sequence ?? 0) + 1;
      const dibuat = await tx.supplierProcess.create({
        data: { supplierId, processTemplateId, sequence },
        select: { id: true },
      });
      await catatJejak(tx, {
        userId: olehUserId,
        action: JEJAK_RANTAI.DITAMBAH,
        entityId: dibuat.id,
        changes: { after: { supplierId, templateName: proses.name, sequence } },
        metadata: { cara: "CENTANG_PEMASOK", processTemplateId },
      });
      ditambah.push(supplierId);
    }

    const dilepas: string[] = [];
    for (const supplierId of lepas) {
      const rantai = await rantaiPemasok(tx, supplierId);
      const kena = rantai.filter((l) => l.processTemplateId === processTemplateId);
      if (kena.length === 0) continue;
      await tx.supplierProcess.deleteMany({ where: { supplierId, id: { in: kena.map((l) => l.id) } } });
      await tulisUrutan(
        tx,
        rantai.filter((l) => l.processTemplateId !== processTemplateId).map((l) => l.id),
      );
      for (const l of kena) {
        await catatJejak(tx, {
          userId: olehUserId,
          action: JEJAK_RANTAI.DILEPAS,
          entityId: l.id,
          changes: { before: { supplierId, templateName: proses.name, sequence: l.sequence } },
          metadata: { cara: "CENTANG_PEMASOK", processTemplateId },
        });
      }
      dilepas.push(supplierId);
    }
    return { ok: true, ditambah, dilepas };
  });
}
