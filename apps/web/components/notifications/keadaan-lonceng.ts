/*
 * Keadaan daftar lonceng di peramban — murni, supaya bisa diuji tanpa React.
 * Dipakai `NotificationIcon`; tesnya di `app/api/notifications/keadaan-lonceng.spec.ts`
 * (vitest tidak menyisir `components/`).
 */

export interface ItemLonceng {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

export interface KeadaanLonceng {
  items: ItemLonceng[];
  /** SEMUA yang belum dibaca milik pengguna (dari server), bukan yang termuat. */
  unreadCount: number;
  /** Kursor halaman berikutnya; `null` = sudah semua termuat. */
  nextCursor: string | null;
}

/** Jawaban GET /api/notifications. `nextCursor` bisa tidak ada pada server lama. */
export type JawabanLonceng = { items: ItemLonceng[]; unreadCount: number; nextCursor?: string | null };

export function dariHalamanPertama(json: JawabanLonceng): KeadaanLonceng {
  return { items: json.items, unreadCount: json.unreadCount, nextCursor: json.nextCursor ?? null };
}

/**
 * Tempel halaman berikutnya. Baris yang sudah ada tidak digandakan, dan
 * lencana + kursor mengikuti jawaban terbaru dari server.
 */
export function tempelHalaman(lama: KeadaanLonceng, json: JawabanLonceng): KeadaanLonceng {
  const ada = new Set(lama.items.map((i) => i.id));
  return {
    items: [...lama.items, ...json.items.filter((i) => !ada.has(i.id))],
    unreadCount: json.unreadCount,
    nextCursor: json.nextCursor ?? null,
  };
}

/** Satu notifikasi dibaca. Yang sudah dibaca tidak mengurangi lencana lagi. */
export function tandaiSatuDibaca(lama: KeadaanLonceng, id: string, waktu: string): KeadaanLonceng {
  const item = lama.items.find((i) => i.id === id);
  const sudah = !item || item.readAt !== null;
  return {
    ...lama,
    items: lama.items.map((i) => (i.id === id && i.readAt === null ? { ...i, readAt: waktu } : i)),
    unreadCount: sudah ? lama.unreadCount : Math.max(0, lama.unreadCount - 1),
  };
}

/**
 * "Tandai semua dibaca": endpoint-nya menandai SEMUA milik pengguna, bukan hanya
 * yang termuat — jadi lencana langsung nol. Kursor tetap: halaman berikutnya
 * yang dimuat sesudahnya sudah terbaca di server.
 */
export function tandaiSemuaDibaca(lama: KeadaanLonceng, waktu: string): KeadaanLonceng {
  return {
    ...lama,
    items: lama.items.map((i) => (i.readAt === null ? { ...i, readAt: waktu } : i)),
    unreadCount: 0,
  };
}
