import type { Prisma } from "@elorae/db";
import { konsiReportKey, payoutMonth, putusReportKey } from "@/lib/spg-commission/payout";
import { bacaDetailGaji } from "./gaji-pokok";
import { kunciGaji, muatGajiPokok } from "./gaji-pokok-queries";
import { pembayaranAkhir } from "./koreksi-akhir";
import { bacaJenisTokoBeban, kalimatBebanKabar, type BarisBebanDipotong, type BarisKembaliBeban } from "./beban-spg";
import { REF_KOMISI_KONSI, REF_KOMISI_SPG_PUTUS } from "./hilang";
import { bagianHilangTerbukaSpg } from "./hilang-db";
import { ENTITAS_KOREKSI_KOMISI, JEJAK_KOMISI_SPG } from "./komisi";
import { rencanaBayarSemua, teksKoreksi, type RefBarisKomisi, type RencanaBayarKomisi, type UnitKomisiSpg } from "./koreksi";
import { bebanReturTerbukaSpg, kembaliBebanTerbukaSpg, utangTerbukaSpg } from "./utang-queries";

/**
 * Bagian pembayaran gaji & komisi SPG yang ditulis DI DALAM transaksi pembayaran — dipakai penulis
 * toko putus (`tandaiKomisiDibayar`) dan konsinyasi (`bayarKomisi`).
 *
 * Fungsi-fungsi ini hanya dipanggil di antara tukar-bandingkan `paidAt` dan akhir `runSerializable`
 * pembayarannya: koreksi yang diterapkan, pengurang yang diambil, utang yang dibuat, dan jejak hitung
 * ulangnya ikut transaksi yang sama, jadi pembayaran yang gagal tidak meninggalkan apa pun, dan dua
 * pembayaran SPG yang sama tidak bisa sama-sama menerapkan satu laporan (keduanya membaca keadaan SPG
 * itu di transaksinya; basis data menolak salah satunya, dan kunci unik `paidRefType, paidRefId,
 * sourceKey` penjaga terakhirnya).
 */

type Tx = Prisma.TransactionClient;

/**
 * Yang dibayarkan berbeda dari yang dilihat kantor saat membuka halaman (`jumlahDiharapkan`).
 * Dilempar DI DALAM transaksi supaya tidak ada yang tertulis.
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

export { pembayaranAkhir, type SebabBukanAkhir } from "./koreksi-akhir";

/**
 * Rencana membayar satu baris, dari keadaan DI DALAM transaksi: baris-baris SPG itu (dibayar atau
 * tidak, angka tersimpan, kunci siklus, tanda dicek), koreksi yang sudah diterapkan, gaji pokok bulan
 * kerja baris ini, bagian beban barang hilang, beban retur pembeli dan utang yang masih terbuka, dan
 * apakah ini pembayaran terakhir — ditimpakan ke `praMuat` (unit yang dimuat sebelum transaksi).
 * Komisi unit yang dibayar diganti `angkaSendiri`, yang dihitung di transaksi ini. Angka laporan lain
 * dari `praMuat`: nota yang masuk di antaranya hanya menyisakan selisih untuk pembayaran berikutnya
 * (atau tertangkap `jumlahDiharapkan`).
 */
export async function siapkanBayarKomisi(
  tx: Tx,
  input: {
    userId: string;
    kunci: string;
    praMuat: readonly UnitKomisiSpg[];
    angkaSendiri: { komisi: number; potong: number; potongTanpaTarif: number };
    storeId: string;
    bulanKerja: string;
    refType: RefBarisKomisi;
    refId: string;
    sekarang?: Date;
  },
): Promise<RencanaBayarKomisi> {
  const [konsi, putus, koreksi] = await Promise.all([
    tx.consignmentCommission.findMany({
      where: { spgUserId: input.userId },
      select: { id: true, cycleId: true, paidAt: true, commission: true, deduction: true, baseSalary: true, salaryDetail: true, cycle: { select: { lockedAt: true } } },
    }),
    tx.spgCommission.findMany({
      where: { userId: input.userId },
      select: { id: true, storeId: true, period: true, paidAt: true, commission: true, deduction: true, unitsSold: true, baseSalary: true, salaryDetail: true },
    }),
    tx.spgCommissionCorrection.findMany({ where: { spgUserId: input.userId }, select: { sourceKey: true, amount: true, salaryAmount: true } }),
  ]);
  const pasanganPutus = [
    ...putus.map((p) => ({ storeId: p.storeId, period: p.period })),
    ...input.praMuat.filter((u) => u.jenis === "PUTUS").map((u) => ({ storeId: u.storeId, period: u.bulanJual })),
  ];
  const cek = pasanganPutus.length
    ? await tx.spgSalesCheck.findMany({
        where: { storeId: { in: [...new Set(pasanganPutus.map((p) => p.storeId))] }, period: { in: [...new Set(pasanganPutus.map((p) => p.period))] } },
        select: { storeId: true, period: true, checkedAt: true },
      })
    : [];
  const cekPer = new Map(cek.map((c) => [kunciPasangan(c.storeId, c.period), c.checkedAt]));
  const terapan = new Map<string, { jumlah: number; gaji: number }>();
  for (const k of koreksi) {
    const ada = terapan.get(k.sourceKey) ?? { jumlah: 0, gaji: 0 };
    terapan.set(k.sourceKey, {
      jumlah: Math.round(ada.jumlah * 100 + angka(k.amount) * 100) / 100,
      gaji: Math.round(ada.gaji * 100 + angka(k.salaryAmount) * 100) / 100,
    });
  }
  const konsiPer = new Map(konsi.map((k) => [konsiReportKey(k.cycleId), k]));
  const putusPer = new Map(putus.map((p) => [putusReportKey(p.storeId, p.period), p]));

  const units: UnitKomisiSpg[] = input.praMuat.map((u0) => {
    const t = terapan.get(u0.kunci) ?? { jumlah: 0, gaji: 0 };
    const u: UnitKomisiSpg = { ...u0, koreksiTerapan: t.jumlah, gajiTerapan: t.gaji };
    if (u.jenis === "KONSI") {
      const r = konsiPer.get(u.kunci);
      if (!r) return { ...u, baris: null };
      return {
        ...u,
        baris: {
          refType: REF_KOMISI_KONSI,
          refId: r.id,
          dibayar: r.paidAt !== null,
          dapatDibayar: r.paidAt === null && r.cycle.lockedAt !== null,
          bulanBayar: r.cycle.lockedAt ? payoutMonth(r.cycle.lockedAt) : null,
          komisiTersimpan: angka(r.commission),
          potongTersimpan: null,
          gajiPokok: angka(r.baseSalary),
          potonganHilang: angka(r.deduction),
        },
        laporanTertutup: r.cycle.lockedAt !== null,
      };
    }
    const c = cekPer.get(kunciPasangan(u.storeId, u.bulanJual)) ?? null;
    const r = putusPer.get(u.kunci);
    if (!r) return { ...u, baris: null, laporanTertutup: u0.laporanTertutup && c !== null };
    return {
      ...u,
      baris: {
        refType: REF_KOMISI_SPG_PUTUS,
        refId: r.id,
        dibayar: r.paidAt !== null,
        dapatDibayar: r.paidAt === null && c !== null,
        bulanBayar: c ? payoutMonth(c) : null,
        komisiTersimpan: angka(r.commission),
        potongTersimpan: r.unitsSold,
        gajiPokok: angka(r.baseSalary),
        potonganHilang: angka(r.deduction),
      },
      laporanTertutup: c !== null,
    };
  });

  const i = units.findIndex((u) => u.kunci === input.kunci);
  if (i < 0) throw new KomisiBerubahError(0);
  // Gaji pokok baris yang dibayar, dihitung di transaksi ini — kecuali gajinya dihitung di baris lain.
  const detail = input.refType === REF_KOMISI_KONSI ? konsi.find((k) => k.id === input.refId)?.salaryDetail : putus.find((p) => p.id === input.refId)?.salaryDetail;
  const diBarisLain = bacaDetailGaji(detail)?.jenis === "DI_BARIS_LAIN";
  const gaji = diBarisLain
    ? null
    : ((await muatGajiPokok(tx, [{ userId: input.userId, storeId: input.storeId, bulan: input.bulanKerja }])).get(kunciGaji(input.userId, input.bulanKerja)) ?? null);
  units[i] = {
    ...units[i],
    angka: input.angkaSendiri.komisi,
    potong: input.angkaSendiri.potong,
    potongTanpaTarif: input.angkaSendiri.potongTanpaTarif,
    gaji,
    ditahan: gaji && !gaji.ok ? gaji.alasan : null,
    hariTahan: gaji && !gaji.ok ? gaji.hari : [],
  };

  const [hilang, retur, kembali, utang, akhir] = await Promise.all([
    bagianHilangTerbukaSpg(tx, input.userId),
    bebanReturTerbukaSpg(tx, input.userId),
    kembaliBebanTerbukaSpg(tx, input.userId),
    utangTerbukaSpg(tx, input.userId),
    pembayaranAkhir(tx, { userId: input.userId, refType: input.refType, refId: input.refId }),
  ]);
  // Rencana yang SAMA dengan layar (B22): pengurang dibagi menurut urutan bayar, jadi baris yang
  // dibayar lebih dulu dari urutannya hanya mengambil yang ditampilkan untuknya.
  const rencana = rencanaBayarSemua(units, {
    bebanHilang: hilang,
    bebanRetur: retur,
    kembaliBeban: kembali,
    utang,
    akhir: (refId) => refId === input.refId && akhir.akhir,
  }).get(input.refId);
  if (!rencana || rencana.kunci !== input.kunci) throw new KomisiBerubahError(0);
  return rencana;
}

/**
 * Kalimat beban retur pembeli yang dipotong dan pengembalian beban yang dibayar di pembayaran ini
 * (P13a/P79), untuk kabar SPG — nomor notanya dibaca dari bebannya. Pada pembayaran terakhir sisa
 * yang tidak terpotong menjadi utang SPG, bukan "dipotong di pembayaran berikutnya". Kosong bila
 * tidak ada keduanya.
 */
export async function kalimatBebanRencana(tx: Tx, rencana: Pick<RencanaBayarKomisi, "beban" | "kembaliBeban" | "akhir">): Promise<string> {
  const ids = [...new Set([...rencana.beban.map((b) => b.chargeId), ...rencana.kembaliBeban.map((k) => k.chargeId)])];
  if (ids.length === 0) return "";
  const c = await tx.spgCharge.findMany({ where: { id: { in: ids } }, select: { id: true, sourceId: true, sourceDocNo: true, sourceKind: true } });
  const per = new Map(c.map((x) => [x.id, x]));
  const beban: BarisBebanDipotong[] = rencana.beban.flatMap((b) => {
    const x = per.get(b.chargeId);
    if (!x) return [];
    return [
      {
        chargeId: b.chargeId,
        sumber: "RETUR_PEMBELI" as const,
        sumberId: x.sourceId,
        docNo: x.sourceDocNo,
        storeId: b.storeId,
        jenisToko: bacaJenisTokoBeban(x.sourceKind),
        sisaSebelum: b.sisaSebelum,
        diterapkan: b.diterapkan,
        dariKomisi: b.dariKomisi,
        dariGaji: b.dariGaji,
        dibawa: rencana.akhir ? 0 : b.dibawa,
      },
    ];
  });
  const kembali: BarisKembaliBeban[] = rencana.kembaliBeban.flatMap((k) => {
    const x = per.get(k.chargeId);
    return x ? [{ chargeId: k.chargeId, docNo: x.sourceDocNo, storeId: k.storeId, jenisToko: bacaJenisTokoBeban(x.sourceKind), jumlah: k.jumlah }] : [];
  });
  return kalimatBebanKabar(beban, kembali);
}

/**
 * Tulis setiap koreksi yang diterapkan rencana (`diterapkan ≠ 0`) — satu `SpgCommissionCorrection`
 * (dengan bagian gaji pokoknya di `salaryAmount`) dan satu jejak `SPG_COMMISSION_CORRECTION_APPLIED`
 * per baris. `paidRefType`/`paidRefId` default = baris yang dibayar; koreksi yang ditutup ke utang
 * SPG (`SpgDebt`) atau dibayar terpisah sesudah gaji terakhir (`SpgExtraPayout`) memberinya sendiri.
 * Koreksi minus yang dipotong sampai Rp 0 menyimpan seluruh selisihnya di `difference`; sisanya tidak
 * ditulis — ia tetap selisih dan ikut pembayaran berikutnya. P2002 pada kunci uniknya dibiarkan naik.
 */
export async function catatKoreksiDiterapkan(
  tx: Tx,
  input: {
    userId: string;
    rencana: Pick<RencanaBayarKomisi, "refType" | "refId" | "koreksi">;
    bulanBayar: string;
    olehUserId: string;
    waktu: Date;
    paidRefType?: string;
    paidRefId?: string;
  },
): Promise<Array<{ id: string; sumber: string; jumlah: number; gaji: number; teks: string }>> {
  const paidRefType = input.paidRefType ?? input.rencana.refType;
  const paidRefId = input.paidRefId ?? input.rencana.refId;
  const hasil: Array<{ id: string; sumber: string; jumlah: number; gaji: number; teks: string }> = [];
  for (const k of input.rencana.koreksi) {
    if (Math.round(k.diterapkan * 100) === 0) continue;
    const teks = teksKoreksi(k);
    const baris = await tx.spgCommissionCorrection.create({
      data: {
        spgUserId: input.userId,
        sourceKind: k.jenis,
        sourceKey: k.sumber,
        sourceStoreId: k.storeId,
        sourceSalesMonth: k.bulanJual,
        amount: k.diterapkan,
        salaryAmount: k.gajiDiterapkan,
        difference: k.selisih,
        figure: k.angka,
        paidBefore: k.dibayarSebelum,
        appliedBefore: k.terapanSebelum,
        paidRefType,
        paidRefId,
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
        changes: {
          before: { selisih: k.selisih, selisihGaji: k.selisihGaji },
          after: { diterapkan: k.diterapkan, gajiDiterapkan: k.gajiDiterapkan, dibawa: k.dibawa },
        } as Prisma.InputJsonValue,
        metadata: {
          spgUserId: input.userId,
          sumber: k.sumber,
          bulanJual: k.bulanJual,
          storeId: k.storeId,
          paidRefType,
          paidRefId,
          payoutMonth: input.bulanBayar,
          catatan: teks,
        } as Prisma.InputJsonValue,
      },
    });
    hasil.push({ id: baris.id, sumber: k.sumber, jumlah: k.diterapkan, gaji: k.gajiDiterapkan, teks });
  }
  return hasil;
}

type IsiBaris = {
  komisi: number;
  potong: number | null;
  dasar: string | null;
  potonganHilang: number;
  gajiPokok?: number;
  total?: number;
};

/**
 * Jejak `SPG_COMMISSION_RECOMPUTED_AT_PAYMENT`: angka tersimpan (komisi, gaji pokok, rinciannya)
 * diganti angka sekarang saat dibayar. `action`, `entityType` dan `entityId` tidak berubah — hanya
 * sebelum/sesudahnya kini membawa gaji pokok.
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
      metadata: { spgUserId: input.spgUserId, storeId: input.storeId, kunci: input.kunci, sebab: "DIBAYAR_ANGKA_SEKARANG" } as Prisma.InputJsonValue,
    },
  });
}
