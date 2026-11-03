import { prisma, type Prisma } from "@elorae/db";
import { kunciHariWib } from "@/lib/dashboard/tren";
import { formatDisplayDate } from "@/lib/date-only";
import { bulanWib } from "@/lib/salesman/pengaturan";
import { salesMonthLabelId } from "@/lib/spg-commission/payout";
import { hariAntara, hariBulan, masaKerjaBulan } from "./gaji-pokok";
import { bulanGajiDibayar } from "./gaji-pokok-queries";
import {
  bulanBolehDiisiSpg,
  ENTITAS_JADWAL_BULAN,
  hariBelumTerisi,
  hariBerubahSejak,
  JEJAK_JADWAL_BULAN,
  potretSel,
  statusJadwalBulanDari,
  type StatusJadwalBulan,
} from "./jadwal-bulan";
import { bacaAturanShift, KUNCI_SHIFT } from "./pengaturan";

/**
 * Pembaca jadwal bulanan SPG: layar HP (`/pwa/spg/jadwal`, bagian "Jadwal bulanan"), tab "Jadwal
 * bulanan" kantor (`/backoffice/jadwal-spg?tab=bulanan`), dan angka Beranda. Tanggal diformat di
 * server (WIB).
 */

type Klien = Prisma.TransactionClient | typeof prisma;

const fmtHari = new Intl.DateTimeFormat("id-ID", { weekday: "short", timeZone: "Asia/Jakarta" });
const labelHari = (day: string) => {
  const d = new Date(`${day}T00:00:00+07:00`);
  return `${fmtHari.format(d)}, ${formatDisplayDate(d)}`;
};

export type HariJadwalBulanHp = {
  day: string;
  label: string;
  /** Hari sudah lewat — tidak bisa diubah. */
  lewat: boolean;
  /** Di luar masa kerjanya (sebelum mulai / sesudah berhenti) — tidak ditawarkan. */
  diLuarMasa: boolean;
  isi: { jenis: "KERJA"; kode: string } | { jenis: "LIBUR" } | null;
};

export type BulanJadwalHp = {
  bulan: string;
  label: string;
  status: StatusJadwalBulan | null;
  versi: number;
  alasanTolak: string | null;
  hari: HariJadwalBulanHp[];
  belumTerisi: string[];
};

export type DataJadwalBulanHp = {
  shift: { kode: string; label: string; mulai: string; selesai: string }[];
  bulan: BulanJadwalHp[];
};

export async function jadwalBulanSaya(input: { userId: string; storeId: string; sekarang: Date }): Promise<DataJadwalBulanHp> {
  const hariIni = kunciHariWib(input.sekarang);
  const daftarBulan = bulanBolehDiisiSpg(hariIni);
  const [u, aturanRow, kepala, sel] = await Promise.all([
    prisma.user.findUnique({ where: { id: input.userId }, select: { spgStartedOn: true, spgEndedOn: true } }),
    prisma.systemSetting.findUnique({ where: { key: KUNCI_SHIFT }, select: { value: true } }),
    prisma.spgMonthSchedule.findMany({ where: { userId: input.userId, month: { in: daftarBulan } }, select: { month: true, status: true, version: true, rejectReason: true } }),
    prisma.spgShift.findMany({
      where: { userId: input.userId, storeId: input.storeId, day: { gte: `${daftarBulan[0]}-01`, lte: `${daftarBulan[1]}-31` } },
      select: { day: true, kind: true, shiftCode: true },
    }),
  ]);
  const aturan = bacaAturanShift(aturanRow?.value);
  const selPer = new Map(sel.map((s) => [s.day, s]));
  return {
    shift: aturan.daftar.map((s) => ({ kode: s.kode, label: s.label, mulai: s.mulai, selesai: s.selesai })),
    bulan: daftarBulan.map((bulan) => {
      const k = kepala.find((x) => x.month === bulan);
      const masa = masaKerjaBulan(bulan, u?.spgStartedOn ?? null, u?.spgEndedOn ?? null);
      return {
        bulan,
        label: salesMonthLabelId(bulan),
        status: statusJadwalBulanDari(k?.status),
        versi: k?.version ?? 0,
        alasanTolak: k?.status === "DITOLAK" ? (k.rejectReason ?? null) : null,
        hari: hariBulan(bulan).map((day) => {
          const s = selPer.get(day);
          return {
            day,
            label: labelHari(day),
            lewat: day < hariIni,
            diLuarMasa: !masa || day < masa.hariAwal || day > masa.hariAkhir,
            isi: s ? (s.kind === "KERJA" ? { jenis: "KERJA" as const, kode: s.shiftCode ?? "" } : { jenis: "LIBUR" as const }) : null,
          };
        }),
        belumTerisi: hariBelumTerisi({ bulan, hariIni, masa, sel: { has: (d: string) => selPer.has(d) } }),
      };
    }),
  };
}

export type BarisJadwalBulanKantor = {
  userId: string;
  nama: string;
  storeId: string;
  namaToko: string;
  bulan: string;
  label: string;
  status: StatusJadwalBulan;
  versi: number;
  hariKerja: number;
  /** Hari di masa kerjanya yang belum berisi. */
  hariKosong: string[];
  /** Hari LIBUR yang punya check-in — akan dibayar satu tarif harian tambahan (P65a). */
  liburDenganCheckin: string[];
  /** Hari check-in yang seluruhnya di luar radius (P70) — hanya tanda. */
  luarRadius: string[];
  /** Hari yang berubah sejak persetujuan terakhir (kosong kalau belum pernah disetujui). */
  berubahSejakDisetujui: string[];
  /** Baris gaji & komisi bulan itu sudah dibayar — tidak bisa dibuka lagi. */
  sudahDibayar: boolean;
};

/**
 * Tab "Jadwal bulanan" kantor: setiap kepala DRAF/DIAJUKAN, dan yang DISETUJUI/DITOLAK di bulan
 * berjalan dan sebelumnya untuk dibuka lagi. Setiap baris membawa hal yang perlu dilihat penyetuju
 * sebelum memutuskan: hari kosong, hari libur yang dikerjakan, check-in di luar radius, dan hari yang
 * berubah sejak disetujui.
 */
export async function antreanJadwalBulanKantor(input: { sekarang: Date; cakupan?: { userIds?: string[] } }): Promise<BarisJadwalBulanKantor[]> {
  const bulanIni = bulanWib(input.sekarang);
  const hariIni = kunciHariWib(input.sekarang);
  const kepala = await prisma.spgMonthSchedule.findMany({
    where: {
      ...(input.cakupan?.userIds !== undefined ? { userId: { in: input.cakupan.userIds } } : {}),
      OR: [{ status: { in: ["DRAF", "DIAJUKAN"] } }, { month: { gte: bulanIni } }],
    },
    orderBy: [{ month: "asc" }, { submittedAt: "asc" }, { id: "asc" }],
    select: { id: true, userId: true, storeId: true, month: true, status: true, version: true },
  });
  if (kepala.length === 0) return [];
  const users = [...new Set(kepala.map((k) => k.userId))];
  const toko = [...new Set(kepala.map((k) => k.storeId))];
  const bulanSemua = [...new Set(kepala.map((k) => k.month))].sort();
  const awal = `${bulanSemua[0]}-01`;
  const akhir = `${bulanSemua[bulanSemua.length - 1]}-31`;
  const [orang, namaToko, sel, kunjungan, jejak, dibayar] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: users } }, select: { id: true, name: true, email: true, spgStartedOn: true, spgEndedOn: true } }),
    prisma.store.findMany({ where: { id: { in: toko } }, select: { id: true, name: true } }),
    prisma.spgShift.findMany({ where: { userId: { in: users }, day: { gte: awal, lte: akhir } }, select: { userId: true, storeId: true, day: true, kind: true, shiftCode: true } }),
    prisma.storeVisit.findMany({
      where: { userId: { in: users }, checkinAt: { gte: new Date(`${awal}T00:00:00+07:00`), lt: new Date(`${hariIni}T23:59:59.999+07:00`) } },
      select: { userId: true, storeId: true, checkinAt: true, checkinOutOfRadius: true },
    }),
    prisma.auditLog.findMany({
      where: { entityType: ENTITAS_JADWAL_BULAN, action: JEJAK_JADWAL_BULAN.DISETUJUI, entityId: { in: kepala.map((k) => k.id) } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { entityId: true, changes: true },
    }),
    bulanGajiDibayar(prisma, users),
  ]);
  const orangPer = new Map(orang.map((o) => [o.id, o]));
  const tokoPer = new Map(namaToko.map((t) => [t.id, t.name]));
  const potretTerakhir = new Map<string, Record<string, string>>();
  for (const j of jejak) {
    if (potretTerakhir.has(j.entityId)) continue;
    const after = (j.changes as { after?: { sel?: Record<string, string> } } | null)?.after?.sel;
    if (after && typeof after === "object") potretTerakhir.set(j.entityId, after);
  }
  return kepala.flatMap((k): BarisJadwalBulanKantor[] => {
    const status = statusJadwalBulanDari(k.status);
    if (!status) return [];
    const o = orangPer.get(k.userId);
    const masa = masaKerjaBulan(k.month, o?.spgStartedOn ?? null, o?.spgEndedOn ?? null);
    const selBulan = sel.filter((s) => s.userId === k.userId && s.storeId === k.storeId && s.day.startsWith(`${k.month}-`));
    const selPer = new Map(selBulan.map((s) => [s.day, s.kind]));
    const hariMasa = masa ? hariAntara(masa.hariAwal, masa.hariAkhir) : [];
    const perHari = new Map<string, boolean>();
    for (const v of kunjungan) {
      if (v.userId !== k.userId || v.storeId !== k.storeId) continue;
      const d = kunciHariWib(v.checkinAt);
      if (!d.startsWith(`${k.month}-`)) continue;
      perHari.set(d, (perHari.get(d) ?? true) && v.checkinOutOfRadius);
    }
    return [
      {
        userId: k.userId,
        nama: o?.name?.trim() || o?.email || k.userId,
        storeId: k.storeId,
        namaToko: tokoPer.get(k.storeId) ?? k.storeId,
        bulan: k.month,
        label: salesMonthLabelId(k.month),
        status,
        versi: k.version,
        hariKerja: selBulan.filter((s) => s.kind === "KERJA").length,
        hariKosong: hariMasa.filter((d) => !selPer.has(d)),
        liburDenganCheckin: [...perHari.keys()].filter((d) => selPer.get(d) === "LIBUR").sort(),
        luarRadius: [...perHari].filter(([, luar]) => luar).map(([d]) => d).sort(),
        berubahSejakDisetujui: hariBerubahSejak(potretTerakhir.get(k.id) ?? null, potretSel(selBulan)),
        sudahDibayar: dibayar.get(k.userId)?.has(k.month) ?? false,
      },
    ];
  });
}

/**
 * Angka Beranda `spgSchedulesPending`: kepala DIAJUKAN, ditambah kepala DRAF bulan yang sudah
 * selesai (SPG tidak bisa lagi mengajukannya, dan penyetuju boleh menyetujui DRAF) yang punya baris
 * gaji & komisi belum dibayar — selain itu bulan itu menunggu tanpa ada yang diingatkan.
 */
export async function jumlahJadwalBulanMenunggu(sekarang: Date = new Date(), cakupan?: { userIds?: string[] }, klien: Klien = prisma): Promise<number> {
  const bulanIni = bulanWib(sekarang);
  const saring = cakupan?.userIds !== undefined ? { userId: { in: cakupan.userIds } } : {};
  const [diajukan, drafLama] = await Promise.all([
    klien.spgMonthSchedule.count({ where: { ...saring, status: "DIAJUKAN" } }),
    klien.spgMonthSchedule.findMany({ where: { ...saring, status: "DRAF", month: { lt: bulanIni } }, select: { userId: true, month: true } }),
  ]);
  if (drafLama.length === 0) return diajukan;
  const users = [...new Set(drafLama.map((d) => d.userId))];
  const [konsi, putus] = await Promise.all([
    klien.consignmentCommission.findMany({ where: { spgUserId: { in: users }, paidAt: null }, select: { spgUserId: true, cycle: { select: { periodYear: true, periodMonth: true } } } }),
    klien.spgCommission.findMany({ where: { userId: { in: users }, paidAt: null }, select: { userId: true, period: true } }),
  ]);
  const terbuka = new Set([
    ...konsi.map((k) => `${k.spgUserId}\u0000${k.cycle.periodYear}-${String(k.cycle.periodMonth).padStart(2, "0")}`),
    ...putus.map((p) => `${p.userId}\u0000${p.period}`),
  ]);
  return diajukan + drafLama.filter((d) => terbuka.has(`${d.userId}\u0000${d.month}`)).length;
}
