'use client';

import { use, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { ambilCetakSiklus } from '@/app/actions/receivable-print';
import type { RincianSiklus } from '@/lib/konsinyasi/queries';
import { LembarCetak, TabelCetak } from '@/components/print/KopSurat';
import { useCetakOtomatis } from '@/components/print/cetakOtomatis';

const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;
const tanggal = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'Asia/Jakarta',
      })
    : '—';

export default function CetakSiklusPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<RincianSiklus | null | 'galat'>(null);

  useEffect(() => {
    ambilCetakSiklus(id)
      .then((d) => setData(d ?? 'galat'))
      .catch(() => setData('galat'));
  }, [id]);

  useCetakOtomatis(data !== null && data !== 'galat');

  if (data === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
      </div>
    );
  }
  if (data === 'galat') {
    return <div className="p-8 text-center text-sm">Siklus tidak ditemukan.</div>;
  }

  const b = data.baris;
  const totalKomisi = data.komisi.reduce((s, k) => s + k.total, 0);

  return (
    <LembarCetak
      judul="Siklus Konsinyasi"
      nomor={b.noKonsi}
      meta={[
        { label: 'Toko', nilai: b.storeName },
        { label: 'Periode', nilai: b.periode },
        { label: 'No. nota', nilai: b.noNota ?? '—' },
        { label: 'No. faktur pajak', nilai: b.noFakturPajak ?? '—' },
        { label: 'Dikunci', nilai: data.dikunciOleh ? `${data.dikunciOleh}, ${tanggal(data.dikunciPada)}` : 'belum' },
        { label: 'Tenggat gaji SPG', nilai: tanggal(b.tenggatSpg) },
      ]}
      tandaTangan={['Admin konsinyasi', 'Toko', 'Mengetahui']}
    >
      {/*
        Yang dicetak adalah ANGKA RESMI, bukan salah satu laporan mentah. Lembar
        yang berpindah tangan harus membawa angka yang menagih, bukan angka yang
        masih diperdebatkan.
      */}
      <h2 className="mb-1 text-[10pt] font-semibold uppercase tracking-wide">Angka resmi</h2>
      {data.resmi.length === 0 ? (
        <p className="border-y border-black py-3 text-[10pt] text-neutral-600">
          Angkanya belum dikunci — belum ada nilai resmi untuk ditagihkan.
        </p>
      ) : (
        <TabelCetak
          kepala={[
            { teks: 'Barang' },
            { teks: 'Qty', kanan: true },
            { teks: 'Harga', kanan: true },
            { teks: 'Jumlah', kanan: true },
          ]}
        >
          {data.resmi.map((r, i) => (
            <tr key={i} className="border-b border-neutral-300">
              <td className="px-2 py-1.5">{r.itemName}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{r.qty}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{rupiah(r.price)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{rupiah(r.amount)}</td>
            </tr>
          ))}
          <tr className="border-t border-black font-bold">
            <td className="px-2 py-1.5" colSpan={3}>
              Total
            </td>
            <td className="px-2 py-1.5 text-right tabular-nums">{rupiah(b.nilaiTerjual)}</td>
          </tr>
        </TabelCetak>
      )}

      {data.komisi.length > 0 && (
        <>
          <h2 className="mb-1 mt-5 text-[10pt] font-semibold uppercase tracking-wide">
            Gaji &amp; komisi SPG
          </h2>
          <TabelCetak
            kepala={[
              { teks: 'SPG' },
              { teks: 'Gaji pokok', kanan: true },
              { teks: 'Komisi', kanan: true },
              { teks: 'Total', kanan: true },
              { teks: 'Dibayar' },
            ]}
          >
            {data.komisi.map((k) => (
              <tr key={k.id} className="border-b border-neutral-300">
                <td className="px-2 py-1.5">{k.spgNama ?? '—'}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{rupiah(k.gajiPokok)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{rupiah(k.komisi)}</td>
                <td className="px-2 py-1.5 text-right font-semibold tabular-nums">
                  {rupiah(k.total)}
                </td>
                <td className="px-2 py-1.5">{tanggal(k.dibayarPada)}</td>
              </tr>
            ))}
            <tr className="border-t border-black font-bold">
              <td className="px-2 py-1.5" colSpan={3}>
                Total
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums">{rupiah(totalKomisi)}</td>
              <td />
            </tr>
          </TabelCetak>
        </>
      )}

      {data.titipan.length > 0 && (
        <>
          <h2 className="mb-1 mt-5 text-[10pt] font-semibold uppercase tracking-wide">
            Stok titipan
          </h2>
          <TabelCetak
            kepala={[
              { teks: 'Barang' },
              { teks: 'Dikirim', kanan: true },
              { teks: 'Terjual', kanan: true },
              { teks: 'Sisa', kanan: true },
            ]}
          >
            {data.titipan.map((x) => (
              <tr key={x.itemName} className="border-b border-neutral-300">
                <td className="px-2 py-1.5">{x.itemName}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{x.dikirim}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{x.terjual}</td>
                <td
                  className={`px-2 py-1.5 text-right tabular-nums ${x.sisa < 0 ? 'font-bold' : ''}`}
                >
                  {x.sisa}
                </td>
              </tr>
            ))}
          </TabelCetak>
        </>
      )}
    </LembarCetak>
  );
}
