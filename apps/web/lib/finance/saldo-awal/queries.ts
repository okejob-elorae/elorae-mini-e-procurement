import { prisma } from "@elorae/db";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { readGlCutover } from "@/lib/finance/sales/sweep";
import { STATUS_JURNAL } from "@/lib/finance/journals/status-jurnal";
import type { PostingRole } from "@/lib/constants/journal-roles";
import {
  JENIS_SALDO_AWAL,
  PERAN_MILIK_JENIS_LAIN,
  STATUS_SALDO_AWAL,
  SUMBER_JURNAL_SALDO_AWAL,
  TIPE_AKUN_SALDO_AWAL,
  bacaIsian,
  kunciJenis,
  type IsiSaldoAwal,
  type JenisSaldoAwal,
} from "./jenis";
import { ringkasSaldoAwal, type RingkasanSaldoAwal, type StatusJenisSaldoAwal } from "./kesiapan";
import { periodeTertutupSejak, type PeriodeTertutup } from "./tanggal";

/* Bacaan halaman Saldo awal dan spanduk kesiapan. Hanya membaca. */

export type PostingSaldoAwal = {
  id: string;
  diposting: string | null;
  olehNama: string | null;
  journalId: string | null;
  ekuitas: number;
  tanggalMulai: string;
  catatan: string | null;
  namaBerkas: string | null;
  isi: IsiSaldoAwal;
};

export type DrafSaldoAwal = { id: string; diubah: string; catatan: string | null; namaBerkas: string | null; isi: IsiSaldoAwal };

export type KeadaanJenisSaldoAwal = {
  jenis: JenisSaldoAwal;
  status: StatusJenisSaldoAwal;
  posting: PostingSaldoAwal | null;
  draf: DrafSaldoAwal | null;
  jumlahDibalik: number;
};

export async function bacaKeadaanSaldoAwal(
  tanggalMulai: string | null,
  ruang?: string,
): Promise<Record<JenisSaldoAwal, KeadaanJenisSaldoAwal>> {
  const kunci = JENIS_SALDO_AWAL.map((j) => kunciJenis(j, ruang));
  const rows = await prisma.openingBalanceImport.findMany({
    where: { kind: { in: kunci } },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      kind: true,
      status: true,
      cutoverDate: true,
      entries: true,
      totalAmount: true,
      journalId: true,
      postedAt: true,
      postedById: true,
      note: true,
      fileName: true,
      updatedAt: true,
    },
  });
  const pemosting = [...new Set(rows.map((r) => r.postedById).filter((id): id is string => !!id))];
  const pengguna = pemosting.length
    ? await prisma.user.findMany({ where: { id: { in: pemosting } }, select: { id: true, name: true } })
    : [];
  const namaPengguna = new Map(pengguna.map((u) => [u.id, u.name]));
  const ringkas = ringkasSaldoAwal(
    rows.map((r) => ({
      kind: ruang ? r.kind.slice(ruang.length + 1) : r.kind,
      status: r.status,
      tanggalMulai: formatDateOnlyJakarta(r.cutoverDate),
    })),
    tanggalMulai,
  );

  const hasil = {} as Record<JenisSaldoAwal, KeadaanJenisSaldoAwal>;
  for (const j of JENIS_SALDO_AWAL) {
    const milik = rows.filter((r) => r.kind === kunciJenis(j, ruang));
    const p = milik.find((r) => r.status === STATUS_SALDO_AWAL.DIPOSTING);
    const d = milik.find((r) => r.status === STATUS_SALDO_AWAL.DRAF);
    hasil[j] = {
      jenis: j,
      status: ringkas.jenis[j],
      posting: p
        ? {
            id: p.id,
            diposting: p.postedAt?.toISOString() ?? null,
            olehNama: p.postedById ? (namaPengguna.get(p.postedById) ?? null) : null,
            journalId: p.journalId,
            ekuitas: Number(p.totalAmount),
            tanggalMulai: formatDateOnlyJakarta(p.cutoverDate),
            catatan: p.note,
            namaBerkas: p.fileName,
            isi: bacaIsian(p.entries),
          }
        : null,
      draf: d ? { id: d.id, diubah: d.updatedAt.toISOString(), catatan: d.note, namaBerkas: d.fileName, isi: bacaIsian(d.entries) } : null,
      jumlahDibalik: milik.filter((r) => r.status === STATUS_SALDO_AWAL.DIBALIK).length,
    };
  }
  return hasil;
}

/** Spanduk kesiapan buku besar. Tidak pernah melempar — null menyembunyikan butirnya. */
export async function bacaKesiapanSaldoAwal(tanggalMulai?: string | null): Promise<RingkasanSaldoAwal | null> {
  try {
    const mulai = tanggalMulai !== undefined ? tanggalMulai : await readGlCutover().then((d) => (d ? formatDateOnlyJakarta(d) : null));
    const rows = await prisma.openingBalanceImport.findMany({
      where: { kind: { in: [...JENIS_SALDO_AWAL] }, status: { in: [STATUS_SALDO_AWAL.DIPOSTING, STATUS_SALDO_AWAL.DRAF] } },
      select: { kind: true, status: true, cutoverDate: true },
    });
    return ringkasSaldoAwal(
      rows.map((r) => ({ kind: r.kind, status: r.status, tanggalMulai: formatDateOnlyJakarta(r.cutoverDate) })),
      mulai,
    );
  } catch (e) {
    console.error("[saldo-awal] gagal membaca kesiapan saldo awal", e);
    return null;
  }
}

/**
 * Jurnal berlaku bertanggal SEBELUM tanggal mulai selain saldo awal ini
 * sendiri. Bila ada, saldo awal bisa tercatat dua kali (mis. jurnal manual
 * "saldo awal" yang dibuat sebelum layar ini ada) — layar memperingatkan.
 */
export async function jumlahJurnalSebelumMulai(tanggalMulai: Date): Promise<number> {
  return prisma.journal.count({
    where: {
      date: { lt: tanggalMulai },
      status: STATUS_JURNAL.POSTED,
      OR: [{ sourceType: null }, { sourceType: { not: SUMBER_JURNAL_SALDO_AWAL } }],
    },
  });
}

export type AkunSaldoAwal = { id: string; kode: string; nama: string; tipe: string };

/**
 * Akun yang boleh diisi di "Kas, bank & akun lain": akun neraca aktif tanpa
 * turunan, BUKAN akun peran yang punya jenisnya sendiri (persediaan, piutang,
 * hutang) dan bukan akun lawannya (Ekuitas saldo awal).
 */
export async function akunUntukSaldoAwal(): Promise<AkunSaldoAwal[]> {
  const [akun, induk, milikLain] = await Promise.all([
    prisma.chartAccount.findMany({
      where: { isActive: true, type: { in: [...TIPE_AKUN_SALDO_AWAL] } },
      select: { id: true, code: true, name: true, type: true },
      orderBy: { code: "asc" },
    }),
    prisma.chartAccount.findMany({ where: { parentId: { not: null } }, select: { parentId: true }, distinct: ["parentId"] }),
    prisma.journalAccountMapping.findMany({ where: { role: { in: [...PERAN_MILIK_JENIS_LAIN] } }, select: { chartAccountId: true } }),
  ]);
  const bukanDaun = new Set(induk.map((i) => i.parentId));
  const dilarang = new Set(milikLain.map((m) => m.chartAccountId));
  return akun
    .filter((a) => !bukanDaun.has(a.id) && !dilarang.has(a.id))
    .map((a) => ({ id: a.id, kode: a.code, nama: a.name, tipe: a.type }));
}

/** Peran yang dibutuhkan saldo awal tetapi belum dipetakan. */
export async function peranSaldoAwalBelumDipetakan(): Promise<PostingRole[]> {
  const perlu: PostingRole[] = ["OPENING_EQUITY", "INVENTORY", "INVENTORY_FG", "AR_STORE", "AR", "AP"];
  const ada = await prisma.journalAccountMapping.findMany({ where: { role: { in: perlu } }, select: { role: true } });
  const terpetakan = new Set(ada.map((m) => m.role));
  return perlu.filter((p) => !terpetakan.has(p));
}

export async function periodeTertutupSaldoAwal(tanggalJurnal: string): Promise<PeriodeTertutup | null> {
  const [periode, tahun] = await Promise.all([
    prisma.accountingPeriod.findMany({ where: { status: "CLOSED" }, select: { year: true, month: true, status: true } }),
    prisma.accountingYear.findMany({ where: { status: "CLOSED" }, select: { year: true, status: true } }),
  ]);
  return periodeTertutupSejak(tanggalJurnal, periode, tahun);
}

/** Pemasok aktif untuk "Tambah pemasok" di hutang awal. */
export async function pemasokUntukSaldoAwal(): Promise<{ id: string; kode: string; nama: string }[]> {
  const rows = await prisma.supplier.findMany({ select: { id: true, code: true, name: true }, orderBy: { name: "asc" } });
  return rows.map((s) => ({ id: s.id, kode: s.code, nama: s.name }));
}
