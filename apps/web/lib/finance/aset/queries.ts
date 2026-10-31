import { prisma, Prisma } from "@elorae/db";
import { cariTeks } from "@/lib/db/cari-teks";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { bulanWib, kunciBulan, STATUS_PERIODE, type TahunBulan } from "@/lib/finance/periode/periode";
import { readGlCutover } from "@/lib/finance/sales/sweep";
import { akhirMasaManfaat, jadwalPenyusutan } from "./jadwal";
import { bacaIdSumberPenyusutan, STATUS_ASET, SUMBER_ASET, type CaraPerolehan } from "./aturan";
import { ENTITAS_ASET, JEJAK_ASET } from "./jejak";
import { PILIH_ASET_SUSUT, spekAset } from "./penyusutan";

/*
 * Pembaca aset tetap (bagian D3) — KHUSUS SERVER. Komponen klien hanya boleh
 * `import type` dari berkas ini.
 *
 * Akumulasi penyusutan = akumulasi awal (sebelum masuk sistem) + jumlah baris
 * `FixedAssetDepreciation` — angka yang SAMA dengan yang dikredit jurnalnya ke
 * akun akumulasi (baris nol tidak berjurnal).
 */

const n = (v: Prisma.Decimal | number | null | undefined): number => (v == null ? 0 : Number(v));
const sen = (x: number) => Math.round(x * 100);

export const SARINGAN_STATUS_ASET = ["AKTIF", "DILEPAS", "BATAL", "SEMUA"] as const;
export type SaringanStatusAset = (typeof SARINGAN_STATUS_ASET)[number];

export function bacaSaringanStatusAset(v: string | null | undefined): SaringanStatusAset {
  return (SARINGAN_STATUS_ASET as readonly string[]).includes(v ?? "") ? (v as SaringanStatusAset) : "AKTIF";
}

const STATUS_DARI_SARINGAN: Record<Exclude<SaringanStatusAset, "SEMUA">, string> = {
  AKTIF: STATUS_ASET.AKTIF,
  DILEPAS: STATUS_ASET.DILEPAS,
  BATAL: STATUS_ASET.BATAL,
};

export type BarisAset = {
  id: string;
  kode: string;
  nama: string;
  kategori: string;
  metode: string;
  tanggalPerolehan: string;
  biaya: number;
  akumulasi: number;
  nilaiBuku: number;
  status: string;
  lokasi: string | null;
  /** Periode penyusutan terakhir yang berjurnal ("YYYY-MM"), null bila belum pernah. */
  penyusutanTerakhir: string | null;
};

export type RingkasanAset = { jumlah: number; biaya: number; akumulasi: number; nilaiBuku: number };

export async function daftarAset(isi: {
  status?: SaringanStatusAset;
  kategori?: string | null;
  cari?: string | null;
  halaman?: number;
  ukuran?: number;
}): Promise<{ baris: BarisAset[]; total: number; ringkasan: RingkasanAset }> {
  const status = isi.status ?? "AKTIF";
  const cari = isi.cari?.trim();
  const where: Prisma.FixedAssetWhereInput = {
    ...(status !== "SEMUA" ? { status: STATUS_DARI_SARINGAN[status] } : {}),
    ...(isi.kategori ? { category: isi.kategori } : {}),
    ...(cari ? { OR: [{ name: cariTeks(cari) }, { code: cariTeks(cari) }, { location: cariTeks(cari) }] } : {}),
  };
  const aset = await prisma.fixedAsset.findMany({
    where,
    orderBy: [{ acquisitionDate: "desc" }, { code: "desc" }],
    take: 5000,
    select: {
      id: true,
      code: true,
      name: true,
      category: true,
      method: true,
      acquisitionDate: true,
      cost: true,
      accumulatedAtStart: true,
      status: true,
      location: true,
    },
  });
  const ids = aset.map((a) => a.id);
  const [jumlah, terakhir] = ids.length
    ? await Promise.all([
        prisma.fixedAssetDepreciation.groupBy({ by: ["assetId"], where: { assetId: { in: ids } }, _sum: { amount: true } }),
        prisma.fixedAssetDepreciation.groupBy({ by: ["assetId"], where: { assetId: { in: ids }, journalId: { not: null } }, _max: { period: true } }),
      ])
    : [[], []];
  const perAset = new Map(jumlah.map((j) => [j.assetId, n(j._sum.amount)]));
  const terakhirPer = new Map(terakhir.map((j) => [j.assetId, j._max.period ?? null]));

  const semua: BarisAset[] = aset.map((a) => {
    const akum = (sen(n(a.accumulatedAtStart)) + sen(perAset.get(a.id) ?? 0)) / 100;
    const biaya = n(a.cost);
    return {
      id: a.id,
      kode: a.code,
      nama: a.name,
      kategori: a.category,
      metode: a.method,
      tanggalPerolehan: formatDateOnlyJakarta(a.acquisitionDate),
      biaya,
      akumulasi: akum,
      nilaiBuku: (sen(biaya) - sen(akum)) / 100,
      status: a.status,
      lokasi: a.location,
      penyusutanTerakhir: terakhirPer.get(a.id) ?? null,
    };
  });
  // Ringkasan atas SELURUH hasil saringan, bukan halaman ini; aset batal tidak dijumlah.
  const dihitung = semua.filter((b) => b.status !== STATUS_ASET.BATAL);
  const ringkasan: RingkasanAset = {
    jumlah: dihitung.length,
    biaya: dihitung.reduce((s, b) => s + sen(b.biaya), 0) / 100,
    akumulasi: dihitung.reduce((s, b) => s + sen(b.akumulasi), 0) / 100,
    nilaiBuku: dihitung.reduce((s, b) => s + sen(b.nilaiBuku), 0) / 100,
  };
  const ukuran = Math.max(1, isi.ukuran ?? 25);
  const halaman = Math.max(1, isi.halaman ?? 1);
  return { baris: semua.slice((halaman - 1) * ukuran, halaman * ukuran), total: semua.length, ringkasan };
}

export type KeadaanBulanJadwal = "DIPOSTING" | "NOL" | "BELUM" | "DITUTUP" | "AKAN_DATANG" | "SESUDAH_LEPAS" | "SEBELUM_BUKU";

export type BarisJadwal = {
  periode: string;
  /** Jumlah menurut jadwal. */
  jadwal: number;
  akumulasiJadwal: number;
  /** Yang diposting (baris penyusutan), null bila belum. */
  diposting: number | null;
  journalId: string | null;
  keadaan: KeadaanBulanJadwal;
};

export type AkunRingkas = { id: string; kode: string; nama: string };

export type JurnalAset = { id: string; jenis: string; tanggal: string; keterangan: string; total: number; dibalikOleh: string | null };

export type RiwayatAset = { aksi: string; waktu: string; olehNama: string | null; alasan: string | null };

export type RincianAset = {
  id: string;
  kode: string;
  nama: string;
  kategori: string;
  metode: string;
  tarifSaldoMenurun: number | null;
  umurBulan: number;
  tanggalPerolehan: string;
  mulaiDisusutkan: string;
  akhirMasaManfaat: string | null;
  biaya: number;
  nilaiSisa: number;
  akumulasiAwal: number;
  akumulasi: number;
  nilaiBuku: number;
  status: string;
  lokasi: string | null;
  catatan: string | null;
  pemasok: { id: string; nama: string } | null;
  akunAset: AkunRingkas | null;
  akunAkumulasi: AkunRingkas | null;
  akunBeban: AkunRingkas | null;
  cara: CaraPerolehan | null;
  dilepas: { tanggal: string; hasilJual: number; catatan: string | null; olehNama: string | null } | null;
  dibuatOleh: string | null;
  dibuatPada: string;
  /** Ada penyusutan berjurnal — nilai penyusutan tidak bisa diubah lagi. */
  sudahDisusutkan: boolean;
  jurnalPerolehanId: string | null;
  jadwal: BarisJadwal[];
  jurnal: JurnalAset[];
  riwayat: RiwayatAset[];
};

async function namaPengguna(ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  const unik = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unik.length) return new Map();
  const u = await prisma.user.findMany({ where: { id: { in: unik } }, select: { id: true, name: true, email: true } });
  return new Map(u.map((x) => [x.id, x.name ?? x.email]));
}

function bacaMetadata(m: unknown): Record<string, unknown> | null {
  let v = m;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function bandingTb(a: TahunBulan, b: TahunBulan): number {
  return a.tahun * 12 + a.bulan - (b.tahun * 12 + b.bulan);
}

export async function rincianAset(id: string, sekarang: Date = new Date()): Promise<RincianAset | null> {
  const a = await prisma.fixedAsset.findUnique({
    where: { id },
    select: {
      ...PILIH_ASET_SUSUT,
      category: true,
      acquisitionDate: true,
      assetAccountId: true,
      supplierId: true,
      location: true,
      notes: true,
      disposalProceeds: true,
      disposalNote: true,
      disposedById: true,
      createdById: true,
      createdAt: true,
      depreciations: { orderBy: { period: "asc" }, select: { period: true, amount: true, journalId: true } },
    },
  });
  if (!a) return null;

  const akunIds = [a.assetAccountId, a.accumDepreciationAccountId, a.depreciationExpenseAccountId].filter((x): x is string => !!x);
  const sumberIds = [a.id];
  const [akun, pemasok, jurnalAset, jejak, tanggalMulai] = await Promise.all([
    akunIds.length ? prisma.chartAccount.findMany({ where: { id: { in: akunIds } }, select: { id: true, code: true, name: true } }) : Promise.resolve([]),
    a.supplierId ? prisma.supplier.findUnique({ where: { id: a.supplierId }, select: { id: true, name: true } }) : Promise.resolve(null),
    prisma.journal.findMany({
      where: {
        OR: [
          { sourceType: { in: [SUMBER_ASET.PEROLEHAN, SUMBER_ASET.PEROLEHAN_BATAL] }, sourceId: { in: sumberIds } },
          {
            sourceType: { in: [SUMBER_ASET.PELEPASAN, SUMBER_ASET.PELEPASAN_BATAL] },
            OR: [{ sourceId: a.id }, { sourceId: { startsWith: `${a.id}#` } }],
          },
        ],
      },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      select: { id: true, sourceType: true, date: true, description: true, reversalOfId: true, lines: { select: { debit: true } } },
    }),
    prisma.auditLog.findMany({
      where: { entityType: ENTITAS_ASET, entityId: a.id },
      orderBy: { createdAt: "asc" },
      select: { action: true, createdAt: true, userId: true, reason: true, metadata: true },
    }),
    readGlCutover(),
  ]);
  const peta = new Map(akun.map((x) => [x.id, { id: x.id, kode: x.code, nama: x.name }]));
  const nama = await namaPengguna([a.createdById, a.disposedById, ...jejak.map((j) => j.userId)]);

  const dicatat = jejak.find((j) => j.action === JEJAK_ASET.DICATAT);
  const metaDicatat = bacaMetadata(dicatat?.metadata);
  const cara = (metaDicatat?.cara as CaraPerolehan | undefined) ?? null;

  const spek = spekAset(a);
  const kini = bulanWib(sekarang);
  const lepas = a.disposedAt ? bulanWib(a.disposedAt) : null;
  const lantai = tanggalMulai ? bulanWib(tanggalMulai) : null;
  const perPeriode = new Map(a.depreciations.map((d) => [d.period, d]));
  const jadwal = jadwalPenyusutan(spek);
  const tertutup = jadwal.length
    ? new Set(
        (
          await prisma.accountingPeriod.findMany({
            where: { status: STATUS_PERIODE.TERTUTUP, year: { gte: jadwal[0].tb.tahun, lte: jadwal[jadwal.length - 1].tb.tahun } },
            select: { year: true, month: true },
          })
        ).map((p) => kunciBulan({ tahun: p.year, bulan: p.month })),
      )
    : new Set<string>();

  const barisJadwal: BarisJadwal[] = jadwal.map((j) => {
    const d = perPeriode.get(j.periode);
    let keadaan: KeadaanBulanJadwal;
    if (d) keadaan = d.journalId ? "DIPOSTING" : "NOL";
    else if (lepas && bandingTb(j.tb, lepas) >= 0) keadaan = "SESUDAH_LEPAS";
    else if (bandingTb(j.tb, kini) > 0) keadaan = "AKAN_DATANG";
    else if (lantai && bandingTb(j.tb, lantai) < 0) keadaan = "SEBELUM_BUKU";
    else if (tertutup.has(j.periode)) keadaan = "DITUTUP";
    else keadaan = "BELUM";
    return {
      periode: j.periode,
      jadwal: j.jumlah,
      akumulasiJadwal: j.akumulasi,
      diposting: d ? n(d.amount) : null,
      journalId: d?.journalId ?? null,
      keadaan,
    };
  });
  const akumPosting = a.depreciations.reduce((s, d) => s + sen(n(d.amount)), 0);
  const akumulasi = (sen(n(a.accumulatedAtStart)) + akumPosting) / 100;
  const dibalik = new Map(jurnalAset.filter((j) => j.reversalOfId).map((j) => [j.reversalOfId as string, j.id]));
  const akhir = akhirMasaManfaat(spek);

  return {
    id: a.id,
    kode: a.code,
    nama: a.name,
    kategori: a.category,
    metode: a.method,
    tarifSaldoMenurun: a.decliningRatePercent == null ? null : n(a.decliningRatePercent),
    umurBulan: a.usefulLifeMonths,
    tanggalPerolehan: formatDateOnlyJakarta(a.acquisitionDate),
    mulaiDisusutkan: kunciBulan(spek.mulai),
    akhirMasaManfaat: akhir ? kunciBulan(akhir) : null,
    biaya: n(a.cost),
    nilaiSisa: n(a.residualValue),
    akumulasiAwal: n(a.accumulatedAtStart),
    akumulasi,
    nilaiBuku: (sen(n(a.cost)) - sen(akumulasi)) / 100,
    status: a.status,
    lokasi: a.location,
    catatan: a.notes,
    pemasok: pemasok ? { id: pemasok.id, nama: pemasok.name } : null,
    akunAset: a.assetAccountId ? (peta.get(a.assetAccountId) ?? null) : null,
    akunAkumulasi: a.accumDepreciationAccountId ? (peta.get(a.accumDepreciationAccountId) ?? null) : null,
    akunBeban: a.depreciationExpenseAccountId ? (peta.get(a.depreciationExpenseAccountId) ?? null) : null,
    cara,
    dilepas:
      a.status === STATUS_ASET.DILEPAS && a.disposedAt
        ? {
            tanggal: formatDateOnlyJakarta(a.disposedAt),
            hasilJual: n(a.disposalProceeds),
            catatan: a.disposalNote,
            olehNama: a.disposedById ? (nama.get(a.disposedById) ?? null) : null,
          }
        : null,
    dibuatOleh: nama.get(a.createdById) ?? null,
    dibuatPada: a.createdAt.toISOString(),
    sudahDisusutkan: a.depreciations.some((d) => d.journalId),
    jurnalPerolehanId: jurnalAset.find((j) => j.sourceType === SUMBER_ASET.PEROLEHAN)?.id ?? null,
    jadwal: barisJadwal,
    jurnal: jurnalAset.map((j) => ({
      id: j.id,
      jenis: j.sourceType ?? "",
      tanggal: j.date.toISOString(),
      keterangan: j.description,
      total: j.lines.reduce((s, l) => s + sen(n(l.debit)), 0) / 100,
      dibalikOleh: dibalik.get(j.id) ?? null,
    })),
    riwayat: jejak.map((j) => ({ aksi: j.action, waktu: j.createdAt.toISOString(), olehNama: nama.get(j.userId) ?? null, alasan: j.reason })),
  };
}

/** Aset yang penyusutan bulan `tb` (sampai dengan bulan itu) masih tertunda — untuk tombol "Posting penyusutan". */
export async function hitungPenyusutanTertunda(tb: TahunBulan): Promise<number> {
  const aset = await prisma.fixedAsset.findMany({
    where: { status: { in: [STATUS_ASET.AKTIF, STATUS_ASET.DILEPAS] }, usefulLifeMonths: { gt: 0 } },
    select: { ...PILIH_ASET_SUSUT, depreciations: { where: { period: kunciBulan(tb) }, select: { id: true } } },
  });
  return aset.filter((a) => {
    if (a.depreciations.length) return false;
    const spek = spekAset(a);
    const akhir = akhirMasaManfaat(spek);
    if (!akhir || bandingTb(tb, spek.mulai) < 0 || bandingTb(tb, akhir) > 0) return false;
    if (a.disposedAt && bandingTb(tb, bulanWib(a.disposedAt)) >= 0) return false;
    return true;
  }).length;
}

export type PilihanAkun = { id: string; kode: string; nama: string; tipe: string };

/** Akun daun aktif untuk formulir aset (aset, akumulasi, beban, kas/bank, hutang). */
export async function akunUntukAset(): Promise<PilihanAkun[]> {
  const { getPostableAccounts } = await import("@/lib/finance/coa/queries");
  const akun = await getPostableAccounts();
  return akun.map((a) => ({ id: a.id, kode: a.code, nama: a.name, tipe: a.type }));
}

export async function pemasokUntukAset(): Promise<Array<{ id: string; nama: string }>> {
  const s = await prisma.supplier.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, take: 1000, select: { id: true, name: true } });
  return s.map((x) => ({ id: x.id, nama: x.name }));
}

/** Nomor dokumen sumber jurnal aset untuk halaman Jurnal / Integritas (dipanggil `info-dokumen.ts`). */
export async function infoDokumenAset(pasangan: Array<{ jenis: string; id: string }>): Promise<Map<string, { asetId: string; nomor: string }>> {
  const hasil = new Map<string, { asetId: string; nomor: string }>();
  const asetIds = new Set<string>();
  for (const p of pasangan) {
    if (p.jenis === SUMBER_ASET.PENYUSUTAN) {
      const b = bacaIdSumberPenyusutan(p.id);
      if (b) asetIds.add(b.asetId);
    } else if (([SUMBER_ASET.PEROLEHAN, SUMBER_ASET.PEROLEHAN_BATAL, SUMBER_ASET.PELEPASAN, SUMBER_ASET.PELEPASAN_BATAL] as string[]).includes(p.jenis)) {
      asetIds.add(p.id.split("#")[0]);
    }
  }
  if (!asetIds.size) return hasil;
  const aset = await prisma.fixedAsset.findMany({ where: { id: { in: [...asetIds] } }, select: { id: true, code: true } });
  const kode = new Map(aset.map((x) => [x.id, x.code]));
  for (const p of pasangan) {
    if (p.jenis === SUMBER_ASET.PENYUSUTAN) {
      const b = bacaIdSumberPenyusutan(p.id);
      const k = b ? kode.get(b.asetId) : undefined;
      if (b && k) hasil.set(`${p.jenis}|${p.id}`, { asetId: b.asetId, nomor: `${k} · ${b.periode}` });
    } else {
      const asetId = p.id.split("#")[0];
      const k = kode.get(asetId);
      if (k) hasil.set(`${p.jenis}|${p.id}`, { asetId, nomor: k });
    }
  }
  return hasil;
}


export type IsianAwalAset = {
  nama?: string;
  tanggalPerolehan?: string;
  biaya?: string;
  pemasokId?: string;
  akunAsetId?: string;
  catatan?: string;
  /** Perolehannya sudah dijurnal oleh dokumen sumbernya. */
  cara?: "SUDAH_DICATAT";
};

/**
 * Isian awal formulir aset dari dokumen yang SUDAH menjurnal perolehannya
 * (rancangan D3: "perolehan dari voucher kas/pembayaran"): voucher kas keluar
 * (`?voucher=<id>`) — baris pertama yang akunnya bertipe ASET menjadi akun aset
 * dan nilainya — atau pembayaran pemasok (`?pembayaran=<id>`). Cara perolehan
 * = sudah dicatat, jadi tidak ada jurnal perolehan kedua. Null bila dokumennya
 * tidak ada / batal.
 */
export async function isianAwalAsetDariDokumen(sumber: { voucher?: string | null; pembayaran?: string | null }): Promise<IsianAwalAset | null> {
  if (sumber.voucher) {
    const v = await prisma.cashVoucher.findUnique({
      where: { id: sumber.voucher },
      select: {
        docNumber: true,
        date: true,
        status: true,
        totalAmount: true,
        supplierId: true,
        description: true,
        lines: { orderBy: { sortOrder: "asc" }, select: { chartAccountId: true, amount: true, memo: true } },
      },
    });
    if (!v || v.status === "CANCELLED") return null;
    const akun = v.lines.length
      ? await prisma.chartAccount.findMany({ where: { id: { in: v.lines.map((l) => l.chartAccountId) } }, select: { id: true, type: true } })
      : [];
    const tipe = new Map(akun.map((a) => [a.id, a.type]));
    const barisAset = v.lines.find((l) => tipe.get(l.chartAccountId) === "ASET");
    return {
      nama: (barisAset?.memo ?? v.description ?? "").slice(0, 191) || undefined,
      tanggalPerolehan: formatDateOnlyJakarta(v.date),
      biaya: String(barisAset ? n(barisAset.amount) : n(v.totalAmount)),
      ...(v.supplierId ? { pemasokId: v.supplierId } : {}),
      ...(barisAset ? { akunAsetId: barisAset.chartAccountId } : {}),
      catatan: `Dari voucher ${v.docNumber}`,
      cara: "SUDAH_DICATAT",
    };
  }
  if (sumber.pembayaran) {
    const p = await prisma.supplierPayment.findUnique({
      where: { id: sumber.pembayaran },
      select: { docNumber: true, date: true, status: true, grossAmount: true, supplierId: true, note: true },
    });
    if (!p || p.status === "CANCELLED") return null;
    return {
      nama: (p.note ?? "").slice(0, 191) || undefined,
      tanggalPerolehan: formatDateOnlyJakarta(p.date),
      biaya: String(n(p.grossAmount)),
      pemasokId: p.supplierId,
      catatan: `Dari pembayaran pemasok ${p.docNumber}`,
      cara: "SUDAH_DICATAT",
    };
  }
  return null;
}
