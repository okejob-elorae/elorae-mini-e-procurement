import { prisma } from "@elorae/db";
import { parseDateOnly, parseDateOnlyEnd } from "@/lib/date-only";
import {
  ANGKA_NOL,
  biayaKolaborasi,
  jumlahkanAngka,
  roas,
  totalInteraksi,
  type AngkaKonten,
  type RincianBiaya,
} from "./angka-konten";

/*
 * Angka hasil per kolaborasi — SATU tempat yang dipakai Hari ini, Kolaborasi,
 * KOL, Campaign, dan Laporan (2026-10-07). Jangan menghitung ulang di layar.
 *
 * - Angka konten = jumlah angka TERBARU tiap konten (angka tidak pernah
 *   ditimpa; setiap pengisian adalah baris baru, yang terakhir yang berlaku).
 * - Biaya = fee + boost + ongkir + HPP sampel yang sudah berangkat + komisi
 *   penjualan (`biayaKolaborasi`). Fee dihitung penuh (biaya rencana), bukan
 *   hanya yang sudah diakui sebagai beban. Bila kolaborasi punya termin, fee =
 *   Σ BRUTO termin yang tidak batal — angka yang sama dengan beban di jurnal
 *   (`jurnal-kol-aturan.ts`): untuk gross-up `KolBrief.fee` adalah neto yang
 *   diterima KOL, jadi PPh yang ditanggung Elorae ikut masuk biaya.
 * - Dengan `periode` (hari WIB "YYYY-MM-DD", inklusif): penjualan menurut
 *   tanggalnya, konten menurut tanggal tayang, pengiriman menurut tanggal
 *   berangkat, fee dan boost bila kolaborasi deal (atau dibuat) di periode itu.
 */

export type AngkaKolaborasi = {
  angka: AngkaKonten;
  interaksi: number;
  jumlahKonten: number;
  orders: number;
  gmv: number;
  komisi: number;
  biaya: RincianBiaya;
  roas: number | null;
};

export type Periode = { dari: string; sampai: string };

function dalam(tgl: Date | null | undefined, batas: { dari: Date; sampai: Date } | null): boolean {
  if (!batas) return true;
  if (!tgl) return false;
  return tgl >= batas.dari && tgl <= batas.sampai;
}

function batasPeriode(periode?: Periode | null): { dari: Date; sampai: Date } | null {
  if (!periode) return null;
  const dari = parseDateOnly(periode.dari);
  const sampai = parseDateOnlyEnd(periode.sampai);
  if (!dari || !sampai) return null;
  return { dari, sampai };
}

const angkaNol = (): AngkaKolaborasi => ({
  angka: { ...ANGKA_NOL },
  interaksi: 0,
  jumlahKonten: 0,
  orders: 0,
  gmv: 0,
  komisi: 0,
  biaya: biayaKolaborasi({}),
  roas: null,
});

export async function angkaKolaborasi(
  ids: readonly string[],
  opsi: { periode?: Periode | null } = {},
): Promise<Map<string, AngkaKolaborasi>> {
  const hasil = new Map<string, AngkaKolaborasi>();
  const unik = [...new Set(ids.filter(Boolean))];
  if (unik.length === 0) return hasil;
  const batas = batasPeriode(opsi.periode);

  const [kolab, konten, penjualan, kiriman, termin] = await Promise.all([
    prisma.kolBrief.findMany({
      where: { id: { in: unik } },
      select: { id: true, fee: true, boostCost: true, dealAt: true, createdAt: true },
    }),
    prisma.kolContent.findMany({
      where: { collabId: { in: unik } },
      select: {
        id: true,
        collabId: true,
        link: true,
        liveAt: true,
        metrics: {
          select: { recordedAt: true, views: true, likes: true, comments: true, shares: true, saves: true },
          orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
          take: 1,
        },
      },
    }),
    prisma.kolSale.findMany({
      where: { collabId: { in: unik } },
      select: { collabId: true, date: true, orders: true, gmv: true, commission: true },
    }),
    prisma.kolShipment.findMany({
      where: { collabId: { in: unik } },
      select: {
        collabId: true,
        sentAt: true,
        stockIssuedAt: true,
        shippingCost: true,
        lines: { select: { qty: true, unitCost: true } },
      },
    }),
    prisma.kolPaymentTerm.findMany({
      where: { collabId: { in: unik }, status: { not: "BATAL" } },
      select: { collabId: true, bruto: true },
    }),
  ]);

  const brutoSen = new Map<string, number>();
  for (const t of termin) brutoSen.set(t.collabId, (brutoSen.get(t.collabId) ?? 0) + Math.round(Number(t.bruto) * 100));

  for (const k of kolab) {
    const kontenIni = konten.filter((c) => c.collabId === k.id && c.link && dalam(c.liveAt, batas));
    const angka = jumlahkanAngka(
      kontenIni.map((c) => {
        const m = c.metrics[0];
        return m
          ? { views: m.views, likes: m.likes, comments: m.comments, shares: m.shares, saves: m.saves }
          : { ...ANGKA_NOL };
      }),
    );
    const jualIni = penjualan.filter((s) => s.collabId === k.id && dalam(s.date, batas));
    const kirimIni = kiriman.filter((s) => s.collabId === k.id && s.stockIssuedAt && dalam(s.sentAt ?? s.stockIssuedAt, batas));
    const feeMasuk = dalam(k.dealAt ?? k.createdAt, batas);
    const gmv = jualIni.reduce((s, j) => s + Number(j.gmv), 0);
    const biaya = biayaKolaborasi({
      fee: feeMasuk ? (brutoSen.has(k.id) ? brutoSen.get(k.id)! / 100 : Number(k.fee)) : 0,
      boostCost: feeMasuk ? Number(k.boostCost) : 0,
      ongkir: kirimIni.map((s) => Number(s.shippingCost)),
      sampel: kirimIni.flatMap((s) => s.lines.map((l) => ({ unitCost: Number(l.unitCost), qty: l.qty }))),
      komisi: jualIni.map((j) => Number(j.commission)),
    });
    hasil.set(k.id, {
      angka,
      interaksi: totalInteraksi(angka),
      jumlahKonten: kontenIni.length,
      orders: jualIni.reduce((s, j) => s + j.orders, 0),
      gmv: Math.round(gmv * 100) / 100,
      komisi: biaya.komisi,
      biaya,
      roas: roas(gmv, biaya.total),
    });
  }
  return hasil;
}

/** Jumlah beberapa kolaborasi (mis. satu KOL, satu campaign, atau satu periode). */
export function jumlahAngkaKolaborasi(daftar: Iterable<AngkaKolaborasi>): AngkaKolaborasi {
  const semua = [...daftar];
  if (semua.length === 0) return angkaNol();
  const angka = jumlahkanAngka(semua.map((a) => a.angka));
  const biaya = biayaKolaborasi({
    fee: semua.reduce((s, a) => s + a.biaya.fee, 0),
    boostCost: semua.reduce((s, a) => s + a.biaya.boost, 0),
    ongkir: semua.map((a) => a.biaya.ongkir),
    sampel: semua.map((a) => ({ unitCost: a.biaya.sampel, qty: 1 })),
    komisi: semua.map((a) => a.biaya.komisi),
  });
  const gmv = Math.round(semua.reduce((s, a) => s + a.gmv, 0) * 100) / 100;
  return {
    angka,
    interaksi: totalInteraksi(angka),
    jumlahKonten: semua.reduce((s, a) => s + a.jumlahKonten, 0),
    orders: semua.reduce((s, a) => s + a.orders, 0),
    gmv,
    komisi: biaya.komisi,
    biaya,
    roas: roas(gmv, biaya.total),
  };
}
