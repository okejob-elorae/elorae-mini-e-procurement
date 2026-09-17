import { INDEKS_DASAR, langkahHarmoni, type AturanHarmoni } from '@/lib/creative/palet/harmoni';
import { cn } from '@/lib/utils';

const PUSAT = 12;
const TEPI = 8;

/** Sebaran acak yang tetap — `CUSTOM` tidak punya resep untuk digambar. */
const SEBARAN_BEBAS = [
  { dh: 25, s: 0.6 },
  { dh: 115, s: 0.95 },
  { dh: 205, s: 0.45 },
  { dh: 290, s: 0.85 },
];

function titik(dh: number, s: number) {
  const rad = (dh * Math.PI) / 180;
  return { x: PUSAT + s * TEPI * Math.sin(rad), y: PUSAT - s * TEPI * Math.cos(rad) };
}

/**
 * Gambar kecil sebuah aturan harmoni: lingkaran roda dengan titik di posisi
 * tiap warnanya, seperti ikon aturan di Adobe Color. Warnanya `currentColor`,
 * jadi mengikuti teks di sekitarnya.
 */
export function IkonHarmoni({ aturan, className }: { aturan: AturanHarmoni; className?: string }) {
  const langkah = langkahHarmoni(aturan);
  const unik = new Map<string, { x: number; y: number; dasar: boolean }>();
  if (langkah) {
    langkah.forEach((l, i) => {
      const kunci = `${l.dh}|${l.s}`;
      const ada = unik.get(kunci);
      unik.set(kunci, { ...titik(l.dh, l.s), dasar: (ada?.dasar ?? false) || i === INDEKS_DASAR });
    });
  } else {
    SEBARAN_BEBAS.forEach((l) => unik.set(`${l.dh}|${l.s}`, { ...titik(l.dh, l.s), dasar: false }));
  }
  const semua = [...unik.values()];
  // Shades menaruh kelima warna di satu titik. Satu titik polos tidak
  // bercerita apa-apa, jadi titiknya diberi riak: warna sama, terang berbeda.
  const riak = aturan === 'SHADES';

  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn('shrink-0', className)}>
      <circle cx={PUSAT} cy={PUSAT} r={TEPI + 2} fill="none" stroke="currentColor" strokeOpacity={0.35} strokeWidth={1.25} />
      {semua.map((p, i) => (
        <line key={`g${i}`} x1={PUSAT} y1={PUSAT} x2={p.x} y2={p.y} stroke="currentColor" strokeOpacity={0.45} strokeWidth={1} />
      ))}
      {riak &&
        semua.map((p, i) => (
          <g key={`r${i}`}>
            <circle cx={p.x} cy={p.y} r={4.6} fill="currentColor" fillOpacity={0.15} />
            <circle cx={p.x} cy={p.y} r={3.4} fill="currentColor" fillOpacity={0.3} />
          </g>
        ))}
      {semua.map((p, i) => (
        <circle key={`t${i}`} cx={p.x} cy={p.y} r={p.dasar ? 2.4 : 1.8} fill="currentColor" />
      ))}
    </svg>
  );
}
