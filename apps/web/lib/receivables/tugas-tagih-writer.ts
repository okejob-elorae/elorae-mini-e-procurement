import type { Prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { hitungUlangPiutang } from "./writer";
import { catatJejak, JEJAK } from "./jejak";
import {
  STATUS_TUGAS,
  bacaIdFaktur,
  bacaStatusTugas,
  periksaBatalTugas,
  periksaSudahDitagih,
  periksaTugasBaru,
  type AlasanGagalTugas,
  type AlasanGagalTutup,
} from "./tugas-tagih";

/**
 * Penulis tugas tagih.
 *
 * Tugas tidak menyentuh uang: ia tidak mengubah sisa piutang, tidak mengunci
 * faktur dari BKM, tidak menggeser keadaan faktur. Yang ia catat hanya siapa
 * yang harus datang ke toko, sampai kapan, dan apa hasilnya.
 */

type Klien = Prisma.TransactionClient;

const JENIS_ENTITAS = "CollectionTask";

/** Nama jejak tugas tagih — tinggal di `JEJAK` (`jejak.ts`), satu daftar untuk seluruh modul. */
export const JEJAK_TUGAS_TAGIH = {
  DIBUAT: JEJAK.TUGAS_TAGIH_DIBUAT,
  SELESAI: JEJAK.TUGAS_TAGIH_SELESAI,
  SELESAI_OTOMATIS: JEJAK.TUGAS_TAGIH_SELESAI_OTOMATIS,
  DIBATALKAN: JEJAK.TUGAS_TAGIH_DIBATALKAN,
} as const;

type NamaJejakTugas = (typeof JEJAK_TUGAS_TAGIH)[keyof typeof JEJAK_TUGAS_TAGIH];

/**
 * Tulis jejak DI DALAM transaksi yang sama — bentuknya sama persis dengan
 * `catatJejak`. Jejak yang ditulis sesudah transaksi bisa gagal sendirian, dan
 * yang tersisa adalah perubahan tanpa catatan.
 */
async function catatJejakTugas(
  tx: Klien,
  isi: {
    userId: string;
    action: NamaJejakTugas;
    entityId: string;
    changes?: { before?: unknown; after?: unknown };
    metadata?: Record<string, unknown>;
    reason?: string | null;
  },
): Promise<void> {
  await catatJejak(tx, { ...isi, entityType: JENIS_ENTITAS });
}

/**
 * Orang lapangan = definisi yang sama dengan `daftarSalesman`: perannya membuka
 * aplikasi HP, bukan peran sistem (admin), dan tidak terikat satu toko (SPG).
 * Diperiksa di dalam transaksi karena pemilih di layar bisa basi.
 */
async function orangLapangan(tx: Klien, userId: string): Promise<boolean> {
  const u = await tx.user.findFirst({
    where: {
      id: userId,
      assignedStoreId: null,
      roleDefinition: { isSystem: false, permissions: { some: { permission: { code: "pwa:access" } } } },
    },
    select: { id: true },
  });
  return u !== null;
}

export type HasilBuatTugas =
  | { ok: true; id: string; storeId: string; assigneeId: string; nilai: number; jumlahFaktur: number }
  | { ok: false; alasan: AlasanGagalTugas };

/**
 * Buat tugas tagih.
 *
 * Sisa tiap faktur dihitung ulang saat itu juga — faktur yang lunas sejak
 * layarnya dibuka ditolak, bukan ditugaskan untuk ditagih dua kali.
 */
export async function buatTugasTagih(input: {
  storeId: string;
  receivableIds: string[];
  assigneeId: string;
  tenggat: Date | null;
  catatan?: string | null;
  olehUserId: string;
  hariIni?: Date;
}): Promise<HasilBuatTugas> {
  const ids = bacaIdFaktur(input.receivableIds);
  const hariIni = input.hariIni ?? new Date();

  return runSerializable(async (tx) => {
    // Toko konsinyasi tidak pernah punya piutang (lihat `daftarPiutang`); faktur
    // yang entah bagaimana menempel ke sana dianggap tidak ada.
    const piutang = ids.length
      ? await tx.receivable.findMany({
          where: { id: { in: ids }, store: { termsType: { not: "KONSI" } } },
          select: { id: true, storeId: true },
        })
      : [];

    const faktur: { id: string; storeId: string; sisa: number }[] = [];
    for (const p of piutang) {
      faktur.push({ id: p.id, storeId: p.storeId, sisa: await hitungUlangPiutang(tx, p.id) });
    }

    const tugasLain = await tx.collectionTask.findMany({
      where: { storeId: input.storeId, status: STATUS_TUGAS.TERBUKA },
      select: { receivableIds: true },
    });
    const sedangDitugaskan = new Set(tugasLain.flatMap((t) => bacaIdFaktur(t.receivableIds)));

    const cek = periksaTugasBaru({
      storeId: input.storeId,
      receivableIds: ids,
      faktur,
      sedangDitugaskan,
      petugasLapangan: await orangLapangan(tx, input.assigneeId),
      tenggat: input.tenggat,
      hariIni,
    });
    if (!cek.ok) return cek;

    const nilai = faktur.reduce((s, f) => s + f.sisa, 0);
    const catatan = input.catatan?.trim() || null;
    const tugas = await tx.collectionTask.create({
      data: {
        assigneeId: input.assigneeId,
        storeId: input.storeId,
        receivableIds: cek.receivableIds,
        note: catatan,
        dueDate: input.tenggat,
        status: STATUS_TUGAS.TERBUKA,
        createdById: input.olehUserId,
      },
      select: { id: true },
    });

    await catatJejakTugas(tx, {
      userId: input.olehUserId,
      action: JEJAK_TUGAS_TAGIH.DIBUAT,
      entityId: tugas.id,
      changes: {
        after: {
          status: STATUS_TUGAS.TERBUKA,
          assigneeId: input.assigneeId,
          storeId: input.storeId,
          receivableIds: cek.receivableIds,
          dueDate: input.tenggat?.toISOString() ?? null,
          note: catatan,
        },
      },
      metadata: { nilai },
    });

    return {
      ok: true as const,
      id: tugas.id,
      storeId: input.storeId,
      assigneeId: input.assigneeId,
      nilai,
      jumlahFaktur: cek.receivableIds.length,
    };
  });
}

export type HasilTutupTugas =
  | { ok: true; storeId: string; assigneeId: string; createdById: string }
  | { ok: false; alasan: AlasanGagalTutup | "TIDAK_DITEMUKAN" };

/**
 * "Sudah ditagih" oleh yang ditugasi, dengan catatan hasil.
 *
 * Hasilnya hidup di jejak (`reason`), bukan menimpa catatan kantor di baris
 * tugasnya — catatan kantor adalah instruksi, hasilnya jawaban; keduanya
 * harus terbaca berdampingan.
 *
 * Penutupnya bertanding-lalu-tukar (`updateMany … where status TERBUKA`):
 * kantor yang membatalkan pada detik yang sama tidak bisa ditimpa diam-diam.
 */
export async function tandaiSudahDitagih(input: {
  taskId: string;
  olehUserId: string;
  hasil: string;
}): Promise<HasilTutupTugas> {
  return runSerializable(async (tx) => {
    const tugas = await tx.collectionTask.findUnique({
      where: { id: input.taskId },
      select: { id: true, status: true, assigneeId: true, storeId: true, createdById: true },
    });
    if (!tugas) return { ok: false as const, alasan: "TIDAK_DITEMUKAN" as const };

    const cek = periksaSudahDitagih({
      status: bacaStatusTugas(tugas.status),
      assigneeId: tugas.assigneeId,
      userId: input.olehUserId,
      hasil: input.hasil,
    });
    if (!cek.ok) return cek;

    const tukar = await tx.collectionTask.updateMany({
      where: { id: tugas.id, status: STATUS_TUGAS.TERBUKA },
      data: { status: STATUS_TUGAS.SELESAI, completedAt: new Date() },
    });
    if (tukar.count !== 1) return { ok: false as const, alasan: "SUDAH_DITUTUP" as const };

    await catatJejakTugas(tx, {
      userId: input.olehUserId,
      action: JEJAK_TUGAS_TAGIH.SELESAI,
      entityId: tugas.id,
      changes: { before: { status: STATUS_TUGAS.TERBUKA }, after: { status: STATUS_TUGAS.SELESAI } },
      reason: cek.hasil,
    });

    return { ok: true as const, storeId: tugas.storeId, assigneeId: tugas.assigneeId, createdById: tugas.createdById };
  });
}

/** Batalkan tugas — kantor, dengan alasan. */
export async function batalkanTugasTagih(input: {
  taskId: string;
  olehUserId: string;
  alasan: string;
}): Promise<HasilTutupTugas> {
  return runSerializable(async (tx) => {
    const tugas = await tx.collectionTask.findUnique({
      where: { id: input.taskId },
      select: { id: true, status: true, assigneeId: true, storeId: true, createdById: true },
    });
    if (!tugas) return { ok: false as const, alasan: "TIDAK_DITEMUKAN" as const };

    const cek = periksaBatalTugas({ status: bacaStatusTugas(tugas.status), alasan: input.alasan });
    if (!cek.ok) return cek;

    const tukar = await tx.collectionTask.updateMany({
      where: { id: tugas.id, status: STATUS_TUGAS.TERBUKA },
      data: { status: STATUS_TUGAS.DIBATALKAN, completedAt: new Date() },
    });
    if (tukar.count !== 1) return { ok: false as const, alasan: "SUDAH_DITUTUP" as const };

    await catatJejakTugas(tx, {
      userId: input.olehUserId,
      action: JEJAK_TUGAS_TAGIH.DIBATALKAN,
      entityId: tugas.id,
      changes: { before: { status: STATUS_TUGAS.TERBUKA }, after: { status: STATUS_TUGAS.DIBATALKAN } },
      reason: cek.alasan,
    });

    return { ok: true as const, storeId: tugas.storeId, assigneeId: tugas.assigneeId, createdById: tugas.createdById };
  });
}

/**
 * Tutup otomatis tugas yang semua fakturnya sudah LUNAS terverifikasi.
 *
 * Dijalankan malas, saat daftar tugas kantor dibaca — tanpa cron. Pemanggil
 * sudah menyaring calonnya dari sisa yang dihitung ulang, tapi keputusan akhir
 * diambil DI DALAM transaksi dengan menghitung ulang lagi: klaim bisa
 * dibatalkan di antara bacaan dan tulisan, dan tugas yang tertutup tidak akan
 * menagih faktur yang terbuka kembali.
 *
 * Satu transaksi per tugas, supaya satu tugas yang bertabrakan tidak menahan
 * yang lain. Tidak pernah melempar: gagal menutup tidak boleh membuat daftar
 * gagal tampil — tugasnya tetap tampil "lunas" dan dicoba lagi pada bacaan
 * berikutnya. Mengembalikan id yang benar-benar ditutup.
 */
export async function tutupTugasLunasOtomatis(input: {
  taskIds: readonly string[];
  olehUserId: string;
}): Promise<string[]> {
  const ditutup: string[] = [];
  for (const taskId of new Set(input.taskIds)) {
    try {
      const hasil = await runSerializable(async (tx) => {
        const tugas = await tx.collectionTask.findUnique({
          where: { id: taskId },
          select: { id: true, status: true, receivableIds: true },
        });
        if (!tugas || bacaStatusTugas(tugas.status) !== STATUS_TUGAS.TERBUKA) return false;

        const ids = bacaIdFaktur(tugas.receivableIds);
        if (ids.length === 0) return false;
        // Faktur yang sudah tidak ada tidak pernah dihitung "lunas" — `hitungUlangPiutang`
        // mengembalikan nol untuk baris yang hilang, jadi keberadaannya diperiksa dulu.
        const ada = await tx.receivable.count({ where: { id: { in: ids } } });
        if (ada !== ids.length) return false;
        for (const id of ids) {
          if ((await hitungUlangPiutang(tx, id)) > 0) return false;
        }

        const tukar = await tx.collectionTask.updateMany({
          where: { id: tugas.id, status: STATUS_TUGAS.TERBUKA },
          data: { status: STATUS_TUGAS.SELESAI, completedAt: new Date() },
        });
        if (tukar.count !== 1) return false;

        await catatJejakTugas(tx, {
          userId: input.olehUserId,
          action: JEJAK_TUGAS_TAGIH.SELESAI_OTOMATIS,
          entityId: tugas.id,
          changes: { before: { status: STATUS_TUGAS.TERBUKA }, after: { status: STATUS_TUGAS.SELESAI } },
          metadata: { otomatis: true, sebab: "SEMUA_FAKTUR_LUNAS", receivableIds: ids },
        });
        return true;
      });
      if (hasil) ditutup.push(taskId);
    } catch (err) {
      console.error("[tugas-tagih] tutup otomatis gagal", taskId, err);
    }
  }
  return ditutup;
}
