// Bukan aksi server — pembaca hutang jasa produksi (ongkos jahit/CMT dan jasa
// langkah WO lainnya) per pemasok, untuk pembayaran pemasok. KHUSUS SERVER:
// komponen klien hanya boleh `import type` dari berkas ini.

import { Decimal } from "decimal.js";
import { prisma, type Prisma } from "@elorae/db";
import { bacaPengaturanPpn } from "@/lib/finance/pajak/ppn-pengaturan";
import { billBookedByWoStep, vendorPaidBySource } from "@/lib/vendor-billing/billable";
import { bagiHutangJasaPerLangkah, nilaiJasaKumulatif, type LangkahJasa } from "./biaya-jasa";
import { resolveAccount, UnmappedRoleError } from "@/lib/finance/journals/mapping";
import { apKoreksiPerPenerimaan } from "@/lib/vendor-billing/koreksi-utang-queries";
import { kunciDokumenHutang } from "@/lib/purchasing/pembayaran-aturan";

type Klien = Prisma.TransactionClient | typeof prisma;

/** `SupplierPaymentAllocation.targetType` untuk pembayaran yang melunasi satu langkah WO. */
export const TARGET_ALOKASI_LANGKAH_WO = "WO_STEP";

/** Hutang jasa satu langkah WO (satu pemasok). Rupiah, dua desimal. */
export type BarisHutangJasa = {
  /** `WorkOrderStep.id` — `targetId` alokasi pembayarannya. */
  stepId: string;
  woId: string;
  woDocNumber: string;
  urutan: number;
  namaLangkah: string | null;
  supplierId: string;
  hargaPerPcs: number;
  hargaTermasukPpn: boolean;
  /** Pcs lolos yang jasanya SUDAH dijurnal ke hutang usaha (di penerimaan barang jadi atau di tagihan vendor). */
  qtyTerhutang: number;
  /** Tagihan jasa (DPP + PPN pemasok) yang sudah dikredit ke hutang usaha, koreksi selisih harga yang diterima termasuk. */
  hutang: number;
  /**
   * `hutang` TANPA koreksi selisih harga invoice: yang dibukukan penerimaan barang jadi dan tagihan
   * vendor lama saja — dasar utang tercatat per potong (`hutangTanpaKoreksi ÷ qtyTerhutang`).
   */
  hutangTanpaKoreksi: number;
  /** Nilai jasa tanpa PPN — dasar pemotongan PPh 23 (badan) / PPh 21 (perorangan). */
  dasarPotong: number;
  /** PPN yang dipungut pemasok = hutang − dasarPotong. */
  ppn: number;
  /**
   * Σ alokasi pembayaran pemasok (bruto, sebelum potongan PPh) ke langkah ini, pembayaran yang tidak
   * dibatalkan, + bagian langkah ini dari pembayaran vendor yang berlaku atas tagihannya.
   */
  dibayar: number;
  /** hutang − dibayar (negatif = lebih bayar). */
  sisa: number;
};

export type HutangJasaPemasok = {
  supplierId: string;
  kodePemasok: string;
  namaPemasok: string;
  /** `Supplier.taxWithholding` (null / PPH23 / PPH21 / PPH4_2). */
  jenisPotong: string | null;
  adaNpwp: boolean;
  hutang: number;
  dasarPotong: number;
  dibayar: number;
  sisa: number;
  langkah: BarisHutangJasa[];
};

export type OpsiHutangJasa = {
  /** Hanya langkah pemasok ini. */
  supplierId?: string;
  /** Hanya WO ini (tes di basis data bersama memakai cakupan ini). */
  woIds?: string[];
  /** Buang langkah yang sisanya nol (lunas). Bawaan false. */
  hanyaBersisa?: boolean;
};

const NOL = new Decimal(0);
const rp = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();

/**
 * Hutang jasa produksi per pemasok, per langkah WO — sama dengan yang dikredit
 * ke hutang usaha di buku besar.
 *
 * Hutang jasa lahir di jurnal penerimaan barang jadi (CR hutang usaha =
 * `FGReceipt.serviceCost`). Per WO: Σ hutang itu atas semua langkahnya =
 * Σ `serviceCost` penerimaannya, persis (lihat `bagiHutangJasaPerLangkah`).
 * Penerimaan SEBELUM ongkos jahit masuk HPP (`serviceCost` null) tidak
 * menjurnal hutang jasa; pcs-nya baru menjadi hutang saat ditagih lewat
 * tagihan vendor, yang menjurnalnya sendiri (`VENDOR_BILL`). Bagian itu
 * ditambahkan dari jurnal tagihan yang masih berdiri (`billBookedByWoStep`);
 * dasar potongnya mengikuti tanda PPN langkah: harga termasuk PPN → DPP-nya,
 * belum termasuk → seluruhnya (tagihan tidak menambahkan PPN di atas harga).
 *
 * Dibayar = Σ `SupplierPaymentAllocation.amount` ber-`targetType` "WO_STEP"
 * dan `targetId` = id langkah, dari `SupplierPayment` yang tidak berstatus
 * CANCELLED, + bagian langkah ini dari pembayaran vendor yang berlaku atas
 * tagihannya (`vendorPaidBySource`; jurnal `VENDOR_PAYMENT`-nya mendebit hutang
 * usaha sebesar itu juga). Jumlah alokasi dibaca sebagai bagian BRUTO hutang
 * yang diselesaikan (sebelum PPh dipotong).
 *
 * Koreksi selisih harga invoice yang diterima (keputusan pemilik 2026-11-02, P27/P49/P53) menambah
 * hutang dan DPP-nya ke langkahnya (`apKoreksiPerPenerimaan`, dari jurnal koreksinya sendiri), jadi
 * buku pembantu tetap sama dengan buku besar; PPN = hutang − DPP ikut bergerak.
 *
 * Satu baris per langkah, apa pun jumlah tagihannya: hutang yang dijurnal
 * penerimaan dan yang dijurnal tagihan dijumlahkan di baris yang sama, jadi
 * WO yang sebagian pcs-nya lama dibayar sekali di Pembayaran pemasok. Sejak
 * 2026-11-01 itu satu-satunya jalan bayar (Vendor Billing tidak menerima
 * pembayaran baru); pembayaran vendor yang lama tetap terhitung dibayar, jadi
 * yang dibayar di sini hanya sisanya.
 */
export async function daftarHutangJasa(opsi: OpsiHutangJasa = {}, klien: Klien = prisma): Promise<HutangJasaPemasok[]> {
  const where: Prisma.WorkOrderWhereInput = {
    OR: [
      { receipts: { some: { serviceCost: { not: null } } } },
      { steps: { some: { vendorBillLines: { some: { bill: { status: { not: "VOID" } } } } } } },
    ],
    ...(opsi.woIds ? { id: { in: opsi.woIds } } : {}),
    ...(opsi.supplierId ? { steps: { some: { supplierId: opsi.supplierId } } } : {}),
  };
  const wos = await klien.workOrder.findMany({
    where,
    orderBy: { docNumber: "asc" },
    select: {
      id: true,
      docNumber: true,
      receipts: { select: { qtyAccepted: true, serviceCost: true } },
      steps: {
        orderBy: { sequence: "asc" },
        select: { id: true, sequence: true, stepName: true, supplierId: true, servicePrice: true, servicePpnIncluded: true, supplier: { select: { isPkp: true } } },
      },
    },
  });
  if (wos.length === 0) return [];
  const pengaturan = await bacaPengaturanPpn(klien);

  const baris: BarisHutangJasa[] = [];
  const langkahPer = new Map<string, LangkahJasa>();
  for (const wo of wos) {
    let qtyLama = NOL;
    let qtySemua = NOL;
    let tercatat = NOL;
    for (const r of wo.receipts) {
      const q = new Decimal(r.qtyAccepted.toString());
      qtySemua = qtySemua.plus(q);
      if (r.serviceCost == null) qtyLama = qtyLama.plus(q);
      else tercatat = tercatat.plus(r.serviceCost.toString());
    }
    const hitungan = wo.steps.map((s) => {
      const langkah = {
        id: s.id,
        supplierId: s.supplierId,
        servicePrice: s.servicePrice.toString(),
        servicePpnIncluded: s.servicePpnIncluded,
        pemasokPkp: s.supplier.isPkp,
      };
      langkahPer.set(s.id, langkah);
      const a = nilaiJasaKumulatif(langkah, qtyLama, pengaturan);
      const b = nilaiJasaKumulatif(langkah, qtySemua, pengaturan);
      return { tagihan: b.tagihan.minus(a.tagihan), dpp: b.dpp.minus(a.dpp) };
    });
    const bagian = bagiHutangJasaPerLangkah(tercatat, hitungan);
    wo.steps.forEach((s, i) => {
      if (opsi.supplierId && s.supplierId !== opsi.supplierId) return;
      const { hutang, dasarPotong } = bagian[i];
      baris.push({
        stepId: s.id,
        woId: wo.id,
        woDocNumber: wo.docNumber,
        urutan: s.sequence,
        namaLangkah: s.stepName,
        supplierId: s.supplierId,
        hargaPerPcs: Number(s.servicePrice),
        hargaTermasukPpn: s.servicePpnIncluded,
        qtyTerhutang: qtySemua.minus(qtyLama).toNumber(),
        hutang: rp(hutang),
        hutangTanpaKoreksi: rp(hutang),
        dasarPotong: rp(dasarPotong),
        ppn: rp(hutang.minus(dasarPotong)),
        dibayar: 0,
        sisa: rp(hutang),
      });
    });
  }
  if (baris.length === 0) return [];

  const stepIds = baris.map((b) => b.stepId);
  const tagihan = await billBookedByWoStep(klien, stepIds);
  for (const b of baris) {
    const t = tagihan.get(b.stepId);
    const langkah = langkahPer.get(b.stepId);
    if (!t || t.cents === 0 || !langkah) continue;
    const tambah = new Decimal(t.cents).div(100);
    const n = nilaiJasaKumulatif({ ...langkah, servicePrice: tambah }, 1, pengaturan);
    const dasar = langkah.servicePpnIncluded && n.tagihan.gt(0) ? n.dpp.mul(tambah).div(n.tagihan) : tambah;
    const hutang = new Decimal(b.hutang).plus(tambah);
    const dasarPotong = new Decimal(b.dasarPotong).plus(dasar).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    b.qtyTerhutang = new Decimal(b.qtyTerhutang).plus(t.qty).toNumber();
    b.hutang = rp(hutang);
    b.hutangTanpaKoreksi = rp(hutang);
    b.dasarPotong = rp(dasarPotong);
    b.ppn = rp(hutang.minus(dasarPotong));
  }

  let apAkunId: string | null = null;
  try {
    apAkunId = await resolveAccount("AP", klien);
  } catch (e) {
    if (!(e instanceof UnmappedRoleError)) throw e;
  }
  if (apAkunId) {
    const koreksi = await apKoreksiPerPenerimaan(klien, { woStepIds: stepIds }, apAkunId);
    for (const b of baris) {
      const k = koreksi.get(kunciDokumenHutang(TARGET_ALOKASI_LANGKAH_WO, b.stepId));
      if (!k || (k.apSen === 0 && k.dppSen === 0)) continue;
      const hutang = new Decimal(b.hutang).plus(new Decimal(k.apSen).div(100));
      const dasarPotong = new Decimal(b.dasarPotong).plus(new Decimal(k.dppSen).div(100));
      b.hutang = rp(hutang);
      b.dasarPotong = rp(dasarPotong);
      b.ppn = rp(hutang.minus(dasarPotong));
    }
  }

  const alokasi = await klien.supplierPaymentAllocation.findMany({
    where: {
      targetType: TARGET_ALOKASI_LANGKAH_WO,
      targetId: { in: stepIds },
      payment: { status: { not: "CANCELLED" } },
    },
    select: { targetId: true, amount: true },
  });
  const dibayarPerLangkah = new Map<string, Decimal>();
  for (const a of alokasi) {
    if (!a.targetId) continue;
    dibayarPerLangkah.set(a.targetId, (dibayarPerLangkah.get(a.targetId) ?? NOL).plus(a.amount.toString()));
  }
  const { byWoStep } = await vendorPaidBySource(klien, { poIds: [], woStepIds: stepIds });
  for (const [stepId, bayarSen] of byWoStep) {
    dibayarPerLangkah.set(stepId, (dibayarPerLangkah.get(stepId) ?? NOL).plus(new Decimal(bayarSen).div(100)));
  }
  for (const b of baris) {
    const dibayar = dibayarPerLangkah.get(b.stepId) ?? NOL;
    b.dibayar = rp(dibayar);
    b.sisa = rp(new Decimal(b.hutang).minus(dibayar));
  }

  const tampil = opsi.hanyaBersisa ? baris.filter((b) => Math.abs(b.sisa) >= 0.005) : baris;
  if (tampil.length === 0) return [];
  const pemasok = await klien.supplier.findMany({
    where: { id: { in: [...new Set(tampil.map((b) => b.supplierId))] } },
    select: { id: true, code: true, name: true, taxWithholding: true, hasNpwp: true },
  });
  const perPemasok = new Map<string, HutangJasaPemasok>();
  for (const p of pemasok) {
    perPemasok.set(p.id, {
      supplierId: p.id,
      kodePemasok: p.code,
      namaPemasok: p.name,
      jenisPotong: p.taxWithholding,
      adaNpwp: p.hasNpwp,
      hutang: 0,
      dasarPotong: 0,
      dibayar: 0,
      sisa: 0,
      langkah: [],
    });
  }
  const sen = (n: number) => Math.round(n * 100);
  for (const b of tampil) {
    const g = perPemasok.get(b.supplierId);
    if (!g) continue;
    g.langkah.push(b);
    g.hutang = (sen(g.hutang) + sen(b.hutang)) / 100;
    g.dasarPotong = (sen(g.dasarPotong) + sen(b.dasarPotong)) / 100;
    g.dibayar = (sen(g.dibayar) + sen(b.dibayar)) / 100;
    g.sisa = (sen(g.sisa) + sen(b.sisa)) / 100;
  }
  return [...perPemasok.values()]
    .filter((g) => g.langkah.length > 0)
    .sort((a, b) => a.namaPemasok.localeCompare(b.namaPemasok, "id"));
}
