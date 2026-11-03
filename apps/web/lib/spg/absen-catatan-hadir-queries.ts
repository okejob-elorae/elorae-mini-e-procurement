import { prisma } from "@elorae/db";
import { kunciHariWib } from "@/lib/dashboard/tren";
import { formatDisplayDate } from "@/lib/date-only";
import { wibMonthRange } from "@/lib/spg-commission/laporan-queries";
import { salesMonthLabelId } from "@/lib/spg-commission/payout";
import {
  ENTITAS_CATATAN_HADIR,
  JEJAK_CATATAN_HADIR,
  menungguDiperiksa,
  perluDimasukkan,
  statusCatatanHadirDari,
  type HariCatatan,
  type StatusCatatanHadir,
} from "./absen-catatan-hadir";
import { bulanWib } from "@/lib/salesman/pengaturan";
import { hariAntara, masaKerjaBulan } from "./gaji-pokok";
import { bulanGajiDibayar, kunciGaji, muatGajiPokok } from "./gaji-pokok-queries";
import { bulanSebelum } from "./komisi";
import { izinPada } from "./shift";

/**
 * Halaman Komisi SPG → Catatan check-in toko (P7d, P7e, P61a): SPG × bulan yang PERLU catatan dan
 * setiap catatan yang sudah ada dengan statusnya. Tanggal diformat di server (WIB).
 *
 * "Perlu" dibaca dari keadaan gajinya SEKARANG, bukan dari pengingat: setiap SPG × bulan selesai
 * (12 bulan ke belakang, `BULAN_HORIZON_CATATAN`) yang gajinya belum dibayar dan tertahan
 * `CATATAN_HADIR_BELUM_DIMASUKKAN` (P7e). Pengingat `SPG_ATTENDANCE_NEEDED` hanya ditulis saat
 * kunci / "Tetapkan", jadi tahanan yang baru muncul sesudahnya (gaji bulanan baru diatur, jadwal
 * ditolak sesudah dikunci) tidak akan pernah punya baris kalau daftarnya bergantung pada pengingat.
 */

/** Bulan selesai yang diperiksa untuk "perlu dimasukkan" — sama dengan antrean laporan yang menunggu dicek (`BULAN_MENUNGGU_CEK`). */
export const BULAN_HORIZON_CATATAN = 12;

export type BarisCatatanHadirKantor = {
  userId: string;
  nama: string;
  storeId: string;
  namaToko: string;
  bulan: string;
  label: string;
  /** Hari masa kerjanya di bulan itu; null kalau tanggal mulainya belum diisi. */
  masa: { hariAwal: string; hariAkhir: string } | null;
  /** Hari yang membuat pembayarannya tertahan (dari pengingatnya). */
  hariPerlu: string[];
  catatan: {
    id: string;
    status: StatusCatatanHadir;
    versi: number;
    sumber: string;
    adaBerkas: boolean;
    dimasukkanOleh: string;
    dimasukkanOlehId: string;
    /** Setiap orang yang menyimpan catatan ini sejak pemeriksaan terakhirnya — tidak boleh memeriksanya (`PEMERIKSA_SAMA`). */
    penyimpanIds: string[];
    dimasukkanLabel: string;
    diperiksaOleh: string | null;
    diperiksaLabel: string | null;
    catatanKembali: string | null;
    hari: HariCatatan[];
  } | null;
  /** Gaji & komisi bulan itu sudah dibayar — catatannya tidak bisa diubah lagi. */
  sudahDibayar: boolean;
};

const nama = (u: { name: string | null; email: string } | undefined) => u?.name?.trim() || u?.email || "—";

/**
 * SPG × bulan selesai yang gajinya belum dibayar dan SEKARANG tertahan
 * `CATATAN_HADIR_BELUM_DIMASUKKAN`, dengan hari yang menahannya. Kandidatnya setiap SPG yang punya
 * toko (bertugas atau sudah berhenti) dan tanggal mulai bekerja — tanpa tanggal mulai pembayarannya
 * tertahan `MULAI_KERJA_BELUM_DIISI` lebih dulu — di bulan yang disentuh masa kerjanya.
 * `cakupan` membatasi ke SPG tertentu (tes basis data).
 */
export async function pasanganPerluCatatan(
  sekarang: Date = new Date(),
  cakupan?: { userIds?: string[] },
): Promise<Array<{ userId: string; storeId: string; bulan: string; hari: string[] }>> {
  const bulanSemua: string[] = [];
  for (let m = bulanSebelum(bulanWib(sekarang)), i = 0; i < BULAN_HORIZON_CATATAN; i++, m = bulanSebelum(m)) bulanSemua.push(m);
  const spg = await prisma.user.findMany({
    where: {
      spgStartedOn: { not: null },
      OR: [{ assignedStoreId: { not: null } }, { spgEndedStoreId: { not: null } }],
      ...(cakupan?.userIds ? { id: { in: cakupan.userIds } } : {}),
    },
    select: { id: true, assignedStoreId: true, spgEndedStoreId: true, spgStartedOn: true, spgEndedOn: true },
  });
  if (spg.length === 0) return [];
  const dibayar = await bulanGajiDibayar(prisma, spg.map((u) => u.id));
  const calon = spg.flatMap((u) => {
    const storeId = u.assignedStoreId ?? u.spgEndedStoreId;
    if (!storeId) return [];
    return bulanSemua
      .filter((bulan) => masaKerjaBulan(bulan, u.spgStartedOn, u.spgEndedOn) !== null && !dibayar.get(u.id)?.has(bulan))
      .map((bulan) => ({ userId: u.id, storeId, bulan }));
  });
  const gaji = await muatGajiPokok(prisma, calon);
  return calon.flatMap((p) => {
    const g = gaji.get(kunciGaji(p.userId, p.bulan));
    return g && !g.ok && g.alasan === "CATATAN_HADIR_BELUM_DIMASUKKAN" ? [{ ...p, hari: g.hari }] : [];
  });
}

export async function daftarCatatanHadirKantor(sekarang: Date = new Date(), cakupan?: { userIds?: string[] }): Promise<BarisCatatanHadirKantor[]> {
  const [perlu, catatan] = await Promise.all([
    pasanganPerluCatatan(sekarang, cakupan),
    prisma.spgAttendanceRecord.findMany({
      where: cakupan?.userIds ? { userId: { in: cakupan.userIds } } : undefined,
      orderBy: [{ month: "desc" }, { updatedAt: "desc" }],
      take: 300,
      include: { days: { orderBy: { day: "asc" }, select: { day: true, kind: true, present: true, note: true } } },
    }),
  ]);
  const pasangan = new Map<string, { userId: string; storeId: string; bulan: string; hari: string[] }>();
  for (const p of perlu) pasangan.set(`${p.userId}|${p.bulan}`, p);
  for (const c of catatan) {
    const k = `${c.userId}|${c.month}`;
    if (!pasangan.has(k)) pasangan.set(k, { userId: c.userId, storeId: c.storeId, bulan: c.month, hari: [] });
  }
  const daftar = [...pasangan.values()];
  if (daftar.length === 0) return [];
  const userIds = [...new Set([...daftar.map((d) => d.userId), ...catatan.flatMap((c) => [c.enteredById, c.checkedById].filter((x): x is string => Boolean(x)))])];
  const [orang, toko, dibayar] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true, spgStartedOn: true, spgEndedOn: true } }),
    prisma.store.findMany({ where: { id: { in: [...new Set(daftar.map((d) => d.storeId))] } }, select: { id: true, name: true } }),
    bulanGajiDibayar(prisma, [...new Set(daftar.map((d) => d.userId))]),
  ]);
  // Penyimpan sejak pemeriksaan terakhir — aturan yang sama dengan penulisnya (`penyimpanSejakDiperiksa`).
  const idMenunggu = catatan.filter((c) => c.status === "DIAJUKAN").map((c) => c.id);
  const jejakSimpan = idMenunggu.length
    ? await prisma.auditLog.findMany({
        where: { entityType: ENTITAS_CATATAN_HADIR, entityId: { in: idMenunggu }, action: { in: [JEJAK_CATATAN_HADIR.DIMASUKKAN, JEJAK_CATATAN_HADIR.DIPERIKSA] } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { entityId: true, action: true, userId: true },
      })
    : [];
  const penyimpan = new Map<string, Set<string>>();
  for (const j of jejakSimpan) {
    if (j.action === JEJAK_CATATAN_HADIR.DIPERIKSA) penyimpan.set(j.entityId, new Set());
    else if (j.userId) penyimpan.set(j.entityId, (penyimpan.get(j.entityId) ?? new Set<string>()).add(j.userId));
  }
  const petaOrang = new Map(orang.map((o) => [o.id, o]));
  const petaToko = new Map(toko.map((t) => [t.id, t.name]));
  const petaCatatan = new Map(catatan.map((c) => [`${c.userId}|${c.month}`, c]));
  return daftar
    .map((d): BarisCatatanHadirKantor => {
      const o = petaOrang.get(d.userId);
      const c = petaCatatan.get(`${d.userId}|${d.bulan}`);
      const masa = o?.spgStartedOn ? masaKerjaBulan(d.bulan, o.spgStartedOn, o.spgEndedOn ?? null) : null;
      return {
        userId: d.userId,
        nama: nama(o),
        storeId: d.storeId,
        namaToko: petaToko.get(d.storeId) ?? "—",
        bulan: d.bulan,
        label: salesMonthLabelId(d.bulan),
        masa: masa ? { hariAwal: masa.hariAwal, hariAkhir: masa.hariAkhir } : null,
        hariPerlu: d.hari,
        sudahDibayar: dibayar.get(d.userId)?.has(d.bulan) ?? false,
        catatan: c
          ? {
              id: c.id,
              status: statusCatatanHadirDari(c.status) ?? "DIAJUKAN",
              versi: c.version,
              sumber: c.source,
              adaBerkas: Boolean(c.fileR2Key),
              dimasukkanOleh: nama(petaOrang.get(c.enteredById)),
              dimasukkanOlehId: c.enteredById,
              penyimpanIds: [...new Set([c.enteredById, ...(penyimpan.get(c.id) ?? [])])],
              dimasukkanLabel: formatDisplayDate(c.enteredAt),
              diperiksaOleh: c.checkedById ? nama(petaOrang.get(c.checkedById)) : null,
              diperiksaLabel: c.checkedAt ? formatDisplayDate(c.checkedAt) : null,
              catatanKembali: c.returnNote,
              hari: c.days.map((h) => ({ day: h.day, kind: h.kind === "LIBUR" ? "LIBUR" : "KERJA", present: h.present, note: h.note })),
            }
          : null,
      };
    })
    .sort((a, b) => {
      const urut = (x: BarisCatatanHadirKantor) => (x.catatan === null ? 0 : x.catatan.status === "DIAJUKAN" ? 1 : x.catatan.status === "DIKEMBALIKAN" ? 2 : 3);
      return urut(a) - urut(b) || (a.bulan < b.bulan ? 1 : a.bulan > b.bulan ? -1 : a.nama.localeCompare(b.nama));
    });
}

/**
 * Angka Beranda `spgAttendanceToEnter` (P7e "kantor diingatkan"): SPG × bulan yang menunggu catatan
 * check-in toko dimasukkan — pengingat tanpa catatan, dan catatan yang DIKEMBALIKAN pemeriksa
 * (keduanya menahan pembayarannya), dan catatan yang sudah diperiksa tetapi masih menyisakan hari
 * tanpa dasar. Bulan yang sudah dibayar tidak dihitung. Satu sumber DAN satu predikat
 * (`perluDimasukkan`) dengan saringan `?perlu=masukkan` yang dibuka tautannya; `cakupan` untuk tes.
 */
export async function jumlahCatatanHadirPerluDimasukkan(cakupan?: { userIds?: string[] }, sekarang: Date = new Date()): Promise<number> {
  const baris = await daftarCatatanHadirKantor(sekarang, cakupan);
  return baris.filter(perluDimasukkan).length;
}

/** Angka Beranda `spgAttendanceToCheck`: catatan check-in toko yang menunggu diperiksa — predikat yang sama dengan `?perlu=periksa`. */
export async function jumlahCatatanHadirMenungguPeriksa(cakupan?: { userIds?: string[] }, sekarang: Date = new Date()): Promise<number> {
  const baris = await daftarCatatanHadirKantor(sekarang, cakupan);
  return baris.filter(menungguDiperiksa).length;
}

const JENIS_IZIN_GAJI = ["IZIN", "SAKIT", "CUTI"];
const fmtJam = new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Jakarta" });
const fmtHariPendek = new Intl.DateTimeFormat("id-ID", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Jakarta" });

export type HariBandingCatatan = {
  day: string;
  /** "Sen, 3 Nov" — diformat di server (WIB). */
  label: string;
  catatan: { kind: "KERJA" | "LIBUR"; present: boolean; note: string | null } | null;
  /** Sel jadwal SPG hari itu (status bulannya ada di `statusJadwal`). */
  jadwal: { kind: "KERJA" | "LIBUR"; kode: string | null } | null;
  /** Check-in pertama SPG itu DI TOKONYA hari itu; `luarRadius` = setiap check-in hari itu di luar radius (P70). */
  checkin: { jam: string; jumlah: number; luarRadius: boolean } | null;
  /** Izin/sakit/cuti yang disetujui kantor mencakup hari ini. */
  izin: string | null;
  /** Catatan berbeda dari jadwal (kerja/libur) atau dari check-in sistem (hadir/tidak) — perlu dilihat. */
  beda: boolean;
};

export type RincianCatatanHadir = {
  userId: string;
  nama: string;
  storeId: string;
  namaToko: string;
  bulan: string;
  label: string;
  statusJadwal: string | null;
  statusCatatan: StatusCatatanHadir | null;
  hari: HariBandingCatatan[];
};

/**
 * Bandingan pemeriksa (B14, P61/P61a): setiap hari masa kerja SPG di bulan itu — isi catatan
 * check-in toko di samping sel jadwal, check-in sistem pertama (dengan tanda di luar radius), dan
 * izin yang disetujui — supaya Admin Keuangan mencocokkan catatan dengan kertas/berkasnya dan
 * melihat di mana catatan menyimpang dari yang dicatat sistem. Hanya membaca.
 */
export async function rincianCatatanHadir(userId: string, bulan: string): Promise<RincianCatatanHadir | null> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(bulan)) return null;
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, spgStartedOn: true, spgEndedOn: true, assignedStoreId: true, spgEndedStoreId: true },
  });
  if (!u) return null;
  const catatan = await prisma.spgAttendanceRecord.findUnique({
    where: { userId_month: { userId, month: bulan } },
    select: { storeId: true, status: true, days: { select: { day: true, kind: true, present: true, note: true } } },
  });
  const storeId = catatan?.storeId ?? u.assignedStoreId ?? u.spgEndedStoreId;
  if (!storeId) return null;
  const masa = masaKerjaBulan(bulan, u.spgStartedOn, u.spgEndedOn);
  const hari = masa ? hariAntara(masa.hariAwal, masa.hariAkhir) : [];
  const { start, end } = wibMonthRange(bulan);
  const [toko, kepala, sel, kunjungan, izin] = await Promise.all([
    prisma.store.findUnique({ where: { id: storeId }, select: { name: true } }),
    prisma.spgMonthSchedule.findUnique({ where: { userId_month: { userId, month: bulan } }, select: { status: true } }),
    prisma.spgShift.findMany({ where: { userId, storeId, day: { gte: `${bulan}-01`, lte: `${bulan}-31` } }, select: { day: true, kind: true, shiftCode: true } }),
    prisma.storeVisit.findMany({
      where: { userId, storeId, checkinAt: { gte: start, lt: end } },
      orderBy: { checkinAt: "asc" },
      select: { checkinAt: true, checkinOutOfRadius: true },
    }),
    prisma.leaveRequest.findMany({
      where: { userId, status: "DISETUJUI", type: { in: JENIS_IZIN_GAJI }, startDay: { lte: `${bulan}-31` }, endDay: { gte: `${bulan}-01` } },
      select: { userId: true, type: true, startDay: true, endDay: true },
    }),
  ]);
  const catatanPer = new Map((catatan?.days ?? []).map((d) => [d.day, d]));
  const selPer = new Map(sel.map((s) => [s.day, s]));
  const checkinPer = new Map<string, { jam: string; jumlah: number; luarRadius: boolean }>();
  for (const v of kunjungan) {
    const d = kunciHariWib(v.checkinAt);
    const ada = checkinPer.get(d);
    checkinPer.set(
      d,
      ada
        ? { jam: ada.jam, jumlah: ada.jumlah + 1, luarRadius: ada.luarRadius && v.checkinOutOfRadius }
        : { jam: fmtJam.format(v.checkinAt), jumlah: 1, luarRadius: v.checkinOutOfRadius },
    );
  }
  return {
    userId,
    nama: nama(u),
    storeId,
    namaToko: toko?.name ?? "—",
    bulan,
    label: salesMonthLabelId(bulan),
    statusJadwal: kepala?.status ?? null,
    statusCatatan: statusCatatanHadirDari(catatan?.status),
    hari: hari.map((day): HariBandingCatatan => {
      const c = catatanPer.get(day);
      const s = selPer.get(day);
      const ci = checkinPer.get(day) ?? null;
      const kindCatatan = c ? (c.kind === "LIBUR" ? "LIBUR" : "KERJA") : null;
      const jadwal = s && (s.kind === "KERJA" || s.kind === "LIBUR") ? { kind: s.kind as "KERJA" | "LIBUR", kode: s.shiftCode } : null;
      return {
        day,
        label: fmtHariPendek.format(new Date(`${day}T00:00:00+07:00`)),
        catatan: c && kindCatatan ? { kind: kindCatatan, present: c.present, note: c.note } : null,
        jadwal,
        checkin: ci,
        izin: izinPada(izin, userId, day),
        beda: Boolean(c && ((jadwal && jadwal.kind !== kindCatatan) || c.present !== (ci !== null))),
      };
    }),
  };
}
