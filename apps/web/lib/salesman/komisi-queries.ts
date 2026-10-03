import { prisma } from "@elorae/db";
import {
  bacaAturanPeringkat,
  bacaSkemaKomisi,
  hitungKomisi,
  KUNCI_PERINGKAT,
  KUNCI_SKEMA_KOMISI,
  nilaiTunaiPorsi,
  porsiTagih,
  rentangBulanWib,
  ringkasTagih,
  susunPeringkat,
  type AturanPeringkat,
  type BarisPeringkat,
  type BarisTagih,
  type HasilKomisi,
  type PeranTagih,
  type SkemaKomisi,
} from "./komisi";
import { bacaTargetBulan, bulanWib, KUNCI_TARGET } from "./pengaturan";
import { daftarSalesman, penjualanSalesman } from "./queries";

/**
 * Kueri komisi / insentif salesman. Aturannya murni di `komisi.ts`; di sini
 * hanya mengambil bahan — dan bahan yang sama dipakai HP salesman, papan
 * peringkat, dan laporan kantor, supaya ketiganya tidak pernah berbeda angka.
 */

const angka = (v: unknown) => Number(v ?? 0);

async function bacaSetelan(): Promise<{ skema: SkemaKomisi; peringkat: AturanPeringkat; target: string | null }> {
  const baris = await prisma.systemSetting.findMany({
    where: { key: { in: [KUNCI_SKEMA_KOMISI, KUNCI_PERINGKAT, KUNCI_TARGET] } },
    select: { key: true, value: true },
  });
  const nilai = (k: string) => baris.find((b) => b.key === k)?.value ?? null;
  return {
    skema: bacaSkemaKomisi(nilai(KUNCI_SKEMA_KOMISI)),
    peringkat: bacaAturanPeringkat(nilai(KUNCI_PERINGKAT)),
    target: nilai(KUNCI_TARGET),
  };
}

export type OmzetBulan = { putus: number; konsi: number; van: number; total: number };

/**
 * Omzet satu bulan WIB, dengan definisi yang SAMA PERSIS dengan kartu "Bulan
 * ini" di beranda HP: `penjualanSalesman` (putus terkirim, konsi disetujui,
 * van), dikelompokkan menurut bulan kalender WIB. Tidak disalin — dipanggil.
 */
export async function omzetBulan(salesmanId: string, bulan: string): Promise<OmzetBulan> {
  const r = rentangBulanWib(bulan);
  const hasil: OmzetBulan = { putus: 0, konsi: 0, van: 0, total: 0 };
  if (!r || !salesmanId) return hasil;
  for (const b of await penjualanSalesman(salesmanId, r.awal)) {
    if (bulanWib(b.tanggal) !== bulan) continue;
    hasil[b.jenis] += b.nilai;
    hasil.total += b.nilai;
  }
  return hasil;
}

/** Satu faktur yang uangnya masuk lewat klaim yang diverifikasi di bulan itu. */
export type BarisTertagih = BarisTagih & {
  claimId: string;
  docNo: string;
  verifiedAt: Date;
  storeId: string;
  toko: string;
  receivableId: string;
  invoiceNo: string;
  /** Nilai faktur yang dilunasi klaim ini (termasuk bagian yang dibayar dengan potongan). */
  dilunasi: number;
};

/**
 * Uang tertagih yang DIVERIFIKASI keuangan dalam satu bulan WIB.
 *
 * Hanya klaim `TERVERIFIKASI` — klaim yang masih dikirim, ditolak, atau
 * dibatalkan bernilai nol (Aturan 1). Bulannya menurut `verifiedAt`: hari uang
 * itu terbukti ada di rekening, bukan hari salesman melapor. Klaim yang
 * dibatalkan SESUDAH terverifikasi ikut keluar dengan sendirinya: pembatalan
 * mengubah statusnya.
 *
 * `salesmanId` menyempitkan ke klaim yang ia tagih ATAU yang melunasi faktur
 * penjualannya; baris lain di klaim yang sama tetap ikut dan disaring oleh
 * `porsiTagih`. Faktur dan toko dibaca terpisah, bukan lewat relasi wajib:
 * `relationMode = "prisma"` tidak memasang foreign key, dan satu penunjuk
 * menggantung tidak boleh menjatuhkan seluruh layar.
 */
export async function tertagihTerverifikasi(bulan: string, salesmanId?: string): Promise<BarisTertagih[]> {
  const r = rentangBulanWib(bulan);
  if (!r) return [];
  if (salesmanId !== undefined && !salesmanId) return [];

  const klaim = await prisma.paymentClaim.findMany({
    where: {
      status: "TERVERIFIKASI",
      verifiedAt: { gte: r.awal, lt: r.akhir },
      ...(salesmanId
        ? { OR: [{ salesmanId }, { receivableLinks: { some: { receivable: { salesmanId } } } }] }
        : {}),
    },
    select: {
      id: true,
      docNo: true,
      salesmanId: true,
      storeId: true,
      verifiedAt: true,
      invoiceAmount: true,
      receivedAmount: true,
      receivableLinks: { select: { receivableId: true, settledAmount: true } },
    },
    orderBy: [{ verifiedAt: "desc" }, { docNo: "desc" }],
  });
  if (klaim.length === 0) return [];

  const idPiutang = [...new Set(klaim.flatMap((k) => k.receivableLinks.map((l) => l.receivableId)))];
  const idToko = [...new Set(klaim.map((k) => k.storeId))];
  const [piutang, toko] = await Promise.all([
    idPiutang.length
      ? prisma.receivable.findMany({ where: { id: { in: idPiutang } }, select: { id: true, invoiceNo: true, salesmanId: true } })
      : [],
    prisma.store.findMany({ where: { id: { in: idToko } }, select: { id: true, name: true } }),
  ]);
  const petaPiutang = new Map(piutang.map((p) => [p.id, p]));
  const namaToko = new Map(toko.map((t) => [t.id, t.name]));

  const hasil: BarisTertagih[] = [];
  for (const k of klaim) {
    const nilaiFaktur = angka(k.invoiceAmount);
    const uangMasuk = angka(k.receivedAmount);
    for (const l of k.receivableLinks) {
      const p = petaPiutang.get(l.receivableId);
      const dilunasi = angka(l.settledAmount);
      hasil.push({
        claimId: k.id,
        docNo: k.docNo,
        verifiedAt: k.verifiedAt as Date,
        storeId: k.storeId,
        toko: namaToko.get(k.storeId) ?? "—",
        receivableId: l.receivableId,
        invoiceNo: p?.invoiceNo ?? "—",
        // Faktur yang tidak ditemukan dibaca sebagai faktur tanpa penjual:
        // uangnya tetap masuk dan tetap ada yang menagihnya.
        penjualId: p?.salesmanId ?? null,
        penagihId: k.salesmanId,
        dilunasi,
        nilai: nilaiTunaiPorsi(dilunasi, nilaiFaktur, uangMasuk),
      });
    }
  }
  return hasil;
}

export type BarisKomisiTagih = {
  claimId: string;
  receivableId: string;
  docNo: string;
  verifiedAt: Date;
  toko: string;
  invoiceNo: string;
  dilunasi: number;
  nilai: number;
  peran: PeranTagih;
  bagian: number;
};

export type RincianKomisi = {
  bulan: string;
  skema: SkemaKomisi;
  hasil: HasilKomisi;
  omzet: OmzetBulan;
  target: number | null;
  tertagih: { bagianPenjual: number; bagianPenagih: number; total: number };
  baris: BarisKomisiTagih[];
};

/**
 * Perkiraan komisi satu salesman untuk satu bulan WIB.
 *
 * `opsi` membiarkan pemanggil yang SUDAH memegang angkanya (beranda sudah
 * menghitung omzet dan target bulan ini) tidak menghitung ulang; dan membiarkan
 * tes memberi skemanya sendiri tanpa menulis pengaturan bersama.
 */
export async function komisiSalesman(
  salesmanId: string,
  bulan: string,
  opsi: { omzet?: OmzetBulan; target?: number | null; skema?: SkemaKomisi } = {},
): Promise<RincianKomisi> {
  const [setelan, omzet, tagih] = await Promise.all([
    bacaSetelan(),
    opsi.omzet ? Promise.resolve(opsi.omzet) : omzetBulan(salesmanId, bulan),
    tertagihTerverifikasi(bulan, salesmanId),
  ]);
  const skema = opsi.skema ?? setelan.skema;
  const target = opsi.target !== undefined ? opsi.target : bacaTargetBulan(setelan.target, salesmanId, bulan);

  const baris: BarisKomisiTagih[] = [];
  for (const b of tagih) {
    const p = porsiTagih(b, salesmanId, skema.bagianPenagihPersen);
    if (!p) continue;
    baris.push({
      claimId: b.claimId,
      receivableId: b.receivableId,
      docNo: b.docNo,
      verifiedAt: b.verifiedAt,
      toko: b.toko,
      invoiceNo: b.invoiceNo,
      dilunasi: b.dilunasi,
      nilai: b.nilai,
      peran: p.peran,
      bagian: p.bagian,
    });
  }
  const tertagih = ringkasTagih(tagih, salesmanId, skema.bagianPenagihPersen);

  return {
    bulan,
    skema,
    hasil: hitungKomisi({ skema, salesmanId, omzet: omzet.total, tertagih: tertagih.total, target }),
    omzet,
    target,
    tertagih,
    baris,
  };
}

export type BarisLaporanKomisi = {
  salesmanId: string;
  nama: string;
  omzet: number;
  target: number | null;
  tertagih: { bagianPenjual: number; bagianPenagih: number; total: number };
  hasil: HasilKomisi;
};

/**
 * Laporan komisi semua salesman untuk kantor, satu bulan WIB.
 *
 * Pesertanya = semua salesman (`daftarSalesman`) DITAMBAH siapa pun yang
 * punya bagian dari uang tertagih bulan itu — mantan salesman atau pengguna
 * yang perannya sudah berubah tetap harus terlihat kalau uang tagihannya
 * masuk di bulan ini.
 */
export async function laporanKomisiBulan(
  bulan: string,
): Promise<{ skema: SkemaKomisi; baris: BarisLaporanKomisi[] }> {
  const [setelan, salesman, tagih] = await Promise.all([bacaSetelan(), daftarSalesman(), tertagihTerverifikasi(bulan)]);
  const { skema } = setelan;

  const nama = new Map(salesman.map((s) => [s.id, s.nama]));
  const ids = new Set(salesman.map((s) => s.id));
  for (const b of tagih) {
    for (const id of [b.penjualId, b.penagihId]) {
      if (id && porsiTagih(b, id, skema.bagianPenagihPersen)) ids.add(id);
    }
  }
  const tanpaNama = [...ids].filter((id) => !nama.has(id));
  if (tanpaNama.length) {
    const lain = await prisma.user.findMany({ where: { id: { in: tanpaNama } }, select: { id: true, name: true, email: true } });
    for (const u of lain) nama.set(u.id, u.name ?? u.email);
  }

  const baris = await Promise.all(
    [...ids].map(async (id): Promise<BarisLaporanKomisi> => {
      const omzet = (await omzetBulan(id, bulan)).total;
      const target = bacaTargetBulan(setelan.target, id, bulan);
      const tertagih = ringkasTagih(tagih, id, skema.bagianPenagihPersen);
      return {
        salesmanId: id,
        nama: nama.get(id) ?? id,
        omzet,
        target,
        tertagih,
        hasil: hitungKomisi({ skema, salesmanId: id, omzet, tertagih: tertagih.total, target }),
      };
    }),
  );
  baris.sort((a, b) => b.hasil.komisi - a.hasil.komisi || a.nama.localeCompare(b.nama, "id"));
  return { skema, baris };
}

/**
 * Papan peringkat satu bulan: capaian target semua salesman. Omzet orang
 * lain dipakai untuk mengurutkan tetapi tidak pernah keluar dari server
 * (`susunPeringkat` hanya mengisi omzet milik penonton).
 */
export async function peringkatBulan(bulan: string, penontonId: string): Promise<{ aturan: AturanPeringkat; baris: BarisPeringkat[] }> {
  const [setelan, salesman] = await Promise.all([bacaSetelan(), daftarSalesman()]);
  const peserta = await Promise.all(
    salesman.map(async (s) => ({
      id: s.id,
      nama: s.nama,
      omzet: (await omzetBulan(s.id, bulan)).total,
      target: bacaTargetBulan(setelan.target, s.id, bulan),
    })),
  );
  return { aturan: setelan.peringkat, baris: susunPeringkat(peserta, penontonId, setelan.peringkat) };
}

/** Bahan kartu Pengaturan → Salesman → Komisi (selain izin ubah, yang dipegang halamannya). */
export async function dataKartuKomisi(): Promise<{
  skema: SkemaKomisi;
  peringkat: AturanPeringkat;
  salesman: { id: string; nama: string }[];
}> {
  const [setelan, salesman] = await Promise.all([bacaSetelan(), daftarSalesman()]);
  return { skema: setelan.skema, peringkat: setelan.peringkat, salesman };
}
