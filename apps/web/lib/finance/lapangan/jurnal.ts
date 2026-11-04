import { prisma, type Prisma, type PrismaClient } from "@elorae/db";
import { generateAutoJournal } from "@/lib/finance/journal";
import { KANAL_JURNAL } from "@/lib/finance/journals/kanal";
import { bacaPengaturanPpn } from "@/lib/finance/pajak/ppn-pengaturan";
import { readGlCutover } from "@/lib/finance/sales/sweep";
import { receivablesBookedOnAr } from "@/lib/finance/ar/store-receivable-role";
import { nilaiFisikNota, potonganRetur } from "@/lib/receivables/deductions";
import { hppJualTerakhir } from "@/lib/receivables/hpp-retur";
import { returTertahan } from "@/lib/receivables/rules";
import {
  barisFaktur,
  barisKlaim,
  barisNota,
  barisRetur,
  barisTukar,
  fakturDijurnalSendiri,
  gabungBaris,
  keBarisJurnal,
  kunciStokPengiriman,
  kunciStokPersetujuan,
  kunciStokReturMasuk,
  nilaiFakturDijurnal,
  nilaiReturBukuBesar,
  peranPotongan,
  SUMBER_LAPANGAN,
  SUMBER_NOTA_LAMA,
  tanggalJurnalKlaim,
  type BarisBertanda,
  type NilaiReturBukuBesar,
  type SumberLapangan,
} from "./aturan";
import { selaraskanJurnal, type HasilSelaras, type SasaranDokumen } from "./selaras";

/*
 * Penulis jurnal penjualan lapangan & piutang toko — KHUSUS SERVER. Aturannya
 * di `aturan.ts`. Dipanggil SESUDAH dokumennya di-commit (lewat `kait.ts`,
 * sapuan, atau tombol posting ulang); tidak pernah dari dalam transaksi
 * dokumen, dan tidak pernah mengubah logika uang modul piutang — hanya membaca
 * hasilnya.
 *
 * GERBANG TANGGAL MULAI. Dokumen yang tanggalnya sebelum `finance.glCutoverDate`
 * sudah tercakup saldo awal (piutang toko awal = sisa modul per tanggal mulai),
 * jadi tidak dijurnal lagi; tanpa tanggal mulai tidak ada yang dijurnal (sama
 * dengan sapuan penjualan marketplace). Dokumen yang sudah berjurnal tetap
 * diselaraskan walau tanggal mulai digeser kemudian.
 */

type Klien = PrismaClient | Prisma.TransactionClient;

export type KodeGagalLapangan =
  | "UNMAPPED_ROLE"
  | "UNBALANCED"
  /** Nilai nol — tidak ada yang dijurnal. */
  | "NOTHING_TO_POST"
  /** Belum boleh dijurnal: sebelum tanggal mulai buku besar, atau belum final. */
  | "BELUM_BERLAKU"
  | "GL_CUTOVER_NOT_CONFIGURED"
  /** Biaya barang yang keluar tidak ditemukan di kartu stok (nota lama tanpa penyesuaian stok). */
  | "BIAYA_TIDAK_DIKETAHUI";

export type HasilJurnalLapangan =
  | { ok: true; journalId: string | null; created: boolean }
  | { ok: false; code: KodeGagalLapangan; role?: string; detail?: string };

/** Kode yang bukan kegagalan — tidak menulis `JOURNAL_PENDING`. */
export const KODE_BUKAN_GAGAL: ReadonlySet<KodeGagalLapangan> = new Set(["NOTHING_TO_POST", "BELUM_BERLAKU", "GL_CUTOVER_NOT_CONFIGURED"]);

const angka = (v: unknown): number => Number(v ?? 0);

/** Dokumen bertanggal `tanggal` boleh dijurnal pertama kali? */
function bolehMulai(mulai: Date | null, tanggal: Date): boolean {
  return mulai !== null && tanggal.getTime() >= mulai.getTime();
}

function dariSelaras(r: HasilSelaras, adaCutover: boolean): HasilJurnalLapangan {
  if (r.ok) return { ok: true, journalId: r.journalId, created: r.berubah };
  if (r.code === "BELUM_BERLAKU") return { ok: false, code: adaCutover ? "BELUM_BERLAKU" : "GL_CUTOVER_NOT_CONFIGURED" };
  return { ok: false, code: r.code, ...(r.role ? { role: r.role } : {}) };
}

// ── Nota tagihan putus (diselaraskan) ───────────────────────────────────────

// Kunci penyesuaian stok tinggal di `aturan.ts` (murni) — dipakai juga penilai HPP retur.
export { kunciStokPengiriman, kunciStokPersetujuan };

export type BahanNota = {
  docNo: string;
  storeId: string;
  storeName: string;
  invoiceDate: Date;
  total: number;
  putus: boolean;
  /** Nota dibatalkan ("tidak jadi dikirim", P16/P25): jurnalnya bersasaran kosong. */
  voidedAt: Date | null;
  hpp: { tipeBarang: string | null; nilai: number }[];
  /** Baris yang biaya keluarnya tidak ditemukan. */
  tanpaBiaya: string[];
};

/**
 * Biaya yang keluar = qty yang DITAGIH di baris nota × harga rata-rata yang dipakai penyesuaian
 * stok saat surat jalan dibuat (`prevAvgCost`) — nilai yang turun di kartu stok untuk barang yang
 * tinggal di toko. Barang yang ditolak di pintu atau hilang di jalan sudah tidak di `qty` baris
 * (`returnedQty`/`lostQty`): yang ditolak kembali ke gudang dengan biaya yang sama
 * (`reopenFieldSalesLineStock`), yang hilang dijurnal barang hilang. Nota backfill (dari konsumsi
 * saat disetujui) memakai harga per unit penyesuaian persetujuan.
 */
export async function bacaBahanNota(client: Klien, deliveryId: string): Promise<BahanNota | null> {
  const d = await client.fieldSalesDelivery.findUnique({
    where: { id: deliveryId },
    select: {
      docNo: true,
      invoiceDate: true,
      total: true,
      voidedAt: true,
      order: { select: { orderNo: true, orderType: true, storeId: true, store: { select: { name: true } } } },
      lines: { select: { orderLineId: true, qty: true, productName: true, item: { select: { type: true } } } },
    },
  });
  if (!d) return null;
  const kunci = d.lines.flatMap((l) => [
    kunciStokPengiriman(d.order.orderNo, deliveryId, l.orderLineId),
    kunciStokPersetujuan(d.order.orderNo, l.orderLineId),
  ]);
  const penyesuaian = kunci.length
    ? await client.stockAdjustment.findMany({ where: { idempotencyKey: { in: kunci } }, select: { idempotencyKey: true, prevAvgCost: true } })
    : [];
  const perKunci = new Map(penyesuaian.map((p) => [p.idempotencyKey!, p]));
  const hpp: BahanNota["hpp"] = [];
  const tanpaBiaya: string[] = [];
  for (const l of d.lines) {
    const biaya =
      perKunci.get(kunciStokPengiriman(d.order.orderNo, deliveryId, l.orderLineId)) ??
      perKunci.get(kunciStokPersetujuan(d.order.orderNo, l.orderLineId));
    if (biaya) {
      hpp.push({ tipeBarang: l.item.type, nilai: l.qty * angka(biaya.prevAvgCost) });
      continue;
    }
    if (l.qty > 0) tanpaBiaya.push(l.productName);
  }
  return {
    docNo: d.docNo,
    storeId: d.order.storeId,
    storeName: d.order.store.name,
    invoiceDate: d.invoiceDate,
    total: angka(d.total),
    putus: d.order.orderType === "PUTUS",
    voidedAt: d.voidedAt,
    hpp,
    tanpaBiaya,
  };
}

/**
 * Pembagian PPN nota yang sudah terposting (sen, Σ semua generasinya): piutang toko dan PPN
 * keluaran (positif). Null bila belum ada piutang terposting. Dibekukan sejak jurnal pertama,
 * seperti `rusakTerposting`/`hppTerposting` retur: pengaturan PPN yang diubah kemudian tidak
 * menggeser PPN nota yang sudah dijurnal.
 */
function ppnNotaTerposting(terposting: readonly BarisBertanda[]): { arSen: number; ppnSen: number } | null {
  const arSen = terposting.filter((b) => b.role === "AR_STORE").reduce((s, b) => s + b.sen, 0);
  if (arSen <= 0) return null;
  const ppnSen = -terposting.filter((b) => b.role === "PPN_KELUARAN").reduce((s, b) => s + b.sen, 0);
  return { arSen, ppnSen };
}

/**
 * Sasaran jurnal nota SEKARANG, atau jawaban tanpa penyelarasan: nota yang memegang pasangan
 * bentuk lama (`SUMBER_NOTA_LAMA`), yang bukan nota putus, yang dibatalkan sebelum pernah
 * dijurnal (selaras tanpa jurnal), atau yang biaya keluarnya tidak ditemukan
 * (`BIAYA_TIDAK_DIKETAHUI`). Satu penyusun untuk penyelarasnya (`selaraskanJurnalNota`) dan
 * pencari nota yang tertinggal (`cariNotaTertinggal`), jadi keduanya tidak pernah berbeda pendapat.
 */
export async function susunJurnalNota(
  client: Klien,
  deliveryId: string,
  mulai: Date | null,
  terposting: readonly BarisBertanda[],
): Promise<{ jawab: HasilJurnalLapangan } | SasaranDokumen> {
  const pasanganLama = await client.journal.count({
    where: { sourceId: deliveryId, sourceType: { in: [SUMBER_NOTA_LAMA.PENDAPATAN, SUMBER_NOTA_LAMA.HPP] } },
  });
  if (pasanganLama > 0) return { jawab: { ok: false, code: "NOTHING_TO_POST" } };
  const b = await bacaBahanNota(client, deliveryId);
  if (!b || !b.putus) return { jawab: { ok: false, code: "NOTHING_TO_POST" } };
  const batal = b.voidedAt !== null;
  /*
   * Nota yang dibatalkan sebelum pernah dijurnal: tidak ada yang perlu dibalik, dan jurnalnya
   * SELARAS dengan keadaannya (kosong = kosong) — dijawab berhasil tanpa jurnal, bukan
   * `NOTHING_TO_POST`. Tanda `JOURNAL_PENDING` (`nota_putus`) dari percobaan sebelum batal
   * (peran belum dipetakan, biaya tidak ditemukan) hanya selesai lewat `readAt` penyelarasnya
   * (`FIELD_DELIVERY` bergenerasi, `jurnal-tertunda.ts`); tanpa jawaban berhasil tandanya
   * terhitung "Jurnal gagal" selamanya walau tidak ada jurnal yang bisa menutupnya.
   */
  if (batal && terposting.length === 0) return { jawab: { ok: true, journalId: null, created: false } };
  const boleh = !batal && bolehMulai(mulai, b.invoiceDate);
  if (!batal && b.tanpaBiaya.length > 0 && (boleh || terposting.length > 0)) {
    return { jawab: { ok: false, code: "BIAYA_TIDAK_DIKETAHUI", detail: b.tanpaBiaya.join(", ") } };
  }
  return {
    sasaran: batal
      ? []
      : barisNota({
          total: b.total,
          storeId: b.storeId,
          tanggal: b.invoiceDate,
          pengaturanPpn: await bacaPengaturanPpn(client),
          hpp: b.hpp,
          ppnTerposting: ppnNotaTerposting(terposting),
        }),
    bolehMulai: boleh,
    tanggal: b.invoiceDate,
    deskripsi: `Nota tagihan ${b.docNo} — ${b.storeName}${batal ? " (dibatalkan)" : ""}`,
  };
}

/**
 * Jurnal nota tagihan satu pengiriman — satu-satunya jurnal piutang, pendapatan, PPN, dan HPP
 * sebuah nota putus. BERGENERASI (`<deliveryId>`, `<deliveryId>#2`, …): sasarannya `barisNota`
 * nota SEKARANG, jadi nota yang dikoreksi (ditolak sebagian di pintu, hilang di jalan) memposting
 * selisihnya, dan nota yang dibatalkan bersasaran kosong — generasinya membalik seluruhnya.
 * Generasi pertama hanya sejak tanggal mulai buku besar (tanggal nota); generasi berikutnya
 * bertanggal saat nota berubah (`voidedAt`/`correctedAt`), dan memegang pembagian PPN yang sudah
 * terposting (`ppnNotaTerposting`), bukan pengaturan PPN hari ini.
 *
 * Nota yang sudah memegang jurnal bentuk lama (`SUMBER_NOTA_LAMA`) dijawab `NOTHING_TO_POST` dan
 * tidak disentuh: jurnal `FIELD_DELIVERY` di atasnya mengakui nota yang sama dua kali.
 * Pemeriksaannya di sini, di dalam transaksi penyelaras, bukan di pemanggil, karena pintunya
 * banyak (kait pasca-commit, sapuan harian, "Selaraskan" per toko, posting ulang dari
 * rekonsiliasi, tombol posting ulang di halaman piutang).
 *
 * Dibaca dan diposting dalam SATU transaksi serializable (`selaraskanJurnal`) yang membaca baris
 * pengirimannya. Koreksi tanggal nota (`updateDeliveryDatesAction`) menulis baris yang sama lalu
 * memindahkan tanggal jurnal nota di transaksinya sendiri, jadi keduanya berurutan.
 */
export async function selaraskanJurnalNota(deliveryId: string, postedById: string): Promise<HasilJurnalLapangan> {
  const mulai = await readGlCutover();
  const ubah = await prisma.fieldSalesDelivery.findUnique({ where: { id: deliveryId }, select: { voidedAt: true, correctedAt: true } });
  /* Jawaban yang bukan hasil penyelarasan; diatur ulang di setiap percobaan transaksinya. */
  const keadaan: { jawab: HasilJurnalLapangan | null } = { jawab: null };
  const r = await selaraskanJurnal({
    sourceType: SUMBER_LAPANGAN.NOTA,
    entityId: deliveryId,
    postedById,
    sekarang: ubah?.voidedAt ?? ubah?.correctedAt ?? undefined,
    susun: async (tx, terposting) => {
      keadaan.jawab = null;
      const hasil = await susunJurnalNota(tx, deliveryId, mulai, terposting);
      if (!("jawab" in hasil)) return hasil;
      keadaan.jawab = hasil.jawab;
      // Tanpa perubahan apa pun: sasaran = yang sudah terposting.
      return { sasaran: [...terposting], bolehMulai: false, tanggal: new Date(), deskripsi: `Nota tagihan ${deliveryId}` };
    },
  });
  if (keadaan.jawab) return keadaan.jawab;
  return dariSelaras(r, mulai !== null);
}

/** Nama lama pintu jurnal nota — sekarang penyelaras bergenerasi (`selaraskanJurnalNota`). */
export function postJurnalNota(deliveryId: string, postedById: string): Promise<HasilJurnalLapangan> {
  return selaraskanJurnalNota(deliveryId, postedById);
}

// ── Pelunasan BKM (diselaraskan) ────────────────────────────────────────────

type TautanFaktur = { receivableId: string; settledAmount: unknown };

/**
 * Bagian nilai faktur sebuah BKM (0–1) yang melunasi piutang di `ids` — piutang berjurnal bentuk
 * lama yang berdiri di AR (`receivablesBookedOnAr`), atau tagihan konsinyasi yang berdiri di
 * AR_CONSIGNMENT. Porsinya sama dengan cara modul piutang membagi satu klaim ke fakturnya
 * (`hitungSisaPiutang`: dilunasi faktur ini ÷ nilai faktur klaim).
 */
function porsiPiutang(nilaiFaktur: number, tautan: readonly TautanFaktur[], ids: ReadonlySet<string>): number {
  if (nilaiFaktur <= 0 || ids.size === 0) return 0;
  const dilunasi = tautan.filter((t) => ids.has(t.receivableId)).reduce((s, t) => s + angka(t.settledAmount), 0);
  return dilunasi / nilaiFaktur;
}

/**
 * Jurnal pelunasan BKM. Tagihan konsinyasi dilunasi lewat BKM juga (satu-satunya jalan bayar konsi
 * dari HP, 2026-10-29): bagian yang melunasinya dikredit ke AR_CONSIGNMENT toko itu, bukan
 * AR_STORE; tandanya `Receivable.isConsignment` di tagihannya, bukan syarat toko hari ini —
 * pelunasan faktur putus di toko yang belakangan pindah ke konsinyasi tetap ke AR_STORE.
 */
export async function selaraskanJurnalKlaim(claimId: string, postedById: string): Promise<HasilJurnalLapangan> {
  const mulai = await readGlCutover();
  const r = await selaraskanJurnal({
    sourceType: SUMBER_LAPANGAN.BKM,
    entityId: claimId,
    postedById,
    susun: async (tx) => {
      const k = await tx.paymentClaim.findUnique({
        where: { id: claimId },
        select: {
          docNo: true,
          status: true,
          method: true,
          storeId: true,
          invoiceAmount: true,
          receivedAmount: true,
          claimedTransferAt: true,
          verifiedAt: true,
          store: { select: { name: true } },
          receivableLinks: { select: { receivableId: true, settledAmount: true } },
          deductions: {
            select: { amount: true, storeReturnId: true, deductionType: { select: { postingRole: true, pkpOnly: true } } },
          },
        },
      });
      if (!k) return { sasaran: [], bolehMulai: false, tanggal: new Date(), deskripsi: `Pelunasan ${claimId}` };
      const terverifikasi = k.status === "TERVERIFIKASI";
      const diverifikasi = k.verifiedAt ?? new Date();
      const ids = k.receivableLinks.map((t) => t.receivableId);
      const lama = terverifikasi ? await receivablesBookedOnAr(tx, ids) : new Set<string>();
      // Dibaca terpisah, bukan lewat relasi: penunjuk menggantung (tagihannya tidak ada) dibaca bukan
      // konsinyasi, jadi kreditnya tetap ke AR_STORE seperti sebelumnya, dan tidak menggagalkan jurnalnya.
      const tagihanKonsi = new Set(
        terverifikasi && ids.length > 0
          ? (await tx.receivable.findMany({ where: { id: { in: ids }, isConsignment: true }, select: { id: true } })).map((r) => r.id)
          : [],
      );
      const konsi = new Set(ids.filter((id) => tagihanKonsi.has(id) && !lama.has(id)));
      const semuaKonsi = ids.length > 0 && ids.every((id) => tagihanKonsi.has(id));
      return {
        sasaran: barisKlaim({
          terverifikasi,
          cara: k.method,
          diterima: angka(k.receivedAmount),
          storeId: k.storeId,
          porsiAr: porsiPiutang(angka(k.invoiceAmount), k.receivableLinks, lama),
          porsiKonsi: porsiPiutang(angka(k.invoiceAmount), k.receivableLinks, konsi),
          kanalPotongan: semuaKonsi ? KANAL_JURNAL.KONSINYASI : KANAL_JURNAL.PUTUS,
          potongan: k.deductions.map((p) => ({
            nilai: angka(p.amount),
            // Penunjuk menggantung tetap retur: Aturan 2 menahannya penuh, jadi tidak pernah mengurangi piutang.
            retur: p.storeReturnId !== null,
            peran: peranPotongan(p.deductionType),
          })),
        }),
        bolehMulai: terverifikasi && bolehMulai(mulai, diverifikasi),
        tanggal: tanggalJurnalKlaim({ verifiedAt: diverifikasi, claimedTransferAt: k.claimedTransferAt, giro: k.method === "giro", mulai }),
        deskripsi: `Pelunasan ${k.docNo} — ${k.store.name}`,
      };
    },
  });
  return dariSelaras(r, mulai !== null);
}

// ── Retur toko (diselaraskan, per hitungan gudang/NRI) ──────────────────────

/** Kolom hitungan gudang yang menentukan nilai jurnal returnya. */
const PILIH_NRI = {
  id: true,
  noNri: true,
  status: true,
  storeId: true,
  physicalAmount: true,
  finalisedAt: true,
  createdAt: true,
  store: { select: { name: true, termsType: true } },
  storeReturn: {
    select: {
      id: true,
      noNrt: true,
      status: true,
      claimedAmount: true,
      storeId: true,
      store: { select: { name: true, termsType: true } },
      // Hitungan SUSULAN yang final menambah fisik nota ini (`nilaiFisikNota`, P22a).
      followUps: { where: { status: "FINAL" }, select: { physicalAmount: true } },
      charges: { select: { status: true, bearer: true } },
      deductions: {
        select: {
          amount: true,
          paymentClaim: { select: { status: true, invoiceAmount: true, receivableLinks: { select: { receivableId: true, settledAmount: true } } } },
        },
      },
    },
  },
} as const;

type BarisNri = Prisma.WarehouseReturnGetPayload<{ select: typeof PILIH_NRI }>;

export type NilaiRetur = {
  noNri: string;
  noNrt: string | null;
  storeId: string | null;
  storeName: string | null;
  konsinyasi: boolean;
  final: boolean;
  tanggal: Date;
  nilai: NilaiReturBukuBesar;
  /**
   * Bagian potongan diakui (`potonganDiakui`) yang melunasi faktur berjurnal
   * bentuk lama (debit AR): jurnal retur memindahnya dari AR_STORE ke AR.
   * Nol bila pembacanya tidak menanyakan peran fakturnya (`bacaNilaiReturBanyak`).
   */
  potonganPiutangLama: number;
};

/** Piutang yang dilunasi BKM terverifikasi yang memotong nota retur hitungan ini. */
function piutangDipotongRetur(nri: BarisNri): string[] {
  const nrt = nri.storeReturn && nri.storeReturn.status !== "BATAL" ? nri.storeReturn : null;
  if (!nrt || nri.status !== "FINAL") return [];
  return nrt.deductions.filter((p) => p.paymentClaim.status === "TERVERIFIKASI").flatMap((p) => p.paymentClaim.receivableLinks.map((t) => t.receivableId));
}

/**
 * Nilai jurnal retur satu hitungan gudang. Potongan atas notanya diterjemahkan
 * lewat penerjemah modul piutang (`potonganRetur` + `returTertahan`, fisik nota =
 * `nilaiFisikNota`: hitungan asli + setiap hitungan susulan yang final) — satu
 * penerjemah, bukan salinan. `lama` = piutang berjurnal bentuk lama di antara
 * yang dilunasi BKM-nya (`receivablesBookedOnAr`). Hitungan SUSULAN sendiri tidak
 * punya nota toko (`storeReturn` null), jadi jurnalnya hanya persediaan dan HPP.
 */
function nilaiDariBaris(nri: BarisNri, lama: ReadonlySet<string> = new Set()): NilaiRetur {
  const nrt = nri.storeReturn && nri.storeReturn.status !== "BATAL" ? nri.storeReturn : null;
  const toko = nri.store ?? nrt?.store ?? null;
  const final = nri.status === "FINAL";
  let potonganDiakui = 0;
  let potonganPiutangLama = 0;
  let nilaiFisik = 0;
  if (nrt && final) {
    const warehouseReturn = { physicalAmount: nri.physicalAmount, status: nri.status };
    const basis = {
      claimedAmount: nrt.claimedAmount,
      status: nrt.status,
      warehouseReturn,
      followUps: nrt.followUps,
      charges: nrt.charges.map((c) => ({ status: c.status, bearer: c.bearer })),
    };
    nilaiFisik = nilaiFisikNota({ warehouseReturn, followUps: nrt.followUps }) ?? 0;
    for (const p of nrt.deductions) {
      if (p.paymentClaim.status !== "TERVERIFIKASI") continue;
      const diakui = angka(p.amount) - returTertahan(potonganRetur([{ amount: p.amount, storeReturnId: nrt.id, storeReturn: basis }]));
      potonganDiakui += diakui;
      potonganPiutangLama += diakui * porsiPiutang(angka(p.paymentClaim.invoiceAmount), p.paymentClaim.receivableLinks, lama);
    }
  } else if (final) {
    nilaiFisik = angka(nri.physicalAmount);
  }
  return {
    noNri: nri.noNri,
    noNrt: nri.storeReturn?.noNrt ?? null,
    storeId: nri.storeId ?? nrt?.storeId ?? null,
    storeName: toko?.name ?? null,
    konsinyasi: toko?.termsType === "KONSI",
    final,
    tanggal: nri.finalisedAt ?? nri.createdAt,
    nilai: nilaiReturBukuBesar({
      nilaiFisik,
      nilaiKlaimNota: nrt ? angka(nrt.claimedAmount) : null,
      potonganDiakui,
    }),
    potonganPiutangLama,
  };
}

/** Nilai jurnal retur banyak hitungan gudang sekaligus (layar rekonsiliasi): satu kueri, bukan satu per dokumen. */
export async function bacaNilaiReturBanyak(client: Klien, nriIds: string[]): Promise<Map<string, NilaiRetur>> {
  const hasil = new Map<string, NilaiRetur>();
  if (nriIds.length === 0) return hasil;
  const rows = await client.warehouseReturn.findMany({ where: { id: { in: nriIds } }, select: PILIH_NRI });
  for (const r of rows) hasil.set(r.id, nilaiDariBaris(r));
  return hasil;
}

export type BahanRetur = NilaiRetur & {
  stokLayak: { tipeBarang: string | null; nilai: number }[];
  /** Barang rusak/kedaluwarsa ber-barang katalog: nilai masuk gudang rusak (HPP saat dijual, atau rata-rata). */
  rusak: number;
  /**
   * HPP yang dibalik atas SEMUA barang yang kembali (layak + rusak): HPP saat
   * barang itu dijual ke toko ini (`hppJualTerakhir`) untuk baris layak yang
   * biaya kartu stoknya diketahui per baris (`kunciStokReturMasuk`); selain itu
   * sebesar nilai masuknya. Selisihnya dengan nilai masuk = `INVENTORY_VARIANCE`.
   */
  hppKembali: number;
};

/** Data satu hitungan gudang untuk jurnalnya. */
export async function bacaBahanRetur(client: Klien, nriId: string): Promise<BahanRetur | null> {
  const nri = await client.warehouseReturn.findUnique({
    where: { id: nriId },
    select: { ...PILIH_NRI, items: { select: { id: true, itemId: true, variantSku: true, qty: true, condition: true } } },
  });
  if (!nri) return null;
  const nilai = nilaiDariBaris(nri, await receivablesBookedOnAr(client, piutangDipotongRetur(nri)));

  // Barang layak: penyesuaian stok yang ditulis hitungan ini (`masukkanKeStok`).
  const stok = nilai.final
    ? await client.stockAdjustment.findMany({
        where: { source: "STORE_RETURN_RECEIVE", reason: { startsWith: `Retur toko ${nri.noNri} — ` } },
        select: { qtyChange: true, prevAvgCost: true, idempotencyKey: true, item: { select: { type: true } } },
      })
    : [];
  const stokLayak = stok.map((s) => ({ tipeBarang: s.item.type, nilai: Math.abs(angka(s.qtyChange)) * angka(s.prevAvgCost) }));

  // Barang rusak: nilai gerakan masuk gudang barang rusak baris itu (`DamagedStockMovement.value`,
  // ditulis bersama hitungannya) — supaya buku besar = nilai gudang rusak; baris lama tanpa nilai:
  // biaya rata-rata barang × varian itu (varian persis, lalu baris tanpa varian, lalu varian mana pun).
  let rusak = 0;
  if (nilai.final) {
    const idRusak = nri.items.filter((i) => i.itemId && i.qty > 0 && i.condition !== "LAYAK").map((i) => i.id);
    const masukRusak = idRusak.length
      ? await client.damagedStockMovement.findMany({
          where: { kind: "MASUK_RETUR", refType: "WarehouseReturnItem", refId: { in: idRusak }, value: { not: null } },
          select: { refId: true, value: true },
        })
      : [];
    const nilaiMasuk = new Map(masukRusak.map((m) => [m.refId!, angka(m.value)]));
    for (const i of nri.items) {
      if (!i.itemId || !(i.qty > 0) || i.condition === "LAYAK") continue;
      const tercatat = nilaiMasuk.get(i.id);
      if (tercatat !== undefined) {
        rusak += tercatat;
        continue;
      }
      const varian = i.variantSku?.trim() ?? "";
      const baris =
        (varian ? await client.inventoryValue.findFirst({ where: { itemId: i.itemId, variantSku: varian }, select: { avgCost: true } }) : null) ??
        (await client.inventoryValue.findFirst({ where: { itemId: i.itemId, OR: [{ variantSku: null }, { variantSku: "" }] }, select: { avgCost: true } })) ??
        (await client.inventoryValue.findFirst({ where: { itemId: i.itemId }, select: { avgCost: true } }));
      rusak += i.qty * angka(baris?.avgCost);
    }
  }

  // HPP yang dibalik untuk barang layak: mulai dari nilai kartu stoknya, lalu setiap baris yang
  // biaya kartu stoknya diketahui (kunci per baris) DAN pernah dijual ke toko ini diganti HPP saat
  // dijual. Hitungan lama tanpa kunci per baris tetap sebesar nilai kartu stoknya (tanpa selisih).
  let hppLayak = stokLayak.reduce((s, x) => s + x.nilai, 0);
  if (nilai.final && nilai.storeId) {
    const perKunci = new Map(stok.filter((s) => s.idempotencyKey).map((s) => [s.idempotencyKey!, s]));
    const sebelum = nri.finalisedAt ?? nri.createdAt;
    for (const i of nri.items) {
      if (!i.itemId || !(i.qty > 0) || i.condition !== "LAYAK") continue;
      const masuk = perKunci.get(kunciStokReturMasuk(i.id));
      if (!masuk) continue;
      const hppJual = await hppJualTerakhir(client, { storeId: nilai.storeId, itemId: i.itemId, variantSku: i.variantSku, sebelum });
      if (hppJual === null) continue;
      const qty = Math.abs(angka(masuk.qtyChange));
      hppLayak += qty * hppJual - qty * angka(masuk.prevAvgCost);
    }
  }

  return {
    ...nilai,
    stokLayak,
    rusak,
    hppKembali: hppLayak + rusak,
  };
}

/** Biaya barang rusak yang sudah dijurnal untuk dokumen ini (dibekukan sejak jurnal pertama). */
function rusakTerposting(terposting: readonly BarisBertanda[]): number | null {
  const sen = gabungBaris(terposting.filter((b) => b.role === "INVENTORY_DAMAGED")).reduce((s, b) => s + b.sen, 0);
  return sen === 0 ? null : sen / 100;
}

/**
 * HPP yang sudah dibalik untuk dokumen ini (Σ kredit COGS di semua generasinya,
 * dibekukan sejak jurnal pertama seperti biaya barang rusak). Jurnal yang
 * diposting sebelum HPP-saat-dijual ada membawa HPP = nilai barang masuk, jadi
 * tetap tanpa selisih — tidak ada penyesuaian diam-diam atas jurnal lama.
 */
function hppTerposting(terposting: readonly BarisBertanda[]): number | null {
  const sen = gabungBaris(terposting.filter((b) => b.role === "COGS")).reduce((s, b) => s + b.sen, 0);
  return sen === 0 ? null : -sen / 100;
}

export async function selaraskanJurnalRetur(nriId: string, postedById: string): Promise<HasilJurnalLapangan> {
  const mulai = await readGlCutover();
  const r = await selaraskanJurnal({
    sourceType: SUMBER_LAPANGAN.RETUR,
    entityId: nriId,
    postedById,
    susun: async (tx, terposting) => {
      const b = await bacaBahanRetur(tx, nriId);
      if (!b) return { sasaran: [], bolehMulai: false, tanggal: new Date(), deskripsi: `Retur toko ${nriId}` };
      /*
       * Biaya barang rusak tidak tersimpan di gerakan gudang rusak, jadi dibaca
       * dari harga rata-rata saat jurnal PERTAMA dibuat lalu dibekukan: generasi
       * berikutnya (keputusan beban, BKM baru) tidak boleh menggeser persediaan
       * hanya karena harga rata-ratanya sudah berubah.
       */
      const beku = rusakTerposting(terposting);
      const hppBeku = hppTerposting(terposting);
      const sasaran = barisRetur({
        konsinyasi: b.konsinyasi,
        storeId: b.storeId,
        tanggal: b.tanggal,
        pengaturanPpn: await bacaPengaturanPpn(tx),
        nilai: b.nilai,
        stokLayak: b.stokLayak,
        nilaiRusak: beku ?? b.rusak,
        // HPP saat dijual (uji akuntansi 2, bug 6), dibekukan sejak jurnal pertama.
        hppKembali: hppBeku ?? b.hppKembali,
        kreditAr: b.potonganPiutangLama,
      });
      return {
        sasaran,
        bolehMulai: !b.konsinyasi && bolehMulai(mulai, b.tanggal),
        tanggal: b.tanggal,
        deskripsi: `Retur toko ${b.noNri}${b.noNrt ? ` (${b.noNrt})` : ""}${b.storeName ? ` — ${b.storeName}` : ""}`,
      };
    },
  });
  return dariSelaras(r, mulai !== null);
}

// ── Tukar barang (sekali posting) ───────────────────────────────────────────

export async function postJurnalTukar(exchangeId: string, postedById: string, client: Klien = prisma): Promise<HasilJurnalLapangan> {
  const ada = await client.journal.findUnique({
    where: { sourceType_sourceId: { sourceType: SUMBER_LAPANGAN.TUKAR, sourceId: exchangeId } },
    select: { id: true },
  });
  if (ada) return { ok: true, journalId: ada.id, created: false };

  const d = await client.storeExchange.findUnique({
    where: { id: exchangeId },
    select: { docNo: true, status: true, storeId: true, completedAt: true, updatedAt: true },
  });
  if (!d || d.status !== "SELESAI") return { ok: false, code: "NOTHING_TO_POST" };
  const tanggal = d.completedAt ?? d.updatedAt;
  const mulai = await readGlCutover();
  if (!mulai) return { ok: false, code: "GL_CUTOVER_NOT_CONFIGURED" };
  if (!bolehMulai(mulai, tanggal)) return { ok: false, code: "BELUM_BERLAKU" };

  const baris = await client.storeExchangeLine.findMany({ where: { exchangeId }, select: { id: true, direction: true, productName: true } });
  const stok = baris.length
    ? await client.stockAdjustment.findMany({
        where: { idempotencyKey: { in: baris.map((b) => `tukar:${b.id}`) } },
        select: { idempotencyKey: true, qtyChange: true, prevAvgCost: true, item: { select: { type: true } } },
      })
    : [];
  const perKunci = new Map(stok.map((s) => [s.idempotencyKey!, s]));
  const tanpaBiaya = baris.filter((b) => !perKunci.has(`tukar:${b.id}`)).map((b) => b.productName);
  if (tanpaBiaya.length > 0) return { ok: false, code: "BIAYA_TIDAK_DIKETAHUI", detail: tanpaBiaya.join(", ") };
  const nilai = (arah: string) =>
    baris
      .filter((b) => b.direction === arah)
      .map((b) => {
        const s = perKunci.get(`tukar:${b.id}`)!;
        return { tipeBarang: s.item.type, nilai: Math.abs(angka(s.qtyChange)) * angka(s.prevAvgCost) };
      });
  const toko = await client.store.findUnique({ where: { id: d.storeId }, select: { name: true } });
  const sasaran = barisTukar({ storeId: d.storeId, masuk: nilai("MASUK"), keluar: nilai("KELUAR") });
  if (sasaran.length === 0) return { ok: false, code: "NOTHING_TO_POST" };
  const r = await generateAutoJournal(client, SUMBER_LAPANGAN.TUKAR, exchangeId, keBarisJurnal(sasaran), {
    date: tanggal,
    description: `Tukar barang ${d.docNo}${toko ? ` — ${toko.name}` : ""}`,
    postedById,
  });
  if (r.ok) return { ok: true, journalId: r.journalId, created: r.created };
  return { ok: false, code: r.code, ...(r.role ? { role: r.role } : {}) };
}

// ── Faktur piutang manual / impor (diselaraskan) ────────────────────────────

/**
 * Faktur piutang yang diketik manual atau diimpor, bertanggal sejak tanggal
 * mulai buku besar (uji akuntansi 2, bug 5 — sebelumnya tidak pernah dijurnal,
 * jadi subbuku piutang ≠ buku besar). Faktur sebelum tanggal mulai tercakup
 * saldo awal piutang dan tidak dijurnal di sini.
 *
 * Diselaraskan: faktur yang dihapus (impor dibatalkan) membalik jurnalnya
 * lewat generasi berikutnya; nota pengiriman dan tagihan konsinyasi
 * (`Receivable.isConsignment`) bersasaran kosong (`fakturDijurnalSendiri`).
 */
export async function selaraskanJurnalFaktur(receivableId: string, postedById: string): Promise<HasilJurnalLapangan> {
  const mulai = await readGlCutover();
  const r = await selaraskanJurnal({
    sourceType: SUMBER_LAPANGAN.FAKTUR,
    entityId: receivableId,
    postedById,
    susun: async (tx) => {
      const f = await tx.receivable.findUnique({
        where: { id: receivableId },
        select: {
          invoiceNo: true,
          storeId: true,
          invoiceDate: true,
          amount: true,
          paidBeforeImport: true,
          source: true,
          deliveryId: true,
          isConsignment: true,
          store: { select: { name: true } },
        },
      });
      if (!f) return { sasaran: [], bolehMulai: false, tanggal: new Date(), deskripsi: `Faktur piutang ${receivableId} (dihapus)` };
      const dijurnal = fakturDijurnalSendiri({
        source: f.source,
        deliveryId: f.deliveryId,
        konsinyasi: f.isConsignment,
      });
      const sasaran = dijurnal
        ? barisFaktur({
            total: nilaiFakturDijurnal({ amount: angka(f.amount), paidBeforeImport: angka(f.paidBeforeImport) }),
            storeId: f.storeId,
            tanggal: f.invoiceDate,
            pengaturanPpn: await bacaPengaturanPpn(tx),
          })
        : [];
      return {
        sasaran,
        bolehMulai: dijurnal && bolehMulai(mulai, f.invoiceDate),
        tanggal: f.invoiceDate,
        deskripsi: `Faktur piutang ${f.invoiceNo}${f.store ? ` — ${f.store.name}` : ""}`,
      };
    },
  });
  return dariSelaras(r, mulai !== null);
}

// ── Satu pintu ──────────────────────────────────────────────────────────────

export function jurnalLapangan(sumber: SumberLapangan, id: string, postedById: string): Promise<HasilJurnalLapangan> {
  switch (sumber) {
    case SUMBER_LAPANGAN.NOTA:
      return postJurnalNota(id, postedById);
    case SUMBER_LAPANGAN.BKM:
      return selaraskanJurnalKlaim(id, postedById);
    case SUMBER_LAPANGAN.RETUR:
      return selaraskanJurnalRetur(id, postedById);
    case SUMBER_LAPANGAN.TUKAR:
      return postJurnalTukar(id, postedById);
    case SUMBER_LAPANGAN.FAKTUR:
      return selaraskanJurnalFaktur(id, postedById);
  }
}
