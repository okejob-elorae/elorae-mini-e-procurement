'use client';

import { use, useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { ambilCetakRetur } from '@/app/actions/receivable-print';
import type { RincianRetur } from '@/lib/receivables/return-queries';
import { LembarCetak, TabelCetak } from '@/components/print/KopSurat';
import { useCetakOtomatis } from '@/components/print/cetakOtomatis';

const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;
const tanggal = (iso: string) =>
  new Date(iso).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  });

const KIRIM: Record<string, string> = {
  SALES: 'dibawa sales',
  TOKO: 'dikirim toko',
  EKSPEDISI: 'lewat ekspedisi',
};

const BEBAN: Record<string, string> = {
  TOKO: 'toko',
  SALES: 'sales',
  GUDANG: 'gudang',
  PERUSAHAAN: 'perusahaan',
};

export default function CetakReturPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<RincianRetur | null | 'galat'>(null);

  useEffect(() => {
    ambilCetakRetur(id)
      .then((d) => setData(d ?? 'galat'))
      .catch(() => setData('galat'));
  }, [id]);

  useCetakOtomatis(data !== null && data !== 'galat');

  /* Disandingkan menurut NAMA barang, bukan urutan baris — gudang mencatat apa
     yang sampai, dan barang yang tidak sampai hanya ada di sisi klaim. */
  const perbandingan = useMemo(() => {
    if (!data || data === 'galat') return [];
    const peta = new Map<
      string,
      { nama: string; qtyKlaim: number; nilaiKlaim: number; qtyFisik: number | null; nilaiFisik: number | null }
    >();
    for (const i of data.barangKlaim) {
      peta.set(i.itemName, {
        nama: i.itemName,
        qtyKlaim: i.qty,
        nilaiKlaim: i.amount,
        qtyFisik: null,
        nilaiFisik: null,
      });
    }
    for (const i of data.barangFisik) {
      const ada = peta.get(i.itemName);
      if (ada) {
        ada.qtyFisik = i.qty;
        ada.nilaiFisik = i.amount;
      } else {
        peta.set(i.itemName, {
          nama: i.itemName,
          qtyKlaim: i.qtyClaim,
          nilaiKlaim: 0,
          qtyFisik: i.qty,
          nilaiFisik: i.amount,
        });
      }
    }
    return [...peta.values()];
  }, [data]);

  if (data === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
      </div>
    );
  }
  if (data === 'galat') {
    return <div className="p-8 text-center text-sm">Nota retur tidak ditemukan.</div>;
  }

  const b = data.baris;

  return (
    <LembarCetak
      judul="Nota Retur"
      nomor={b.nomor}
      meta={[
        { label: 'Toko', nilai: b.storeName ?? '—' },
        { label: 'Tanggal nota', nilai: tanggal(b.tanggal) },
        { label: 'Cara kirim', nilai: KIRIM[b.caraKirim] ?? b.caraKirim },
        { label: 'Dicatat oleh', nilai: b.salesmanName ?? '—' },
        { label: 'No. internal', nilai: data.gudang?.noNri ?? 'belum dicek' },
        {
          label: 'Dicek gudang',
          nilai: data.gudang
            ? `${data.gudang.olehNama ?? '—'}, ${tanggal(data.gudang.diterimaPada)}`
            : '—',
        },
      ]}
      tandaTangan={['Toko', 'Sales', 'Gudang']}
    >
      {perbandingan.length > 0 ? (
        <TabelCetak
          kepala={[
            { teks: 'Barang' },
            { teks: 'Qty klaim', kanan: true },
            { teks: 'Qty fisik', kanan: true },
            { teks: 'Nilai klaim', kanan: true },
            { teks: 'Nilai fisik', kanan: true },
          ]}
        >
          {perbandingan.map((p) => {
            const kurang = p.qtyFisik !== null && p.qtyFisik < p.qtyKlaim;
            return (
              <tr key={p.nama} className="border-b border-neutral-300">
                <td className="px-2 py-1.5">{p.nama}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{p.qtyKlaim}</td>
                <td
                  className={`px-2 py-1.5 text-right tabular-nums ${kurang ? 'font-bold' : ''}`}
                >
                  {p.qtyFisik === null ? '—' : p.qtyFisik}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">{rupiah(p.nilaiKlaim)}</td>
                <td
                  className={`px-2 py-1.5 text-right tabular-nums ${kurang ? 'font-bold' : ''}`}
                >
                  {p.nilaiFisik === null ? '—' : rupiah(p.nilaiFisik)}
                </td>
              </tr>
            );
          })}
        </TabelCetak>
      ) : (
        <p className="border-y border-black py-3 text-[10pt] text-neutral-600">
          Nota ini tidak memuat rincian barang.
        </p>
      )}

      <div className="mt-4 space-y-1 text-[10pt]">
        <Baris label="Total klaim toko" nilai={rupiah(b.nilaiKlaim ?? 0)} />
        <Baris
          label="Total fisik gudang"
          nilai={b.nilaiFisik === null ? 'belum dicek' : rupiah(b.nilaiFisik)}
        />
        <div className="flex justify-between border-t border-black pt-1 text-[11pt] font-bold">
          <span>Selisih</span>
          <span className="tabular-nums">
            {b.nilaiFisik === null ? '—' : rupiah(b.selisih)}
          </span>
        </div>
      </div>

      {data.beban && (
        <p className="mt-4 border border-black p-2 text-[9.5pt]">
          <span className="font-semibold">Selisih {rupiah(data.beban.amount)}</span>{' '}
          {data.beban.status === 'TERBUKA'
            ? '— belum ada yang menanggung. Selama itu, faktur terkait tetap terbuka.'
            : `— ditanggung ${BEBAN[data.beban.penanggung ?? ''] ?? '—'}${
                data.beban.diputuskanOleh ? `, diputuskan ${data.beban.diputuskanOleh}` : ''
              }.`}
          {data.beban.catatan && (
            <span className="block text-neutral-700">{data.beban.catatan}</span>
          )}
        </p>
      )}
    </LembarCetak>
  );
}

function Baris({ label, nilai }: { label: string; nilai: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-neutral-600">{label}</span>
      <span className="tabular-nums">{nilai}</span>
    </div>
  );
}
