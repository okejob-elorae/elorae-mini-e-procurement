import type { Prisma } from "@elorae/db";
import { konsiReportKey, payoutMonth, putusReportKey } from "@/lib/spg-commission/payout";
import { REF_KOMISI_KONSI, REF_KOMISI_SPG_PUTUS } from "./hilang";
import { aturanLama, ENTITAS_KOREKSI_KOMISI, JEJAK_KOMISI_SPG } from "./komisi";
import {
  alasanTahan,
  dalamJendelaKoreksi,
  rencanaBayarKomisi,
  teksKoreksi,
  type RefBarisKomisi,
  type RencanaBayarKomisi,
  type UnitKomisiSpg,
} from "./koreksi";
import { siklusAturanLama } from "./koreksi-queries";
import { bulanWib } from "@/lib/salesman/pengaturan";

/**
 * Bagian pembayaran komisi SPG yang ditulis DI DALAM transaksi pembayaran — dipakai penulis toko
 * putus (`tandaiKomisiDibayar`) dan konsinyasi (`bayarKomisi`).
 *
 * Fungsi-fungsi ini hanya dipanggil di antara tukar-bandingkan `paidAt` dan akhir `runSerializable`
 * pembayarannya: koreksi yang diterapkan dan jejak hitung ulangnya ikut transaksi yang sama, jadi
 * pembayaran yang gagal tidak meninggalkan apa pun, dan dua pembayaran SPG yang sama tidak bisa
 * sama-sama menerapkan satu laporan (keduanya membaca koreksi SPG itu di transaksinya; basis data
 * menolak salah satunya, dan kunci unik `paidRefType, paidRefId, sourceKey` penjaga terakhirnya).
 */

type Tx = Prisma.TransactionClient;

/**
 * Yang dibayarkan berbeda dari yang dilihat kantor saat membuka halaman (`jumlahDiharapkan`).
 * Dilempar DI DALAM transaksi supaya tidak ada yang tertulis — hitung ulang, `paidAt`, koreksi,
 * maupun jejak.
 */
export class KomisiBerubahError extends Error {
  readonly jumlah: number;
  constructor(jumlah: number) {
    super("ANGKA_BERUBAH");
    this.name = "KomisiBerubahError";
    this.jumlah = jumlah;
  }
}

const angka = (v: unknown) => Number(v ?? 0);
const kunciPasangan = (storeId: string, periode: string) => `${storeId}\u0000${periode}`;

/**
 * Rencana membayar satu baris, dari keadaan DI DALAM transaksi: baris-baris SPG itu (dibayar atau
 * tidak, angka tersimpan, kunci siklus), tanda dicek dan baris dibayar toko × bulan putusnya, dan
 * koreksi yang sudah diterapkan — ditimpakan ke `praMuat` (unit yang dimuat sebelum transaksi).
 * Angka unit yang dibayar diganti `angkaSendiri`, yang dihitung di transaksi ini, dan
 * penahanannya (`alasanTahan`: aturan lama siklus/toko × bulan itu dibaca ulang di sini) dihitung
 * dari angka itu — penulis menolak rencana yang `ditahan`, dan itu hanya potong tanpa tarif
 * (`alasanTahanBayar`): baris yang dibayar belum dibayar, jadi siklus yang angka resminya tidak
 * seluruhnya tercatat di HP dibayar dengan aturan hari ini (Q7), gaji pokoknya ikut. Angka dan
 * penahanan laporan lain dari `praMuat`: nota yang masuk di antaranya hanya menyisakan selisih untuk
 * pembayaran berikutnya (atau tertangkap `jumlahDiharapkan`).
 */
export async function siapkanBayarKomisi(
  tx: Tx,
  input: {
    userId: string;
    kunci: string;
    praMuat: readonly UnitKomisiSpg[];
    angkaSendiri: {
      komisi: number;
      potong: number;
      potongTanpaTarif: number;
      /**
       * Konsinyasi: angka resmi siklusnya tidak seluruhnya tercatat di HP (`laporanKonsiTidakLengkap`).
       * Tidak menahan baris yang dibayar ini (belum dibayar); diteruskan supaya aturannya tetap satu
       * tempat (`alasanTahan`).
       */
      laporanTidakLengkap?: boolean;
    };
    maksPotongPersen: number;
    sekarang?: Date;
  },
): Promise<RencanaBayarKomisi> {
  const bulanIni = bulanWib(input.sekarang ?? new Date());
  const [konsi, putus, koreksi] = await Promise.all([
    tx.consignmentCommission.findMany({
      where: { spgUserId: input.userId },
      select: { id: true, cycleId: true, paidAt: true, commission: true, deduction: true, baseSalary: true, cycle: { select: { lockedAt: true } } },
    }),
    tx.spgCommission.findMany({
      where: { userId: input.userId },
      select: { id: true, storeId: true, period: true, paidAt: true, commission: true, deduction: true, unitsSold: true, basis: true },
    }),
    tx.spgCommissionCorrection.findMany({ where: { spgUserId: input.userId }, select: { sourceKey: true, amount: true } }),
  ]);

  // Toko × bulan putus yang dibaca ulang: setiap baris miliknya DAN setiap unit putus `praMuat`,
  // termasuk unit TANPA baris (nota yang masuk sesudah bulan toko itu dibayar) — tertutup-tidaknya
  // ditentukan baris dibayar SPG lain di toko × bulan itu, juga saat ia tidak punya baris putus sama sekali.
  const pasanganPutus = [
    ...putus.map((p) => ({ storeId: p.storeId, period: p.period })),
    ...input.praMuat.filter((u) => u.jenis === "PUTUS").map((u) => ({ storeId: u.storeId, period: u.bulanJual })),
  ];
  const tokoPutus = [...new Set(pasanganPutus.map((p) => p.storeId))];
  const periodePutus = [...new Set(pasanganPutus.map((p) => p.period))];
  const adaPasangan = pasanganPutus.length > 0;
  const [cek, barisPasangan] = await Promise.all([
    adaPasangan
      ? tx.spgSalesCheck.findMany({ where: { storeId: { in: tokoPutus }, period: { in: periodePutus } }, select: { storeId: true, period: true, checkedAt: true } })
      : Promise.resolve([] as { storeId: string; period: string; checkedAt: Date }[]),
    adaPasangan
      ? tx.spgCommission.findMany({
          where: { storeId: { in: tokoPutus }, period: { in: periodePutus } },
          select: { storeId: true, period: true, paidAt: true, lockedAt: true, basis: true },
        })
      : Promise.resolve([] as { storeId: string; period: string; paidAt: Date | null; lockedAt: Date; basis: string }[]),
  ]);
  const cekPer = new Map(cek.map((c) => [kunciPasangan(c.storeId, c.period), c.checkedAt]));
  const pasangan = new Map<string, { dibayar: boolean; terakhir: Date | null; lama: boolean }>();
  for (const b of barisPasangan) {
    const kp = kunciPasangan(b.storeId, b.period);
    const ada = pasangan.get(kp) ?? { dibayar: false, terakhir: null, lama: false };
    if (b.paidAt) ada.dibayar = true;
    if (aturanLama(b.basis)) ada.lama = true;
    if (!ada.terakhir || b.lockedAt > ada.terakhir) ada.terakhir = b.lockedAt;
    pasangan.set(kp, ada);
  }
  const terapan = new Map<string, number>();
  for (const k of koreksi) terapan.set(k.sourceKey, Math.round((terapan.get(k.sourceKey) ?? 0) * 100 + angka(k.amount) * 100) / 100);

  const konsiPer = new Map(konsi.map((k) => [konsiReportKey(k.cycleId), k]));
  const putusPer = new Map(putus.map((p) => [putusReportKey(p.storeId, p.period), p]));

  const units: UnitKomisiSpg[] = input.praMuat.map((u0) => {
    const u: UnitKomisiSpg = { ...u0, koreksiTerapan: terapan.get(u0.kunci) ?? 0 };
    if (u.jenis === "KONSI") {
      const r = konsiPer.get(u.kunci);
      if (!r) return { ...u, baris: null };
      const bulanBayar = r.cycle.lockedAt ? payoutMonth(r.cycle.lockedAt) : null;
      return {
        ...u,
        // Baris yang muncul sesudah praMuat dibuat penulis kunci sekarang — aturan baru.
        baris: {
          refType: REF_KOMISI_KONSI,
          refId: r.id,
          dibayar: r.paidAt !== null,
          dapatDibayar: r.paidAt === null && r.cycle.lockedAt !== null,
          bulanBayar,
          komisiTersimpan: angka(r.commission),
          potongTersimpan: null,
          dasarLama: u0.baris?.dasarLama ?? false,
          gajiPokok: angka(r.baseSalary),
          potonganHilang: angka(r.deduction),
          dalamJendela: dalamJendelaKoreksi(bulanBayar, bulanIni),
        },
        laporanTertutup: r.cycle.lockedAt !== null,
      };
    }
    const r = putusPer.get(u.kunci);
    const [storeId, periode] = [u.storeId, u.bulanJual];
    const kp = kunciPasangan(storeId, periode);
    const info = pasangan.get(kp);
    const laporanTertutup = Boolean(info?.dibayar);
    // Tanpa baris: tertutup hanya kalau pemuatnya melihatnya tertutup DAN toko × bulan itu masih punya
    // baris dibayar. Unit asal koreksi yang dimuat terbuka (tanpa angka yang dihitung) tetap terbuka.
    if (!r) return { ...u, baris: null, laporanTertutup: u0.laporanTertutup && laporanTertutup };
    const c = cekPer.get(kp) ?? null;
    const bulanBayar = c ? payoutMonth(c) : info?.terakhir ? payoutMonth(info.terakhir) : null;
    const dasarLama = aturanLama(r.basis);
    return {
      ...u,
      baris: {
        refType: REF_KOMISI_SPG_PUTUS,
        refId: r.id,
        dibayar: r.paidAt !== null,
        dapatDibayar: r.paidAt === null && (c !== null || laporanTertutup),
        bulanBayar,
        komisiTersimpan: angka(r.commission),
        potongTersimpan: r.unitsSold,
        dasarLama,
        gajiPokok: 0,
        potonganHilang: angka(r.deduction),
        dalamJendela: dalamJendelaKoreksi(bulanBayar, bulanIni),
      },
      laporanTertutup,
    };
  });

  const i = units.findIndex((u) => u.kunci === input.kunci);
  if (i < 0) throw new KomisiBerubahError(0);
  const dibayarkan = units[i];
  // Aturan lama laporan yang dibayar, dibaca di transaksi ini: siklus menurut jejak kunci
  // terakhirnya; toko putus menurut baris-baris toko × bulan itu.
  let dasarLamaLaporan = false;
  if (dibayarkan.jenis === "KONSI") {
    const r = konsiPer.get(dibayarkan.kunci);
    dasarLamaLaporan = r ? (await siklusAturanLama(tx, [r.cycleId])).has(r.cycleId) : false;
  } else {
    dasarLamaLaporan = Boolean(pasangan.get(kunciPasangan(dibayarkan.storeId, dibayarkan.bulanJual))?.lama || dibayarkan.baris?.dasarLama);
  }
  units[i] = {
    ...dibayarkan,
    angka: input.angkaSendiri.komisi,
    potong: input.angkaSendiri.potong,
    potongTanpaTarif: input.angkaSendiri.potongTanpaTarif,
    baris: dibayarkan.baris && dibayarkan.jenis === "KONSI" ? { ...dibayarkan.baris, dasarLama: dasarLamaLaporan } : dibayarkan.baris,
    ditahan: alasanTahan({
      jenis: dibayarkan.jenis,
      dasarLama: dasarLamaLaporan,
      potongTanpaTarif: input.angkaSendiri.potongTanpaTarif,
      laporanTidakLengkap: input.angkaSendiri.laporanTidakLengkap ?? false,
      komisiDibayar: dibayarkan.baris?.dibayar ? dibayarkan.baris.komisiTersimpan : null,
      angka: input.angkaSendiri.komisi,
    }),
  };

  const rencana = rencanaBayarKomisi({ units, kunci: input.kunci, maksPotongPersen: input.maksPotongPersen });
  if (!rencana) throw new KomisiBerubahError(0);
  return rencana;
}

/**
 * Tulis setiap koreksi yang diterapkan rencana (`diterapkan ≠ 0`) — satu `SpgCommissionCorrection`
 * dan satu jejak `SPG_COMMISSION_CORRECTION_APPLIED` per baris. Koreksi minus yang dipotong sampai
 * Rp 0 menyimpan seluruh selisihnya di `difference`; sisanya tidak ditulis — ia tetap selisih dan
 * ikut pembayaran berikutnya. P2002 pada kunci uniknya dibiarkan naik (transaksinya batal).
 */
export async function catatKoreksiDiterapkan(
  tx: Tx,
  input: { userId: string; rencana: RencanaBayarKomisi; bulanBayar: string; olehUserId: string; waktu: Date },
): Promise<Array<{ id: string; sumber: string; jumlah: number; teks: string }>> {
  const hasil: Array<{ id: string; sumber: string; jumlah: number; teks: string }> = [];
  for (const k of input.rencana.koreksi) {
    if (Math.round(k.diterapkan * 100) === 0) continue;
    const teks = teksKoreksi(k);
    // Suku-suku rumusnya: selisih = angka − dibayar − sudah diterapkan.
    const baris = await tx.spgCommissionCorrection.create({
      data: {
        spgUserId: input.userId,
        sourceKind: k.jenis,
        sourceKey: k.sumber,
        sourceStoreId: k.storeId,
        sourceSalesMonth: k.bulanJual,
        amount: k.diterapkan,
        difference: k.selisih,
        figure: k.angka,
        paidBefore: k.dibayarSebelum,
        appliedBefore: k.terapanSebelum,
        paidRefType: input.rencana.refType,
        paidRefId: input.rencana.refId,
        payoutMonth: input.bulanBayar,
        note: teks,
        appliedById: input.olehUserId,
        appliedAt: input.waktu,
      },
      select: { id: true },
    });
    await tx.auditLog.create({
      data: {
        userId: input.olehUserId,
        action: JEJAK_KOMISI_SPG.KOREKSI_DITERAPKAN,
        entityType: ENTITAS_KOREKSI_KOMISI,
        entityId: baris.id,
        changes: { before: { selisih: k.selisih }, after: { diterapkan: k.diterapkan, dibawa: k.dibawa } } as Prisma.InputJsonValue,
        metadata: {
          spgUserId: input.userId,
          sumber: k.sumber,
          bulanJual: k.bulanJual,
          storeId: k.storeId,
          paidRefType: input.rencana.refType,
          paidRefId: input.rencana.refId,
          payoutMonth: input.bulanBayar,
          catatan: teks,
        } as Prisma.InputJsonValue,
      },
    });
    hasil.push({ id: baris.id, sumber: k.sumber, jumlah: k.diterapkan, teks });
  }
  return hasil;
}

type IsiBaris = { komisi: number; potong: number | null; dasar: string | null; potonganHilang: number; total?: number };

/**
 * Jejak `SPG_COMMISSION_RECOMPUTED_AT_PAYMENT`: angka tersimpan diganti komisi per SPG sekarang saat
 * dibayar, atau potongan beban barang hilangnya diturunkan ke batas sekarang.
 */
export async function catatHitungUlangSaatBayar(
  tx: Tx,
  input: {
    olehUserId: string;
    entityType: RefBarisKomisi;
    entityId: string;
    spgUserId: string;
    /** Toko laporannya — jejak dicari menurut toko seperti jejak komisi lainnya. */
    storeId: string;
    kunci: string;
    sebelum: IsiBaris;
    sesudah: IsiBaris;
  },
): Promise<void> {
  await tx.auditLog.create({
    data: {
      userId: input.olehUserId,
      action: JEJAK_KOMISI_SPG.DIHITUNG_ULANG_SAAT_BAYAR,
      entityType: input.entityType,
      entityId: input.entityId,
      changes: { before: input.sebelum, after: input.sesudah } as Prisma.InputJsonValue,
      metadata: { spgUserId: input.spgUserId, storeId: input.storeId, kunci: input.kunci, sebab: "DIBAYAR_ANGKA_PER_SPG" } as Prisma.InputJsonValue,
    },
  });
}
