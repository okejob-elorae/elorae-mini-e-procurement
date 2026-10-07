/*
 * Notifikasi mana yang "baru masuk" — murni, dipakai lonceng kantor dan
 * pemantau kabar HP untuk memberi tahu pulau status.
 *
 * Muatan pertama hanya menjadi patokan: notifikasi yang sudah ada saat halaman
 * dibuka tidak pernah dimunculkan. Sesudahnya yang dihitung baru hanyalah yang
 * belum dibaca, belum pernah terlihat, dan tidak lebih lama dari patokan —
 * baris lama yang baru terlihat karena halaman pertama bergeser tidak ikut.
 */

export type ButirKabar = { id: string; createdAt: string; readAt: string | null };

export type PenandaKabar = { batasMs: number; terlihat: ReadonlySet<string> };

function waktu(b: ButirKabar): number {
  const ms = Date.parse(b.createdAt);
  return Number.isFinite(ms) ? ms : Number.NaN;
}

/** Urutan masukan dipertahankan (API mengirim terbaru dulu). */
export function kabarBaru<T extends ButirKabar>(
  penanda: PenandaKabar | null,
  items: readonly T[],
): { baru: T[]; penanda: PenandaKabar } {
  const terlihat = new Set(penanda?.terlihat ?? []);
  let batasMs = penanda?.batasMs ?? Number.NEGATIVE_INFINITY;
  const baru: T[] = [];
  for (const b of items) {
    const ms = waktu(b);
    if (penanda && !terlihat.has(b.id) && b.readAt === null && Number.isFinite(ms) && ms >= penanda.batasMs) {
      baru.push(b);
    }
    terlihat.add(b.id);
    if (Number.isFinite(ms) && ms > batasMs) batasMs = ms;
  }
  return { baru, penanda: { batasMs, terlihat } };
}
