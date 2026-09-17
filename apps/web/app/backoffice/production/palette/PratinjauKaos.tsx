import { rasioKontras } from '@/lib/production-colors/palet/kontras';

/** Siluet kaos sederhana — cukup untuk membaca warna kain, bukan gambar produk. */
const KAOS =
  'M70 18 L88 10 Q100 24 112 10 L130 18 L172 42 L158 74 L142 66 L142 188 L58 188 L58 66 L42 74 L28 42 Z';

const SISI = 10;

/**
 * Pratinjau porsi sablon di atas warna kain.
 *
 * Bidang cetaknya kisi 10 × 10: satu kotak = 1% luas desain. Kisi, bukan pita
 * atau lingkaran, karena persen bulat terbaca langsung dengan menghitung
 * kotak — dan bentuknya sendiri terasa seperti bidang sablon.
 */
export function PratinjauKaos({
  kainHex,
  tinta,
  label,
}: {
  kainHex: string;
  tinta: { huruf: string; hex: string; porsi: number }[];
  label: string;
}) {
  const kotak: string[] = [];
  for (const t of tinta) for (let i = 0; i < Math.max(0, Math.round(t.porsi)); i++) kotak.push(t.hex);
  const garis = rasioKontras(kainHex, '#000000') >= rasioKontras(kainHex, '#ffffff') ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.3)';

  const lebarBidang = 56;
  const celah = 0.8;
  const ukuran = (lebarBidang - celah * (SISI - 1)) / SISI;
  const kiri = 100 - lebarBidang / 2;
  const atas = 58;

  return (
    <svg viewBox="0 0 200 200" role="img" aria-label={label} className="mx-auto block h-auto w-full max-w-[18rem]">
      <path d={KAOS} fill={kainHex} stroke={garis} strokeWidth={1.5} strokeLinejoin="round" />
      <path d="M88 10 Q100 24 112 10" fill="none" stroke={garis} strokeWidth={1.5} />
      {Array.from({ length: SISI * SISI }, (_, i) => {
        const warna = kotak[i];
        const x = kiri + (i % SISI) * (ukuran + celah);
        const y = atas + Math.floor(i / SISI) * (ukuran + celah);
        return warna ? (
          <rect key={i} x={x} y={y} width={ukuran} height={ukuran} rx={0.8} fill={warna} />
        ) : (
          <rect key={i} x={x} y={y} width={ukuran} height={ukuran} rx={0.8} fill="none" stroke={garis} strokeWidth={0.4} strokeDasharray="1 1" />
        );
      })}
    </svg>
  );
}
