'use client';

import { use, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { ambilCetakFaktur, type CetakFaktur } from '@/app/actions/receivable-print';
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

export default function CetakFakturPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<CetakFaktur | null | 'galat'>(null);

  useEffect(() => {
    ambilCetakFaktur(id)
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
    return <div className="p-8 text-center text-sm">Faktur tidak ditemukan.</div>;
  }

  return (
    <LembarCetak
      judul="Faktur"
      nomor={data.invoiceNo}
      meta={[
        { label: 'Toko', nilai: data.storeName },
        { label: 'Tanggal', nilai: tanggal(data.invoiceDate) },
        { label: 'Alamat', nilai: data.storeAddress ?? '—' },
        { label: 'Jatuh tempo', nilai: tanggal(data.dueDate) },
        { label: 'Salesman', nilai: data.salesmanName ?? '—' },
      ]}
      tandaTangan={['Penerima', 'Hormat kami']}
    >
      {data.items.length > 0 ? (
        <TabelCetak
          kepala={[
            { teks: 'Barang' },
            { teks: 'Qty', kanan: true },
            { teks: 'Harga', kanan: true },
            { teks: 'Jumlah', kanan: true },
          ]}
        >
          {data.items.map((i, n) => (
            <tr key={n} className="border-b border-neutral-300">
              <td className="px-2 py-1.5">{i.itemName}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{i.qty}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{rupiah(i.price)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{rupiah(i.amount)}</td>
            </tr>
          ))}
        </TabelCetak>
      ) : (
        /* Faktur impor datang sebagai total tanpa rincian. Dicetak apa adanya
           daripada memalsukan satu baris "jumlah" yang tidak ada di sumbernya. */
        <p className="border-y border-black py-3 text-[10pt] text-neutral-600">
          Faktur ini tidak memuat rincian barang.
        </p>
      )}

      <div className="mt-4 space-y-1 text-[10pt]">
        <Baris label="Nilai faktur" nilai={rupiah(data.amount)} />
        <Baris label="Sudah dibayar" nilai={rupiah(data.amount - data.outstanding)} />
        <div className="flex justify-between border-t border-black pt-1 text-[11pt] font-bold">
          <span>Sisa tagihan</span>
          <span className="tabular-nums">{rupiah(data.outstanding)}</span>
        </div>
      </div>
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
