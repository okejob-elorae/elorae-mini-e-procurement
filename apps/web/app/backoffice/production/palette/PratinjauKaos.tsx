'use client';

import { useId, useRef, type PointerEvent } from 'react';
import { rasioKontras } from '@/lib/production-colors/palet/kontras';
import { hexKeRgb, rgbKeHex } from '@/lib/production-colors/palet/warna';

/*
 * Kaos tampak depan dalam kanvas 400 × 420, berproporsi kaos sungguhan (lebar
 * dada kira-kira dua pertiga panjang badan). Bagian kanan cermin bagian kiri
 * (x → 400 − x). Garis leher adalah potongan kain; di belakangnya terlihat
 * bagian dalam kaos.
 */
const BADAN =
  'M160 34 C142 40 118 50 92 58 C70 64 46 96 28 140 L76 172 Q92 162 102 146 C104 240 98 320 100 392 ' +
  'Q200 402 300 392 C302 320 296 240 298 146 Q308 162 324 172 L372 140 C354 96 330 64 308 58 ' +
  'C282 50 258 40 240 34 C232 60 216 70 200 70 C184 70 168 60 160 34 Z';
const DALAM_LEHER = 'M160 34 Q200 48 240 34 C232 60 216 70 200 70 C184 70 168 60 160 34 Z';
const RIB_BELAKANG = 'M160 34 Q200 48 240 34 L236 38 Q200 55 164 38 Z';
const RIB_DEPAN = 'M160 34 C168 60 184 70 200 70 C216 70 232 60 240 34 L249 36 C241 68 222 80 200 80 C178 80 159 68 151 36 Z';

/** Bidang cetak di dada. */
const CETAK = { cx: 200, cy: 196, r: 62 };

function campur(hex: string, faktor: number): string {
  const { r, g, b } = hexKeRgb(hex);
  return rgbKeHex(r * faktor, g * faktor, b * faktor);
}

/** Kedalaman dari puncak lingkaran (0..2r) yang memotong `bagian` luasnya. */
function kedalamanUntuk(bagian: number, r: number): number {
  if (bagian <= 0) return 0;
  if (bagian >= 1) return 2 * r;
  const luas = (d: number) => (r * r * Math.acos((r - d) / r) - (r - d) * Math.sqrt(2 * r * d - d * d)) / (Math.PI * r * r);
  let bawah = 0;
  let atas = 2 * r;
  for (let i = 0; i < 40; i++) {
    const tengah = (bawah + atas) / 2;
    if (luas(tengah) < bagian) bawah = tengah;
    else atas = tengah;
  }
  return (bawah + atas) / 2;
}

/**
 * Pratinjau sablon di atas kaos berwarna kain.
 *
 * Desainnya lingkaran berpita seperti sablon "sunset": LUAS tiap pita sama
 * dengan porsi tintanya, jadi dominan benar-benar terlihat dominan. Bayangan,
 * lipatan, serat, dan jahitan digambar di atas kain dan tinta sekaligus, dan
 * tintanya sedikit mengikuti lipatan — supaya warna dinilai seperti di kaos
 * sungguhan, bukan di kotak datar. Kaos sedikit miring mengikuti kursor.
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
  // useId bisa berisi karakter yang tidak sah di url(#…).
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const kaosRef = useRef<HTMLDivElement>(null);

  const kainTerang = rasioKontras(kainHex, '#000000') >= rasioKontras(kainHex, '#ffffff');
  const bayang = kainTerang ? 1 : 0.75;
  const kilap = kainTerang ? 0.6 : 1.5;

  const total = tinta.reduce((s, t) => s + Math.max(0, t.porsi), 0);
  const { cx, cy, r } = CETAK;
  const pita = tinta.map((t, i) => {
    const sebelum = tinta.slice(0, i).reduce((s, x) => s + Math.max(0, x.porsi), 0);
    const sampai = sebelum + Math.max(0, t.porsi);
    return {
      ...t,
      y0: cy - r + kedalamanUntuk(sebelum / (total || 1), r),
      y1: cy - r + kedalamanUntuk(sampai / (total || 1), r),
    };
  });

  function miring(e: PointerEvent<HTMLDivElement>) {
    const kaos = kaosRef.current;
    if (!kaos || e.pointerType === 'touch' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const kotak = e.currentTarget.getBoundingClientRect();
    const dx = (e.clientX - kotak.left) / kotak.width - 0.5;
    const dy = (e.clientY - kotak.top) / kotak.height - 0.5;
    kaos.style.transform = `rotateX(${(-dy * 10).toFixed(2)}deg) rotateY(${(dx * 14).toFixed(2)}deg)`;
    kaos.style.setProperty('--bayang-x', `${(-dx * 18).toFixed(1)}px`);
  }

  function tegak() {
    const kaos = kaosRef.current;
    if (!kaos) return;
    kaos.style.transform = '';
    kaos.style.setProperty('--bayang-x', '0px');
  }

  const u = (nama: string) => `url(#${id}-${nama})`;
  const hitam = (a: number) => `rgba(0,0,0,${(a * bayang).toFixed(3)})`;
  const putih = (a: number) => `rgba(255,255,255,${Math.min(1, a * kilap).toFixed(3)})`;
  const jahitan = kainTerang ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.2)';

  return (
    <div className="mx-auto w-full max-w-[18rem] [perspective:900px]" onPointerMove={miring} onPointerLeave={tegak}>
      <div ref={kaosRef} className="transition-transform duration-300 ease-out [transform-style:preserve-3d] motion-reduce:transition-none">
        <svg viewBox="0 0 400 420" role="img" aria-label={label} className="block h-auto w-full overflow-visible">
          <defs>
            <clipPath id={`${id}-badan`}>
              <path d={BADAN} />
            </clipPath>
            <clipPath id={`${id}-cetak`}>
              <circle cx={cx} cy={cy} r={r} />
            </clipPath>
            <filter id={`${id}-kabur`} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="7" />
            </filter>
            <filter id={`${id}-kabur-tipis`} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3.5" />
            </filter>
            {/* Tinta ikut bergelombang sedikit bersama kain. */}
            <filter id={`${id}-lipatan`} x="-10%" y="-10%" width="120%" height="120%">
              <feTurbulence type="fractalNoise" baseFrequency="0.004 0.011" numOctaves="1" seed="7" result="gelombang" />
              <feDisplacementMap in="SourceGraphic" in2="gelombang" scale="3.5" xChannelSelector="R" yChannelSelector="G" />
            </filter>
            <filter id={`${id}-serat`} x="0" y="0" width="100%" height="100%">
              <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" seed="3" />
              <feColorMatrix type="saturate" values="0" />
            </filter>
            <linearGradient id={`${id}-sisi`} x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stopColor="#000" stopOpacity={0.3 * bayang} />
              <stop offset="0.2" stopColor="#000" stopOpacity={0.08 * bayang} />
              <stop offset="0.38" stopColor="#fff" stopOpacity={0.07 * kilap} />
              <stop offset="0.55" stopColor="#000" stopOpacity={0} />
              <stop offset="0.82" stopColor="#000" stopOpacity={0.1 * bayang} />
              <stop offset="1" stopColor="#000" stopOpacity={0.34 * bayang} />
            </linearGradient>
            <linearGradient id={`${id}-tegak`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#fff" stopOpacity={0.08 * kilap} />
              <stop offset="0.55" stopColor="#fff" stopOpacity={0} />
              <stop offset="1" stopColor="#000" stopOpacity={0.16 * bayang} />
            </linearGradient>
          </defs>

          {/* Bayangan di lantai, bergeser berlawanan arah kemiringan. */}
          <g style={{ transform: 'translateX(var(--bayang-x, 0px))', transition: 'transform 300ms ease-out' }}>
            <ellipse cx="200" cy="404" rx="150" ry="11" fill="rgba(0,0,0,0.32)" filter={u('kabur')} />
          </g>

          <path d={DALAM_LEHER} fill={campur(kainHex, 0.55)} />
          <path d={RIB_BELAKANG} fill={campur(kainHex, 0.82)} />
          <path d={BADAN} fill={kainHex} />

          {total > 0 ? (
            <g filter={u('lipatan')}>
              <g clipPath={u('cetak')}>
                {pita.map((p) => (
                  <rect key={p.huruf} x={cx - r - 1} y={p.y0} width={2 * r + 2} height={Math.max(0, p.y1 - p.y0)} fill={p.hex} />
                ))}
                {pita.slice(1).map((p) => (
                  <line key={p.huruf} x1={cx - r} x2={cx + r} y1={p.y0} y2={p.y0} stroke={kainHex} strokeWidth="1.8" />
                ))}
              </g>
            </g>
          ) : (
            <circle cx={cx} cy={cy} r={r} fill="none" stroke={jahitan} strokeWidth="1.5" strokeDasharray="5 4" />
          )}

          <path d={RIB_DEPAN} fill={campur(kainHex, 0.95)} />

          {/* Cahaya, lipatan, serat, dan jahitan — di atas kain dan tinta sekaligus. */}
          <g clipPath={u('badan')}>
            <rect x="20" y="28" width="360" height="380" fill={u('sisi')} />
            <rect x="20" y="28" width="360" height="380" fill={u('tegak')} />
            <g filter={u('kabur')} fill="none" strokeLinecap="round">
              <path d="M154 44 C164 82 182 92 200 92 C218 92 236 82 246 44" stroke={hitam(0.16)} strokeWidth="7" />
              <path d="M104 160 Q130 182 138 222" stroke={hitam(0.2)} strokeWidth="12" />
              <path d="M296 160 Q270 182 262 222" stroke={hitam(0.22)} strokeWidth="12" />
              <path d="M146 282 Q160 330 146 388" stroke={hitam(0.09)} strokeWidth="16" />
              <path d="M262 290 Q246 336 264 390" stroke={hitam(0.1)} strokeWidth="16" />
              <path d="M170 290 Q182 336 172 386" stroke={putih(0.08)} strokeWidth="10" />
              <path d="M96 66 C106 90 108 120 104 148" stroke={hitam(0.22)} strokeWidth="6" />
              <path d="M304 66 C294 90 292 120 296 148" stroke={hitam(0.24)} strokeWidth="6" />
              <path d="M50 146 L84 166" stroke={hitam(0.14)} strokeWidth="10" />
              <path d="M350 146 L316 166" stroke={hitam(0.16)} strokeWidth="10" />
            </g>
            <g filter={u('kabur')}>
              <ellipse cx="132" cy="66" rx="34" ry="12" fill={putih(0.12)} transform="rotate(-14 132 66)" />
              <ellipse cx="268" cy="66" rx="34" ry="12" fill={putih(0.08)} transform="rotate(14 268 66)" />
            </g>
            <rect x="20" y="28" width="360" height="380" filter={u('serat')} opacity={kainTerang ? 0.07 : 0.1} style={{ mixBlendMode: 'overlay' }} />

            <g fill="none" stroke={jahitan} strokeWidth="1.1">
              <path d="M92 58 C102 82 106 118 102 146" strokeWidth="1.3" />
              <path d="M308 58 C298 82 294 118 298 146" strokeWidth="1.3" />
              <g strokeDasharray="3.2 2.6">
                <path d="M149 39 C157 74 178 86 200 86 C222 86 243 74 251 39" />
                <path d="M32 133 L80 165" />
                <path d="M368 133 L320 165" />
                <path d="M100 382 Q200 393 300 382" />
              </g>
            </g>
          </g>

          <g filter={u('kabur-tipis')} opacity="0.9">
            <path d="M164 38 Q200 54 236 38" fill="none" stroke={hitam(0.35)} strokeWidth="3" />
          </g>
          <path d={BADAN} fill="none" stroke={kainTerang ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.1)'} strokeWidth="1.2" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}
