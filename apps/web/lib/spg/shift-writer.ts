import { prisma, type AdminNotification, type Prisma } from "@elorae/db";
import { kunciHariWib } from "@/lib/dashboard/tren";
import { formatDisplayDate } from "@/lib/date-only";
import { runSerializable } from "@/lib/db/tx-retry";
import { fanOutAdminNotification } from "@/lib/notifications/admin-fanout";
import { JENIS_KABAR, kabariPengguna, type Kabar } from "@/lib/notifications/kabar-pengguna";
import { bentrokKunciKiriman } from "@/lib/receivables/idempoten";
import { bacaAturanShift, KUNCI_SHIFT, type AturanShift } from "./pengaturan";
import {
  ENTITAS_JADWAL_SPG,
  ENTITAS_TUKAR_SHIFT,
  hariTukar,
  hasilTukar,
  JEJAK_SHIFT,
  KATEGORI_NOTIF_TUKAR_SHIFT,
  kunciSel,
  labelShift,
  MAKS_ALASAN_TUKAR,
  MAKS_KUNCI_TUKAR,
  periksaTukar,
  rapikanTeksTukar,
  rencanakanSimpanJadwalSpg,
  STATUS_TUKAR_TERBUKA,
  tukarBentrok,
  type BarisShift,
  type IsianSel,
  type KodeTolakTukar,
  type PerubahanSel,
  type SelShift,
  type StatusTukar,
  type TolakJadwalSpg,
} from "./shift";

/**
 * Penulis jadwal kerja dan tukar shift SPG.
 *
 * - Simpan jadwal (kantor, `stores:manage`): SATU transaksi serializable + SATU
 *   baris `AuditLog` (`SPG_SHIFT_UPDATED`, `entityId` = id toko) yang membawa
 *   setiap sel yang berubah, sebelum dan sesudah. Kabar `JADWAL_SPG` ke setiap
 *   SPG yang jadwalnya berubah, SESUDAH transaksi.
 * - Tukar shift: pengaju (SPG) → rekan setoko setuju → kantor menyetujui. Setiap
 *   langkah di `runSerializable` dengan penjaga keadaan bandingkan-lalu-tukar
 *   (`updateMany where status = …` + periksa jumlah) dan jejaknya di transaksi
 *   yang sama. Jadwal hanya berubah saat kantor menyetujui.
 *
 * Toko SPG selalu dari pemanggil (server), tidak pernah dari isian HP. Semua
 * aturan murni ada di `shift.ts` dan dites di sana.
 */

type Tx = Prisma.TransactionClient;

const PILIH_BARIS = { userId: true, day: true, kind: true, shiftCode: true, startTime: true, endTime: true } as const;

async function aturanShiftTx(tx: Tx): Promise<AturanShift> {
  const r = await tx.systemSetting.findUnique({ where: { key: KUNCI_SHIFT }, select: { value: true } });
  return bacaAturanShift(r?.value);
}

/** SPG toko ini sekarang — pengguna dengan toko tetap itu. */
async function spgTokoTx(tx: Tx, storeId: string): Promise<Set<string>> {
  const rows = await tx.user.findMany({ where: { assignedStoreId: storeId }, select: { id: true } });
  return new Set(rows.map((r) => r.id));
}

async function barisOrangHari(tx: Tx, userIds: readonly string[], hari: readonly string[]): Promise<BarisShift[]> {
  const u = [...new Set(userIds)].filter(Boolean);
  const h = [...new Set(hari)].filter(Boolean);
  if (u.length === 0 || h.length === 0) return [];
  return tx.spgShift.findMany({ where: { userId: { in: u }, day: { in: h } }, select: PILIH_BARIS });
}

/** Tulis isi sel (buat atau ubah), untuk toko ini. */
async function tulisSel(tx: Tx, storeId: string, olehUserId: string, sel: SelShift & { userId: string; day: string }) {
  const isi = { storeId, kind: sel.kind, shiftCode: sel.shiftCode, startTime: sel.startTime, endTime: sel.endTime };
  await tx.spgShift.upsert({
    where: { userId_day: { userId: sel.userId, day: sel.day } },
    create: { ...isi, userId: sel.userId, day: sel.day, createdById: olehUserId },
    update: { ...isi, updatedById: olehUserId },
  });
}

/** Perubahan sel → bentuk jejak `{ before, after }` berkunci "userId|day". */
function jejakSel(perubahan: readonly PerubahanSel[]): { before: Prisma.InputJsonObject; after: Prisma.InputJsonObject } {
  const before: Record<string, Prisma.InputJsonValue | null> = {};
  const after: Record<string, Prisma.InputJsonValue | null> = {};
  for (const p of perubahan) {
    const k = kunciSel(p.userId, p.day);
    before[k] = p.sebelum;
    after[k] = p.sesudah;
  }
  return { before, after } as { before: Prisma.InputJsonObject; after: Prisma.InputJsonObject };
}

// ─── Teks kabar (selalu Indonesia: kabar disimpan sebagai satu teks) ─────────

const fmtHari = new Intl.DateTimeFormat("id-ID", { weekday: "long", timeZone: "Asia/Jakarta" });

/** "Senin, 5 Okt 2026". */
export function labelHariKabar(day: string): string {
  const d = new Date(`${day}T00:00:00+07:00`);
  return `${fmtHari.format(d)}, ${formatDisplayDate(d)}`;
}

function teksSel(b: Pick<BarisShift, "kind" | "shiftCode" | "startTime" | "endTime"> | null | undefined, aturan: AturanShift): string {
  if (!b || b.kind !== "KERJA") return "libur";
  return `shift ${labelShift(b.shiftCode, aturan)} ${b.startTime}–${b.endTime}`;
}

async function kirimKabar(daftar: { userId: string; kabar: Kabar }[]): Promise<void> {
  for (const k of daftar) await kabariPengguna(k.userId, k.kabar);
}

async function namaPengguna(ids: readonly string[]): Promise<Map<string, string>> {
  const rows = await prisma.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true, email: true } });
  return new Map(rows.map((u) => [u.id, u.name ?? u.email]));
}

// ─── Simpan jadwal (kantor) ──────────────────────────────────────────────────

export type HasilSimpanJadwalSpg =
  | { ok: true; berubah: number; hariPertama: Record<string, string> }
  | TolakJadwalSpg
  | { ok: false; kode: "TOKO_TIDAK_DITEMUKAN" };

/**
 * Simpan sel-sel kisi jadwal satu toko. Ditolak seluruhnya bila satu sel
 * salah (hari lewat, bukan SPG toko ini, shift tidak dikenal) — tidak ada
 * simpan setengah jalan. Sel yang tidak berubah tidak ditulis dan tidak
 * dijejak; simpan tanpa perubahan apa pun tidak menulis apa-apa.
 */
export async function simpanJadwalSpg(input: {
  storeId: string;
  olehUserId: string;
  isian: readonly IsianSel[];
  sekarang?: Date;
}): Promise<HasilSimpanJadwalSpg> {
  const hariIni = kunciHariWib(input.sekarang ?? new Date());
  const hasil = await runSerializable(async (tx): Promise<HasilSimpanJadwalSpg> => {
    const toko = await tx.store.findUnique({ where: { id: input.storeId }, select: { id: true } });
    if (!toko) return { ok: false, kode: "TOKO_TIDAK_DITEMUKAN" };
    const [aturan, spg, sebelum] = await Promise.all([
      aturanShiftTx(tx),
      spgTokoTx(tx, input.storeId),
      barisOrangHari(
        tx,
        input.isian.map((s) => s.userId),
        input.isian.map((s) => s.day),
      ),
    ]);
    const r = rencanakanSimpanJadwalSpg({ sebelum, isian: input.isian, aturan, hariIni, spg });
    if (!r.ok) return r;
    if (r.perubahan.length === 0) return { ok: true, berubah: 0, hariPertama: {} };

    for (const w of r.tulis) await tulisSel(tx, input.storeId, input.olehUserId, w);
    if (r.hapus.length > 0) {
      await tx.spgShift.deleteMany({ where: { OR: r.hapus.map((h) => ({ userId: h.userId, day: h.day })) } });
    }
    await tx.auditLog.create({
      data: {
        userId: input.olehUserId,
        action: JEJAK_SHIFT.DIUBAH,
        entityType: ENTITAS_JADWAL_SPG,
        entityId: input.storeId,
        changes: jejakSel(r.perubahan),
        metadata: {
          jumlahSel: r.perubahan.length,
          hari: [...new Set(r.perubahan.map((p) => p.day))],
          spg: Object.keys(r.hariPertama),
        },
      },
    });
    return { ok: true, berubah: r.perubahan.length, hariPertama: r.hariPertama };
  });

  if (hasil.ok && hasil.berubah > 0) {
    // Satu kabar per SPG per simpan, menuju hari pertama yang berubah. Hari
    // lalu memang tidak bisa diubah, jadi setiap perubahan adalah hari ini atau sesudahnya.
    await kirimKabar(
      Object.entries(hasil.hariPertama)
        .filter(([userId]) => userId !== input.olehUserId)
        .map(([userId, day]) => ({
          userId,
          kabar: {
            jenis: JENIS_KABAR.JADWAL_SPG,
            judul: "Jadwal kerja Anda berubah",
            isi: `Kantor mengubah jadwal Anda mulai ${labelHariKabar(day)}. Buka Jadwal kerja untuk melihatnya.`,
            data: { day },
          },
        })),
    );
  }
  return hasil;
}

// ─── Tukar shift ─────────────────────────────────────────────────────────────

export type KodeTukar =
  | KodeTolakTukar
  | "KUNCI_WAJIB"
  | "KUNCI_DIPAKAI"
  | "REKAN_TIDAK_SAH"
  | "ALASAN_WAJIB"
  | "ALASAN_TERLALU_PANJANG"
  | "CATATAN_WAJIB"
  | "CATATAN_TERLALU_PANJANG"
  | "BENTROK"
  | "TIDAK_DITEMUKAN"
  | "SUDAH_DIPUTUSKAN"
  | "BUKAN_SPG_TOKO"
  | "MILIK_SENDIRI";

export type HasilTukar = { ok: true; id: string; status: StatusTukar; ulang?: boolean } | { ok: false; kode: KodeTukar };

const PILIH_TUKAR = {
  id: true,
  storeId: true,
  requesterId: true,
  partnerId: true,
  day: true,
  partnerDay: true,
  reason: true,
  status: true,
  decisionNote: true,
} as const;

type BarisTukar = Prisma.SpgShiftSwapGetPayload<{ select: typeof PILIH_TUKAR }>;

const petaHari = (baris: readonly BarisShift[], userId: string) => new Map(baris.filter((b) => b.userId === userId).map((b) => [b.day, b]));

/** Catatan opsional/wajib — rapikan + batas panjang. */
function teksCatatan(
  x: unknown,
  wajib: boolean,
  kode: { wajib: KodeTukar; panjang: KodeTukar },
): { ok: true; teks: string | null } | { ok: false; kode: KodeTukar } {
  const t = rapikanTeksTukar(x);
  if (!t) return wajib ? { ok: false, kode: kode.wajib } : { ok: true, teks: null };
  if (t.length > MAKS_ALASAN_TUKAR) return { ok: false, kode: kode.panjang };
  return { ok: true, teks: t };
}

async function catatJejakTukar(
  tx: Tx,
  data: { userId: string; action: string; swapId: string; changes: Prisma.InputJsonObject; reason?: string | null; metadata?: Prisma.InputJsonObject },
) {
  await tx.auditLog.create({
    data: {
      userId: data.userId,
      action: data.action,
      entityType: ENTITAS_TUKAR_SHIFT,
      entityId: data.swapId,
      changes: data.changes,
      reason: data.reason ?? null,
      ...(data.metadata ? { metadata: data.metadata } : {}),
    },
  });
}

/**
 * SPG mengajukan tukar shift ke rekan setokonya. Kunci kiriman diperiksa
 * PALING DULU: kiriman ulang dari HP mengembalikan ajuan yang sudah ada apa
 * adanya. `storeId` = toko tetap pengaju, dari server.
 */
export async function ajukanTukarShift(input: {
  userId: string;
  storeId: string;
  day: unknown;
  partnerId: unknown;
  partnerDay?: unknown;
  alasan: unknown;
  idempotencyKey: unknown;
  sekarang?: Date;
}): Promise<HasilTukar> {
  const kunci = typeof input.idempotencyKey === "string" ? input.idempotencyKey.trim() : "";
  if (!kunci || kunci.length > MAKS_KUNCI_TUKAR) return { ok: false, kode: "KUNCI_WAJIB" };
  const hariIni = kunciHariWib(input.sekarang ?? new Date());
  const day = typeof input.day === "string" ? input.day : "";
  const partnerDay = typeof input.partnerDay === "string" && input.partnerDay ? input.partnerDay : null;
  const partnerId = typeof input.partnerId === "string" ? input.partnerId : "";

  const simpan = () =>
    runSerializable(async (tx): Promise<HasilTukar> => {
      const ada = await tx.spgShiftSwap.findUnique({ where: { idempotencyKey: kunci }, select: { id: true, status: true, requesterId: true } });
      if (ada) {
        return ada.requesterId === input.userId
          ? { ok: true, id: ada.id, status: ada.status as StatusTukar, ulang: true }
          : { ok: false, kode: "KUNCI_DIPAKAI" };
      }
      const alasan = teksCatatan(input.alasan, true, { wajib: "ALASAN_WAJIB", panjang: "ALASAN_TERLALU_PANJANG" });
      if (!alasan.ok) return alasan;
      if (!partnerId || partnerId === input.userId) return { ok: false, kode: "REKAN_TIDAK_SAH" };

      const spg = await spgTokoTx(tx, input.storeId);
      if (!spg.has(input.userId)) return { ok: false, kode: "BUKAN_SPG_TOKO" };
      if (!spg.has(partnerId)) return { ok: false, kode: "REKAN_TIDAK_SAH" };

      const hari = hariTukar({ day, partnerDay });
      const baris = await barisOrangHari(tx, [input.userId, partnerId], hari);
      const salah = periksaTukar({ day, partnerDay, hariIni, pengaju: petaHari(baris, input.userId), rekan: petaHari(baris, partnerId) });
      if (salah) return { ok: false, kode: salah };

      const terbuka = await tx.spgShiftSwap.findMany({
        where: {
          status: { in: [...STATUS_TUKAR_TERBUKA] },
          OR: [{ requesterId: { in: [input.userId, partnerId] } }, { partnerId: { in: [input.userId, partnerId] } }],
        },
        select: { id: true, requesterId: true, partnerId: true, day: true, partnerDay: true },
      });
      if (tukarBentrok({ requesterId: input.userId, partnerId, day, partnerDay }, terbuka)) return { ok: false, kode: "BENTROK" };

      const dibuat = await tx.spgShiftSwap.create({
        data: {
          storeId: input.storeId,
          requesterId: input.userId,
          partnerId,
          day,
          partnerDay,
          reason: alasan.teks,
          status: "MENUNGGU_REKAN",
          idempotencyKey: kunci,
        },
        select: { id: true },
      });
      await catatJejakTukar(tx, {
        userId: input.userId,
        action: JEJAK_SHIFT.TUKAR_DIAJUKAN,
        swapId: dibuat.id,
        changes: { after: { status: "MENUNGGU_REKAN", day, partnerDay, partnerId } },
        reason: alasan.teks,
        metadata: { storeId: input.storeId },
      });
      return { ok: true, id: dibuat.id, status: "MENUNGGU_REKAN" };
    });

  let hasil: HasilTukar;
  try {
    hasil = await simpan();
  } catch (err) {
    // Kiriman kembarnya menang lebih dulu; percobaan ini menemukan ajuannya.
    if (!bentrokKunciKiriman(err)) throw err;
    hasil = await simpan();
  }

  if (hasil.ok && !hasil.ulang) {
    const [nama, aturan, baris] = await Promise.all([
      namaPengguna([input.userId]),
      prisma.systemSetting.findUnique({ where: { key: KUNCI_SHIFT }, select: { value: true } }).then((r) => bacaAturanShift(r?.value)),
      prisma.spgShift.findUnique({ where: { userId_day: { userId: input.userId, day } }, select: PILIH_BARIS }),
    ]);
    await kirimKabar([
      {
        userId: partnerId,
        kabar: {
          jenis: JENIS_KABAR.TUKAR_SHIFT_DIMINTA,
          judul: `${nama.get(input.userId) ?? "Rekan Anda"} meminta tukar shift`,
          isi:
            `${labelHariKabar(day)}, ${teksSel(baris, aturan)}` +
            (partnerDay ? `, ditukar dengan hari Anda ${labelHariKabar(partnerDay)}` : "") +
            ". Buka Jadwal kerja untuk menjawab.",
          data: { swapId: hasil.id },
        },
      },
    ]);
  }
  return hasil;
}

async function muatTukar(tx: Tx, id: string): Promise<BarisTukar | null> {
  if (!id) return null;
  return tx.spgShiftSwap.findUnique({ where: { id }, select: PILIH_TUKAR });
}

/**
 * Rekan menjawab ajuan yang ditujukan kepadanya. Setuju → menunggu kantor
 * (catatan kantor `SPG_SHIFT_SWAP` ditulis di transaksi, disebar sesudahnya);
 * tolak → selesai, pengaju dikabari. Jadwal belum berubah di sini.
 */
export async function jawabTukarShift(input: {
  swapId: string;
  userId: string;
  storeId: string;
  setuju: boolean;
  alasan?: unknown;
  sekarang?: Date;
}): Promise<HasilTukar> {
  const sekarang = input.sekarang ?? new Date();
  const hariIni = kunciHariWib(sekarang);
  const alasan = teksCatatan(input.alasan, false, { wajib: "ALASAN_WAJIB", panjang: "ALASAN_TERLALU_PANJANG" });
  if (!alasan.ok) return alasan;

  const sesudah: { notifikasi: AdminNotification | null; swap: BarisTukar | null } = { notifikasi: null, swap: null };
  const hasil = await runSerializable(async (tx): Promise<HasilTukar> => {
    sesudah.notifikasi = null;
    sesudah.swap = null;
    const s = await muatTukar(tx, input.swapId);
    // Ajuan orang lain atau toko lain tidak diakui ada.
    if (!s || s.partnerId !== input.userId || s.storeId !== input.storeId) return { ok: false, kode: "TIDAK_DITEMUKAN" };
    if (s.status !== "MENUNGGU_REKAN") return { ok: false, kode: "SUDAH_DIPUTUSKAN" };

    if (input.setuju) {
      const baris = await barisOrangHari(tx, [s.requesterId, s.partnerId], hariTukar(s));
      const salah = periksaTukar({
        day: s.day,
        partnerDay: s.partnerDay,
        hariIni,
        pengaju: petaHari(baris, s.requesterId),
        rekan: petaHari(baris, s.partnerId),
        tanpaBatasJauh: true,
      });
      if (salah) return { ok: false, kode: salah };
    }
    const status: StatusTukar = input.setuju ? "MENUNGGU_KANTOR" : "DITOLAK_REKAN";
    const r = await tx.spgShiftSwap.updateMany({
      where: { id: s.id, status: "MENUNGGU_REKAN" },
      data: { status, partnerAnsweredAt: sekarang, ...(input.setuju ? {} : { decisionNote: alasan.teks }) },
    });
    if (r.count !== 1) return { ok: false, kode: "SUDAH_DIPUTUSKAN" };
    await catatJejakTukar(tx, {
      userId: input.userId,
      action: input.setuju ? JEJAK_SHIFT.TUKAR_DISETUJUI_REKAN : JEJAK_SHIFT.TUKAR_DITOLAK_REKAN,
      swapId: s.id,
      changes: { before: { status: s.status }, after: { status } },
      reason: alasan.teks,
    });
    if (input.setuju) {
      const [toko, nama] = await Promise.all([
        tx.store.findUnique({ where: { id: s.storeId }, select: { name: true } }),
        tx.user.findMany({ where: { id: { in: [s.requesterId, s.partnerId] } }, select: { id: true, name: true, email: true } }),
      ]);
      const n = (id: string) => {
        const u = nama.find((x) => x.id === id);
        return u ? (u.name ?? u.email) : "SPG";
      };
      sesudah.notifikasi = await tx.adminNotification.create({
        data: {
          category: KATEGORI_NOTIF_TUKAR_SHIFT,
          severity: "INFO",
          title: "Tukar shift menunggu persetujuan",
          message:
            `${n(s.requesterId)} dan ${n(s.partnerId)} (${toko?.name ?? "toko"}) sepakat menukar shift ` +
            `${labelHariKabar(s.day)}${s.partnerDay && s.partnerDay !== s.day ? ` dan ${labelHariKabar(s.partnerDay)}` : ""}. ` +
            "Setujui atau tolak di Jadwal SPG → Tukar shift.",
          metadata: { swapId: s.id, storeId: s.storeId },
        },
      });
    }
    sesudah.swap = s;
    return { ok: true, id: s.id, status };
  });

  if (hasil.ok && sesudah.swap) {
    const s = sesudah.swap;
    const terkirim: AdminNotification | null = sesudah.notifikasi;
    if (terkirim) void fanOutAdminNotification(terkirim);
    const nama = await namaPengguna([s.partnerId]);
    await kirimKabar([
      {
        userId: s.requesterId,
        kabar: {
          jenis: JENIS_KABAR.TUKAR_SHIFT_DIPUTUSKAN,
          judul: input.setuju ? "Rekan setuju tukar shift" : "Rekan menolak tukar shift",
          isi: input.setuju
            ? `${nama.get(s.partnerId) ?? "Rekan Anda"} setuju menukar shift ${labelHariKabar(s.day)}. Menunggu persetujuan kantor.`
            : `${nama.get(s.partnerId) ?? "Rekan Anda"} menolak menukar shift ${labelHariKabar(s.day)}.` +
              (alasan.teks ? ` Alasan: ${alasan.teks}` : ""),
          data: { swapId: s.id },
        },
      },
    ]);
  }
  return hasil;
}

/** Pengaju membatalkan ajuannya selama belum diputuskan kantor. */
export async function batalkanTukarShift(input: { swapId: string; userId: string; storeId: string }): Promise<HasilTukar> {
  return runSerializable(async (tx): Promise<HasilTukar> => {
    const s = await muatTukar(tx, input.swapId);
    if (!s || s.requesterId !== input.userId || s.storeId !== input.storeId) return { ok: false, kode: "TIDAK_DITEMUKAN" };
    if (!STATUS_TUKAR_TERBUKA.includes(s.status as StatusTukar)) return { ok: false, kode: "SUDAH_DIPUTUSKAN" };
    const r = await tx.spgShiftSwap.updateMany({
      where: { id: s.id, status: { in: [...STATUS_TUKAR_TERBUKA] } },
      data: { status: "DIBATALKAN" },
    });
    if (r.count !== 1) return { ok: false, kode: "SUDAH_DIPUTUSKAN" };
    await catatJejakTukar(tx, {
      userId: input.userId,
      action: JEJAK_SHIFT.TUKAR_DIBATALKAN,
      swapId: s.id,
      changes: { before: { status: s.status }, after: { status: "DIBATALKAN" } },
    });
    return { ok: true, id: s.id, status: "DIBATALKAN" };
  });
}

/**
 * Kantor menyetujui ajuan yang sudah disetujui rekan: isi sel kedua orang di
 * setiap hari yang terlibat bertukar (rekan libur/kosong → shift berpindah,
 * pengaju libur). Jadwal diperiksa ulang lebih dulu — kantor bisa mengubahnya
 * sesudah ajuan dibuat — dan kedua orang harus masih SPG toko itu.
 */
export async function setujuiTukarShift(input: { swapId: string; olehUserId: string; catatan?: unknown; sekarang?: Date }): Promise<HasilTukar> {
  const sekarang = input.sekarang ?? new Date();
  const hariIni = kunciHariWib(sekarang);
  const catatan = teksCatatan(input.catatan, false, { wajib: "CATATAN_WAJIB", panjang: "CATATAN_TERLALU_PANJANG" });
  if (!catatan.ok) return catatan;

  const sesudah: { swap: BarisTukar | null; aturan: AturanShift | null; baru: Map<string, SelShift> } = { swap: null, aturan: null, baru: new Map() };
  const hasil = await runSerializable(async (tx): Promise<HasilTukar> => {
    sesudah.swap = null;
    sesudah.baru = new Map();
    const s = await muatTukar(tx, input.swapId);
    if (!s) return { ok: false, kode: "TIDAK_DITEMUKAN" };
    if (input.olehUserId === s.requesterId || input.olehUserId === s.partnerId) return { ok: false, kode: "MILIK_SENDIRI" };
    if (s.status !== "MENUNGGU_KANTOR") return { ok: false, kode: "SUDAH_DIPUTUSKAN" };

    const spg = await spgTokoTx(tx, s.storeId);
    if (!spg.has(s.requesterId) || !spg.has(s.partnerId)) return { ok: false, kode: "BUKAN_SPG_TOKO" };
    const hari = hariTukar(s);
    const baris = await barisOrangHari(tx, [s.requesterId, s.partnerId], hari);
    const salah = periksaTukar({
      day: s.day,
      partnerDay: s.partnerDay,
      hariIni,
      pengaju: petaHari(baris, s.requesterId),
      rekan: petaHari(baris, s.partnerId),
      tanpaBatasJauh: true,
    });
    if (salah) return { ok: false, kode: salah };

    const r = await tx.spgShiftSwap.updateMany({
      where: { id: s.id, status: "MENUNGGU_KANTOR" },
      data: { status: "DISETUJUI", decidedById: input.olehUserId, decidedAt: sekarang, decisionNote: catatan.teks },
    });
    if (r.count !== 1) return { ok: false, kode: "SUDAH_DIPUTUSKAN" };

    const t = hasilTukar({ pengajuId: s.requesterId, rekanId: s.partnerId, hari, baris });
    for (const w of t.tulis) await tulisSel(tx, s.storeId, input.olehUserId, w);
    const j = jejakSel(t.perubahan);
    await catatJejakTukar(tx, {
      userId: input.olehUserId,
      action: JEJAK_SHIFT.TUKAR_DISETUJUI,
      swapId: s.id,
      changes: { before: { status: s.status, sel: j.before }, after: { status: "DISETUJUI", sel: j.after } },
      reason: catatan.teks,
      metadata: { storeId: s.storeId },
    });
    sesudah.swap = s;
    sesudah.aturan = await aturanShiftTx(tx);
    sesudah.baru = new Map(t.tulis.map((w) => [kunciSel(w.userId, w.day), w]));
    return { ok: true, id: s.id, status: "DISETUJUI" };
  });

  if (hasil.ok && sesudah.swap && sesudah.aturan) {
    const s = sesudah.swap;
    const aturan = sesudah.aturan;
    const ringkas = (userId: string) =>
      hariTukar(s)
        .map((d) => `${labelHariKabar(d)}: ${teksSel(sesudah.baru.get(kunciSel(userId, d)) ?? null, aturan)}`)
        .join("; ");
    await kirimKabar(
      [s.requesterId, s.partnerId].map((userId) => ({
        userId,
        kabar: {
          jenis: JENIS_KABAR.TUKAR_SHIFT_DIPUTUSKAN,
          judul: "Tukar shift disetujui kantor",
          isi: `Jadwal Anda sekarang — ${ringkas(userId)}.`,
          data: { swapId: s.id },
        },
      })),
    );
  }
  return hasil;
}

/** Kantor menolak ajuan yang sudah disetujui rekan. Catatan wajib; jadwal tidak berubah. */
export async function tolakTukarShift(input: { swapId: string; olehUserId: string; catatan: unknown; sekarang?: Date }): Promise<HasilTukar> {
  const sekarang = input.sekarang ?? new Date();
  const catatan = teksCatatan(input.catatan, true, { wajib: "CATATAN_WAJIB", panjang: "CATATAN_TERLALU_PANJANG" });
  if (!catatan.ok) return catatan;

  const sesudah: { swap: BarisTukar | null } = { swap: null };
  const hasil = await runSerializable(async (tx): Promise<HasilTukar> => {
    sesudah.swap = null;
    const s = await muatTukar(tx, input.swapId);
    if (!s) return { ok: false, kode: "TIDAK_DITEMUKAN" };
    if (input.olehUserId === s.requesterId || input.olehUserId === s.partnerId) return { ok: false, kode: "MILIK_SENDIRI" };
    if (s.status !== "MENUNGGU_KANTOR") return { ok: false, kode: "SUDAH_DIPUTUSKAN" };
    const r = await tx.spgShiftSwap.updateMany({
      where: { id: s.id, status: "MENUNGGU_KANTOR" },
      data: { status: "DITOLAK", decidedById: input.olehUserId, decidedAt: sekarang, decisionNote: catatan.teks },
    });
    if (r.count !== 1) return { ok: false, kode: "SUDAH_DIPUTUSKAN" };
    await catatJejakTukar(tx, {
      userId: input.olehUserId,
      action: JEJAK_SHIFT.TUKAR_DITOLAK,
      swapId: s.id,
      changes: { before: { status: s.status }, after: { status: "DITOLAK" } },
      reason: catatan.teks,
    });
    sesudah.swap = s;
    return { ok: true, id: s.id, status: "DITOLAK" };
  });

  if (hasil.ok && sesudah.swap) {
    const s = sesudah.swap;
    await kirimKabar(
      [s.requesterId, s.partnerId].map((userId) => ({
        userId,
        kabar: {
          jenis: JENIS_KABAR.TUKAR_SHIFT_DIPUTUSKAN,
          judul: "Tukar shift ditolak kantor",
          isi: `Tukar shift ${labelHariKabar(s.day)} ditolak. Alasan: ${catatan.teks}. Jadwal Anda tidak berubah.`,
          data: { swapId: s.id },
        },
      })),
    );
  }
  return hasil;
}
