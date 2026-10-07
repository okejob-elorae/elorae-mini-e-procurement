/**
 * Alat analisa Elorae untuk Claude (konektor MCP lokal, lihat
 * `scripts/mcp/elorae-analisa.ts`).
 *
 * HANYA MEMBACA, dan hanya lewat query yang sudah dipakai layar-layar Elorae —
 * Claude tidak pernah menulis SQL sendiri. Angka yang ia sebut karenanya sama
 * dengan angka di Beranda.
 *
 * PIUTANG DAN KONSINYASI BELUM ADA. Dulu ditahan karena syarat program SSG
 * ("tidak ada data yang keluar dari komputer ini"); sejak 2026-10-06 Elorae
 * tidak memuat data SSG sama sekali, jadi alatnya boleh ditambahkan bila
 * pemilik memintanya — lewat Claude Desktop datanya diproses di server Anthropic.
 *
 * Logika di sini murni — sumber datanya disuntikkan — supaya bisa diuji tanpa
 * basis data.
 */

import { bandingkanPeriode, kunciHariWib, MAKS_HARI_RENTANG, rentangTren, SALURAN, type TitikDasar } from '@/lib/dashboard/tren';

export type SumberData = {
  /** Tren harian untuk rentang, DITAMBAH periode sama panjang sebelumnya. */
  trenRentang(mulai: string, akhir: string): Promise<TitikDasar[] | null>;
  salesman(): Promise<unknown>;
  stok(): Promise<unknown>;
  produksi(): Promise<unknown>;
  marketplaceHariIni(): Promise<unknown>;
};

type Alat = { name: string; description: string; inputSchema: { type: 'object'; properties: Record<string, unknown>; additionalProperties: false } };

const TANGGAL = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };

export const ALAT: Alat[] = [
  {
    name: 'ringkasan_penjualan',
    description:
      'Total penjualan Elorae (Rupiah) untuk satu rentang tanggal WIB: marketplace (pesanan Jubelio, tanpa yang batal/retur) dan lapangan (pengiriman pesanan putus + penjualan van + nota SPG), jumlah per saluran (perSaluran: shopee, tiktok, tokopedia, mpLain = saluran Jubelio lain, putus, van, spg), rincian per hari yang ada penjualannya, dan perbandingan dengan periode sama panjang tepat sebelumnya. Tanpa argumen: 30 hari terakhir. Maksimal 366 hari.',
    inputSchema: {
      type: 'object',
      properties: {
        dari: { ...TANGGAL, description: 'Tanggal mulai, YYYY-MM-DD (WIB).' },
        sampai: { ...TANGGAL, description: 'Tanggal akhir, YYYY-MM-DD (WIB), ikut dihitung.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'penjualan_per_salesman',
    description:
      'Penjualan tiap salesman sejak awal: terealisasi (pengiriman putus + penjualan van) dan belum selesai (pesanan putus menunggu persetujuan), dalam Rupiah dan jumlah transaksi. Konsinyasi tidak dihitung.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'kondisi_stok',
    description:
      'Kondisi stok saat ini: nilai persediaan, pembagian nilai bahan baku vs barang jadi, jumlah barang di bawah batas minimum, SKU yang terjual melebihi stok (oversold), dan bahan yang kurang untuk rencana produksi.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'produksi_dan_pembelian',
    description:
      'Keadaan produksi dan pembelian: jumlah perintah kerja per status, PO yang lewat tanggal tiba (dengan pemasok dan berapa hari terlambat), dan jumlah PO yang menunggu persetujuan.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'marketplace_hari_ini',
    description:
      'Marketplace hari ini (WIB): nilai dan jumlah pesanan yang masuk hari ini, dan pesanan yang belum dikirim.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

const HARI_MS = 86_400_000;
const geser = (tgl: string, hari: number) =>
  new Date(Date.parse(`${tgl}T00:00:00Z`) + hari * HARI_MS).toISOString().slice(0, 10);

export async function jalankanAlat(
  nama: string,
  argumen: Record<string, unknown> | undefined,
  sumber: SumberData,
  hariIni: Date = new Date(),
): Promise<unknown> {
  switch (nama) {
    case 'ringkasan_penjualan': {
      const sampai = typeof argumen?.sampai === 'string' ? argumen.sampai : kunciHariWib(hariIni);
      const dari = typeof argumen?.dari === 'string' ? argumen.dari : geser(sampai, -29);
      const r = rentangTren(dari, sampai);
      if (!r) {
        return {
          galat: `Rentang tidak valid: pakai YYYY-MM-DD, "dari" tidak boleh setelah "sampai", maksimal ${MAKS_HARI_RENTANG} hari.`,
        };
      }
      const tren = await sumber.trenRentang(dari, sampai);
      if (!tren) return { galat: 'Rentang tidak valid.' };
      const kini = tren.slice(-r.panjang);
      const b = bandingkanPeriode(tren, r.panjang);
      const jumlah = (k: 'marketplace' | 'lapangan') => kini.reduce((s, t) => s + t[k], 0);
      return {
        dari,
        sampai,
        jumlahHari: r.panjang,
        total: b.sekarang,
        marketplace: jumlah('marketplace'),
        lapangan: jumlah('lapangan'),
        perSaluran: Object.fromEntries(SALURAN.map((k) => [k, kini.reduce((s, t) => s + (t[k] ?? 0), 0)])),
        periodeSebelumnya: { dari: r.mulaiPembanding, sampai: geser(dari, -1), total: b.sebelumnya },
        perubahanPersen: b.persen,
        hariAdaPenjualan: kini
          .filter((t) => t.marketplace + t.lapangan !== 0)
          .map((t) => ({ tanggal: t.tanggal, marketplace: t.marketplace, lapangan: t.lapangan, total: t.marketplace + t.lapangan })),
        mataUang: 'IDR',
      };
    }
    case 'penjualan_per_salesman':
      return jsonAman(await sumber.salesman());
    case 'kondisi_stok':
      return jsonAman(await sumber.stok());
    case 'produksi_dan_pembelian':
      return jsonAman(await sumber.produksi());
    case 'marketplace_hari_ini':
      return jsonAman(await sumber.marketplaceHariIni());
    default:
      return { galat: `Alat "${nama}" tidak ada. Yang tersedia: ${ALAT.map((a) => a.name).join(', ')}.` };
  }
}

/** Decimal Prisma, Date, dan bigint → JSON biasa. */
export function jsonAman(v: unknown): unknown {
  if (v == null) return v;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'bigint') return Number(v);
  if (Array.isArray(v)) return v.map(jsonAman);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown> & { toNumber?: () => number };
    if (typeof o.toNumber === 'function' && 'd' in o) return o.toNumber();
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, jsonAman(x)]));
  }
  return v;
}
