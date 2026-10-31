import { prisma } from "@elorae/db";
import { bacaAturanPeringkat, KUNCI_PERINGKAT, rentangBulanWib, susunPeringkat, type AturanPeringkat } from "./komisi";
import { omzetBulan } from "./komisi-queries";
import { bacaTargetBulan, KUNCI_TARGET } from "./pengaturan";
import { omzetTanpaKonsi, pcsKonsiBulan } from "./penjualan-hp";
import { pcsKonsiSalesman } from "./penjualan-hp-queries";
import { daftarSalesman } from "./queries";

/**
 * Papan peringkat salesman untuk HP — SELURUHNYA atas putus + van.
 *
 * Aturan mutlak pemilik: harga dan total konsinyasi tidak pernah sampai ke
 * aplikasi salesman. Papan resmi (`peringkatBulan`) memuat konsi: omzet sendiri
 * yang dikirim adalah total dengan konsi, dan capaian sendiri × target (yang
 * terlihat di halaman Target) − putus − van = konsi. Mengurutkan dengan angka
 * resmi pun membocorkan: persen rekan di atas dan di bawah posisi sendiri
 * mengapit capaian resmi sendiri, jadi konsinya bisa ditebak sampai beberapa
 * persen target. Karena itu urutan, persen, dan omzet di papan HP semuanya
 * putus + van, untuk semua peserta — sama dengan Insentif dan kartu "Bulan ini".
 *
 * Konsinyasi hanya sebagai pcs, dan hanya milik penonton sendiri.
 *
 * Client screens hanya boleh `import type` dari berkas ini (memuat Prisma).
 */

export type BarisPeringkatHp = {
  /** Peringkat bersaing: capaian sama → peringkat sama (1, 2, 2, 4). */
  peringkat: number;
  /** Urutan baris 1..n — label "Sales #n" saat nama disembunyikan. */
  posisi: number;
  /** null = disembunyikan pengaturan pemilik. Nama sendiri selalu terlihat. */
  nama: string | null;
  /** Capaian target atas putus + van. */
  persen: number | null;
  /** Omzet putus + van — hanya milik penonton sendiri. */
  omzet: number | null;
  /** Pcs konsinyasi bulan itu — hanya milik penonton sendiri. */
  pcsKonsi: number | null;
  adaTarget: boolean;
  diriSendiri: boolean;
};

async function bacaSetelanPeringkat(): Promise<{ aturan: AturanPeringkat; target: string | null }> {
  const baris = await prisma.systemSetting.findMany({
    where: { key: { in: [KUNCI_PERINGKAT, KUNCI_TARGET] } },
    select: { key: true, value: true },
  });
  const nilai = (k: string) => baris.find((b) => b.key === k)?.value ?? null;
  return { aturan: bacaAturanPeringkat(nilai(KUNCI_PERINGKAT)), target: nilai(KUNCI_TARGET) };
}

/**
 * Papan peringkat satu bulan WIB untuk HP penonton. `opsi.peserta`,
 * `opsi.target`, dan `opsi.aturan` hanya untuk tes — halaman memakai daftar
 * salesman dan pengaturan kantor.
 */
export async function peringkatHp(
  bulan: string,
  penontonId: string,
  opsi: {
    hariIni?: Date;
    peserta?: readonly { id: string; nama: string }[];
    target?: string | null;
    aturan?: AturanPeringkat;
  } = {},
): Promise<BarisPeringkatHp[]> {
  const hariIni = opsi.hariIni ?? new Date();
  const perlu = opsi.target === undefined || opsi.aturan === undefined;
  const [setelan, peserta] = await Promise.all([
    perlu ? bacaSetelanPeringkat() : Promise.resolve(null),
    opsi.peserta ? Promise.resolve(opsi.peserta) : daftarSalesman(),
  ]);
  const aturan = opsi.aturan ?? setelan?.aturan ?? bacaAturanPeringkat(null);
  const target = opsi.target !== undefined ? opsi.target : (setelan?.target ?? null);

  const rentang = rentangBulanWib(bulan);
  const [dinilai, pcs] = await Promise.all([
    Promise.all(
      peserta.map(async (s) => ({
        id: s.id,
        nama: s.nama,
        // Omzet resmi dibaca di server, tapi yang dipakai hanya putus + van.
        omzet: omzetTanpaKonsi(await omzetBulan(s.id, bulan)).total,
        target: bacaTargetBulan(target, s.id, bulan),
      })),
    ),
    rentang && penontonId ? pcsKonsiSalesman(penontonId, rentang.awal, rentang.akhir) : Promise.resolve([]),
  ]);

  const pcsSendiri = pcsKonsiBulan(pcs, bulan, hariIni);
  // Kunci dipilih satu per satu: id rekan tidak dikirim — saat nama
  // disembunyikan, "Sales #n" tidak boleh bisa ditelusuri balik.
  return susunPeringkat(dinilai, penontonId, aturan).map((b) => ({
    peringkat: b.peringkat,
    posisi: b.posisi,
    nama: b.nama,
    persen: b.persen,
    omzet: b.diriSendiri ? b.omzet : null,
    pcsKonsi: b.diriSendiri ? pcsSendiri : null,
    adaTarget: b.adaTarget,
    diriSendiri: b.diriSendiri,
  }));
}
