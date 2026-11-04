import { prisma } from '@elorae/db';
import {
  bandingkanLaporan,
  giliranTahap,
  tahapSiklus,
  type BahanTahap,
  type BarisBanding,
  type TahapSiklus,
} from './aturan';
import { pencocokanSiklus, penandaTerjualSiklus, type PencocokanSiklus } from "./pencocokan-queries";
import type { PenandaCocok } from "./pencocokan";
import { promoEloraeSiklus } from "./promo-elorae-queries";
import { totalTagihanKonsi } from "./promo-elorae";
import { stokDiToko, type SumberStokToko } from "./stok-di-toko";
import { muatBulanSiklusPertama } from "./siklus-pertama";
import { sebelumSiklusPertama } from "./siklus-pertama-aturan";
import { payoutMonth } from "@/lib/spg-commission/payout";
import { bulanWib } from "@/lib/salesman/pengaturan";
import { daftarPiutang } from "@/lib/receivables/queries";
import { penghalangBatalPiutang, type KodePenghalangBatal } from "@/lib/receivables/penghalang-batal";
import type { KeadaanTampil } from "@/lib/receivables/jatuh-tempo";
import type { StatusKlaim } from "@/lib/receivables/rules";
import { REF_KOMISI_KONSI } from "@/lib/spg/hilang";
import { bacaDetailGaji, type AlasanTahanBayar, type RincianGaji } from "@/lib/spg/gaji-pokok";
import { bulanSudahSelesai, potongTanpaKategori } from "@/lib/spg/komisi";
import { spgSaleMovements } from "@/lib/spg-commission/laporan-queries";
import { konteksBayarSpg } from "@/lib/spg/komisi-queries";
import { rencanaBayarSemua, type RencanaBayarKomisi, type UnitKomisiSpg } from "@/lib/spg/koreksi";
import { koreksiPadaPembayaran, kunciReturMenunggu, returMenungguPerLaporan, unitKomisiSpg } from "@/lib/spg/koreksi-queries";
import { potonganLainPadaPembayaran } from "@/lib/spg/utang-queries";

const angka = (v: unknown): number => Number(v ?? 0);

/**
 * Tahap siklus termasuk "menunggu pembayaran toko": tagihan siklus di Piutang belum dilunasi
 * BKM yang sudah diverifikasi. Tahap ini datang SESUDAH faktur pajak: nota dan faktur adalah
 * dasar toko membayar.
 */
export type TahapSiklusLengkap = TahapSiklus | "bayar_toko";

export function tahapLengkap(b: BahanTahap, tokoLunas: boolean): TahapSiklusLengkap {
  const t = tahapSiklus(b);
  return t === "selesai" && !tokoLunas ? "bayar_toko" : t;
}

/** Pembayaran toko dicocokkan dengan mutasi rekening — giliran keuangan. */
export function giliranTahapLengkap(t: TahapSiklusLengkap): ReturnType<typeof giliranTahap> {
  return t === "bayar_toko" ? "keuangan" : giliranTahap(t);
}

/** Total tagihan yang DIBEKUKAN saat mengunci: laku resmi − promo Elorae + beban hilang. */
export function totalTagihanBeku(c: {
  sold: { amount: unknown }[];
  promoBorneByElorae: unknown;
  lossChargedToStore: unknown;
}): number {
  return totalTagihanKonsi({
    lakuResmi: c.sold.reduce((s, x) => s + angka(x.amount), 0),
    promoElorae: angka(c.promoBorneByElorae),
    bebanHilang: angka(c.lossChargedToStore),
  });
}

export type BarisSiklus = {
  id: string;
  noKonsi: string;
  storeId: string;
  storeName: string;
  periode: string;
  tahap: TahapSiklusLengkap;
  giliran: ReturnType<typeof giliranTahap>;
  nilaiTerjual: number;
  /** Sisa tagihan ke toko sesudah pembayaran. null selama belum dikunci. */
  sisaTagihan: number | null;
  noNota: string | null;
  noFakturPajak: string | null;
  tenggatSpg: string | null;
  /** Tenggat gaji SPG sudah lewat dan masih ada yang belum dibayar. */
  gajiTerlambat: boolean;
  /**
   * Buku stok toko vs laporan SPG vs laporan toko (bagian terjual saja), untuk
   * siklus yang belum dikunci. null = sudah dikunci, atau belum ada dua sumber
   * yang bisa dibandingkan.
   */
  penandaCocok: PenandaCocok | null;
};

function bahan(c: {
  reports: { source: string }[];
  lockedAt: Date | null;
  commissions: { paidAt: Date | null }[];
  noNota: string | null;
  noFakturPajak: string | null;
  vatApplied: boolean | null;
  store: { consignmentVat: boolean };
}) {
  const sumber = new Set(c.reports.map((r) => r.source));
  return {
    adaLaporanSpg: sumber.has('SPG'),
    adaLaporanToko: sumber.has('TOKO'),
    terkunci: c.lockedAt !== null,
    adaSpg: c.commissions.length > 0,
    semuaKomisiDibayar: c.commissions.every((k) => k.paidAt !== null),
    adaNota: Boolean(c.noNota),
    adaFakturPajak: Boolean(c.noFakturPajak),
    pakaiPpn: pakaiPpnSiklus(c),
  };
}

/**
 * Tagihan konsinyasi siklus memakai PPN: yang DIBEKUKAN saat dikunci
 * (`vatApplied`), sebelum itu sakelar toko sekarang (`Store.consignmentVat`).
 */
export function pakaiPpnSiklus(c: { vatApplied: boolean | null; store: { consignmentVat: boolean } }): boolean {
  return c.vatApplied ?? c.store.consignmentVat;
}

const BULAN = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

/** Daftar siklus, yang perlu dikerjakan lebih dulu. */
export async function daftarSiklus(): Promise<BarisSiklus[]> {
  const rows = await prisma.consignmentCycle.findMany({
    orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }],
    select: {
      id: true,
      noKonsi: true,
      storeId: true,
      periodYear: true,
      periodMonth: true,
      spgDueDate: true,
      noNota: true,
      noFakturPajak: true,
      lockedAt: true,
      promoBorneByElorae: true,
      lossChargedToStore: true,
      vatApplied: true,
      store: { select: { name: true, consignmentVat: true } },
      reports: { select: { source: true } },
      commissions: { select: { paidAt: true } },
      sold: { select: { amount: true } },
      receivables: { where: { status: { not: "VOIDED" } }, select: { id: true } },
    },
  });

  const sekarang = new Date();
  const sisaPiutang = await sisaTagihanSiklus(rows.flatMap((c) => c.receivables.map((r) => r.id)));
  const URUT: TahapSiklusLengkap[] = ['laporan', 'cocok', 'bayar_spg', 'nota', 'pajak', 'bayar_toko', 'selesai'];
  const penanda = await penandaTerjualSiklus(rows.filter((c) => c.lockedAt === null));

  return rows
    .map((c) => {
      const bayar = pelunasanSiklus(c.lockedAt !== null, c.receivables[0]?.id ?? null, totalTagihanBeku(c), sisaPiutang);
      const tahap = tahapLengkap(bahan(c), bayar.lunas);
      return {
        id: c.id,
        noKonsi: c.noKonsi,
        storeId: c.storeId,
        storeName: c.store.name,
        periode: `${BULAN[c.periodMonth - 1]} ${c.periodYear}`,
        tahap,
        giliran: giliranTahapLengkap(tahap),
        nilaiTerjual: c.sold.reduce((s, x) => s + angka(x.amount), 0),
        sisaTagihan: bayar.sisa,
        noNota: c.noNota,
        noFakturPajak: c.noFakturPajak,
        tenggatSpg: c.spgDueDate?.toISOString() ?? null,
        /*
         * Gaji SPG punya tenggatnya sendiri justru supaya ia tidak lagi kalah
         * oleh pekerjaan bertenggat lain. Penandanya ikut dihitung di sini agar
         * daftar bisa menonjolkannya tanpa membaca ulang.
         */
        gajiTerlambat:
          c.spgDueDate !== null &&
          c.spgDueDate < sekarang &&
          c.commissions.some((k) => k.paidAt === null),
        penandaCocok: penanda.get(c.id) ?? null,
      };
    })
    .sort(
      (a, b) =>
        Number(b.gajiTerlambat) - Number(a.gajiTerlambat) ||
        URUT.indexOf(a.tahap) - URUT.indexOf(b.tahap),
    );
}

export type RincianSiklus = {
  baris: BarisSiklus;
  terkunci: boolean;
  dikunciOleh: string | null;
  dikunciPada: string | null;
  laporanSpg: { itemName: string; itemId: string | null; qty: number }[] | null;
  laporanToko: { itemName: string; itemId: string | null; qty: number }[] | null;
  banding: BarisBanding[];
  /** `komisiPerPcs`: tarif kategori yang berlaku saat dikunci, disalin sebagai riwayat. */
  resmi: { itemId: string | null; itemName: string; qty: number; price: number; amount: number; komisiPerPcs: number }[];
  /**
   * Bulan komisi SPG siklus ini: penjualannya (bulan siklus) dan pembayarannya — bulan WIB saat
   * angkanya dikunci, yaitu saat kantor mengecek laporannya; null selama belum/tidak dikunci.
   */
  komisiBulan: { bulanJual: string; bulanBayar: string | null };
  komisi: {
    id: string;
    spgNama: string | null;
    gajiPokok: number;
    /** Rincian gaji pokok: yang tersimpan saat dibayar, atau yang sekarang kalau belum dibayar. */
    gaji: RincianGaji | null;
    /** Seluruh pembayaran baris ini menunggu dasar gajinya (P60) — tanpa rupiah. */
    tahan: { alasan: AlasanTahanBayar; hari: string[] } | null;
    komisi: number;
    total: number;
    /** Beban barang hilang yang dipotong saat DIBAYAR (penuh, P11a). */
    potonganHilang: number;
    dibayarPada: string | null;
    /**
     * Beban selisih retur yang masih ditanggung orang ini.
     *
     * Brief bilang penagihannya "bisa dipotong dari komisi" — BISA, bukan
     * harus. Jadi angka ini TIDAK dikurangkan otomatis dari totalnya:
     * ditampilkan di layar pembayaran supaya admin tahu, dan keputusannya
     * tetap miliknya. Tanpa ini, komisi dibayar penuh sementara bebannya
     * menganggur di layar lain yang tidak pernah dibuka bersamaan.
     */
    bebanTerbuka: number;
    /**
     * Yang AKAN dibayarkan baris yang belum dibayar di siklus terkunci — komisi per SPG sekarang,
     * potongan, koreksi yang ikut (`lib/spg/koreksi.ts`); sama dengan yang dibayar penulis. Null
     * untuk baris yang sudah dibayar atau siklus yang belum dikunci.
     */
    bayar: RencanaBayarKomisi | null;
    /** Koreksi gaji & komisi bulan lain yang diterapkan pada baris yang sudah dibayar. */
    koreksiDiterapkan: { bulanJual: string; toko: string; jumlah: number; gaji: number }[];
    /** Yang dibayarkan baris yang sudah dibayar: total − pengurang + koreksi; null kalau belum dibayar. */
    dibayarkan: number | null;
  }[];
  /** Retur pembeli bulan siklus ini yang masih menunggu persetujuan kantor. */
  komisiReturMenunggu: number;
  /**
   * Stok barang yang sekarang ada di toko, per barang × ukuran — hitungan yang
   * sama dengan halaman toko (`stokDiToko`): buku stok SPG kalau ada, kalau
   * tidak titipan (dikirim − terjual resmi semua bulan − diretur). `perkiraan`:
   * terjual per barang dibagi ke ukuran.
   */
  stokToko: {
    sumber: SumberStokToko;
    baris: {
      itemId: string;
      variantSku: string;
      nama: string;
      sku: string;
      varian: string | null;
      sisa: number;
      perkiraan: boolean;
    }[];
  };
  pengiriman: { id: string; noKirim: string; tanggal: string; nilai: number; jumlahBaris: number }[];
  /** Buku stok toko vs laporan laku konsinyasi, per barang. */
  pencocokan: PencocokanSiklus;
  tagihan: TagihanSiklus;
  pelunasan: PelunasanToko;
  /** Bulan siklus sudah selesai (WIB) — baru boleh dikunci (P30). */
  bulanSelesai: boolean;
  /** Gerbang bulan siklus pertama (P59). */
  siklusPertama: "BELUM_DIATUR" | "SEBELUM" | "OK";
  /** Toko punya salesman pemegang — penagih tagihan siklusnya (P47). */
  adaPemegang: boolean;
  tempoHari: number;
  /**
   * Potong yang dijual SPG bulan itu tanpa kategori barang, per barang — ditampilkan di dialog
   * kunci: komisinya menyusul begitu kategorinya diisi (P69), tidak menahan kunci. Kosong sesudah
   * dikunci (dihitung hanya selama belum dikunci).
   */
  tanpaKategori: { itemId: string; nama: string; potong: number }[];
};

/**
 * Ringkasan tagihan ke toko: laku resmi − potongan promo ditanggung Elorae +
 * beban barang hilang ke toko. Sebelum dikunci hanya potongan promo yang ada
 * (dihitung langsung dari nota); sesudahnya ketiganya dibekukan di siklus.
 */
export type TagihanSiklus = {
  beku: boolean;
  /** Tagihan memakai PPN (dibekukan saat dikunci; sebelum itu sakelar toko). */
  pakaiPpn: boolean;
  /** Σ angka resmi. null selama belum dikunci. */
  lakuResmi: number | null;
  /** Dibekukan saat dikunci; sebelum itu dihitung langsung. */
  promoElorae: number;
  /** Dihitung dari nota SPG sekarang — pembanding untuk angka yang dibekukan. */
  promoEloraeSekarang: number;
  /** Ditetapkan saat mengunci. null selama belum dikunci. */
  bebanHilang: number | null;
  /** null selama belum dikunci. */
  total: number | null;
};

/** Tagihan siklus di Piutang (lahir saat angka resminya dikunci) dan BKM yang menautkannya. */
export type TagihanPiutangSiklus = {
  receivableId: string;
  invoiceNo: string;
  invoiceDate: string;
  dueDate: string;
  amount: number;
  sisa: number;
  keadaanTampil: KeadaanTampil;
  penjual: string | null;
  bkm: { id: string; docNo: string; status: StatusKlaim; dilunasi: number; tanggal: string }[];
  /** Yang menghalangi membuka kunci (tagihan sudah disentuh uang toko); null kalau bersih. */
  penghalangBuka: KodePenghalangBatal | null;
};

/** Pelunasan tagihan siklus — lewat BKM di Piutang. */
export type PelunasanToko = {
  /** Sisa tagihan; null selama belum dikunci. */
  sisa: number | null;
  lunas: boolean;
  tagihan: TagihanPiutangSiklus | null;
};

/** Sisa setiap tagihan siklus menurut Piutang (dihitung ulang, bukan kolom cache). */
async function sisaTagihanSiklus(ids: readonly string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const baris = await daftarPiutang({ receivableIds: [...ids] });
  return new Map(baris.map((b) => [b.id, b.outstanding]));
}

/** Belum dikunci → null; ada tagihan hidup → sisanya; tanpa tagihan (total nol) → sisa total beku, tidak negatif. */
function pelunasanSiklus(terkunci: boolean, receivableId: string | null, totalBeku: number, sisaPer: ReadonlyMap<string, number>): { sisa: number | null; lunas: boolean } {
  if (!terkunci) return { sisa: null, lunas: false };
  const sisa = receivableId ? (sisaPer.get(receivableId) ?? totalBeku) : Math.max(0, totalBeku);
  return { sisa, lunas: sisa <= 0 };
}

/** Satu siklus, kedua laporannya, angka resminya, komisinya, dan stok titipannya. */
export async function rincianSiklus(id: string): Promise<RincianSiklus | null> {
  const c = await prisma.consignmentCycle.findUnique({
    where: { id },
    select: {
      id: true,
      noKonsi: true,
      storeId: true,
      periodYear: true,
      periodMonth: true,
      spgDueDate: true,
      noNota: true,
      noFakturPajak: true,
      lockedAt: true,
      promoBorneByElorae: true,
      lossChargedToStore: true,
      vatApplied: true,
      store: { select: { name: true, consignmentVat: true, salesmanId: true, paymentTempo: true } },
      lockedBy: { select: { name: true } },
      reports: {
        select: {
          source: true,
          items: { select: { itemName: true, itemId: true, qty: true } },
        },
      },
      sold: {
        select: {
          itemId: true,
          itemName: true,
          qty: true,
          price: true,
          amount: true,
          commissionPerPcs: true,
        },
      },
      commissions: {
        select: {
          id: true,
          spgUserId: true,
          baseSalary: true,
          commission: true,
          total: true,
          deduction: true,
          salaryDetail: true,
          paidAt: true,
          spgUser: { select: { name: true } },
        },
      },
      receivables: { where: { status: { not: "VOIDED" } }, select: { id: true } },
    },
  });
  if (!c) return null;

  // Daftar pengiriman dicari lewat TOKO, bukan lewat siklus: barang bisa
  // dikirim sebelum siklus bulan itu dibuka.
  const kirim = await prisma.consignmentShipment.findMany({
    where: { storeId: c.storeId },
    orderBy: { shippedAt: 'desc' },
    select: {
      id: true,
      noKirim: true,
      shippedAt: true,
      items: { select: { amount: true } },
    },
  });

  /*
   * Beban selisih retur yang masih ditanggung orang-orang di siklus ini.
   *
   * Dikumpulkan HANYA untuk penerima komisi di siklus ini — bukan seluruh
   * beban terbuka di perusahaan. Beban yang sudah `LUNAS` tidak ikut: yang
   * sudah dibayar tidak boleh muncul lagi sebagai peringatan.
   */
  const idPenerima = c.commissions.map((k) => k.spgUserId);
  const beban = idPenerima.length
    ? await prisma.returnCharge.findMany({
        where: {
          bearerUserId: { in: idPenerima },
          status: { not: 'LUNAS' },
        },
        select: { bearerUserId: true, amount: true },
      })
    : [];
  const bebanPerOrang = new Map<string, number>();
  for (const b of beban) {
    if (!b.bearerUserId) continue;
    bebanPerOrang.set(b.bearerUserId, (bebanPerOrang.get(b.bearerUserId) ?? 0) + angka(b.amount));
  }

  /*
   * Gaji & komisi: yang belum dibayar dibayar dengan komisi per SPG SEKARANG (keputusan pemilik
   * 2026-11-02) — rencana yang sama dengan penulisnya, jadi layar ini dan Komisi SPG menyebut
   * angka yang sama dengan yang dibayar. Yang sudah dibayar membawa koreksi yang diterapkan padanya.
   */
  const bulanKomisi = `${c.periodYear}-${String(c.periodMonth).padStart(2, "0")}`;
  const belumDibayar = c.commissions.filter((k) => k.paidAt === null);
  // Callback bertipe: tanpa itu `refType` melebar ke string (TS2345 di koreksiPadaPembayaran).
  const refDibayar = c.commissions
    .filter((k) => k.paidAt !== null)
    .map((k): { refType: typeof REF_KOMISI_KONSI; refId: string } => ({ refType: REF_KOMISI_KONSI, refId: k.id }));
  const [petaUnit, terapanKonsi, lainDibayar, returMenunggu] = await Promise.all([
    c.lockedAt && belumDibayar.length > 0 ? unitKomisiSpg(prisma, belumDibayar.map((k) => k.spgUserId)) : Promise.resolve(new Map<string, UnitKomisiSpg[]>()),
    koreksiPadaPembayaran(prisma, refDibayar),
    potonganLainPadaPembayaran(prisma, refDibayar),
    returMenungguPerLaporan(prisma, [{ storeId: c.storeId, bulanJual: bulanKomisi }]),
  ]);
  const konteks = await konteksBayarSpg(prisma, petaUnit);
  const rencana = new Map<string, RencanaBayarKomisi>();
  for (const [userId, units] of petaUnit) for (const [refId, r] of rencanaBayarSemua(units, konteks.get(userId))) rencana.set(refId, r);
  const unitPerRef = new Map<string, UnitKomisiSpg>();
  for (const units of petaUnit.values()) for (const u of units) if (u.baris) unitPerRef.set(u.baris.refId, u);
  const tokoKoreksi = [...new Set([...terapanKonsi.values()].flat().map((x) => x.storeId))];
  const namaTokoKoreksi = new Map(
    (tokoKoreksi.length ? await prisma.store.findMany({ where: { id: { in: tokoKoreksi } }, select: { id: true, name: true } }) : []).map((t) => [t.id, t.name]),
  );

  const tagihanPiutang = await tagihanSiklusPiutang(c.receivables[0]?.id ?? null);
  const pertama = await muatBulanSiklusPertama(prisma);
  const tanpaKategoriMentah = c.lockedAt
    ? []
    : potongTanpaKategori({ movements: (await spgSaleMovements(prisma, [c.storeId], bulanKomisi)).get(c.storeId) ?? [] });
  const namaTanpaKategori = new Map(
    (tanpaKategoriMentah.length
      ? await prisma.item.findMany({ where: { id: { in: tanpaKategoriMentah.map((x) => x.itemId) } }, select: { id: true, nameId: true, sku: true } })
      : []
    ).map((i) => [i.id, i.nameId?.trim() || i.sku]),
  );

  const [stok, pencocokan, promoSekarang, penanda] = await Promise.all([
    stokDiToko(c.storeId),
    pencocokanSiklus(c.id),
    promoEloraeSiklus(prisma, { storeId: c.storeId, periodYear: c.periodYear, periodMonth: c.periodMonth }),
    c.lockedAt ? Promise.resolve(new Map<string, PenandaCocok | null>()) : penandaTerjualSiklus([c]),
  ]);
  if (!pencocokan) return null;
  const terkunci = c.lockedAt !== null;
  const lakuResmi = c.sold.reduce((s, x) => s + angka(x.amount), 0);
  const totalBeku = terkunci ? totalTagihanBeku(c) : null;
  const bayar = pelunasanSiklus(terkunci, tagihanPiutang?.receivableId ?? null, totalBeku ?? 0, new Map(tagihanPiutang ? [[tagihanPiutang.receivableId, tagihanPiutang.sisa]] : []));
  const tagihan: TagihanSiklus = terkunci
    ? {
        beku: true,
        pakaiPpn: pakaiPpnSiklus(c),
        lakuResmi,
        promoElorae: angka(c.promoBorneByElorae),
        promoEloraeSekarang: promoSekarang.total,
        bebanHilang: angka(c.lossChargedToStore),
        total: totalBeku,
      }
    : {
        beku: false,
        pakaiPpn: pakaiPpnSiklus(c),
        lakuResmi: null,
        promoElorae: promoSekarang.total,
        promoEloraeSekarang: promoSekarang.total,
        bebanHilang: null,
        total: null,
      };

  const spg = c.reports.find((r) => r.source === 'SPG')?.items ?? null;
  const toko = c.reports.find((r) => r.source === 'TOKO')?.items ?? null;
  const tahap = tahapLengkap(bahan({ ...c, commissions: c.commissions }), bayar.lunas);

  return {
    baris: {
      id: c.id,
      noKonsi: c.noKonsi,
      storeId: c.storeId,
      storeName: c.store.name,
      periode: `${BULAN[c.periodMonth - 1]} ${c.periodYear}`,
      tahap,
      giliran: giliranTahapLengkap(tahap),
      nilaiTerjual: c.sold.reduce((s, x) => s + angka(x.amount), 0),
      sisaTagihan: bayar.sisa,
      noNota: c.noNota,
      noFakturPajak: c.noFakturPajak,
      tenggatSpg: c.spgDueDate?.toISOString() ?? null,
      gajiTerlambat:
        c.spgDueDate !== null &&
        c.spgDueDate < new Date() &&
        c.commissions.some((k) => k.paidAt === null),
      penandaCocok: penanda.get(c.id) ?? null,
    },
    terkunci,
    dikunciOleh: c.lockedBy?.name ?? null,
    dikunciPada: c.lockedAt?.toISOString() ?? null,
    laporanSpg: spg,
    laporanToko: toko,
    banding: bandingkanLaporan(spg ?? [], toko ?? []),
    resmi: c.sold.map((s) => ({
      itemId: s.itemId,
      itemName: s.itemName,
      qty: s.qty,
      price: angka(s.price),
      amount: angka(s.amount),
      komisiPerPcs: angka(s.commissionPerPcs),
    })),
    komisiBulan: {
      bulanJual: `${c.periodYear}-${String(c.periodMonth).padStart(2, "0")}`,
      bulanBayar: c.lockedAt ? payoutMonth(c.lockedAt) : null,
    },
    komisi: c.commissions.map((k) => {
      const dibayar = k.paidAt !== null;
      const u = unitPerRef.get(k.id);
      const tersimpan = bacaDetailGaji(k.salaryDetail);
      const gajiSekarang = !dibayar && u?.gaji?.ok ? u.gaji.rincian : null;
      const lain = lainDibayar.get(k.id) ?? { retur: 0, utang: 0, kembali: 0 };
      return {
      id: k.id,
      spgNama: k.spgUser?.name ?? null,
      gajiPokok: angka(k.baseSalary),
      gaji: dibayar ? (tersimpan?.jenis === "RINCIAN" ? tersimpan.rincian : null) : gajiSekarang,
      tahan: !dibayar && u?.gaji && !u.gaji.ok ? { alasan: u.gaji.alasan, hari: u.gaji.hari } : null,
      komisi: angka(k.commission),
      total: angka(k.total),
      potonganHilang: angka(k.deduction),
      dibayarPada: k.paidAt?.toISOString() ?? null,
      bebanTerbuka: bebanPerOrang.get(k.spgUserId) ?? 0,
      bayar: k.paidAt === null && c.lockedAt ? (rencana.get(k.id) ?? null) : null,
      koreksiDiterapkan: (terapanKonsi.get(k.id) ?? []).map((x) => ({
        bulanJual: x.bulanJual,
        toko: namaTokoKoreksi.get(x.storeId) ?? x.storeId,
        jumlah: x.jumlah,
        gaji: x.gaji,
      })),
      dibayarkan: dibayar
        ? Math.round(
            (Math.max(0, angka(k.total) - angka(k.deduction) - lain.retur - lain.utang) +
              lain.kembali +
              (terapanKonsi.get(k.id) ?? []).reduce((n, x) => n + x.jumlah, 0)) *
              100,
          ) / 100
        : null,
      };
    }),
    komisiReturMenunggu: returMenunggu.get(kunciReturMenunggu(c.storeId, bulanKomisi)) ?? 0,
    stokToko: {
      sumber: stok.source,
      baris: stok.baris.map((b) => ({
        itemId: b.itemId,
        variantSku: b.variantSku,
        nama: b.nama,
        sku: b.sku,
        varian: b.varian,
        sisa: b.qty,
        perkiraan: b.perkiraan,
      })),
    },
    pengiriman: kirim.map((k) => ({
      id: k.id,
      noKirim: k.noKirim,
      tanggal: k.shippedAt.toISOString(),
      nilai: k.items.reduce((s, i) => s + angka(i.amount), 0),
      jumlahBaris: k.items.length,
    })),
    pencocokan,
    tagihan,
    pelunasan: { sisa: bayar.sisa, lunas: bayar.lunas, tagihan: tagihanPiutang },
    bulanSelesai: bulanSudahSelesai(bulanKomisi, bulanWib(new Date())),
    siklusPertama: !pertama.diatur ? "BELUM_DIATUR" : sebelumSiklusPertama(bulanKomisi, pertama.bulan) ? "SEBELUM" : "OK",
    adaPemegang: c.store.salesmanId !== null,
    tempoHari: c.store.paymentTempo,
    tanpaKategori: tanpaKategoriMentah.map((x) => ({ itemId: x.itemId, nama: namaTanpaKategori.get(x.itemId) ?? x.itemId, potong: x.potong })),
  };
}

/** Tagihan siklus di Piutang dengan BKM-nya dan penghalang membuka kunci. */
async function tagihanSiklusPiutang(receivableId: string | null): Promise<TagihanPiutangSiklus | null> {
  if (!receivableId) return null;
  const [baris, tautan, penghalang] = await Promise.all([
    daftarPiutang({ receivableIds: [receivableId] }),
    prisma.paymentClaimReceivable.findMany({
      where: { receivableId },
      select: { settledAmount: true, paymentClaim: { select: { id: true, docNo: true, status: true, claimedTransferAt: true } } },
    }),
    penghalangBatalPiutang(prisma, receivableId),
  ]);
  const b = baris[0];
  if (!b) return null;
  return {
    receivableId,
    invoiceNo: b.invoiceNo,
    invoiceDate: b.invoiceDate,
    dueDate: b.dueDate,
    amount: b.amount,
    sisa: b.outstanding,
    keadaanTampil: b.keadaanTampil,
    penjual: b.salesmanName,
    bkm: tautan.map((t) => ({
      id: t.paymentClaim.id,
      docNo: t.paymentClaim.docNo,
      status: t.paymentClaim.status as StatusKlaim,
      dilunasi: angka(t.settledAmount),
      tanggal: t.paymentClaim.claimedTransferAt.toISOString(),
    })),
    penghalangBuka: penghalang,
  };
}

/** Toko konsinyasi, untuk membuka siklus atau mengirim titipan. */
export async function tokoKonsi(): Promise<{ id: string; name: string }[]> {
  return prisma.store.findMany({
    where: { isActive: true, termsType: 'KONSI' },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });
}
