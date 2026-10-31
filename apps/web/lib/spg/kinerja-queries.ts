import { prisma } from "@elorae/db";
import { kunciHariWib } from "@/lib/dashboard/tren";
import { formatDisplayDate } from "@/lib/date-only";
import { bacaHariKerjaSpg, hariTidakKerjaDari, KUNCI_HARI_KERJA_SPG } from "@/lib/salesman/izin";
import { izinDisetujuiRentang } from "@/lib/salesman/izin-queries";
import { bacaTargetBulan, bulanWib, KUNCI_TARGET } from "@/lib/salesman/pengaturan";
import { bulanBerikutnya, bulanSebelumnya, dokumenSpg } from "@/lib/salesman/target-rinci";
import {
  bagiPengunjungHari,
  hariSebulan,
  ringkasKinerja,
  simpulkanHari,
  type HariKinerja,
  type PengunjungSpgHari,
  type RingkasKinerja,
} from "./kinerja";
import { bacaAturanShift, KUNCI_SHIFT } from "./pengaturan";
import { izinPada, jamWib, kunciSel, labelShift, type Kenyataan } from "./shift";

/**
 * Kueri halaman Kinerja SPG (kantor). Semua dibaca langsung dari tabelnya:
 * nota (`SpgSale`, bersih), check-in (`StoreVisit`), jadwal (`SpgShift`), izin
 * disetujui (`LeaveRequest`), penghitung pengunjung (`SpgVisitorCount`),
 * laporan tutup hari (`SpgDailyClose`), titip pesan (`CustomerRequest`), dan
 * member yang didaftarkan (`Member.joinedById` × `joinedStoreId`).
 *
 * Siapa yang masuk tabel (satu baris per SPG × toko): SPG yang saat ini
 * memegang toko (`User.assignedStoreId`, akunnya sudah ada di bulan itu),
 * ditambah siapa pun yang punya nota, jadwal, atau hitungan pengunjung di
 * sebuah toko pada bulan itu — SPG yang sudah dipindah atau dilepas tetap
 * terlihat untuk bulan ia bekerja.
 */

const awalHariWib = (day: string) => new Date(`${day}T00:00:00+07:00`);
const kunciPasangan = (userId: string, storeId: string) => `${userId}|${storeId}`;
const kunciTokoHari = (storeId: string, day: string) => `${storeId}|${day}`;

const fmtHariPendek = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", weekday: "short", day: "numeric", month: "short" });
const fmtBulan = new Intl.DateTimeFormat("id-ID", { timeZone: "UTC", month: "long", year: "numeric" });

/** "Oktober 2026". */
export const labelBulan = (bulan: string) => fmtBulan.format(new Date(`${bulan}-15T00:00:00Z`));
/** "Sab, 3 Okt" — kunci hari WIB. */
const labelHariPendek = (day: string) => fmtHariPendek.format(awalHariWib(day));

/** Bulan yang bisa dipilih: bulan berjalan dan sebelas bulan sebelumnya. */
export function pilihanBulanKinerja(sekarang: Date): { bulan: string; label: string }[] {
  const hasil: { bulan: string; label: string }[] = [];
  let b = bulanWib(sekarang);
  for (let i = 0; i < 12; i++) {
    hasil.push({ bulan: b, label: labelBulan(b) });
    b = bulanSebelumnya(b);
  }
  return hasil;
}

type HariRinci = HariKinerja & {
  shiftKode: string | null;
  jamMulai: string | null;
  jamSelesai: string | null;
  jamMasuk: string | null;
  titipDibuat: number;
};

type BarisMuat = {
  userId: string;
  storeId: string;
  hari: HariRinci[];
  ringkas: RingkasKinerja;
};

type HasilMuat = {
  hariIni: string;
  baris: BarisMuat[];
  nama: Map<string, string>;
  toko: Map<string, { nama: string; kode: string }>;
  tokoTetap: Map<string, string | null>;
  pilihanToko: string[];
  labelShift: (kode: string | null) => string;
  toleransiMenit: number;
};

/**
 * Muat semua baris satu bulan. `storeIds` membatasi ke toko-toko itu (null =
 * semua). Kehadiran rekan setoko tetap dimuat utuh untuk toko yang dipilih:
 * pembagian angka pengunjung dari laporan tutup hari butuh tahu siapa saja
 * yang hadir.
 */
async function muat(m: { bulan: string; sekarang: Date; storeIds: readonly string[] | null }): Promise<HasilMuat> {
  const hariIni = kunciHariWib(m.sekarang);
  const hari = hariSebulan(m.bulan);
  const hariAwal = hari[0];
  const hariAkhir = hari[hari.length - 1];
  const awal = awalHariWib(hariAwal);
  const akhir = awalHariWib(`${bulanBerikutnya(m.bulan)}-01`);
  const rentangHari = { gte: hariAwal, lte: hariAkhir };

  // Siapa saja: pemegang toko sekarang + yang punya kegiatan di bulan itu.
  const [spgSekarang, pasJual, pasJadwal, pasHitung] = await Promise.all([
    prisma.user.findMany({ where: { assignedStoreId: { not: null }, createdAt: { lt: akhir } }, select: { id: true, assignedStoreId: true } }),
    prisma.spgSale.groupBy({ by: ["salesmanId", "storeId"], where: { createdAt: { gte: awal, lt: akhir } } }),
    prisma.spgShift.groupBy({ by: ["userId", "storeId"], where: { day: rentangHari } }),
    prisma.spgVisitorCount.groupBy({ by: ["userId", "storeId"], where: { day: rentangHari } }),
  ]);
  const semuaPasangan = new Map<string, { userId: string; storeId: string }>();
  const tambah = (userId: string, storeId: string) => semuaPasangan.set(kunciPasangan(userId, storeId), { userId, storeId });
  for (const u of spgSekarang) if (u.assignedStoreId) tambah(u.id, u.assignedStoreId);
  for (const p of pasJual) tambah(p.salesmanId, p.storeId);
  for (const p of pasJadwal) tambah(p.userId, p.storeId);
  for (const p of pasHitung) tambah(p.userId, p.storeId);

  const pilihanToko = [...new Set([...semuaPasangan.values()].map((p) => p.storeId))];
  const saring = m.storeIds ? new Set(m.storeIds) : null;
  const pasangan = [...semuaPasangan.values()].filter((p) => !saring || saring.has(p.storeId));
  const userIds = [...new Set(pasangan.map((p) => p.userId))];
  const storeIds = [...new Set(pasangan.map((p) => p.storeId))];

  const [orang, tokoBaris, setelan] = await Promise.all([
    userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true, assignedStoreId: true } }) : [],
    pilihanToko.length ? prisma.store.findMany({ where: { id: { in: pilihanToko } }, select: { id: true, name: true, code: true } }) : [],
    prisma.systemSetting.findMany({ where: { key: { in: [KUNCI_SHIFT, KUNCI_HARI_KERJA_SPG, KUNCI_TARGET] } }, select: { key: true, value: true } }),
  ]);
  const nilaiSetelan = (k: string) => setelan.find((s) => s.key === k)?.value ?? null;
  const aturanShift = bacaAturanShift(nilaiSetelan(KUNCI_SHIFT));
  const liburSpg = hariTidakKerjaDari(bacaHariKerjaSpg(nilaiSetelan(KUNCI_HARI_KERJA_SPG)));
  const nilaiTarget = nilaiSetelan(KUNCI_TARGET);
  const nama = new Map(orang.map((o) => [o.id, o.name ?? o.email]));
  const tokoTetap = new Map(orang.map((o) => [o.id, o.assignedStoreId]));
  const toko = new Map(tokoBaris.map((s) => [s.id, { nama: s.name, kode: s.code }]));

  const hasilKosong: HasilMuat = {
    hariIni,
    baris: [],
    nama,
    toko,
    tokoTetap,
    pilihanToko,
    labelShift: (kode) => labelShift(kode, aturanShift),
    toleransiMenit: aturanShift.toleransiTerlambatMenit,
  };
  if (pasangan.length === 0) return hasilKosong;

  const [shift, kunjungan, izin, nota, hitungan, tutup, titip, memberBaru] = await Promise.all([
    prisma.spgShift.findMany({
      where: { userId: { in: userIds }, day: rentangHari },
      select: { userId: true, storeId: true, day: true, kind: true, shiftCode: true, startTime: true, endTime: true },
    }),
    prisma.storeVisit.findMany({
      where: { userId: { in: userIds }, storeId: { in: storeIds }, checkinAt: { gte: awal, lt: akhir } },
      select: { userId: true, storeId: true, checkinAt: true },
    }),
    izinDisetujuiRentang(userIds, hariAwal, hariAkhir),
    // Nota orang-orang ini di SEMUA toko: capaian target milik orangnya, bukan tokonya.
    prisma.spgSale.findMany({
      where: { salesmanId: { in: userIds }, createdAt: { gte: awal, lt: akhir } },
      select: {
        salesmanId: true,
        storeId: true,
        createdAt: true,
        total: true,
        customerId: true,
        lines: { select: { itemId: true, qty: true, lineTotal: true, returnedQty: true } },
      },
    }),
    prisma.spgVisitorCount.findMany({ where: { storeId: { in: storeIds }, day: rentangHari }, select: { storeId: true, userId: true, day: true, count: true } }),
    prisma.spgDailyClose.findMany({ where: { storeId: { in: storeIds }, day: rentangHari }, select: { storeId: true, day: true, visitorCount: true, closedById: true } }),
    prisma.customerRequest.findMany({
      where: { createdById: { in: userIds }, createdAt: { gte: awal, lt: akhir } },
      select: { createdById: true, storeId: true, status: true, createdAt: true },
    }),
    // Member yang didaftarkan orang-orang ini bulan itu, per toko tempat mendaftar.
    prisma.member.groupBy({
      by: ["joinedById", "joinedStoreId"],
      where: { joinedById: { in: userIds }, joinedAt: { gte: awal, lt: akhir } },
      _count: { _all: true },
    }),
  ]);
  const memberBaruPer = new Map(memberBaru.map((x) => [kunciPasangan(x.joinedById, x.joinedStoreId), x._count._all]));

  // Jadwal per orang × hari (satu baris per orang per hari, di satu toko).
  const jadwal = new Map(shift.map((s) => [kunciSel(s.userId, s.day), s]));

  // Check-in pertama per orang × toko × hari.
  const masuk = new Map<string, Date>();
  for (const k of kunjungan) {
    const kunci = `${k.userId}|${k.storeId}|${kunciHariWib(k.checkinAt)}`;
    const ada = masuk.get(kunci);
    if (!ada || k.checkinAt < ada) masuk.set(kunci, k.checkinAt);
  }

  // Nota per orang × toko × hari, dan per orang (semua toko) untuk target.
  type JualHari = { nota: number; potong: number; nilaiSen: number };
  const jual = new Map<string, JualHari>();
  const nilaiOrangSen = new Map<string, number>();
  const qtyPasangan = new Map<string, { terjual: number; kembali: number }>();
  const berpembeliPasangan = new Map<string, number>();
  for (const n of nota) {
    if (n.customerId) berpembeliPasangan.set(kunciPasangan(n.salesmanId, n.storeId), (berpembeliPasangan.get(kunciPasangan(n.salesmanId, n.storeId)) ?? 0) + 1);
    const dok = dokumenSpg(n);
    nilaiOrangSen.set(n.salesmanId, (nilaiOrangSen.get(n.salesmanId) ?? 0) + dok.totalSen);
    const kunci = `${n.salesmanId}|${n.storeId}|${kunciHariWib(n.createdAt)}`;
    const j = jual.get(kunci) ?? { nota: 0, potong: 0, nilaiSen: 0 };
    j.nota += 1;
    j.potong += dok.baris.reduce((s, b) => s + b.qty, 0);
    j.nilaiSen += dok.totalSen;
    jual.set(kunci, j);
    const q = qtyPasangan.get(kunciPasangan(n.salesmanId, n.storeId)) ?? { terjual: 0, kembali: 0 };
    for (const l of n.lines) {
      const qty = Math.max(0, l.qty);
      q.terjual += qty;
      q.kembali += Math.min(qty, Math.max(0, l.returnedQty));
    }
    qtyPasangan.set(kunciPasangan(n.salesmanId, n.storeId), q);
  }

  // Pengunjung per toko × hari: penghitung per SPG + sisa dari laporan tutup hari.
  const hadir = new Map<string, Set<string>>();
  const catatHadir = (storeId: string, day: string, userId: string) => {
    const k = kunciTokoHari(storeId, day);
    const s = hadir.get(k) ?? new Set<string>();
    s.add(userId);
    hadir.set(k, s);
  };
  for (const k of kunjungan) catatHadir(k.storeId, kunciHariWib(k.checkinAt), k.userId);
  for (const n of nota) catatHadir(n.storeId, kunciHariWib(n.createdAt), n.salesmanId);
  const tutupPer = new Map(tutup.map((t) => [kunciTokoHari(t.storeId, t.day), t]));
  for (const t of tutup) catatHadir(t.storeId, t.day, t.closedById);
  const hitunganPer = new Map<string, Map<string, number>>();
  for (const h of hitungan) {
    const k = kunciTokoHari(h.storeId, h.day);
    const peta = hitunganPer.get(k) ?? new Map<string, number>();
    peta.set(h.userId, h.count);
    hitunganPer.set(k, peta);
  }
  const pengunjung = new Map<string, Map<string, PengunjungSpgHari>>();
  for (const k of new Set([...hitunganPer.keys(), ...tutupPer.keys()])) {
    pengunjung.set(
      k,
      bagiPengunjungHari({
        hitungan: hitunganPer.get(k) ?? new Map(),
        tutup: tutupPer.get(k)?.visitorCount ?? null,
        // Hanya SPG toko itu: pengguna kantor yang menutup hari tidak ikut kebagian.
        hadir: [...(hadir.get(k) ?? [])].filter((u) => semuaPasangan.has(kunciPasangan(u, k.slice(0, k.indexOf("|"))))),
      }),
    );
  }

  // Titip pesan per orang × toko (dan per hari untuk rincian).
  const titipPasangan = new Map<string, { dibuat: number; selesai: number }>();
  const titipHari = new Map<string, number>();
  for (const r of titip) {
    const kp = kunciPasangan(r.createdById, r.storeId);
    const t = titipPasangan.get(kp) ?? { dibuat: 0, selesai: 0 };
    t.dibuat += 1;
    if (r.status === "SELESAI") t.selesai += 1;
    titipPasangan.set(kp, t);
    const kh = `${kp}|${kunciHariWib(r.createdAt)}`;
    titipHari.set(kh, (titipHari.get(kh) ?? 0) + 1);
  }

  const baris: BarisMuat[] = pasangan.map(({ userId, storeId }) => {
    const izinOrang = izin.filter((z) => z.userId === userId);
    const rumah = tokoTetap.get(userId);
    let jadwalDisusun = false;
    const hariBaris: HariRinci[] = hari.map((day) => {
      const j = jadwal.get(kunciSel(userId, day));
      const sel = j && j.storeId === storeId ? j : null;
      if (sel && day <= hariIni) jadwalDisusun = true;
      const jenisIzin = izinPada(izinOrang, userId, day);
      // Izin di hari tanpa jadwal di toko ini dihitung sekali: di toko tempat ia
      // dijadwalkan hari itu, atau di toko tetapnya — bukan di setiap barisnya.
      const diTempatLain = !!j || (!!rumah && rumah !== storeId);
      const izinDiSini = sel || !diTempatLain ? jenisIzin : null;
      const checkin = masuk.get(`${userId}|${storeId}|${day}`) ?? null;
      const k = simpulkanHari({
        day,
        sel,
        checkin,
        izin: izinDiSini,
        hariIni,
        sekarang: m.sekarang,
        toleransiMenit: aturanShift.toleransiTerlambatMenit,
        liburSpg,
      });
      const jh = jual.get(`${userId}|${storeId}|${day}`);
      const p = pengunjung.get(kunciTokoHari(storeId, day))?.get(userId) ?? null;
      return {
        ...k,
        day,
        nota: jh?.nota ?? 0,
        potong: jh?.potong ?? 0,
        nilaiSen: jh?.nilaiSen ?? 0,
        pengunjung: p ? p.jumlah : null,
        pengunjungDariTutup: p?.dariTutup ?? false,
        tutup: tutupPer.has(kunciTokoHari(storeId, day)),
        shiftKode: sel?.kind === "KERJA" ? sel.shiftCode : null,
        jamMulai: sel?.startTime ?? null,
        jamSelesai: sel?.endTime ?? null,
        jamMasuk: checkin ? jamWib(checkin) : null,
        titipDibuat: titipHari.get(`${kunciPasangan(userId, storeId)}|${day}`) ?? 0,
      };
    });
    const q = qtyPasangan.get(kunciPasangan(userId, storeId)) ?? { terjual: 0, kembali: 0 };
    const t = titipPasangan.get(kunciPasangan(userId, storeId)) ?? { dibuat: 0, selesai: 0 };
    const ringkas = ringkasKinerja(
      hariBaris.filter((h) => h.day <= hariIni),
      {
        jadwalDisusun,
        titipDibuat: t.dibuat,
        titipSelesai: t.selesai,
        qtyTerjual: q.terjual,
        qtyKembali: q.kembali,
        target: bacaTargetBulan(nilaiTarget, userId, bulanDari(hari)),
        nilaiOrang: (nilaiOrangSen.get(userId) ?? 0) / 100,
        notaBerpembeli: berpembeliPasangan.get(kunciPasangan(userId, storeId)) ?? 0,
        memberBaru: memberBaruPer.get(kunciPasangan(userId, storeId)) ?? 0,
      },
    );
    return { userId, storeId, hari: hariBaris, ringkas };
  });

  return { ...hasilKosong, baris };
}

const bulanDari = (hari: readonly string[]) => hari[0].slice(0, 7);

// ─── Daftar kantor ───────────────────────────────────────────────────────────

export type BarisKinerjaSpg = RingkasKinerja & {
  userId: string;
  nama: string;
  storeId: string;
  toko: string;
  kodeToko: string;
  /** Toko ini bukan (lagi) toko tetapnya — SPG dipindah atau dilepas. */
  bukanTokoTetap: boolean;
};

export type DataKinerjaSpg = {
  bulan: string;
  labelBulan: string;
  /** Bulan berjalan: angka sampai hari ini saja. */
  berjalan: boolean;
  labelSampai: string;
  storeId: string | null;
  pilihanBulan: { bulan: string; label: string }[];
  pilihanToko: { id: string; nama: string; kode: string }[];
  toleransiMenit: number;
  baris: BarisKinerjaSpg[];
};

export async function kinerjaSpgKantor(m: { bulan: string; storeId: string | null; sekarang: Date }): Promise<DataKinerjaSpg> {
  const h = await muat({ bulan: m.bulan, sekarang: m.sekarang, storeIds: m.storeId ? [m.storeId] : null });
  const berjalan = m.bulan === bulanWib(m.sekarang);
  const hari = hariSebulan(m.bulan);
  const sampai = berjalan ? h.hariIni : hari[hari.length - 1];
  return {
    bulan: m.bulan,
    labelBulan: labelBulan(m.bulan),
    berjalan,
    labelSampai: formatDisplayDate(awalHariWib(sampai)),
    storeId: m.storeId,
    pilihanBulan: pilihanBulanKinerja(m.sekarang),
    pilihanToko: h.pilihanToko
      .map((id) => ({ id, nama: h.toko.get(id)?.nama ?? "—", kode: h.toko.get(id)?.kode ?? "" }))
      .sort((a, b) => a.nama.localeCompare(b.nama, "id")),
    toleransiMenit: h.toleransiMenit,
    baris: h.baris
      .map((b) => ({
        ...b.ringkas,
        userId: b.userId,
        nama: h.nama.get(b.userId) ?? "—",
        storeId: b.storeId,
        toko: h.toko.get(b.storeId)?.nama ?? "—",
        kodeToko: h.toko.get(b.storeId)?.kode ?? "",
        bukanTokoTetap: h.tokoTetap.get(b.userId) !== b.storeId,
      }))
      .sort((a, b) => a.nama.localeCompare(b.nama, "id") || a.toko.localeCompare(b.toko, "id")),
  };
}

// ─── Rincian harian satu SPG ─────────────────────────────────────────────────

export type HariKinerjaTampil = {
  day: string;
  label: string;
  /** Hari yang belum tiba — hanya jadwalnya yang tampil. */
  depan: boolean;
  shift: { jenis: "KERJA"; label: string; mulai: string | null; selesai: string | null } | { jenis: "LIBUR" } | null;
  jamMasuk: string | null;
  status: Kenyataan["status"] | null;
  terlambatMenit: number | null;
  izin: string | null;
  nota: number;
  potong: number;
  nilai: number;
  pengunjung: number | null;
  pengunjungDariTutup: boolean;
  konversiPersen: number | null;
  tutup: boolean;
  titipDibuat: number;
};

export type BagianKinerjaSpg = {
  storeId: string;
  toko: string;
  kodeToko: string;
  bukanTokoTetap: boolean;
  ringkas: RingkasKinerja;
  hari: HariKinerjaTampil[];
};

export type DataKinerjaSpgHarian = {
  userId: string;
  nama: string;
  bulan: string;
  labelBulan: string;
  berjalan: boolean;
  pilihanBulan: { bulan: string; label: string }[];
  toleransiMenit: number;
  bagian: BagianKinerjaSpg[];
};

/**
 * Rincian harian satu SPG satu bulan, satu bagian per toko tempat ia bekerja
 * bulan itu. `null` = orangnya tidak ada.
 */
export async function kinerjaSpgHarian(m: { userId: string; bulan: string; sekarang: Date }): Promise<DataKinerjaSpgHarian | null> {
  const orang = await prisma.user.findUnique({ where: { id: m.userId }, select: { id: true, name: true, email: true, assignedStoreId: true } });
  if (!orang) return null;

  // Toko-toko orang ini bulan itu; rekan setokonya ikut dimuat untuk pembagian pengunjung.
  const hari = hariSebulan(m.bulan);
  const awal = awalHariWib(hari[0]);
  const akhir = awalHariWib(`${bulanBerikutnya(m.bulan)}-01`);
  const rentangHari = { gte: hari[0], lte: hari[hari.length - 1] };
  const [j, s, v] = await Promise.all([
    prisma.spgSale.groupBy({ by: ["storeId"], where: { salesmanId: m.userId, createdAt: { gte: awal, lt: akhir } } }),
    prisma.spgShift.groupBy({ by: ["storeId"], where: { userId: m.userId, day: rentangHari } }),
    prisma.spgVisitorCount.groupBy({ by: ["storeId"], where: { userId: m.userId, day: rentangHari } }),
  ]);
  const storeIds = [
    ...new Set([...(orang.assignedStoreId ? [orang.assignedStoreId] : []), ...[...j, ...s, ...v].map((x) => x.storeId)]),
  ];

  const h = storeIds.length ? await muat({ bulan: m.bulan, sekarang: m.sekarang, storeIds }) : null;
  const milik = h ? h.baris.filter((b) => b.userId === m.userId) : [];

  return {
    userId: orang.id,
    nama: orang.name ?? orang.email,
    bulan: m.bulan,
    labelBulan: labelBulan(m.bulan),
    berjalan: m.bulan === bulanWib(m.sekarang),
    pilihanBulan: pilihanBulanKinerja(m.sekarang),
    toleransiMenit: h?.toleransiMenit ?? 0,
    bagian: milik.map((b) => ({
      storeId: b.storeId,
      toko: h!.toko.get(b.storeId)?.nama ?? "—",
      kodeToko: h!.toko.get(b.storeId)?.kode ?? "",
      bukanTokoTetap: orang.assignedStoreId !== b.storeId,
      ringkas: b.ringkas,
      hari: b.hari.map((x) => ({
        day: x.day,
        label: labelHariPendek(x.day),
        depan: x.day > h!.hariIni,
        shift: x.libur
          ? { jenis: "LIBUR" as const }
          : x.shiftKode || x.jamMulai
            ? { jenis: "KERJA" as const, label: h!.labelShift(x.shiftKode), mulai: x.jamMulai, selesai: x.jamSelesai }
            : null,
        jamMasuk: x.jamMasuk,
        status: x.kenyataan?.status ?? null,
        terlambatMenit: x.terlambatMenit,
        izin: x.kenyataan?.status === "IZIN" ? x.kenyataan.jenis : x.izin,
        nota: x.nota,
        potong: x.potong,
        nilai: x.nilaiSen / 100,
        pengunjung: x.pengunjung,
        pengunjungDariTutup: x.pengunjungDariTutup,
        konversiPersen: x.pengunjung && x.pengunjung > 0 ? (x.nota / x.pengunjung) * 100 : null,
        tutup: x.tutup,
        titipDibuat: x.titipDibuat,
      })),
    })),
  };
}
