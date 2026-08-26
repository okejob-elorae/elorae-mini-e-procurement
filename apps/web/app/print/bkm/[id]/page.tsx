'use client';

import { use, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { ambilCetakKlaim } from '@/app/actions/receivable-print';
import type { RincianKlaim } from '@/lib/receivables/claim-queries';
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

const KEADAAN: Record<RincianKlaim['status'], string> = {
  DIKIRIM: 'Belum diverifikasi',
  TERVERIFIKASI: 'Terverifikasi',
  DITOLAK: 'Ditolak',
  DIBATALKAN: 'Dibatalkan',
};

export default function CetakBkmPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<RincianKlaim | null | 'galat'>(null);

  useEffect(() => {
    ambilCetakKlaim(id)
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
    return <div className="p-8 text-center text-sm">BKM tidak ditemukan.</div>;
  }

  return (
    <LembarCetak
      judul="Bukti Kas Masuk"
      nomor={data.docNo}
      meta={[
        { label: 'Toko', nilai: data.storeName },
        { label: 'Tanggal transfer', nilai: tanggal(data.claimedTransferAt) },
        { label: 'Salesman', nilai: data.salesmanName ?? '—' },
        { label: 'Cara bayar', nilai: data.method },
        { label: 'Keadaan', nilai: KEADAAN[data.status] },
        {
          label: 'Diverifikasi',
          nilai: data.verifikatorNama
            ? `${data.verifikatorNama}${data.verifikasiPada ? `, ${tanggal(data.verifikasiPada)}` : ''}`
            : '—',
        },
      ]}
      tandaTangan={['Diserahkan oleh', 'Diterima oleh', 'Mengetahui']}
    >
      <h2 className="mb-1 text-[10pt] font-semibold uppercase tracking-wide">Faktur yang dilunasi</h2>
      <TabelCetak
        kepala={[
          { teks: 'No. faktur' },
          { teks: 'Nilai faktur', kanan: true },
          { teks: 'Dilunasi', kanan: true },
        ]}
      >
        {data.faktur.map((f) => (
          <tr key={f.id} className="border-b border-neutral-300">
            <td className="px-2 py-1.5 font-mono">{f.invoiceNo}</td>
            <td className="px-2 py-1.5 text-right tabular-nums">{rupiah(f.nilaiFaktur)}</td>
            <td className="px-2 py-1.5 text-right tabular-nums">{rupiah(f.nilaiDilunasi)}</td>
          </tr>
        ))}
      </TabelCetak>

      {data.potongan.length > 0 && (
        <>
          <h2 className="mb-1 mt-5 text-[10pt] font-semibold uppercase tracking-wide">Potongan</h2>
          <TabelCetak
            kepala={[{ teks: 'Keterangan' }, { teks: 'Nota retur' }, { teks: 'Nilai', kanan: true }]}
          >
            {data.potongan.map((p, n) => (
              <tr key={n} className="border-b border-neutral-300">
                <td className="px-2 py-1.5">
                  {p.nama}
                  {p.catatan && (
                    <span className="block text-[9pt] text-neutral-600">{p.catatan}</span>
                  )}
                </td>
                <td className="px-2 py-1.5 font-mono">{p.noNrt ?? '—'}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{rupiah(p.nilai)}</td>
              </tr>
            ))}
          </TabelCetak>
        </>
      )}

      <div className="mt-4 space-y-1 text-[10pt]">
        <Baris label="Nilai faktur" nilai={rupiah(data.nilaiFaktur)} />
        <Baris label="Total potongan" nilai={`− ${rupiah(data.totalPotongan)}`} />
        <div className="flex justify-between border-t border-black pt-1 text-[11pt] font-bold">
          <span>Diterima</span>
          <span className="tabular-nums">{rupiah(data.nilaiDiterima)}</span>
        </div>
      </div>

      {/*
        Nilai tertahan dicetak kalau ada. Lembar yang berpindah tangan harus
        menyebutkan bahwa sebagian nilainya belum diakui — kalau tidak, toko
        menyimpan bukti yang tampak menyatakan lunas atas jumlah yang lebih
        besar daripada yang sebenarnya dilepas.
      */}
      {data.status === 'TERVERIFIKASI' && data.nilaiTertahan > 0 && (
        <p className="mt-4 border border-black p-2 text-[9.5pt]">
          <span className="font-semibold">Tertahan {rupiah(data.nilaiTertahan)}</span> — potongan
          retur belum cocok dengan barang yang diterima gudang. Sisa faktur belum bisa nol sampai
          selisihnya beres.
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
