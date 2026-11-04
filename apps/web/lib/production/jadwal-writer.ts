import { type Prisma } from "@elorae/db";
import { formatDateOnlyJakarta, parseDateOnly } from "@/lib/date-only";
import { runSerializable } from "@/lib/db/tx-retry";
import { computeStepDays, resolveChain } from "@/lib/leadtime/calculations";
import { bacaTanggal, hariIniWib } from "@/lib/tanggal-isian";
import type { KalenderKerja } from "./hari-kerja";
import { mulaiDariTenggat, susunTanggal, totalHariJadwal, type StatusLangkah } from "./jadwal";
import {
  DURASI_MAKS_HARI,
  ENTITAS_LANGKAH,
  ENTITAS_TAHAP,
  JEJAK_JADWAL,
  NAMA_LANGKAH_MAKS,
  type KodeGalatJadwal,
} from "./jadwal-jejak";
import { bacaKalenderKerja } from "./jadwal-pengaturan";

/*
 * Jadwal proses per tahap Plan Kerja — penulis (2026-10-07).
 *
 * Setiap penulis:
 *  - berjalan di `runSerializable` (dua orang yang mengubah jadwal tahap yang
 *    sama tidak saling menimpa tanggal — salah satunya diulang);
 *  - menulis jejaknya (`JEJAK_JADWAL`) DI DALAM transaksi itu, dengan pasangan
 *    sebelum/sesudah;
 *  - menyusun ulang tanggal target SEMUA langkah tahapnya di transaksi yang sama
 *    (`susunUlangTahap`) dengan kalender kerja yang berlaku saat itu.
 *
 * Jadwal boleh diubah walau plan sudah ACTIVE/terkunci: jadwal adalah pekerjaan
 * berjalan, sama dengan "Buat WO dari tahap".
 *
 * Penolakan dikembalikan sebagai `{ ok:false, code }`, tidak dilempar. Callback
 * transaksi bisa diulang — semua keadaan dibaca ulang di dalamnya.
 */

type Tx = Prisma.TransactionClient;

export type HasilJadwal<T extends object = object> = ({ ok: true } & T) | { ok: false; code: KodeGalatJadwal };

type Gagal = { ok: false; code: KodeGalatJadwal };
const gagal = (code: KodeGalatJadwal): Gagal => ({ ok: false, code });

const STATUS: readonly StatusLangkah[] = ["BELUM", "PROSES", "SELESAI"];

/** Teks "YYYY-MM-DD" yang benar-benar ada, tahun 2000–2100. */
function tanggalSah(teks: unknown): teks is string {
  if (typeof teks !== "string") return false;
  const b = bacaTanggal(teks);
  return !!b && b.tahun >= 2000 && b.tahun <= 2100;
}

const keTanggal = (teks: string): Date => parseDateOnly(teks) as Date;
const keTeks = (d: Date | null | undefined): string | null => (d ? formatDateOnlyJakarta(d) : null);

function periksaNama(nama: unknown): string | Gagal {
  if (typeof nama !== "string" || !nama.trim()) return gagal("NAMA_WAJIB");
  const rapi = nama.trim();
  if (rapi.length > NAMA_LANGKAH_MAKS) return gagal("NAMA_TERLALU_PANJANG");
  return rapi;
}

function durasiSah(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= DURASI_MAKS_HARI;
}

function rapikanCatatan(note: unknown): string | null {
  return typeof note === "string" && note.trim() ? note.trim() : null;
}

const id = (teks: unknown): teks is string => typeof teks === "string" && teks.length > 0;

/** Potret satu langkah untuk jejak sebelum/sesudah. */
type PotretLangkah = {
  sequence: number;
  name: string;
  supplierId: string | null;
  durationDays: number;
  targetDate: string;
  doneDate: string | null;
  status: StatusLangkah;
  note: string | null;
};

function potret(l: {
  sequence: number;
  name: string;
  supplierId: string | null;
  durationDays: number;
  targetDate: Date;
  doneDate: Date | null;
  status: StatusLangkah;
  note: string | null;
}): PotretLangkah {
  return {
    sequence: l.sequence,
    name: l.name,
    supplierId: l.supplierId,
    durationDays: l.durationDays,
    targetDate: keTeks(l.targetDate) ?? "",
    doneDate: keTeks(l.doneDate),
    status: l.status,
    note: l.note,
  };
}

const PILIH_LANGKAH = {
  id: true,
  planStageId: true,
  sequence: true,
  name: true,
  supplierId: true,
  durationDays: true,
  targetDate: true,
  doneDate: true,
  status: true,
  note: true,
} as const;

async function catatJejak(
  tx: Tx,
  data: {
    userId: string;
    action: string;
    entityType: string;
    entityId: string;
    changes?: unknown;
    metadata?: unknown;
  },
) {
  await tx.auditLog.create({
    data: {
      userId: data.userId,
      action: data.action,
      entityType: data.entityType,
      entityId: data.entityId,
      ...(data.changes !== undefined ? { changes: data.changes as Prisma.InputJsonValue } : {}),
      ...(data.metadata !== undefined ? { metadata: data.metadata as Prisma.InputJsonValue } : {}),
    },
  });
}

/**
 * Susun ulang urutan (1..n) dan tanggal target semua langkah satu tahap.
 * Mulai = `PlanStage.scheduleStart`; bila kosong (langkah pertama baru dibuat)
 * diisi hari ini WIB. Hanya baris yang berubah yang ditulis.
 *
 * Dipakai juga oleh pengaturan kalender (`jadwal-pengaturan.ts`).
 */
export async function susunUlangTahap(tx: Tx, planStageId: string, kal: KalenderKerja, hariIni: string): Promise<void> {
  const tahap = await tx.planStage.findUnique({ where: { id: planStageId }, select: { scheduleStart: true } });
  if (!tahap) return;
  const langkah = await tx.planStageStep.findMany({
    where: { planStageId },
    orderBy: [{ sequence: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: { id: true, sequence: true, durationDays: true, status: true, doneDate: true, targetDate: true },
  });
  if (langkah.length === 0) return;
  let mulai = keTeks(tahap.scheduleStart);
  if (!mulai) {
    mulai = hariIni;
    await tx.planStage.update({ where: { id: planStageId }, data: { scheduleStart: keTanggal(hariIni) } });
  }
  const tanggal = susunTanggal(
    langkah.map((l) => ({ durationDays: l.durationDays, status: l.status, doneDate: keTeks(l.doneDate) })),
    mulai,
    kal,
  );
  for (const [i, l] of langkah.entries()) {
    const target = keTanggal(tanggal[i]);
    const urut = i + 1;
    if (l.sequence !== urut || l.targetDate.getTime() !== target.getTime()) {
      await tx.planStageStep.update({ where: { id: l.id }, data: { sequence: urut, targetDate: target } });
    }
  }
}

// ─── Tarik dari Lead Time ───────────────────────────────────────────────────

export type ModeJadwal = "MAJU" | "MUNDUR";
export type CaraTarik = "TAMBAH" | "GANTI";

export type MasukanTarikJadwal = {
  planStageId: string;
  /**
   * Langkah yang ditarik, BERURUTAN (urutan larik = urutan rantai, boleh lintas
   * pemasok: pabrik kain → penjahit → sablon). `sequence` = `SupplierProcess.sequence`
   * pemasok itu (sama dengan `sumberLeadTime[].langkah[].sequence`).
   */
  langkah: { supplierId: string; sequence: number }[];
  mode: ModeJadwal;
  /** "YYYY-MM-DD": tanggal mulai (MAJU) atau tenggat (MUNDUR). */
  tanggal: string;
  cara: CaraTarik;
  olehUserId: string;
};

/**
 * Tarik langkah dari rantai Lead Time pemasok. Lama tiap langkah =
 * `computeStepDays(langkah, qty tahap)` (sebanding qty). Hanya template proses
 * yang aktif dan pemasok ACTIVE.
 *
 * MAJU: mulai = `tanggal`, tenggat dikosongkan — kecuali TAMBAH ke jadwal yang
 * sudah berisi: langkah baru menyambung di akhir dan tanggal mulai lama tetap.
 * MUNDUR: tenggat = `tanggal`, mulai = tenggat dikurangi total hari kerja SEMUA
 * langkah sesudah penambahan.
 * GANTI menghapus semua langkah lama, dan ditolak bila ada yang PROSES/SELESAI.
 */
export async function tarikJadwalDariLeadTime(masukan: MasukanTarikJadwal): Promise<HasilJadwal<{ jumlah: number }>> {
  const { planStageId, langkah, mode, tanggal, cara, olehUserId } = masukan;
  if (!id(planStageId)) return gagal("TAHAP_TIDAK_ADA");
  if (mode !== "MAJU" && mode !== "MUNDUR") return gagal("ISIAN_TIDAK_SAH");
  if (cara !== "TAMBAH" && cara !== "GANTI") return gagal("ISIAN_TIDAK_SAH");
  if (!tanggalSah(tanggal)) return gagal("TANGGAL_TIDAK_SAH");
  if (!Array.isArray(langkah) || langkah.length === 0) return gagal("TANPA_LANGKAH_LEAD_TIME");
  if (!langkah.every((l) => l && id(l.supplierId) && Number.isInteger(l.sequence))) return gagal("ISIAN_TIDAK_SAH");
  const hariIni = hariIniWib();

  return runSerializable(async (tx): Promise<HasilJadwal<{ jumlah: number }>> => {
    const tahap = await tx.planStage.findUnique({
      where: { id: planStageId },
      select: { id: true, targetQty: true, scheduleStart: true, deadline: true },
    });
    if (!tahap) return gagal("TAHAP_TIDAK_ADA");

    const idPemasok = [...new Set(langkah.map((l) => l.supplierId))];
    const pemasok = await tx.supplier.findMany({
      where: { id: { in: idPemasok }, isActive: true, status: "ACTIVE" },
      select: {
        id: true,
        processChain: { include: { processTemplate: true }, orderBy: { sequence: "asc" } },
      },
    });
    if (pemasok.length !== idPemasok.length) return gagal("PEMASOK_TIDAK_ADA");

    const baru: { supplierId: string; processTemplateId: string; name: string; durationDays: number }[] = [];
    for (const l of langkah) {
      const baris = pemasok.find((p) => p.id === l.supplierId)?.processChain.find((r) => r.sequence === l.sequence);
      if (!baris || !baris.processTemplate.isActive) return gagal("TANPA_LANGKAH_LEAD_TIME");
      const [langkahRantai] = resolveChain([baris]);
      baru.push({
        supplierId: l.supplierId,
        processTemplateId: baris.processTemplateId,
        name: langkahRantai.name.slice(0, NAMA_LANGKAH_MAKS),
        durationDays: Math.min(DURASI_MAKS_HARI, computeStepDays(langkahRantai, tahap.targetQty)),
      });
    }

    const lama = await tx.planStageStep.findMany({
      where: { planStageId },
      orderBy: [{ sequence: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: PILIH_LANGKAH,
    });
    if (cara === "GANTI") {
      if (lama.some((l) => l.status !== "BELUM")) return gagal("ADA_LANGKAH_BERJALAN");
      if (lama.length > 0) await tx.planStageStep.deleteMany({ where: { planStageId, id: { in: lama.map((l) => l.id) } } });
    }
    const tersisa = cara === "GANTI" ? [] : lama;

    const { kal } = await bacaKalenderKerja(tx);
    let scheduleStart = tahap.scheduleStart;
    let deadline = tahap.deadline;
    if (mode === "MAJU") {
      if (!(cara === "TAMBAH" && tersisa.length > 0 && tahap.scheduleStart)) {
        scheduleStart = keTanggal(tanggal);
        deadline = null;
      }
    } else {
      const total = totalHariJadwal([...tersisa, ...baru]);
      deadline = keTanggal(tanggal);
      scheduleStart = keTanggal(mulaiDariTenggat(total, tanggal, kal));
    }
    await tx.planStage.update({ where: { id: planStageId }, data: { scheduleStart, deadline } });

    const urutAwal = tersisa.length;
    for (const [i, b] of baru.entries()) {
      await tx.planStageStep.create({
        data: {
          planStageId,
          sequence: urutAwal + i + 1,
          name: b.name,
          processTemplateId: b.processTemplateId,
          supplierId: b.supplierId,
          durationDays: b.durationDays,
          targetDate: keTanggal(tanggal),
          status: "BELUM",
          createdById: olehUserId,
        },
      });
    }
    await susunUlangTahap(tx, planStageId, kal, hariIni);

    const sesudah = await tx.planStageStep.findMany({
      where: { planStageId },
      orderBy: { sequence: "asc" },
      select: PILIH_LANGKAH,
    });
    await catatJejak(tx, {
      userId: olehUserId,
      action: JEJAK_JADWAL.DITARIK,
      entityType: ENTITAS_TAHAP,
      entityId: planStageId,
      changes: {
        before: { scheduleStart: keTeks(tahap.scheduleStart), deadline: keTeks(tahap.deadline), langkah: lama.map(potret) },
        after: { scheduleStart: keTeks(scheduleStart), deadline: keTeks(deadline), langkah: sesudah.map(potret) },
      },
      metadata: { mode, cara, tanggal, jumlah: baru.length, langkah },
    });
    return { ok: true, jumlah: baru.length };
  });
}

// ─── Langkah manual ─────────────────────────────────────────────────────────

/** Tambah satu langkah di AKHIR jadwal tahap. */
export async function tambahLangkah(masukan: {
  planStageId: string;
  name: string;
  durationDays: number;
  supplierId?: string | null;
  note?: string | null;
  olehUserId: string;
}): Promise<HasilJadwal<{ id: string }>> {
  if (!id(masukan.planStageId)) return gagal("TAHAP_TIDAK_ADA");
  const nama = periksaNama(masukan.name);
  if (typeof nama !== "string") return nama;
  if (!durasiSah(masukan.durationDays)) return gagal("DURASI_TIDAK_SAH");
  const supplierId = masukan.supplierId ?? null;
  if (supplierId !== null && !id(supplierId)) return gagal("PEMASOK_TIDAK_ADA");
  const note = rapikanCatatan(masukan.note);
  const hariIni = hariIniWib();

  return runSerializable(async (tx): Promise<HasilJadwal<{ id: string }>> => {
    const tahap = await tx.planStage.findUnique({ where: { id: masukan.planStageId }, select: { id: true } });
    if (!tahap) return gagal("TAHAP_TIDAK_ADA");
    if (supplierId && !(await tx.supplier.findUnique({ where: { id: supplierId }, select: { id: true } }))) {
      return gagal("PEMASOK_TIDAK_ADA");
    }
    const terakhir = await tx.planStageStep.findFirst({
      where: { planStageId: masukan.planStageId },
      orderBy: { sequence: "desc" },
      select: { sequence: true },
    });
    const dibuat = await tx.planStageStep.create({
      data: {
        planStageId: masukan.planStageId,
        sequence: (terakhir?.sequence ?? 0) + 1,
        name: nama,
        supplierId,
        durationDays: masukan.durationDays,
        targetDate: keTanggal(hariIni),
        status: "BELUM",
        note,
        createdById: masukan.olehUserId,
      },
      select: { id: true },
    });
    const { kal } = await bacaKalenderKerja(tx);
    await susunUlangTahap(tx, masukan.planStageId, kal, hariIni);
    const sesudah = await tx.planStageStep.findUniqueOrThrow({ where: { id: dibuat.id }, select: PILIH_LANGKAH });
    await catatJejak(tx, {
      userId: masukan.olehUserId,
      action: JEJAK_JADWAL.LANGKAH_DITAMBAH,
      entityType: ENTITAS_LANGKAH,
      entityId: dibuat.id,
      changes: { before: null, after: potret(sesudah) },
      metadata: { planStageId: masukan.planStageId },
    });
    return { ok: true, id: dibuat.id };
  });
}

/**
 * Ubah nama, lama, pemasok, atau catatan satu langkah. Kolom yang tidak dikirim
 * (`undefined`) tidak berubah; `supplierId: null` / `note: null` atau "" mengosongkan.
 */
export async function ubahLangkah(masukan: {
  stepId: string;
  name?: string;
  durationDays?: number;
  supplierId?: string | null;
  note?: string | null;
  olehUserId: string;
}): Promise<HasilJadwal> {
  if (!id(masukan.stepId)) return gagal("LANGKAH_TIDAK_ADA");
  const data: { name?: string; durationDays?: number; supplierId?: string | null; note?: string | null } = {};
  if (masukan.name !== undefined) {
    const nama = periksaNama(masukan.name);
    if (typeof nama !== "string") return nama;
    data.name = nama;
  }
  if (masukan.durationDays !== undefined) {
    if (!durasiSah(masukan.durationDays)) return gagal("DURASI_TIDAK_SAH");
    data.durationDays = masukan.durationDays;
  }
  if (masukan.supplierId !== undefined) {
    if (masukan.supplierId !== null && !id(masukan.supplierId)) return gagal("PEMASOK_TIDAK_ADA");
    data.supplierId = masukan.supplierId;
  }
  if (masukan.note !== undefined) data.note = rapikanCatatan(masukan.note);
  const hariIni = hariIniWib();

  return runSerializable(async (tx): Promise<HasilJadwal> => {
    const lama = await tx.planStageStep.findUnique({ where: { id: masukan.stepId }, select: PILIH_LANGKAH });
    if (!lama) return gagal("LANGKAH_TIDAK_ADA");
    if (data.supplierId && !(await tx.supplier.findUnique({ where: { id: data.supplierId }, select: { id: true } }))) {
      return gagal("PEMASOK_TIDAK_ADA");
    }
    const berubah = Object.fromEntries(
      Object.entries(data).filter(([k, v]) => lama[k as keyof typeof lama] !== v),
    ) as typeof data;
    if (Object.keys(berubah).length === 0) return { ok: true };

    await tx.planStageStep.update({ where: { id: lama.id }, data: berubah });
    if (berubah.durationDays !== undefined) {
      const { kal } = await bacaKalenderKerja(tx);
      await susunUlangTahap(tx, lama.planStageId, kal, hariIni);
    }
    const sesudah = await tx.planStageStep.findUniqueOrThrow({ where: { id: lama.id }, select: PILIH_LANGKAH });
    await catatJejak(tx, {
      userId: masukan.olehUserId,
      action: JEJAK_JADWAL.LANGKAH_DIUBAH,
      entityType: ENTITAS_LANGKAH,
      entityId: lama.id,
      changes: { before: potret(lama), after: potret(sesudah) },
      metadata: { planStageId: lama.planStageId, kolom: Object.keys(berubah) },
    });
    return { ok: true };
  });
}

/**
 * Ubah status satu langkah. SELESAI butuh tanggal selesai sebenarnya (bawaan
 * hari ini WIB; tidak boleh sesudah hari ini) — langkah yang selesai berjangkar
 * pada tanggal itu, jadi selesai lebih cepat/lambat menggeser langkah sesudahnya.
 * BELUM/PROSES mengosongkan tanggal selesai.
 */
export async function ubahStatusLangkah(masukan: {
  stepId: string;
  status: StatusLangkah;
  doneDate?: string | null;
  olehUserId: string;
}): Promise<HasilJadwal> {
  if (!id(masukan.stepId)) return gagal("LANGKAH_TIDAK_ADA");
  if (!STATUS.includes(masukan.status)) return gagal("ISIAN_TIDAK_SAH");
  const hariIni = hariIniWib();
  let selesaiPada: string | null = null;
  if (masukan.status === "SELESAI") {
    selesaiPada = masukan.doneDate ?? hariIni;
    if (!tanggalSah(selesaiPada) || selesaiPada > hariIni) return gagal("TANGGAL_TIDAK_SAH");
  }

  return runSerializable(async (tx): Promise<HasilJadwal> => {
    const lama = await tx.planStageStep.findUnique({ where: { id: masukan.stepId }, select: PILIH_LANGKAH });
    if (!lama) return gagal("LANGKAH_TIDAK_ADA");
    if (lama.status === masukan.status && keTeks(lama.doneDate) === selesaiPada) return { ok: true };

    await tx.planStageStep.update({
      where: { id: lama.id },
      data: { status: masukan.status, doneDate: selesaiPada ? keTanggal(selesaiPada) : null },
    });
    const { kal } = await bacaKalenderKerja(tx);
    await susunUlangTahap(tx, lama.planStageId, kal, hariIni);
    const sesudah = await tx.planStageStep.findUniqueOrThrow({ where: { id: lama.id }, select: PILIH_LANGKAH });
    await catatJejak(tx, {
      userId: masukan.olehUserId,
      action: JEJAK_JADWAL.STATUS_DIUBAH,
      entityType: ENTITAS_LANGKAH,
      entityId: lama.id,
      changes: {
        before: { status: lama.status, doneDate: keTeks(lama.doneDate), targetDate: keTeks(lama.targetDate) },
        after: { status: sesudah.status, doneDate: keTeks(sesudah.doneDate), targetDate: keTeks(sesudah.targetDate) },
      },
      metadata: { planStageId: lama.planStageId, name: lama.name },
    });
    return { ok: true };
  });
}

/** Tukar langkah dengan tetangganya. Di ujung daftar: tidak berubah apa pun. */
export async function pindahUrutanLangkah(masukan: {
  stepId: string;
  arah: "NAIK" | "TURUN";
  olehUserId: string;
}): Promise<HasilJadwal> {
  if (!id(masukan.stepId)) return gagal("LANGKAH_TIDAK_ADA");
  if (masukan.arah !== "NAIK" && masukan.arah !== "TURUN") return gagal("ISIAN_TIDAK_SAH");
  const hariIni = hariIniWib();

  return runSerializable(async (tx): Promise<HasilJadwal> => {
    const langkah = await tx.planStageStep.findUnique({ where: { id: masukan.stepId }, select: { id: true, planStageId: true } });
    if (!langkah) return gagal("LANGKAH_TIDAK_ADA");
    const semua = await tx.planStageStep.findMany({
      where: { planStageId: langkah.planStageId },
      orderBy: [{ sequence: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: { id: true, sequence: true },
    });
    const i = semua.findIndex((l) => l.id === langkah.id);
    const j = masukan.arah === "NAIK" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= semua.length) return { ok: true };
    const urutan = semua.map((l) => l.id);
    [urutan[i], urutan[j]] = [urutan[j], urutan[i]];
    for (const [k, idLangkah] of urutan.entries()) {
      if (semua.find((l) => l.id === idLangkah)?.sequence !== k + 1) {
        await tx.planStageStep.update({ where: { id: idLangkah }, data: { sequence: k + 1 } });
      }
    }
    const { kal } = await bacaKalenderKerja(tx);
    await susunUlangTahap(tx, langkah.planStageId, kal, hariIni);
    await catatJejak(tx, {
      userId: masukan.olehUserId,
      action: JEJAK_JADWAL.URUTAN_DIPINDAH,
      entityType: ENTITAS_LANGKAH,
      entityId: langkah.id,
      changes: { before: { sequence: i + 1 }, after: { sequence: j + 1 } },
      metadata: { planStageId: langkah.planStageId, arah: masukan.arah, ditukarDengan: semua[j].id },
    });
    return { ok: true };
  });
}

/**
 * Pindahkan satu langkah langsung ke `posisi` (indeks 0 = paling atas) — hasil
 * seret-lepas di ruang kerja tahap. Posisi melewati akhir dijepit ke langkah
 * terakhir (daftar bisa memendek di tangan orang lain); posisi yang sama tidak
 * mengubah apa pun dan tidak menulis jejak. Urutan dirapikan 1..n dan tanggal
 * semua langkah disusun ulang di transaksi yang sama.
 */
export async function pindahLangkahKe(masukan: {
  stepId: string;
  posisi: number;
  olehUserId: string;
}): Promise<HasilJadwal> {
  if (!id(masukan.stepId)) return gagal("LANGKAH_TIDAK_ADA");
  if (!Number.isInteger(masukan.posisi) || masukan.posisi < 0) return gagal("ISIAN_TIDAK_SAH");
  const hariIni = hariIniWib();

  return runSerializable(async (tx): Promise<HasilJadwal> => {
    const langkah = await tx.planStageStep.findUnique({ where: { id: masukan.stepId }, select: { id: true, planStageId: true } });
    if (!langkah) return gagal("LANGKAH_TIDAK_ADA");
    const semua = await tx.planStageStep.findMany({
      where: { planStageId: langkah.planStageId },
      orderBy: [{ sequence: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: { id: true, sequence: true },
    });
    const i = semua.findIndex((l) => l.id === langkah.id);
    if (i < 0) return gagal("LANGKAH_TIDAK_ADA");
    const k = Math.min(masukan.posisi, semua.length - 1);
    if (k === i) return { ok: true };
    const sebelum = semua.map((l) => l.id);
    const urutan = [...sebelum];
    urutan.splice(i, 1);
    urutan.splice(k, 0, langkah.id);
    for (const [n, idLangkah] of urutan.entries()) {
      if (semua.find((l) => l.id === idLangkah)?.sequence !== n + 1) {
        await tx.planStageStep.update({ where: { id: idLangkah }, data: { sequence: n + 1 } });
      }
    }
    const { kal } = await bacaKalenderKerja(tx);
    await susunUlangTahap(tx, langkah.planStageId, kal, hariIni);
    await catatJejak(tx, {
      userId: masukan.olehUserId,
      action: JEJAK_JADWAL.URUTAN_DIPINDAH,
      entityType: ENTITAS_LANGKAH,
      entityId: langkah.id,
      changes: { before: { sequence: i + 1, urutan: sebelum }, after: { sequence: k + 1, urutan } },
      metadata: { planStageId: langkah.planStageId, posisi: masukan.posisi, cara: "SERET" },
    });
    return { ok: true };
  });
}

/** Hapus satu langkah (status apa pun); urutan dirapikan 1..n dan tanggal disusun ulang. */
export async function hapusLangkah(masukan: { stepId: string; olehUserId: string }): Promise<HasilJadwal> {
  if (!id(masukan.stepId)) return gagal("LANGKAH_TIDAK_ADA");
  const hariIni = hariIniWib();

  return runSerializable(async (tx): Promise<HasilJadwal> => {
    const lama = await tx.planStageStep.findUnique({ where: { id: masukan.stepId }, select: PILIH_LANGKAH });
    if (!lama) return gagal("LANGKAH_TIDAK_ADA");
    await tx.planStageStep.delete({ where: { id: lama.id } });
    const { kal } = await bacaKalenderKerja(tx);
    await susunUlangTahap(tx, lama.planStageId, kal, hariIni);
    await catatJejak(tx, {
      userId: masukan.olehUserId,
      action: JEJAK_JADWAL.LANGKAH_DIHAPUS,
      entityType: ENTITAS_LANGKAH,
      entityId: lama.id,
      changes: { before: potret(lama), after: null },
      metadata: { planStageId: lama.planStageId },
    });
    return { ok: true };
  });
}

/**
 * Atur jadwal tahap dari tanggal mulai (MAJU; tenggat dikosongkan) atau dari
 * tenggat (MUNDUR; mulai = tenggat dikurangi total hari kerja semua langkah).
 */
export async function aturMulaiJadwal(masukan: {
  planStageId: string;
  mode: ModeJadwal;
  tanggal: string;
  olehUserId: string;
}): Promise<HasilJadwal> {
  if (!id(masukan.planStageId)) return gagal("TAHAP_TIDAK_ADA");
  if (masukan.mode !== "MAJU" && masukan.mode !== "MUNDUR") return gagal("ISIAN_TIDAK_SAH");
  if (!tanggalSah(masukan.tanggal)) return gagal("TANGGAL_TIDAK_SAH");
  const hariIni = hariIniWib();

  return runSerializable(async (tx): Promise<HasilJadwal> => {
    const tahap = await tx.planStage.findUnique({
      where: { id: masukan.planStageId },
      select: { id: true, scheduleStart: true, deadline: true },
    });
    if (!tahap) return gagal("TAHAP_TIDAK_ADA");
    const langkah = await tx.planStageStep.findMany({ where: { planStageId: tahap.id }, select: { durationDays: true } });
    const { kal } = await bacaKalenderKerja(tx);
    const scheduleStart =
      masukan.mode === "MAJU" ? masukan.tanggal : mulaiDariTenggat(totalHariJadwal(langkah), masukan.tanggal, kal);
    const deadline = masukan.mode === "MUNDUR" ? masukan.tanggal : null;
    await tx.planStage.update({
      where: { id: tahap.id },
      data: { scheduleStart: keTanggal(scheduleStart), deadline: deadline ? keTanggal(deadline) : null },
    });
    await susunUlangTahap(tx, tahap.id, kal, hariIni);
    await catatJejak(tx, {
      userId: masukan.olehUserId,
      action: JEJAK_JADWAL.MULAI_DIATUR,
      entityType: ENTITAS_TAHAP,
      entityId: tahap.id,
      changes: {
        before: { scheduleStart: keTeks(tahap.scheduleStart), deadline: keTeks(tahap.deadline) },
        after: { scheduleStart, deadline },
      },
      metadata: { mode: masukan.mode, tanggal: masukan.tanggal },
    });
    return { ok: true };
  });
}
