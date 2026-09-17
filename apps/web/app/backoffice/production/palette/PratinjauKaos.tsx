'use client';

import { useId, useRef, type PointerEvent } from 'react';
import { svgKaos, type TintaKaos } from '@/lib/production-colors/palet/kaos-svg';

/**
 * Pratinjau sablon di atas kaos berwarna kain. Gambarnya dari `svgKaos` —
 * yang sama dengan lembar PDF dan gambar PNG — dan di layar sedikit miring
 * mengikuti kursor.
 */
export function PratinjauKaos({ kainHex, tinta, label }: { kainHex: string; tinta: TintaKaos[]; label: string }) {
  const id = useId();
  const kaosRef = useRef<HTMLDivElement>(null);

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

  return (
    <div className="mx-auto w-full max-w-[18rem] [perspective:900px]" onPointerMove={miring} onPointerLeave={tegak}>
      <div
        ref={kaosRef}
        className="transition-transform duration-300 ease-out [transform-style:preserve-3d] motion-reduce:transition-none"
        // Teks SVG dari fungsi murni yang meloloskan label dan hanya menerima hex sah.
        dangerouslySetInnerHTML={{ __html: svgKaos({ kainHex, tinta, id, label, kelas: 'block h-auto w-full overflow-visible' }) }}
      />
    </div>
  );
}
