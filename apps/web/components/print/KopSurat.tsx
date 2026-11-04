'use client';

/**
 * Kop dan kerangka satu halaman cetak.
 *
 * Semua dokumen modul ini memakainya supaya yang keluar dari printer terlihat
 * berasal dari satu perusahaan, bukan dari lima layar yang kebetulan bisa
 * dicetak. Ruang tanda tangan ikut di sini karena hampir setiap dokumen di sini
 * berpindah tangan dan ditandatangani.
 */
export function LembarCetak({
  judul,
  nomor,
  meta,
  children,
  tandaTangan,
}: {
  judul: string;
  nomor: string;
  meta: { label: string; nilai: string }[];
  children: React.ReactNode;
  tandaTangan?: string[];
}) {
  return (
    <div className="mx-auto max-w-[190mm] bg-white p-8 text-[11pt] leading-snug text-black">
      <header className="mb-6 flex items-start justify-between gap-6 border-b-2 border-black pb-3">
        <div>
          <p className="text-lg font-bold tracking-tight">ELORAE</p>
          <p className="text-[9pt] text-neutral-600">Sistem Piutang &amp; Retur</p>
        </div>
        <div className="text-right">
          <p className="text-base font-bold uppercase tracking-wide">{judul}</p>
          <p className="font-mono text-sm">{nomor}</p>
        </div>
      </header>

      {meta.length > 0 && (
        <dl className="mb-5 grid grid-cols-2 gap-x-8 gap-y-1 text-[10pt]">
          {meta.map((m) => (
            <div key={m.label} className="flex gap-2">
              <dt className="w-32 shrink-0 text-neutral-600">{m.label}</dt>
              <dd className="font-medium">{m.nilai}</dd>
            </div>
          ))}
        </dl>
      )}

      {children}

      {tandaTangan && tandaTangan.length > 0 && (
        <div
          className="mt-10 grid gap-8"
          style={{ gridTemplateColumns: `repeat(${tandaTangan.length}, minmax(0, 1fr))` }}
        >
          {tandaTangan.map((peran) => (
            <div key={peran} className="text-center text-[10pt]">
              <p className="mb-14 text-neutral-600">{peran}</p>
              <p className="border-t border-black pt-1">(&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;)</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function TabelCetak({
  kepala,
  children,
}: {
  kepala: { teks: string; kanan?: boolean }[];
  children: React.ReactNode;
}) {
  return (
    <table className="w-full border-collapse text-[10pt]">
      <thead>
        <tr className="border-y border-black">
          {kepala.map((k) => (
            <th
              key={k.teks}
              className={`px-2 py-1.5 font-semibold ${k.kanan ? 'text-right' : 'text-left'}`}
            >
              {k.teks}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}
