import { prisma } from "@elorae/db";
import { kunciHariWib } from "@/lib/dashboard/tren";
import { formatDisplayDateTime } from "@/lib/date-only";
import { bacaHariKerjaSpg, KUNCI_HARI_KERJA_SPG } from "@/lib/salesman/izin";
import { izinDisetujuiRentang } from "@/lib/salesman/izin-queries";
import { bacaAturanShift, KUNCI_SHIFT, type AturanShift } from "./pengaturan";
import {
  checkinPertama,
  geserHari,
  hariSeminggu,
  hariTukar,
  izinPada,
  JANGKAUAN_TUKAR_HARI,
  kunciSel,
  labelShift,
  nilaiKenyataan,
  STATUS_TUKAR_TERBUKA,
  statusTukarDari,
  type BarisShift,
  type Kenyataan,
  type StatusTukar,
} from "./shift";

/**
 * Bacaan jadwal kerja dan tukar shift SPG — untuk layar kantor mingguan,
 * tab tukar shift, layar jadwal di HP, dan beranda SPG (`shiftHariIni`).
 *
 * `SpgShift`/`SpgShiftSwap` tidak punya relasi, jadi nama orang dan toko
 * digabung di sini dengan satu kueri per pemanggilan, bukan per baris.
 * Tanggal untuk HP diformat DI SERVER (WIB). Tidak ada rupiah di sini sama
 * sekali — jadwal rekan setoko hanya nama dan shiftnya.
 */

const PILIH_BARIS = { userId: true, day: true, kind: true, shiftCode: true, startTime: true, endTime: true, storeId: true } as const;
const awalHari = (day: string) => new Date(`${day}T00:00:00+07:00`);

export async function aturanShift(): Promise<AturanShift> {
  const r = await prisma.systemSetting.findUnique({ where: { key: KUNCI_SHIFT }, select: { value: true } });
  return bacaAturanShift(r?.value);
}

async function hariKerjaSpg(): Promise<number[]> {
  const r = await prisma.systemSetting.findUnique({ where: { key: KUNCI_HARI_KERJA_SPG }, select: { value: true } });
  return bacaHariKerjaSpg(r?.value);
}

async function namaPengguna(ids: readonly string[]): Promise<Map<string, string>> {
  const unik = [...new Set(ids.filter(Boolean))];
  if (unik.length === 0) return new Map();
  const rows = await prisma.user.findMany({ where: { id: { in: unik } }, select: { id: true, name: true, email: true } });
  return new Map(rows.map((u) => [u.id, u.name ?? u.email]));
}

/** Isi sel yang siap ditampilkan; label dari daftar shift SEKARANG (kode yang dihapus tampil apa adanya). */
export type SelRingkas = { kind: "KERJA" | "LIBUR"; shiftCode: string | null; label: string; mulai: string | null; selesai: string | null };

function ringkasSel(b: Pick<BarisShift, "kind" | "shiftCode" | "startTime" | "endTime"> | null | undefined, aturan: AturanShift): SelRingkas | null {
  if (!b) return null;
  if (b.kind === "LIBUR") return { kind: "LIBUR", shiftCode: null, label: "", mulai: null, selesai: null };
  if (b.kind !== "KERJA") return null;
  return { kind: "KERJA", shiftCode: b.shiftCode, label: labelShift(b.shiftCode, aturan), mulai: b.startTime, selesai: b.endTime };
}

// ─── Beranda SPG ─────────────────────────────────────────────────────────────

/**
 * Shift satu SPG hari ini, untuk beranda: KERJA dengan label dan jamnya,
 * LIBUR, atau null bila belum dijadwalkan. `hariIni` = kunci hari WIB
 * ("YYYY-MM-DD"); `Date` juga diterima dan dibaca sebagai hari WIB-nya.
 */
export async function shiftHariIni(
  userId: string,
  hariIni: string | Date,
): Promise<{ jenis: "KERJA"; label: string; mulai: string; selesai: string } | { jenis: "LIBUR" } | null> {
  if (!userId) return null;
  const day = typeof hariIni === "string" ? hariIni : kunciHariWib(hariIni);
  const b = await prisma.spgShift.findUnique({ where: { userId_day: { userId, day } }, select: PILIH_BARIS });
  if (!b) return null;
  if (b.kind === "LIBUR") return { jenis: "LIBUR" };
  if (b.kind !== "KERJA" || !b.startTime || !b.endTime) return null;
  const aturan = await aturanShift();
  return { jenis: "KERJA", label: labelShift(b.shiftCode, aturan), mulai: b.startTime, selesai: b.endTime };
}

// ─── Kantor: pilih toko ──────────────────────────────────────────────────────

export type TokoBerSpg = { id: string; kode: string; nama: string; jumlahSpg: number };

/** Toko yang punya SPG sekarang (pengguna dengan toko tetap itu), urut nama. */
export async function tokoDenganSpg(): Promise<TokoBerSpg[]> {
  const kelompok = await prisma.user.groupBy({ by: ["assignedStoreId"], where: { assignedStoreId: { not: null } }, _count: { _all: true } });
  const ids = kelompok.map((k) => k.assignedStoreId).filter((x): x is string => !!x);
  if (ids.length === 0) return [];
  const toko = await prisma.store.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true } });
  const jumlah = new Map(kelompok.map((k) => [k.assignedStoreId, k._count._all]));
  return toko
    .map((t) => ({ id: t.id, kode: t.code, nama: t.name, jumlahSpg: jumlah.get(t.id) ?? 0 }))
    .sort((a, b) => a.nama.localeCompare(b.nama, "id"));
}

// ─── Kantor: satu toko, satu minggu ──────────────────────────────────────────

export type OrangJadwalSpg = {
  id: string;
  nama: string;
  /** Masih SPG toko ini. false = punya jadwal di toko ini minggu ini tapi sudah dipindah — hanya dibaca. */
  diToko: boolean;
};

export type SelKantor = SelRingkas & {
  /** Baris ini tercatat untuk toko lain (SPG baru dipindah ke toko ini). */
  tokoLain: boolean;
};

export type DataJadwalSpgKantor = {
  storeId: string;
  senin: string;
  hari: string[];
  hariIni: string;
  orang: OrangJadwalSpg[];
  /** `kunciSel(userId, day)` → isi sel minggu ini. */
  sel: Record<string, SelKantor>;
  /** `kunciSel` → kenyataan (hari ini dan hari lalu saja). */
  kenyataan: Record<string, Kenyataan>;
  /** `kunciSel` → jenis izin yang disetujui. */
  izin: Record<string, string>;
  /** Baris minggu sebelumnya milik SPG toko ini — bahan "Salin minggu lalu". */
  mingguLalu: BarisShift[];
  aturan: AturanShift;
  /** Hari kerja SPG (0 = Minggu) — bahan "Isi semua hari kerja". */
  hariKerja: number[];
};

/**
 * Kisi satu toko satu minggu: SPG toko ini sekarang, ditambah orang yang
 * punya jadwal di toko ini minggu ini tapi sudah dipindah (hanya dibaca).
 * Hari ini dan hari lalu membawa kenyataan: check-in pertama di TOKO INI,
 * terlambat (> mulai + toleransi), tidak masuk, izin yang disetujui.
 */
export async function jadwalSpgMingguKantor(input: { storeId: string; senin: string; sekarang: Date }): Promise<DataJadwalSpgKantor> {
  const hari = hariSeminggu(input.senin);
  const hariIni = kunciHariWib(input.sekarang);
  const [aturan, hariKerja, spg] = await Promise.all([
    aturanShift(),
    hariKerjaSpg(),
    prisma.user.findMany({ where: { assignedStoreId: input.storeId }, select: { id: true, name: true, email: true } }),
  ]);
  const idSpg = spg.map((u) => u.id);
  const rows = await prisma.spgShift.findMany({
    where: { day: { in: hari }, OR: [{ storeId: input.storeId }, ...(idSpg.length ? [{ userId: { in: idSpg } }] : [])] },
    select: PILIH_BARIS,
  });
  const pindahan = [...new Set(rows.map((r) => r.userId))].filter((id) => !idSpg.includes(id));
  const namaPindahan = await namaPengguna(pindahan);
  const orang: OrangJadwalSpg[] = [
    ...spg.map((u) => ({ id: u.id, nama: u.name ?? u.email, diToko: true })).sort((a, b) => a.nama.localeCompare(b.nama, "id")),
    ...pindahan.map((id) => ({ id, nama: namaPindahan.get(id) ?? "—", diToko: false })).sort((a, b) => a.nama.localeCompare(b.nama, "id")),
  ];
  const semuaId = orang.map((o) => o.id);

  const akhirKenyataan = hari[6] < hariIni ? hari[6] : hariIni;
  const [kunjungan, izin, lalu] = await Promise.all([
    semuaId.length && hari[0] <= hariIni
      ? prisma.storeVisit.findMany({
          where: { storeId: input.storeId, userId: { in: semuaId }, checkinAt: { gte: awalHari(hari[0]), lt: awalHari(geserHari(akhirKenyataan, 1)) } },
          select: { userId: true, checkinAt: true },
        })
      : Promise.resolve([]),
    izinDisetujuiRentang(semuaId, hari[0], hari[6]),
    idSpg.length
      ? prisma.spgShift.findMany({
          where: { userId: { in: idSpg }, day: { in: hariSeminggu(geserHari(input.senin, -7)) } },
          select: { userId: true, day: true, kind: true, shiftCode: true, startTime: true, endTime: true },
        })
      : Promise.resolve([]),
  ]);

  const sel: Record<string, SelKantor> = {};
  const barisPer = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const s = ringkasSel(r, aturan);
    if (!s) continue;
    sel[kunciSel(r.userId, r.day)] = { ...s, tokoLain: r.storeId !== input.storeId };
    barisPer.set(kunciSel(r.userId, r.day), r);
  }
  const masuk = checkinPertama(kunjungan);
  const kenyataan: Record<string, Kenyataan> = {};
  const izinPeta: Record<string, string> = {};
  for (const o of orang) {
    for (const day of hari) {
      const k = kunciSel(o.id, day);
      const jenisIzin = izinPada(izin, o.id, day);
      if (jenisIzin) izinPeta[k] = jenisIzin;
      const n = nilaiKenyataan({
        day,
        hariIni,
        sekarang: input.sekarang,
        sel: barisPer.get(k) ?? null,
        checkin: masuk.get(k) ?? null,
        izin: jenisIzin,
        toleransiMenit: aturan.toleransiTerlambatMenit,
      });
      if (n) kenyataan[k] = n;
    }
  }

  return { storeId: input.storeId, senin: input.senin, hari, hariIni, orang, sel, kenyataan, izin: izinPeta, mingguLalu: lalu, aturan, hariKerja };
}

// ─── Kantor: tab tukar shift ─────────────────────────────────────────────────

export type SelTukar = { day: string; pengaju: SelRingkas | null; rekan: SelRingkas | null };

export type BarisTukarKantor = {
  id: string;
  storeId: string;
  toko: string;
  pengaju: string;
  rekan: string;
  day: string;
  partnerDay: string | null;
  alasan: string | null;
  status: StatusTukar;
  catatan: string | null;
  diajukan: string;
  rekanMenjawab: string | null;
  diputuskan: string | null;
  diputuskanOleh: string | null;
  /** Isi sel kedua orang di setiap hari yang terlibat, SEKARANG. */
  sel: SelTukar[];
};

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
  decidedById: true,
  decidedAt: true,
  partnerAnsweredAt: true,
  createdAt: true,
} as const;

type BarisTukarDb = {
  id: string;
  storeId: string;
  requesterId: string;
  partnerId: string;
  day: string;
  partnerDay: string | null;
  reason: string | null;
  status: string;
  decisionNote: string | null;
  decidedById: string | null;
  decidedAt: Date | null;
  partnerAnsweredAt: Date | null;
  createdAt: Date;
};

async function susunTukar(rows: readonly BarisTukarDb[], aturan: AturanShift): Promise<BarisTukarKantor[]> {
  if (rows.length === 0) return [];
  const [nama, toko, sel] = await Promise.all([
    namaPengguna(rows.flatMap((r) => [r.requesterId, r.partnerId, r.decidedById ?? ""])),
    prisma.store.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.storeId))] } }, select: { id: true, name: true } }),
    prisma.spgShift.findMany({
      where: {
        userId: { in: [...new Set(rows.flatMap((r) => [r.requesterId, r.partnerId]))] },
        day: { in: [...new Set(rows.flatMap((r) => hariTukar(r)))] },
      },
      select: PILIH_BARIS,
    }),
  ]);
  const namaToko = new Map(toko.map((t) => [t.id, t.name]));
  const selPer = new Map(sel.map((s) => [kunciSel(s.userId, s.day), s]));
  return rows.map((r) => ({
    id: r.id,
    storeId: r.storeId,
    toko: namaToko.get(r.storeId) ?? "—",
    pengaju: nama.get(r.requesterId) ?? "—",
    rekan: nama.get(r.partnerId) ?? "—",
    day: r.day,
    partnerDay: r.partnerDay,
    alasan: r.reason,
    status: statusTukarDari(r.status),
    catatan: r.decisionNote,
    diajukan: formatDisplayDateTime(r.createdAt),
    rekanMenjawab: r.partnerAnsweredAt ? formatDisplayDateTime(r.partnerAnsweredAt) : null,
    diputuskan: r.decidedAt ? formatDisplayDateTime(r.decidedAt) : null,
    diputuskanOleh: r.decidedById ? (nama.get(r.decidedById) ?? "—") : null,
    sel: hariTukar(r).map((day) => ({
      day,
      pengaju: ringkasSel(selPer.get(kunciSel(r.requesterId, day)), aturan),
      rekan: ringkasSel(selPer.get(kunciSel(r.partnerId, day)), aturan),
    })),
  }));
}

const BATAS_RIWAYAT_KANTOR = 50;

/**
 * Tab "Tukar shift" kantor: ajuan yang menunggu keputusan kantor (semua toko,
 * yang paling lama diajukan dulu), lalu riwayat terbaru — termasuk yang masih
 * menunggu jawaban rekan, supaya kantor tahu ada yang sedang berjalan.
 */
export async function daftarTukarKantor(): Promise<{ menunggu: BarisTukarKantor[]; riwayat: BarisTukarKantor[]; menungguRekan: number }> {
  const [aturan, menunggu, riwayat, menungguRekan] = await Promise.all([
    aturanShift(),
    prisma.spgShiftSwap.findMany({ where: { status: "MENUNGGU_KANTOR" }, select: PILIH_TUKAR, orderBy: { createdAt: "asc" }, take: 200 }),
    prisma.spgShiftSwap.findMany({
      where: { status: { not: "MENUNGGU_KANTOR" } },
      select: PILIH_TUKAR,
      orderBy: { updatedAt: "desc" },
      take: BATAS_RIWAYAT_KANTOR,
    }),
    prisma.spgShiftSwap.count({ where: { status: "MENUNGGU_REKAN" } }),
  ]);
  const [m, r] = await Promise.all([susunTukar(menunggu, aturan), susunTukar(riwayat, aturan)]);
  return { menunggu: m, riwayat: r, menungguRekan };
}

export async function jumlahTukarMenungguKantor(): Promise<number> {
  return prisma.spgShiftSwap.count({ where: { status: "MENUNGGU_KANTOR" } });
}

// ─── HP SPG ──────────────────────────────────────────────────────────────────

/** Tanggal diformat di server: format klien bisa berbeda antara Node dan Safari. */
const fmtPendek = new Intl.DateTimeFormat("id-ID", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Jakarta" });
const labelPendek = (day: string) => fmtPendek.format(new Date(`${day}T12:00:00+07:00`));

export type HariHp = {
  day: string;
  /** "Sen, 5 Okt" — diformat di server. */
  label: string;
  hariIni: boolean;
  saya: SelRingkas | null;
  izin: string | null;
  /** Rekan setoko: nama dan shiftnya. Jenis izin rekan (sakit/cuti) TIDAK dikirim — cukup "izin". */
  rekan: { userId: string; nama: string; sel: SelRingkas | null; izin: boolean }[];
};

export type TukarHp = {
  id: string;
  status: StatusTukar;
  /** Peran saya di ajuan ini. */
  peran: "PENGAJU" | "REKAN";
  pengaju: string;
  rekan: string;
  day: string;
  dayLabel: string;
  partnerDay: string | null;
  partnerDayLabel: string | null;
  alasan: string | null;
  catatan: string | null;
  diajukan: string;
  /** Isi sel kedua orang sekarang, per hari yang terlibat. */
  sel: (SelTukar & { label: string })[];
};

export type DataJadwalSpgHp = {
  hariIni: string;
  hari: HariHp[];
  rekan: { id: string; nama: string }[];
  /** Ajuan dari rekan yang menunggu jawaban saya. */
  masuk: TukarHp[];
  /** Ajuan saya yang belum diputuskan. */
  keluar: TukarHp[];
  /** Ajuan yang sudah selesai (saya pengaju atau rekan), terbaru dulu. */
  riwayat: TukarHp[];
};

const BATAS_RIWAYAT_HP = 10;

/**
 * Layar jadwal di HP SPG: 14 hari mulai hari ini — shift sendiri (atau libur,
 * izin) dan shift rekan setoko — beserta ajuan tukar shift yang melibatkan
 * dirinya. `storeId` = toko tetap SPG, dari server.
 */
export async function jadwalSpgHp(input: { userId: string; storeId: string; sekarang: Date }): Promise<DataJadwalSpgHp> {
  const hariIni = kunciHariWib(input.sekarang);
  const hari = Array.from({ length: JANGKAUAN_TUKAR_HARI }, (_, i) => geserHari(hariIni, i));
  const [aturan, spg] = await Promise.all([
    aturanShift(),
    prisma.user.findMany({ where: { assignedStoreId: input.storeId }, select: { id: true, name: true, email: true } }),
  ]);
  const rekan = spg
    .filter((u) => u.id !== input.userId)
    .map((u) => ({ id: u.id, nama: u.name ?? u.email }))
    .sort((a, b) => a.nama.localeCompare(b.nama, "id"));
  const semuaId = [input.userId, ...rekan.map((r) => r.id)];

  const [rows, izin, tukar] = await Promise.all([
    prisma.spgShift.findMany({ where: { userId: { in: semuaId }, day: { in: hari } }, select: PILIH_BARIS }),
    izinDisetujuiRentang(semuaId, hari[0], hari[hari.length - 1]),
    prisma.spgShiftSwap.findMany({
      where: { OR: [{ requesterId: input.userId }, { partnerId: input.userId }] },
      select: PILIH_TUKAR,
      orderBy: { createdAt: "desc" },
      take: 40,
    }),
  ]);
  const selPer = new Map(rows.map((r) => [kunciSel(r.userId, r.day), r]));

  const hariHp: HariHp[] = hari.map((day) => ({
    day,
    label: labelPendek(day),
    hariIni: day === hariIni,
    saya: ringkasSel(selPer.get(kunciSel(input.userId, day)), aturan),
    izin: izinPada(izin, input.userId, day),
    rekan: rekan.map((r) => ({
      userId: r.id,
      nama: r.nama,
      sel: ringkasSel(selPer.get(kunciSel(r.id, day)), aturan),
      izin: izinPada(izin, r.id, day) !== null,
    })),
  }));

  const tersusun = await susunTukar(tukar, aturan);
  const keHp = (t: BarisTukarKantor, asal: BarisTukarDb): TukarHp => ({
    id: t.id,
    status: t.status,
    peran: asal.requesterId === input.userId ? "PENGAJU" : "REKAN",
    pengaju: t.pengaju,
    rekan: t.rekan,
    day: t.day,
    dayLabel: labelPendek(t.day),
    partnerDay: t.partnerDay,
    partnerDayLabel: t.partnerDay ? labelPendek(t.partnerDay) : null,
    alasan: t.alasan,
    catatan: t.catatan,
    diajukan: t.diajukan,
    sel: t.sel.map((s) => ({ ...s, label: labelPendek(s.day) })),
  });
  const semua = tersusun.map((t, i) => keHp(t, tukar[i]));
  const terbuka = (s: StatusTukar) => STATUS_TUKAR_TERBUKA.includes(s);
  return {
    hariIni,
    hari: hariHp,
    rekan,
    masuk: semua.filter((t) => t.peran === "REKAN" && t.status === "MENUNGGU_REKAN"),
    keluar: semua.filter((t) => t.peran === "PENGAJU" && terbuka(t.status)),
    riwayat: semua.filter((t) => !terbuka(t.status) || (t.peran === "REKAN" && t.status === "MENUNGGU_KANTOR")).slice(0, BATAS_RIWAYAT_HP),
  };
}
