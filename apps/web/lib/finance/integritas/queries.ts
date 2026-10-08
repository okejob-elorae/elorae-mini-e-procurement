import { prisma, Prisma, sqlId } from "@elorae/db";
import type { PostingRole } from "@/lib/constants/journal-roles";
import { endOfTodayJakarta, formatDateOnlyJakarta, parseDateOnly } from "@/lib/date-only";
import { daftarJurnalTertunda } from "@/lib/finance/jurnal-tertunda";
import { getAccountBalances } from "@/lib/finance/reports/balances";
import { cariSemuaTanpaJurnal, rentangSapuan } from "@/lib/finance/sapuan/runner";
import { STATUS_JURNAL } from "@/lib/finance/journals/status-jurnal";
import { AWALAN_SUMBER_SALDO_AWAL, STATUS_PERIODE, SUMBER_TUTUP_TAHUN, bulanWib, kunciBulan, rentangBulan } from "@/lib/finance/periode/periode";
import { cariInfoDokumen } from "@/app/backoffice/finance/journals/_sumber/info-dokumen";
import { idDokumenDariSumber, kunciDokumen, tautanDokumenSumber } from "@/app/backoffice/finance/journals/_sumber/tautan";
import { PERAN_SALDO_BOLEH_TERBALIK, saldoTerbalik } from "./aturan";

/*
 * Integritas buku besar (bagian A1) — pemeriksaan yang hanya bisa SALAH karena
 * data rusak, bug, atau jurnal yang terlewat. Hanya di server; setiap bagian
 * dibaca terpisah dan kegagalan satu bagian tidak menjatuhkan halaman.
 */

const BATAS_BARIS = 200;

export type JurnalTakSeimbang = {
  id: string;
  tanggal: string;
  keterangan: string;
  status: string;
  debit: number;
  kredit: number;
  jumlahBaris: number;
};

/** Jurnal yang Σ debit ≠ Σ kredit (sampai sen) atau kurang dari dua baris — `postJournal` tidak pernah membuatnya. */
export async function jurnalTakSeimbang(): Promise<JurnalTakSeimbang[]> {
  const rows = await prisma.$queryRaw<
    Array<{ id: string; date: Date | string; description: string; status: string; debit: unknown; credit: unknown; n: unknown }>
  >(Prisma.sql`
    SELECT j.${sqlId("id")} AS ${sqlId("id")}, j.${sqlId("date")} AS ${sqlId("date")}, j.${sqlId("description")} AS ${sqlId("description")},
      j.${sqlId("status")} AS ${sqlId("status")},
      COALESCE(SUM(l.${sqlId("debit")}), 0) AS ${sqlId("debit")}, COALESCE(SUM(l.${sqlId("credit")}), 0) AS ${sqlId("credit")},
      COUNT(l.${sqlId("id")}) AS ${sqlId("n")}
    FROM ${sqlId("Journal")} j
    LEFT JOIN ${sqlId("JournalLine")} l ON l.${sqlId("journalId")} = j.${sqlId("id")}
    GROUP BY j.${sqlId("id")}, j.${sqlId("date")}, j.${sqlId("description")}, j.${sqlId("status")}
    HAVING COUNT(l.${sqlId("id")}) < 2 OR ROUND(COALESCE(SUM(l.${sqlId("debit")}), 0), 2) <> ROUND(COALESCE(SUM(l.${sqlId("credit")}), 0), 2)
    ORDER BY j.${sqlId("date")} DESC
    LIMIT ${BATAS_BARIS}
  `);
  return rows.map((r) => ({
    id: r.id,
    tanggal: new Date(r.date).toISOString(),
    keterangan: r.description,
    status: r.status,
    debit: Number(r.debit),
    kredit: Number(r.credit),
    jumlahBaris: Number(r.n),
  }));
}

export type JurnalYatim = { id: string; tanggal: string; keterangan: string; sourceType: string; sourceId: string };

export type HasilJurnalYatim = {
  yatim: JurnalYatim[];
  /** Jenis sumber yang dokumennya tidak bisa dicari di sini (tidak ada satu pun yang ditemukan) — tidak dinilai yatim. */
  tidakDiperiksa: Array<{ sourceType: string; jumlah: number }>;
  terpotong: boolean;
};

/** Jenis sumber yang bukan dokumen (dibuat oleh buku besar sendiri) atau milik tes. */
const BUKAN_DOKUMEN = (t: string) => t === SUMBER_TUTUP_TAHUN || t.startsWith("UJI_");

const POTONG = 1000;

/**
 * Pencari dokumen untuk jenis yang tidak dikenal `info-dokumen.ts`: saldo awal
 * (`OPENING`, sourceId = `OpeningBalanceImport.id`, pembaliknya `<id>:balik` —
 * dipotong `idDokumenDariSumber`). Mengembalikan id yang ADA.
 */
const PENCARI_KHUSUS: Record<string, (ids: string[]) => Promise<string[]>> = {
  [AWALAN_SUMBER_SALDO_AWAL]: async (ids) =>
    (await prisma.openingBalanceImport.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((r) => r.id),
};

/**
 * Jurnal otomatis yang dokumen sumbernya sudah tidak ada. Jenis sumber yang
 * tidak satu pun dokumennya ditemukan dilaporkan "tidak diperiksa", bukan
 * yatim: itu lebih mungkin jenis yang belum dikenal pencari nomor dokumen
 * (`info-dokumen.ts`) daripada semua dokumennya hilang.
 */
export async function jurnalYatim(): Promise<HasilJurnalYatim> {
  const jurnal = await prisma.journal.findMany({
    where: { sourceType: { not: null }, sourceId: { not: null } },
    select: { id: true, date: true, description: true, sourceType: true, sourceId: true },
    orderBy: { date: "desc" },
  });
  const perJenis = new Map<string, typeof jurnal>();
  for (const j of jurnal) {
    if (!j.sourceType || BUKAN_DOKUMEN(j.sourceType)) continue;
    const daftar = perJenis.get(j.sourceType) ?? [];
    daftar.push(j);
    perJenis.set(j.sourceType, daftar);
  }

  const yatim: JurnalYatim[] = [];
  const tidakDiperiksa: HasilJurnalYatim["tidakDiperiksa"] = [];
  for (const [jenis, daftar] of perJenis) {
    const pasangan = daftar
      .map((j) => ({ jenis, id: idDokumenDariSumber(jenis, j.sourceId) }))
      .filter((p): p is { jenis: string; id: string } => !!p.id);
    const ada = new Set<string>();
    const khusus = PENCARI_KHUSUS[jenis];
    for (let i = 0; i < pasangan.length; i += POTONG) {
      const potong = pasangan.slice(i, i + POTONG);
      if (khusus) {
        for (const id of await khusus(potong.map((p) => p.id))) ada.add(kunciDokumen(jenis, id));
      } else {
        const info = await cariInfoDokumen(potong);
        for (const k of info.keys()) ada.add(k);
      }
    }
    if (ada.size === 0) {
      tidakDiperiksa.push({ sourceType: jenis, jumlah: daftar.length });
      continue;
    }
    for (const j of daftar) {
      const id = idDokumenDariSumber(jenis, j.sourceId);
      if (id && !ada.has(kunciDokumen(jenis, id))) {
        yatim.push({ id: j.id, tanggal: j.date.toISOString(), keterangan: j.description, sourceType: jenis, sourceId: j.sourceId! });
      }
    }
  }
  return { yatim: yatim.slice(0, BATAS_BARIS), tidakDiperiksa, terpotong: yatim.length > BATAS_BARIS };
}

export type DokumenTanpaJurnalBaris = {
  sourceType: string;
  jenis: string;
  id: string;
  nomor: string;
  tanggal: string;
  /** Sudah ada `JOURNAL_PENDING` untuknya (tampil juga di tab Tertunda). */
  tercatatGagal: boolean;
  tautan: string | null;
};

export type HasilTanpaJurnal =
  | { berlaku: false; sebab: "TANPA_TANGGAL_MULAI" | "SEBELUM_TANGGAL_MULAI" }
  | {
      berlaku: true;
      sejak: string;
      sampai: string;
      dokumen: DokumenTanpaJurnalBaris[];
      perSumber: Array<{ sourceType: string; label: string; jumlah: number; terpotong: boolean; galat: string | null }>;
    };

/** Batas dokumen per sumber yang dibaca halaman Integritas. */
const BATAS_PER_SUMBER = 100;

/**
 * Dokumen yang seharusnya berjurnal tetapi belum, per sumber terdaftar,
 * sejak tanggal mulai buku besar. `bulan` membatasi ke satu bulan;
 * `hanyaDiam` = hanya yang TIDAK tercatat gagal dan bertanggal sebelum hari
 * ini (WIB) — definisi baris Beranda "Dokumen tanpa jurnal".
 */
export async function dokumenTanpaJurnal(opsi: { bulan?: { tahun: number; bulan: number } | null; hanyaDiam?: boolean } = {}): Promise<HasilTanpaJurnal> {
  const rentangBulanIni = opsi.bulan ? rentangBulan(opsi.bulan) : null;
  const sampai = opsi.hanyaDiam
    ? new Date((parseDateOnly(formatDateOnlyJakarta(new Date())) ?? new Date()).getTime() - 1)
    : (rentangBulanIni?.akhir ?? new Date());
  const rentang = await rentangSapuan({ sejak: rentangBulanIni?.awal, sampai });
  if (!rentang) {
    const { readGlCutover } = await import("@/lib/finance/sales/sweep");
    return { berlaku: false, sebab: (await readGlCutover()) ? "SEBELUM_TANGGAL_MULAI" : "TANPA_TANGGAL_MULAI" };
  }
  const [hasil, tertunda] = await Promise.all([
    cariSemuaTanpaJurnal({ ...rentang, batasPerSumber: BATAS_PER_SUMBER }),
    daftarJurnalTertunda(),
  ]);
  const gagal = new Set(
    tertunda.flatMap((t) => (t.sumber?.tipe === "dokumen" ? [kunciDokumen(t.sumber.sourceType, t.sumber.sourceId)] : [])),
  );

  const semua = hasil.flatMap((h) => h.dokumen.map((d) => ({ h, d })));
  const info = await cariInfoDokumen(
    semua.map(({ h, d }) => ({ jenis: h.sourceType, id: idDokumenDariSumber(h.sourceType, d.id) ?? d.id })),
  );
  const dokumen: DokumenTanpaJurnalBaris[] = semua
    .map(({ h, d }) => {
      const idDok = idDokumenDariSumber(h.sourceType, d.id) ?? d.id;
      const induk = info.get(kunciDokumen(h.sourceType, idDok));
      return {
        sourceType: h.sourceType,
        jenis: h.label,
        id: d.id,
        nomor: d.label,
        tanggal: d.tanggal.toISOString(),
        tercatatGagal: gagal.has(kunciDokumen(h.sourceType, d.id)),
        tautan: tautanDokumenSumber(h.sourceType, idDok, induk ?? {}),
      };
    })
    .filter((x) => !opsi.hanyaDiam || !x.tercatatGagal);

  return {
    berlaku: true,
    sejak: rentang.sejak.toISOString(),
    sampai: rentang.sampai.toISOString(),
    dokumen,
    perSumber: hasil.map((h) => ({
      sourceType: h.sourceType,
      label: h.label,
      jumlah: dokumen.filter((x) => x.sourceType === h.sourceType).length,
      terpotong: h.terpotong,
      galat: h.galat,
    })),
  };
}

/** Angka baris Beranda "Dokumen tanpa jurnal": dokumen tanpa jurnal dan tanpa catatan gagal, sebelum hari ini. */
export async function hitungDokumenTanpaJurnalDiam(): Promise<number> {
  const r = await dokumenTanpaJurnal({ hanyaDiam: true });
  return r.berlaku ? r.dokumen.length : 0;
}

export type SaldoTerbalikBaris = { accountId: string; kode: string; nama: string; tipe: string; saldo: number };

/**
 * Akun daun yang saldo kumulatifnya berlawanan dengan sisi normalnya (aset
 * bersaldo kredit, hutang bersaldo debit, …). Akun yang memang boleh dua arah
 * (kontra-akun, laba ditahan, selisih) dikecualikan lewat perannya.
 */
export async function saldoBertandaTerbalik(): Promise<SaldoTerbalikBaris[]> {
  const [baris, pemetaan] = await Promise.all([
    getAccountBalances({ to: endOfTodayJakarta() }, { sertakanTutupTahun: true }),
    prisma.journalAccountMapping.findMany({ select: { role: true, chartAccountId: true } }),
  ]);
  const peranAkun = new Map<string, PostingRole[]>();
  for (const m of pemetaan) {
    const daftar = peranAkun.get(m.chartAccountId) ?? [];
    daftar.push(m.role as PostingRole);
    peranAkun.set(m.chartAccountId, daftar);
  }
  return baris
    .filter((b) => !b.hasChildren && saldoTerbalik(b.signed, peranAkun.get(b.accountId) ?? []))
    .map((b) => ({ accountId: b.accountId, kode: b.code, nama: b.name, tipe: b.type, saldo: b.signed }));
}

export { PERAN_SALDO_BOLEH_TERBALIK };

export type JurnalSesudahTutup = { id: string; tanggal: string; keterangan: string; bulan: string; dibuat: string; ditutup: string };

/**
 * Jurnal BERLAKU di bulan tertutup yang dibuat SESUDAH bulan itu ditutup —
 * kunci periode `postJournal` mencegahnya; selain jurnal penutup tahun (yang
 * memang diposting ke bulan tertutup), ini hanya muncul dari data yang
 * ditulis di luar `postJournal`.
 */
export async function jurnalSesudahDitutup(): Promise<JurnalSesudahTutup[]> {
  const tertutup = await prisma.accountingPeriod.findMany({
    where: { status: STATUS_PERIODE.TERTUTUP, closedAt: { not: null } },
    select: { year: true, month: true, closedAt: true },
  });
  const hasil: JurnalSesudahTutup[] = [];
  for (const p of tertutup) {
    const r = rentangBulan({ tahun: p.year, bulan: p.month });
    const jurnal = await prisma.journal.findMany({
      where: {
        status: STATUS_JURNAL.POSTED,
        date: { gte: r.awal, lte: r.akhir },
        createdAt: { gt: p.closedAt! },
        OR: [{ sourceType: null }, { sourceType: { not: SUMBER_TUTUP_TAHUN } }],
      },
      select: { id: true, date: true, description: true, createdAt: true },
      take: BATAS_BARIS,
    });
    for (const j of jurnal) {
      hasil.push({
        id: j.id,
        tanggal: j.date.toISOString(),
        keterangan: j.description,
        bulan: kunciBulan(bulanWib(j.date)),
        dibuat: j.createdAt.toISOString(),
        ditutup: p.closedAt!.toISOString(),
      });
    }
  }
  return hasil.slice(0, BATAS_BARIS);
}
