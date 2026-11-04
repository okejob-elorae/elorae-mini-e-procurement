import { pwaDb, type PendingCheckin, type PendingCheckout } from "./db";

/**
 * Kunjungan yang berjalan DI HP — check-in yang dicatat tanpa sinyal.
 *
 * Layar yang mensyaratkan check-in membaca kunjungan berjalan dari server.
 * Tanpa sinyal server tidak bisa ditanya, dan halaman yang dibuka dari cache
 * masih berkata "belum check-in". Modul ini menjawabnya dari HP:
 *
 * - `antre`    : check-in masih di antrean HP. Pekerjaan di kunjungan ini
 *                (nota, pesanan, stok) diikat lewat `clientId` dan dikirim
 *                SESUDAH check-in-nya sampai.
 * - `ditolak`  : server menolak check-in itu (mis. di luar radius toko, mode
 *                TOLAK). Kunjungannya tidak sah — layar memperlakukannya
 *                sebagai belum check-in dan menyebut alasannya.
 * - `terkirim` : check-in sudah sampai (server memberi id) tapi halaman di HP
 *                belum dimuat ulang dari server — misalnya sinyal sempat kembali
 *                sebentar lalu hilang lagi. Disimpan di `localStorage`, bukan di
 *                basis data antrean: tabel antrean dihitung sebagai "belum
 *                terkirim" (`hitung.ts`), dan ini sudah terkirim.
 *
 * Kunjungan berakhir di HP saat check-out-nya diantrekan (atau terkirim), saat
 * check-in lain dicatat, atau setelah `UMUR_KUNJUNGAN_LOKAL_MS`.
 */

export const KUNCI_KUNJUNGAN_TERKIRIM = "elorae.pwa.kunjunganLuring";
export const KUNCI_ATURAN_KUNJUNGAN = "elorae.pwa.aturanKunjungan";

/** Sehari kerja penuh SPG (buka sampai tutup mal) masih di bawah ini. */
export const UMUR_KUNJUNGAN_LOKAL_MS = 18 * 3_600_000;

export type KeadaanKunjunganLokal = "antre" | "ditolak" | "terkirim";

export type KunjunganLokal = {
  /** Id buatan HP (`StoreVisit.clientId`). */
  clientId: string;
  storeId: string;
  storeName: string | null;
  /** Saat check-in ditekan di HP (ms). */
  waktu: number;
  keadaan: KeadaanKunjunganLokal;
  /** Kode penolakan server (keadaan `ditolak`). */
  alasan: string | null;
  /** Angka penolakan radius (keadaan `ditolak`, `DI_LUAR_RADIUS`). */
  rinci: { jarakMeter?: number; radiusMeter?: number } | null;
  /** Id kunjungan di server (keadaan `terkirim`). */
  visitId: string | null;
};

/** Catatan check-in tanpa sinyal yang sudah sampai ke server. */
export type CatatanTerkirim = {
  clientId: string;
  storeId: string;
  storeName: string | null;
  waktu: number;
  visitId: string;
};

type BarisCheckin = Pick<PendingCheckin, "localId" | "storeId" | "storeName" | "waktu" | "syncState" | "error" | "galatRinci">;
type BarisCheckout = Pick<PendingCheckout, "visitId" | "visitClientId">;

/**
 * Murni: kunjungan berjalan di HP dari antrean check-in, antrean check-out,
 * dan catatan check-in yang sudah terkirim. Yang TERBARU yang berlaku — check-in
 * di toko lain sesudahnya berarti kunjungan sebelumnya sudah selesai. Dengan
 * `storeId`, kunjungan terbaru di toko lain = tidak ada kunjungan di toko ini.
 */
export function pilihKunjunganLokal(m: {
  checkins: readonly BarisCheckin[];
  checkouts: readonly BarisCheckout[];
  terkirim: CatatanTerkirim | null;
  sekarang: number;
  storeId?: string | null;
}): KunjunganLokal | null {
  const keluarClient = new Set(m.checkouts.map((c) => c.visitClientId).filter((x): x is string => !!x));
  const keluarServer = new Set(m.checkouts.map((c) => c.visitId).filter((x): x is string => !!x));
  const masihBerlaku = (waktu: number) => waktu >= m.sekarang - UMUR_KUNJUNGAN_LOKAL_MS;

  const calon: KunjunganLokal[] = [];
  for (const c of m.checkins) {
    if (keluarClient.has(c.localId) || !masihBerlaku(c.waktu)) continue;
    calon.push({
      clientId: c.localId,
      storeId: c.storeId,
      storeName: c.storeName,
      waktu: c.waktu,
      keadaan: c.syncState === "failed" ? "ditolak" : "antre",
      alasan: c.syncState === "failed" ? (c.error ?? null) : null,
      rinci: c.syncState === "failed" ? (c.galatRinci ?? null) : null,
      visitId: null,
    });
  }
  const t = m.terkirim;
  if (t && !keluarClient.has(t.clientId) && !keluarServer.has(t.visitId) && masihBerlaku(t.waktu)) {
    // Check-in yang sama masih di antrean (jawaban sampai tapi baris belum dihapus): antrean menang.
    if (!calon.some((c) => c.clientId === t.clientId)) {
      calon.push({
        clientId: t.clientId,
        storeId: t.storeId,
        storeName: t.storeName,
        waktu: t.waktu,
        keadaan: "terkirim",
        alasan: null,
        rinci: null,
        visitId: t.visitId,
      });
    }
  }
  if (calon.length === 0) return null;
  const terbaru = calon.reduce((a, b) => (b.waktu > a.waktu ? b : a));
  if (m.storeId && terbaru.storeId !== m.storeId) return null;
  return terbaru;
}

function penyimpanan(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Murni: baca catatan terkirim dari teks `localStorage`; rusak = tidak ada. */
export function bacaCatatanTerkirim(mentah: string | null): CatatanTerkirim | null {
  if (!mentah) return null;
  try {
    const d = JSON.parse(mentah) as Partial<CatatanTerkirim>;
    if (
      typeof d.clientId !== "string" ||
      typeof d.storeId !== "string" ||
      typeof d.visitId !== "string" ||
      typeof d.waktu !== "number" ||
      !Number.isFinite(d.waktu)
    ) {
      return null;
    }
    return { clientId: d.clientId, storeId: d.storeId, storeName: typeof d.storeName === "string" ? d.storeName : null, waktu: d.waktu, visitId: d.visitId };
  } catch {
    return null;
  }
}

/** Dipanggil penyinkron saat check-in tanpa sinyal sampai ke server. Tidak pernah melempar. */
export function catatKunjunganTerkirim(c: CatatanTerkirim): void {
  try {
    penyimpanan()?.setItem(KUNCI_KUNJUNGAN_TERKIRIM, JSON.stringify(c));
  } catch {
    // Penyimpanan penuh/dilarang: halaman dimuat ulang dari server saat ada sinyal.
  }
}

/** Kunjungan dari HP selesai (check-out, atau check-in lain dengan sinyal). Tidak pernah melempar. */
export function lupakanKunjunganTerkirim(): void {
  try {
    penyimpanan()?.removeItem(KUNCI_KUNJUNGAN_TERKIRIM);
  } catch {
    // Tidak ada yang perlu dibuang.
  }
}

/**
 * Kunjungan yang berjalan di HP, untuk toko tertentu (atau yang mana pun).
 * Penyimpanan HP yang tidak terbaca (mode privat) = tidak ada kunjungan lokal.
 */
export async function kunjunganAktifLokal(storeId?: string | null): Promise<KunjunganLokal | null> {
  try {
    const [checkins, checkouts] = await Promise.all([pwaDb.pendingCheckins.toArray(), pwaDb.pendingCheckouts.toArray()]);
    let terkirim: CatatanTerkirim | null = null;
    try {
      terkirim = bacaCatatanTerkirim(penyimpanan()?.getItem(KUNCI_KUNJUNGAN_TERKIRIM) ?? null);
    } catch {
      terkirim = null;
    }
    return pilihKunjunganLokal({ checkins, checkouts, terkirim, sekarang: Date.now(), storeId });
  } catch {
    return null;
  }
}

/** Kunjungan lokal yang boleh dipakai bekerja (bukan yang ditolak server). */
export function kunjunganLokalSah(k: KunjunganLokal | null): k is KunjunganLokal & { keadaan: "antre" | "terkirim" } {
  return k !== null && k.keadaan !== "ditolak";
}

/**
 * Ikatan kunjungan untuk pekerjaan yang dicatat sekarang: yang LEBIH BARU di
 * antara kunjungan server (dari halaman — bisa halaman lama dari cache) dan
 * kunjungan lokal yang sah. Kunjungan lokal yang sudah terkirim dikirim dengan
 * id servernya; yang masih di antrean dengan id buatan HP.
 */
export function ikatanKunjungan(
  server: { id: string; checkinAtMs?: number | null } | null,
  lokal: KunjunganLokal | null,
): { visitId: string | null; visitClientId: string | null } | null {
  const pakaiLokal = lokal && kunjunganLokalSah(lokal) && (!server || server.checkinAtMs == null || lokal.waktu >= server.checkinAtMs);
  if (lokal && pakaiLokal) {
    return lokal.keadaan === "terkirim" ? { visitId: lokal.visitId, visitClientId: null } : { visitId: null, visitClientId: lokal.clientId };
  }
  return server ? { visitId: server.id, visitClientId: null } : null;
}

// ─── Aturan check-out yang disimpan di HP ────────────────────────────────────

export type AturanKunjunganTersimpan = { spg: boolean; alasanWajib: boolean; fotoWajib: boolean };

/** Murni: baca aturan tersimpan; rusak = tidak diketahui. */
export function bacaAturanTersimpan(mentah: string | null): AturanKunjunganTersimpan | null {
  if (!mentah) return null;
  try {
    const d = JSON.parse(mentah) as Partial<AturanKunjunganTersimpan>;
    if (typeof d.spg !== "boolean" || typeof d.alasanWajib !== "boolean" || typeof d.fotoWajib !== "boolean") return null;
    return { spg: d.spg, alasanWajib: d.alasanWajib, fotoWajib: d.fotoWajib };
  } catch {
    return null;
  }
}

export function simpanAturanKunjungan(a: AturanKunjunganTersimpan): void {
  try {
    penyimpanan()?.setItem(KUNCI_ATURAN_KUNJUNGAN, JSON.stringify(a));
  } catch {
    // Tanpa penyimpanan, check-out tanpa sinyal memakai aturan bawaan.
  }
}

export function aturanKunjunganDiHp(): AturanKunjunganTersimpan | null {
  try {
    return bacaAturanTersimpan(penyimpanan()?.getItem(KUNCI_ATURAN_KUNJUNGAN) ?? null);
  } catch {
    return null;
  }
}

// ─── Transaksi kunjungan yang masih di HP (untuk check-out tanpa sinyal) ────

type Keadaan = "pending" | "syncing" | "failed" | string;

/**
 * Murni: apakah HP masih menyimpan transaksi dari kunjungan ini. Pesanan terikat
 * kunjungannya (id server atau id buatan HP); klaim bayar dan retur toko hanya
 * punya toko, jadi dibatasi sejak check-in bila waktunya diketahui. Baris yang
 * ditolak (`failed`) tidak dihitung — ia belum tentu pernah sampai.
 */
export function adaTransaksiTertahan(
  antrean: {
    pesanan: readonly { visitId: string | null; visitClientId?: string | null; syncState: Keadaan }[];
    klaim: readonly { storeId: string; capturedAt: number; syncState: Keadaan }[];
    retur: readonly { storeId: string; capturedAt: number; syncState: Keadaan }[];
  },
  acuan: { visitId: string | null; visitClientId: string | null; storeId: string | null; sejakMs: number | null },
): boolean {
  const hidup = (s: Keadaan) => s !== "failed";
  const pesanan = antrean.pesanan.some(
    (p) =>
      hidup(p.syncState) &&
      ((acuan.visitId !== null && p.visitId === acuan.visitId) ||
        (acuan.visitClientId !== null && (p.visitClientId ?? null) === acuan.visitClientId)),
  );
  if (pesanan) return true;
  if (!acuan.storeId) return false;
  const cocok = (r: { storeId: string; capturedAt: number; syncState: Keadaan }) =>
    hidup(r.syncState) && r.storeId === acuan.storeId && (acuan.sejakMs === null || r.capturedAt >= acuan.sejakMs);
  return antrean.klaim.some(cocok) || antrean.retur.some(cocok);
}

export async function adaTransaksiDiHp(acuan: Parameters<typeof adaTransaksiTertahan>[1]): Promise<boolean> {
  try {
    const [pesanan, klaim, retur] = await Promise.all([
      pwaDb.pendingOrders.toArray(),
      pwaDb.pendingClaims.toArray(),
      pwaDb.pendingReturns.toArray(),
    ]);
    return adaTransaksiTertahan({ pesanan, klaim, retur }, acuan);
  } catch {
    // Tidak terbaca: server tetap menilai hasil kunjungannya sendiri.
    return false;
  }
}

/** Check-out kunjungan ini yang masih di HP (menunggu sinyal), bila ada. */
export async function checkoutTertahanUntuk(visitId: string | null, visitClientId: string | null): Promise<boolean> {
  if (!visitId && !visitClientId) return false;
  try {
    const semua = await pwaDb.pendingCheckouts.toArray();
    return semua.some((c) => (visitId !== null && c.visitId === visitId) || (visitClientId !== null && c.visitClientId === visitClientId));
  } catch {
    return false;
  }
}
