import type { Prisma } from "@elorae/db";
import { kunciHariWib } from "@/lib/dashboard/tren";
import { runSerializable } from "@/lib/db/tx-retry";
import {
  AKSI_JADWAL,
  ENTITAS_JADWAL,
  geserHari,
  hariSeminggu,
  kunciHariSah,
  rencanakanSalinMinggu,
  rencanakanUbahJadwal,
  seninDari,
  type BarisJadwal,
  type DilewatiSalin,
  type JejakJadwal,
  type PerubahanJadwal,
  type TokoJadwal,
  type TolakJadwal,
} from "./jadwal";
import { bacaTokoTerkunci, KUNCI_TOKO_TERKUNCI } from "./pengaturan";

/**
 * Penulis jadwal kunjungan dari kantor.
 *
 * Setiap simpan = SATU transaksi serializable + SATU baris `AuditLog`
 * (`VISIT_SCHEDULE_UPDATED`, `entityId` = id sales) yang membawa isi setiap
 * hari yang berubah, sebelum dan sesudah. Barisnya sendiri hanya menyimpan
 * keadaan terakhir; jadwal yang diubah hanya hidup di jejaknya.
 *
 * Semua aturan (hari lewat, batas per hari, toko aktif, kunci "hanya toko
 * sendiri") ada di `jadwal.ts` dan dites di sana; di sini hanya membaca,
 * menerapkan, dan mencatat. Kabar ke sales dikirim pemanggil SESUDAH
 * transaksi selesai.
 */

type Klien = Prisma.TransactionClient;

export type HasilSimpanJadwal =
  | { ok: true; hariBerubah: string[]; jejak: JejakJadwal | null }
  | TolakJadwal
  | { ok: false; kode: "SALES_TIDAK_DITEMUKAN" };

export type HasilSalinMinggu =
  | { ok: true; disalin: number; dilewati: DilewatiSalin; hariBerubah: string[]; jejak: JejakJadwal | null }
  | { ok: false; kode: "SALES_TIDAK_DITEMUKAN" | "HARI_LEWAT" | "TANGGAL_TIDAK_SAH" };

/**
 * Sales yang boleh dijadwalkan: pengguna berperan lapangan (`pwa:access`,
 * bukan peran sistem) dan BUKAN SPG — sama dengan `daftarSalesman`, yang
 * mengisi pilihan sales di layar kantor.
 */
async function salesSah(tx: Klien, salesmanId: string): Promise<boolean> {
  if (!salesmanId) return false;
  const n = await tx.user.count({
    where: {
      id: salesmanId,
      assignedStoreId: null,
      roleDefinition: { isSystem: false, permissions: { some: { permission: { code: "pwa:access" } } } },
    },
  });
  return n > 0;
}

async function bacaTerkunci(tx: Klien): Promise<boolean> {
  const baris = await tx.systemSetting.findUnique({ where: { key: KUNCI_TOKO_TERKUNCI }, select: { value: true } });
  return bacaTokoTerkunci(baris?.value);
}

async function petaToko(tx: Klien, ids: readonly string[]): Promise<Map<string, TokoJadwal>> {
  const unik = [...new Set(ids)].filter((x) => typeof x === "string" && x.length > 0);
  if (unik.length === 0) return new Map();
  const rows = await tx.store.findMany({
    where: { id: { in: unik } },
    select: { id: true, isActive: true, salesmanId: true },
  });
  return new Map(rows.map((r) => [r.id, r]));
}

async function barisHari(tx: Klien, salesmanId: string, hari: readonly string[]): Promise<BarisJadwal[]> {
  if (hari.length === 0) return [];
  return tx.visitSchedule.findMany({
    where: { salesmanId, dayKey: { in: [...new Set(hari)] } },
    select: { dayKey: true, storeId: true, note: true },
  });
}

async function tulisJejak(
  tx: Klien,
  input: { salesmanId: string; olehUserId: string; jejak: JejakJadwal; metadata: Prisma.InputJsonObject },
): Promise<void> {
  await tx.auditLog.create({
    data: {
      userId: input.olehUserId,
      action: AKSI_JADWAL,
      entityType: ENTITAS_JADWAL,
      entityId: input.salesmanId,
      changes: input.jejak as unknown as Prisma.InputJsonObject,
      metadata: input.metadata,
    },
  });
}

async function buatBaris(tx: Klien, salesmanId: string, olehUserId: string, buat: readonly BarisJadwal[]): Promise<void> {
  if (buat.length === 0) return;
  // skipDuplicates: dua admin yang menambah toko yang sama di hari yang sama
  // pada saat bersamaan — barisnya tetap satu (dijaga @@unique), bukan galat.
  await tx.visitSchedule.createMany({
    data: buat.map((b) => ({ salesmanId, storeId: b.storeId, dayKey: b.dayKey, note: b.note, createdById: olehUserId })),
    skipDuplicates: true,
  });
}

/**
 * Tambah, hapus, ubah catatan, atau ganti isi beberapa hari jadwal SATU sales.
 * Ditolak seluruhnya bila ada satu bagian yang salah — tidak ada simpan
 * setengah jalan.
 */
export async function simpanJadwal(input: {
  salesmanId: string;
  olehUserId: string;
  perubahan: PerubahanJadwal;
  sekarang?: Date;
}): Promise<HasilSimpanJadwal> {
  const hariIni = kunciHariWib(input.sekarang ?? new Date());
  const p = input.perubahan;
  const hari = [
    ...(p.ganti ?? []).map((g) => g.dayKey),
    ...(p.hapus ?? []).map((h) => h.dayKey),
    ...(p.tambah ?? []).map((t) => t.dayKey),
    ...(p.catatan ?? []).map((c) => c.dayKey),
  ].filter(kunciHariSah);
  const tokoDirujuk = [...(p.tambah ?? []).map((t) => t.storeId), ...(p.ganti ?? []).flatMap((g) => g.toko.map((t) => t.storeId))];

  return runSerializable(async (tx) => {
    if (!(await salesSah(tx, input.salesmanId))) return { ok: false as const, kode: "SALES_TIDAK_DITEMUKAN" as const };
    const [sebelum, toko, terkunci] = await Promise.all([
      barisHari(tx, input.salesmanId, hari),
      petaToko(tx, tokoDirujuk),
      bacaTerkunci(tx),
    ]);
    const r = rencanakanUbahJadwal({ sebelum, perubahan: p, hariIni, toko, terkunci, salesmanId: input.salesmanId });
    if (!r.ok) return r;
    if (!r.jejak) return { ok: true as const, hariBerubah: [], jejak: null };

    await buatBaris(tx, input.salesmanId, input.olehUserId, r.buat);
    for (const u of r.ubah) {
      await tx.visitSchedule.update({
        where: { salesmanId_storeId_dayKey: { salesmanId: input.salesmanId, storeId: u.storeId, dayKey: u.dayKey } },
        data: { note: u.note },
      });
    }
    if (r.hapus.length) {
      await tx.visitSchedule.deleteMany({
        where: { salesmanId: input.salesmanId, OR: r.hapus.map((h) => ({ storeId: h.storeId, dayKey: h.dayKey })) },
      });
    }
    await tulisJejak(tx, {
      salesmanId: input.salesmanId,
      olehUserId: input.olehUserId,
      jejak: r.jejak,
      metadata: { cara: "UBAH" },
    });
    return { ok: true as const, hariBerubah: r.hariBerubah, jejak: r.jejak };
  });
}

/**
 * "Salin minggu lalu" ke minggu `senin` (minggu ini atau minggu depan): baris
 * yang sudah ada di tujuan tidak disentuh, hari yang sudah lewat dilewati.
 */
export async function salinMingguLalu(input: {
  salesmanId: string;
  olehUserId: string;
  /** Hari apa pun di minggu tujuan; dinormalkan ke Seninnya. */
  minggu: string;
  sekarang?: Date;
}): Promise<HasilSalinMinggu> {
  if (!kunciHariSah(input.minggu)) return { ok: false, kode: "TANGGAL_TIDAK_SAH" };
  const hariIni = kunciHariWib(input.sekarang ?? new Date());
  const senin = seninDari(input.minggu);
  const tujuan = hariSeminggu(senin);
  // Seluruh minggu tujuan sudah lewat: tidak ada yang bisa disalin.
  if (tujuan[6] < hariIni) return { ok: false, kode: "HARI_LEWAT" };
  const sumberHari = hariSeminggu(geserHari(senin, -7));

  return runSerializable(async (tx) => {
    if (!(await salesSah(tx, input.salesmanId))) return { ok: false as const, kode: "SALES_TIDAK_DITEMUKAN" as const };
    const [sumber, ada, terkunci] = await Promise.all([
      barisHari(tx, input.salesmanId, sumberHari),
      barisHari(tx, input.salesmanId, tujuan),
      bacaTerkunci(tx),
    ]);
    const toko = await petaToko(
      tx,
      sumber.map((s) => s.storeId),
    );
    const r = rencanakanSalinMinggu({ sumber, ada, seninTujuan: senin, hariIni, toko, terkunci, salesmanId: input.salesmanId });
    if (r.jejak) {
      await buatBaris(tx, input.salesmanId, input.olehUserId, r.buat);
      await tulisJejak(tx, {
        salesmanId: input.salesmanId,
        olehUserId: input.olehUserId,
        jejak: r.jejak,
        metadata: { cara: "SALIN_MINGGU", dariSenin: sumberHari[0], keSenin: senin },
      });
    }
    return { ok: true as const, disalin: r.buat.length, dilewati: r.dilewati, hariBerubah: r.hariBerubah, jejak: r.jejak };
  });
}
