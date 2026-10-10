import { Prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { samaTeks } from "@/lib/db/cari-teks";
import { catatJejak, JEJAK } from "@/lib/receivables/jejak";
import type { Platform } from "./aturan";
import { cariKembar, normalisasiHandle, type SebabKembar } from "./kembar";
import { BATAS_TEMPEL, tulisLabel, tulisProfilUkuran, type ProfilUkuran } from "./kol-aturan";
import { bacaRateFormat, tulisRateFormat, validasiRateFormat, type RateFormat } from "./rate-format";
import { normalisasiWa } from "./wa";
import type { AlasanGagalKreatif, HasilKreatif } from "./writer";

/*
 * Penulis database KOL (2026-10-07).
 *
 * AKUN DIUBAH DI TEMPAT (perbaikan bug D KOL Manager): menyimpan formulir
 * tidak lagi menghapus semua akun lalu membuatnya ulang. Akun yang sama tetap
 * memakai id yang sama, jadi riwayat pengikutnya (`KolFollowerSnapshot`) tidak
 * ikut terhapus — dan setiap jumlah pengikut yang BERUBAH dicatat sebagai baris
 * riwayat baru, tidak menimpa yang lama.
 *
 * Kembar (nomor WA sama, atau handle sama di platform mana pun) ditolak dengan
 * kode `KEMBAR` beserta daftar yang cocok; penyimpan boleh meneruskan dengan
 * alasan, dan alasannya masuk jejak.
 */

type Klien = Prisma.TransactionClient;
const D = (n: number) => new Prisma.Decimal(n);

export type AlasanGagalKol =
  | AlasanGagalKreatif
  | "AKUN_WAJIB"
  | "KEMBAR"
  | "SUDAH_DIBLOKIR"
  | "BELUM_DIBLOKIR"
  | "ISI_WAJIB"
  | "TERLALU_PANJANG"
  | "TERLALU_BANYAK";

export type KembarDitemukan = {
  id: string;
  nama: string;
  sebab: SebabKembar[];
  handles: string[];
  diblokir: boolean;
};

export type HasilKol<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; alasan: AlasanGagalKol; detail?: string; kembar?: KembarDitemukan[] };

/* ───────────────────────────── isian ───────────────────────────── */

export type AkunKol = {
  /** Id akun yang sudah ada (formulir ubah). Tanpa id, akun dicocokkan menurut platform + handle. */
  id?: string | null;
  platform: Platform;
  handle: string;
  followers: number;
  url?: string | null;
};

/**
 * Isian KOL. Saat MENGUBAH, kolom yang tidak dikirim (`undefined`) tidak
 * disentuh dan `null` yang dikirim mengosongkan — formulir yang tidak membawa
 * sebuah kolom tidak boleh menghapus isinya diam-diam.
 */
export type IsiKol = {
  name: string;
  recipientName?: string | null;
  niche?: string | null;
  city?: string | null;
  province?: string | null;
  postalCode?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  rateCard?: number | null;
  /**
   * Tarif per format konten (rupiah bulat). `undefined` = tidak disentuh —
   * penulis lain (ekstensi, tempel link, formulir data KOL) tidak membawanya,
   * jadi rate card per format tidak pernah terhapus diam-diam; `null` atau
   * objek kosong mengosongkan.
   */
  rateFormat?: RateFormat | null;
  rateNote?: string | null;
  note?: string | null;
  /** Label dipisah koma ("favorit, hijab") atau daftar. */
  label?: string | readonly string[] | null;
  engagementRate?: number | null;
  avgViews?: number | null;
  ukuran?: Partial<ProfilUkuran> | null;
  isActive?: boolean;
  akun: AkunKol[];
};

const BATAS_TEKS = { nama: 120, pendek: 120, panjang: 2000, catatan: 5000 } as const;

const teks = (v: string | null | undefined, maks: number = BATAS_TEKS.pendek): string | null | undefined =>
  v === undefined ? undefined : v?.replace(/\s+$/g, "").trim().slice(0, maks) || null;

type AkunBersih = { id: string | null; platform: Platform; handle: string; followers: number; url: string | null };

/** Akun formulir → bentuk simpan: handle pembanding, kembar dalam formulir digabung (yang pertama menang). */
function bersihkanAkun(daftar: readonly AkunKol[]): AkunBersih[] {
  const hasil: AkunBersih[] = [];
  const sudah = new Set<string>();
  for (const a of daftar) {
    const handle = normalisasiHandle(a.handle);
    if (!handle) continue;
    const kunci = `${a.platform}:${handle}`;
    if (sudah.has(kunci)) continue;
    sudah.add(kunci);
    hasil.push({
      id: a.id?.trim() || null,
      platform: a.platform,
      handle: handle.slice(0, 100),
      followers: Number.isFinite(a.followers) ? Math.max(0, Math.trunc(a.followers)) : 0,
      url: a.url?.trim().slice(0, 500) || null,
    });
  }
  return hasil;
}

type Kolom = {
  name?: string;
  recipientName?: string | null;
  niche?: string | null;
  city?: string | null;
  province?: string | null;
  postalCode?: string | null;
  address?: string | null;
  phone?: string | null;
  waNormal?: string | null;
  email?: string | null;
  rateCard?: Prisma.Decimal | null;
  rateFormat?: string | null;
  rateNote?: string | null;
  note?: string | null;
  label?: string | null;
  engagementRate?: Prisma.Decimal | null;
  avgViews?: number | null;
  sizeProfile?: string | null;
  isActive?: boolean;
};

function kolomDariIsi(isi: IsiKol, nama: string): { kolom: Kolom } | { galat: string } {
  const er = isi.engagementRate;
  if (er !== undefined && er !== null && (!Number.isFinite(er) || er < 0 || er > 100)) return { galat: "engagementRate" };
  const views = isi.avgViews;
  if (views !== undefined && views !== null && (!Number.isFinite(views) || views < 0)) return { galat: "avgViews" };
  const rate = isi.rateCard;
  if (rate !== undefined && rate !== null && (!Number.isFinite(rate) || rate < 0)) return { galat: "rateCard" };
  let rateFormat: string | null | undefined;
  if (isi.rateFormat === undefined) rateFormat = undefined;
  else if (isi.rateFormat === null) rateFormat = null;
  else {
    const v = validasiRateFormat(isi.rateFormat);
    if (!v.ok) return { galat: "rateFormat" };
    rateFormat = tulisRateFormat(v.rate);
  }
  const phone = teks(isi.phone, 40);
  const kolom: Kolom = {
    name: nama,
    recipientName: teks(isi.recipientName),
    niche: teks(isi.niche),
    city: teks(isi.city),
    province: teks(isi.province),
    postalCode: teks(isi.postalCode, 20),
    address: teks(isi.address, BATAS_TEKS.panjang),
    phone,
    waNormal: phone === undefined ? undefined : normalisasiWa(phone),
    email: teks(isi.email),
    rateCard: rate === undefined ? undefined : rate === null ? null : D(rate),
    rateFormat,
    rateNote: teks(isi.rateNote, BATAS_TEKS.panjang),
    note: teks(isi.note, BATAS_TEKS.catatan),
    label: isi.label === undefined ? undefined : tulisLabel(isi.label),
    engagementRate: er === undefined ? undefined : er === null ? null : D(Math.round(er * 100) / 100),
    avgViews: views === undefined ? undefined : views === null ? null : Math.trunc(views),
    sizeProfile: isi.ukuran === undefined ? undefined : tulisProfilUkuran(isi.ukuran),
    isActive: isi.isActive,
  };
  return { kolom: Object.fromEntries(Object.entries(kolom).filter(([, v]) => v !== undefined)) as Kolom };
}

/** Nilai yang bisa dibandingkan untuk jejak sebelum/sesudah. */
const nilaiJejak = (v: unknown): unknown => (v instanceof Prisma.Decimal ? v.toNumber() : v);

/* ───────────────────────────── kembar ───────────────────────────── */

/**
 * KOL lain yang kembar dengan nomor/handle ini. Kueri dipersempit lebih dulu
 * (waNormal sama ATAU handle sama tanpa memandang huruf), baru `cariKembar`
 * memutuskan — supaya aturannya persis yang dipakai layar Cek kembar.
 */
async function kembarUntuk(
  tx: Klien,
  calon: { waNormal: string | null; handles: string[] },
  kecualiId: string | null,
): Promise<KembarDitemukan[]> {
  const syarat: Prisma.KolWhereInput[] = [];
  if (calon.waNormal) syarat.push({ waNormal: calon.waNormal });
  for (const h of calon.handles) syarat.push({ accounts: { some: { handle: samaTeks(h) } } });
  if (syarat.length === 0) return [];
  const daftar = await tx.kol.findMany({
    where: { OR: syarat, ...(kecualiId ? { id: { not: kecualiId } } : {}) },
    select: { id: true, name: true, waNormal: true, blockedAt: true, accounts: { select: { handle: true } } },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  const cocok = cariKembar(
    { waNormal: calon.waNormal, handles: calon.handles },
    daftar.map((k) => ({ id: k.id, nama: k.name, waNormal: k.waNormal, handles: k.accounts.map((a) => a.handle) })),
    kecualiId,
  );
  const per = new Map(daftar.map((k) => [k.id, k]));
  return cocok.map((c) => ({
    id: c.id,
    nama: c.nama,
    sebab: c.sebab,
    handles: per.get(c.id)?.accounts.map((a) => a.handle) ?? [],
    diblokir: Boolean(per.get(c.id)?.blockedAt),
  }));
}

/* ───────────────────────────── simpan ───────────────────────────── */

export type HasilSimpanKol = HasilKol<{ id: string; dibuat: boolean; riwayatPengikut: number }>;

/**
 * Simpan (buat/ubah) satu KOL beserta akunnya.
 *
 * - Minimal satu akun (handle + platform). Nama kosong → handle akun pertama.
 * - Saat mengubah, akun dicocokkan lewat id lebih dulu, lalu platform + handle;
 *   yang cocok DIPERBARUI di tempat, yang tidak ada lagi di formulir dihapus
 *   (beserta riwayatnya — itu memang akun yang dibuang), yang baru dibuat.
 * - Jumlah pengikut yang berubah (atau akun baru berpengikut) → satu baris
 *   `KolFollowerSnapshot`.
 * - `periksaKembar`: nomor WA baru/berubah dan handle baru dicocokkan dengan
 *   KOL lain. Ada yang cocok dan tanpa `alasanKembar` → `KEMBAR`.
 */
export type IsiSimpanProfilKol = {
  id?: string | null;
  isi: IsiKol;
  olehUserId: string;
  periksaKembar: boolean;
  alasanKembar?: string | null;
  /** Asal penulisan untuk jejak dan riwayat pengikut ("formulir", "massal", "tempel-link"). */
  sumber?: string;
};

export async function simpanProfilKol(input: IsiSimpanProfilKol): Promise<HasilSimpanKol> {
  return runSerializable((tx) => simpanProfilKolDiTx(tx, input));
}

/**
 * Isi `simpanProfilKol` di dalam transaksi PEMANGGIL — dipakai penulis tempel
 * link video, yang membuat KOL, kolaborasi, dan kontennya dalam satu
 * transaksi. Satu penulis KOL, bukan dua.
 */
export async function simpanProfilKolDiTx(tx: Klien, input: IsiSimpanProfilKol): Promise<HasilSimpanKol> {
  const akun = bersihkanAkun(input.isi.akun ?? []);
  if (akun.length === 0) return { ok: false, alasan: "AKUN_WAJIB" };
  const nama = (input.isi.name ?? "").replace(/\s+/g, " ").trim().slice(0, BATAS_TEKS.nama) || akun[0].handle;
  const k = kolomDariIsi(input.isi, nama);
  if ("galat" in k) return { ok: false, alasan: "TIDAK_VALID", detail: k.galat };
  const kolom = k.kolom;
  const alasanKembar = input.alasanKembar?.trim().slice(0, 500) || null;
  const sumber = input.sumber ?? "formulir";

  const sekarang = new Date();
  const lama = input.id
    ? await tx.kol.findUnique({
        where: { id: input.id },
        select: {
          id: true,
          name: true,
          recipientName: true,
          niche: true,
          city: true,
          province: true,
          postalCode: true,
          address: true,
          phone: true,
          waNormal: true,
          email: true,
          rateCard: true,
          rateFormat: true,
          rateNote: true,
          note: true,
          label: true,
          engagementRate: true,
          avgViews: true,
          sizeProfile: true,
          isActive: true,
          accounts: { select: { id: true, platform: true, handle: true, followers: true, url: true } },
        },
      })
    : null;
  if (input.id && !lama) return { ok: false, alasan: "TIDAK_DITEMUKAN" };

  let kembar: KembarDitemukan[] = [];
  if (input.periksaKembar) {
    const handleLama = new Set((lama?.accounts ?? []).map((a) => normalisasiHandle(a.handle)));
    const waBaru = kolom.waNormal !== undefined && kolom.waNormal !== (lama?.waNormal ?? null) ? kolom.waNormal : null;
    kembar = await kembarUntuk(
      tx,
      { waNormal: waBaru ?? null, handles: akun.map((a) => a.handle).filter((h) => !handleLama.has(h)) },
      lama?.id ?? null,
    );
    if (kembar.length && !alasanKembar) return { ok: false, alasan: "KEMBAR", kembar };
  }
  const tandaKembar = kembar.length ? { kembarDengan: kembar.map((x) => x.id), alasanKembar } : {};

  let riwayatPengikut = 0;
  const catatRiwayat = async (accountId: string, followers: number) => {
    await tx.kolFollowerSnapshot.create({ data: { accountId, followers, recordedAt: sekarang, source: sumber } });
    riwayatPengikut += 1;
  };

  if (!lama) {
    const dibuat = await tx.kol.create({
      data: { ...kolom, name: nama, lastContactAt: null, createdById: input.olehUserId },
      select: { id: true },
    });
    for (const a of akun) {
      const baru = await tx.kolAccount.create({
        data: { kolId: dibuat.id, platform: a.platform, handle: a.handle, followers: a.followers, url: a.url },
        select: { id: true },
      });
      if (a.followers > 0) await catatRiwayat(baru.id, a.followers);
    }
    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.KOL_DIBUAT,
      entityType: "Kol",
      entityId: dibuat.id,
      changes: { after: { name: nama, akun: akun.map((a) => `${a.platform}:@${a.handle}`) } },
      metadata: { jumlahAkun: akun.length, sumber, ...tandaKembar },
      reason: alasanKembar,
    });
    return { ok: true, id: dibuat.id, dibuat: true, riwayatPengikut };
  }

  /* — ubah: kolom KOL — */
  const sebelum: Record<string, unknown> = {};
  const sesudah: Record<string, unknown> = {};
  for (const [kunci, nilai] of Object.entries(kolom)) {
    if (kunci === "waNormal") continue;
    // Rate per format dicatat sebagai objek (bukan teks JSON) supaya jejaknya terbaca.
    const ubah = kunci === "rateFormat" ? (v: unknown) => bacaRateFormat(v) : nilaiJejak;
    const lamaNilai = ubah((lama as Record<string, unknown>)[kunci] ?? null);
    const baruNilai = ubah(nilai ?? null);
    if (JSON.stringify(lamaNilai) !== JSON.stringify(baruNilai)) {
      sebelum[kunci] = lamaNilai;
      sesudah[kunci] = baruNilai;
    }
  }
  await tx.kol.update({ where: { id: lama.id }, data: kolom });

  /* — ubah: akun di tempat — */
  const dipakai = new Set<string>();
  const rencana: { akun: AkunBersih; lama: (typeof lama.accounts)[number] | null }[] = akun.map((a) => {
    const lewatId = a.id ? lama.accounts.find((x) => x.id === a.id && !dipakai.has(x.id)) : undefined;
    const cocok =
      lewatId ??
      lama.accounts.find((x) => !dipakai.has(x.id) && x.platform === a.platform && normalisasiHandle(x.handle) === a.handle);
    if (cocok) dipakai.add(cocok.id);
    return { akun: a, lama: cocok ?? null };
  });
  const dibuang = lama.accounts.filter((x) => !dipakai.has(x.id));
  if (dibuang.length) await tx.kolAccount.deleteMany({ where: { id: { in: dibuang.map((x) => x.id) } } });

  const ditambah: string[] = [];
  const diubah: string[] = [];
  const pengikutBerubah: { akun: string; dari: number; ke: number }[] = [];
  for (const { akun: a, lama: l } of rencana) {
    const label = `${a.platform}:@${a.handle}`;
    if (!l) {
      const baru = await tx.kolAccount.create({
        data: { kolId: lama.id, platform: a.platform, handle: a.handle, followers: a.followers, url: a.url },
        select: { id: true },
      });
      if (a.followers > 0) await catatRiwayat(baru.id, a.followers);
      ditambah.push(label);
      continue;
    }
    const berubahPengikut = l.followers !== a.followers;
    const berubahLain = l.platform !== a.platform || l.handle !== a.handle || (l.url ?? null) !== a.url;
    if (!berubahPengikut && !berubahLain) continue;
    await tx.kolAccount.update({
      where: { id: l.id },
      data: { platform: a.platform, handle: a.handle, followers: a.followers, url: a.url },
    });
    if (berubahPengikut) {
      await catatRiwayat(l.id, a.followers);
      pengikutBerubah.push({ akun: label, dari: l.followers, ke: a.followers });
    }
    if (berubahLain) diubah.push(label);
  }

  await catatJejak(tx, {
    userId: input.olehUserId,
    action: JEJAK.KOL_DIUBAH,
    entityType: "Kol",
    entityId: lama.id,
    changes: { before: sebelum, after: sesudah },
    metadata: {
      sumber,
      akunDitambah: ditambah,
      akunDiubah: diubah,
      akunDihapus: dibuang.map((x) => `${x.platform}:@${x.handle}`),
      pengikutBerubah,
      ...tandaKembar,
    },
    reason: alasanKembar,
  });
  return { ok: true, id: lama.id, dibuat: false, riwayatPengikut };
}

/**
 * Bentuk lama `simpanKol` (dipakai tes dan aksi lama di `creative.ts`):
 * tanpa pemeriksaan kembar, hasil memakai alasan gagal Kreatif.
 */
export async function simpanKol(input: {
  id?: string | null;
  isi: IsiKol;
  olehUserId: string;
}): Promise<HasilKreatif<{ id: string }>> {
  const r = await simpanProfilKol({ ...input, periksaKembar: false });
  if (r.ok) return { ok: true, id: r.id };
  const alasan: AlasanGagalKreatif =
    r.alasan === "TIDAK_DITEMUKAN" || r.alasan === "NAMA_WAJIB" || r.alasan === "TIDAK_VALID"
      ? r.alasan
      : r.alasan === "AKUN_WAJIB"
        ? "NAMA_WAJIB"
        : "TIDAK_VALID";
  return { ok: false, alasan, detail: r.detail };
}

/* ───────────────────────────── blokir ───────────────────────────── */

/**
 * "Jangan diajak lagi". Alasan wajib — pemblokiran tanpa alasan tidak bisa
 * dipertanggungjawabkan saat orang lain bertanya kenapa KOL ini tidak boleh
 * diajak. KOL yang diblokir tetap ada dan bisa dicari.
 */
export async function blokirKol(input: { kolId: string; alasan: string; olehUserId: string }): Promise<HasilKol> {
  const alasan = input.alasan?.trim().slice(0, 1000);
  if (!alasan) return { ok: false, alasan: "ALASAN_WAJIB" };
  return runSerializable(async (tx): Promise<HasilKol> => {
    const kol = await tx.kol.findUnique({ where: { id: input.kolId }, select: { id: true, name: true, blockedAt: true } });
    if (!kol) return { ok: false, alasan: "TIDAK_DITEMUKAN" };
    if (kol.blockedAt) return { ok: false, alasan: "SUDAH_DIBLOKIR" };
    const sekarang = new Date();
    await tx.kol.update({ where: { id: kol.id }, data: { blockedAt: sekarang, blockReason: alasan } });
    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.KOL_DIBLOKIR,
      entityType: "Kol",
      entityId: kol.id,
      changes: { before: { blockedAt: null }, after: { blockedAt: sekarang.toISOString(), blockReason: alasan } },
      metadata: { kol: kol.name },
      reason: alasan,
    });
    return { ok: true };
  });
}

/** Buka blokir. Alasan juga wajib — keputusan yang dibalik perlu jejak yang sama jelasnya. */
export async function bukaBlokirKol(input: { kolId: string; alasan: string; olehUserId: string }): Promise<HasilKol> {
  const alasan = input.alasan?.trim().slice(0, 1000);
  if (!alasan) return { ok: false, alasan: "ALASAN_WAJIB" };
  return runSerializable(async (tx): Promise<HasilKol> => {
    const kol = await tx.kol.findUnique({
      where: { id: input.kolId },
      select: { id: true, name: true, blockedAt: true, blockReason: true },
    });
    if (!kol) return { ok: false, alasan: "TIDAK_DITEMUKAN" };
    if (!kol.blockedAt) return { ok: false, alasan: "BELUM_DIBLOKIR" };
    await tx.kol.update({ where: { id: kol.id }, data: { blockedAt: null, blockReason: null } });
    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.KOL_DIBUKA_BLOKIR,
      entityType: "Kol",
      entityId: kol.id,
      changes: {
        before: { blockedAt: kol.blockedAt.toISOString(), blockReason: kol.blockReason },
        after: { blockedAt: null },
      },
      metadata: { kol: kol.name },
      reason: alasan,
    });
    return { ok: true };
  });
}

/* ─────────────────────────── tambah massal ─────────────────────────── */

export type AksiMassal = "BARU" | "PERBARUI" | "LEWATI";

export type BarisSimpanMassal = {
  handle: string;
  nama?: string | null;
  pengikut?: number | null;
  wa?: string | null;
  kota?: string | null;
  aksi: AksiMassal;
  /** KOL yang diperbarui — wajib untuk PERBARUI (dipilih di pratinjau). */
  targetId?: string | null;
};

export type HasilMassal = HasilKol<{
  baru: number;
  diperbarui: number;
  dilewati: number;
  /** KOL yang dibuat atau diperbarui, untuk langkah berikut (mis. masukkan ke campaign). */
  kolIds: string[];
  /** Handle yang dilewati karena KOL kembar baru muncul sesudah pratinjau. */
  kembarBaru: string[];
}>;

/**
 * Simpan hasil "Tambah massal" dalam SATU transaksi serializable.
 *
 * - BARU: diperiksa ulang di dalam transaksi; bila sementara itu muncul KOL
 *   dengan handle/nomor yang sama, baris dilewati (bukan dibuat dobel).
 * - PERBARUI: jumlah pengikut di platform ini diganti (riwayat pengikut
 *   dicatat), akunnya ditambahkan bila belum ada, dan HANYA kolom yang masih
 *   kosong yang diisi — nomor, kota, nama yang masih sama dengan handle. Data
 *   yang sudah dirapikan orang tidak ditimpa tempelan.
 * - LEWATI: tidak menyentuh apa pun.
 */
export async function simpanKolMassal(input: {
  baris: readonly BarisSimpanMassal[];
  platform: Platform;
  olehUserId: string;
}): Promise<HasilMassal> {
  if (input.baris.length > BATAS_TEMPEL) return { ok: false, alasan: "TERLALU_BANYAK", detail: String(BATAS_TEMPEL) };
  if (input.baris.length === 0) return { ok: false, alasan: "TIDAK_VALID" };

  return runSerializable(async (tx): Promise<HasilMassal> => {
    const sekarang = new Date();
    let baru = 0;
    let diperbarui = 0;
    let dilewati = 0;
    const kolIds: string[] = [];
    const kembarBaru: string[] = [];
    const sudahHandle = new Set<string>();

    for (const b of input.baris) {
      const handle = normalisasiHandle(b.handle);
      if (!handle || b.aksi === "LEWATI" || sudahHandle.has(handle)) {
        dilewati += 1;
        continue;
      }
      sudahHandle.add(handle);
      const pengikut = b.pengikut != null && Number.isFinite(b.pengikut) ? Math.max(0, Math.trunc(b.pengikut)) : null;
      const wa = normalisasiWa(b.wa);
      const nama = b.nama?.replace(/\s+/g, " ").trim().slice(0, BATAS_TEKS.nama) || null;
      const kota = b.kota?.trim().slice(0, BATAS_TEKS.pendek) || null;

      if (b.aksi === "BARU") {
        const kembar = await kembarUntuk(tx, { waNormal: wa, handles: [handle] }, null);
        if (kembar.length) {
          dilewati += 1;
          kembarBaru.push(handle);
          continue;
        }
        const dibuat = await tx.kol.create({
          data: {
            name: nama ?? handle,
            city: kota,
            phone: wa ? b.wa?.trim() || wa : null,
            waNormal: wa,
            createdById: input.olehUserId,
          },
          select: { id: true },
        });
        const a = await tx.kolAccount.create({
          data: { kolId: dibuat.id, platform: input.platform, handle, followers: pengikut ?? 0 },
          select: { id: true },
        });
        if (pengikut) {
          await tx.kolFollowerSnapshot.create({ data: { accountId: a.id, followers: pengikut, recordedAt: sekarang, source: "massal" } });
        }
        await catatJejak(tx, {
          userId: input.olehUserId,
          action: JEJAK.KOL_DIBUAT,
          entityType: "Kol",
          entityId: dibuat.id,
          changes: { after: { name: nama ?? handle, akun: [`${input.platform}:@${handle}`] } },
          metadata: { jumlahAkun: 1, sumber: "massal" },
        });
        baru += 1;
        kolIds.push(dibuat.id);
        continue;
      }

      /* PERBARUI */
      if (!b.targetId) {
        dilewati += 1;
        continue;
      }
      const kol = await tx.kol.findUnique({
        where: { id: b.targetId },
        select: {
          id: true,
          name: true,
          phone: true,
          waNormal: true,
          city: true,
          accounts: { select: { id: true, platform: true, handle: true, followers: true } },
        },
      });
      if (!kol) {
        dilewati += 1;
        continue;
      }
      const sebelum: Record<string, unknown> = {};
      const sesudah: Record<string, unknown> = {};
      const isi: Prisma.KolUpdateInput = {};
      const namaMasihHandle = kol.accounts.some((x) => normalisasiHandle(x.handle) === normalisasiHandle(kol.name));
      if (nama && namaMasihHandle && nama !== kol.name) {
        isi.name = nama;
        sebelum.name = kol.name;
        sesudah.name = nama;
      }
      if (wa && !kol.phone) {
        isi.phone = b.wa?.trim() || wa;
        isi.waNormal = wa;
        sebelum.phone = null;
        sesudah.phone = isi.phone;
      }
      if (kota && !kol.city) {
        isi.city = kota;
        sebelum.city = null;
        sesudah.city = kota;
      }
      if (Object.keys(isi).length) await tx.kol.update({ where: { id: kol.id }, data: isi });

      const pengikutBerubah: { akun: string; dari: number; ke: number }[] = [];
      const akunAda = kol.accounts.find((x) => x.platform === input.platform && normalisasiHandle(x.handle) === handle);
      if (!akunAda) {
        const a = await tx.kolAccount.create({
          data: { kolId: kol.id, platform: input.platform, handle, followers: pengikut ?? 0 },
          select: { id: true },
        });
        if (pengikut) {
          await tx.kolFollowerSnapshot.create({ data: { accountId: a.id, followers: pengikut, recordedAt: sekarang, source: "massal" } });
        }
      } else if (pengikut !== null && pengikut !== akunAda.followers) {
        await tx.kolAccount.update({ where: { id: akunAda.id }, data: { followers: pengikut } });
        await tx.kolFollowerSnapshot.create({ data: { accountId: akunAda.id, followers: pengikut, recordedAt: sekarang, source: "massal" } });
        pengikutBerubah.push({ akun: `${input.platform}:@${handle}`, dari: akunAda.followers, ke: pengikut });
      }
      await catatJejak(tx, {
        userId: input.olehUserId,
        action: JEJAK.KOL_DIUBAH,
        entityType: "Kol",
        entityId: kol.id,
        changes: { before: sebelum, after: sesudah },
        metadata: { sumber: "massal", akunDitambah: akunAda ? [] : [`${input.platform}:@${handle}`], pengikutBerubah },
      });
      diperbarui += 1;
      kolIds.push(kol.id);
    }

    return { ok: true, baru, diperbarui, dilewati, kolIds, kembarBaru };
  });
}

/* ───────────────────────────── catatan ───────────────────────────── */

export const BATAS_CATATAN = BATAS_TEKS.catatan;

/**
 * Catatan manual pada KOL atau kolaborasi ("Catatan & riwayat").
 *
 * Aturan KOL Manager: menulis catatan berarti baru saja ada kontak, jadi
 * kontak terakhir KOL (dan kolaborasinya) diperbarui — jam follow-up mulai
 * ulang. Catatan kolaborasi juga membawa `kolId`, supaya muncul di profil KOL.
 *
 * Jejaknya ditulis pada entitas `KolNote`, bukan pada KOL/kolaborasinya:
 * linimasa sudah menampilkan catatannya sendiri, jejak di entitas induk hanya
 * akan menggandakannya.
 */
export async function buatCatatanKol(input: {
  kolId?: string | null;
  kolaborasiId?: string | null;
  isi: string;
  olehUserId: string;
}): Promise<HasilKol<{ id: string }>> {
  const isi = (input.isi ?? "").trim();
  if (!isi) return { ok: false, alasan: "ISI_WAJIB" };
  if (isi.length > BATAS_CATATAN) return { ok: false, alasan: "TERLALU_PANJANG" };
  if (!input.kolId && !input.kolaborasiId) return { ok: false, alasan: "TIDAK_VALID" };

  return runSerializable(async (tx): Promise<HasilKol<{ id: string }>> => {
    const sekarang = new Date();
    let kolId = input.kolId ?? null;
    let docNo: string | null = null;
    if (input.kolaborasiId) {
      const c = await tx.kolBrief.findUnique({ where: { id: input.kolaborasiId }, select: { id: true, kolId: true, docNo: true } });
      if (!c) return { ok: false, alasan: "TIDAK_DITEMUKAN" };
      if (kolId && kolId !== c.kolId) return { ok: false, alasan: "TIDAK_VALID" };
      kolId = c.kolId;
      docNo = c.docNo;
      await tx.kolBrief.update({ where: { id: c.id }, data: { lastContactAt: sekarang } });
    }
    const kol = await tx.kol.findUnique({ where: { id: kolId! }, select: { id: true, name: true } });
    if (!kol) return { ok: false, alasan: "TIDAK_DITEMUKAN" };
    await tx.kol.update({ where: { id: kol.id }, data: { lastContactAt: sekarang } });

    const catatan = await tx.kolNote.create({
      data: { kolId: kol.id, collabId: input.kolaborasiId ?? null, body: isi, createdById: input.olehUserId, createdAt: sekarang },
      select: { id: true },
    });
    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.CATATAN_KOL_DIBUAT,
      entityType: "KolNote",
      entityId: catatan.id,
      metadata: { kolId: kol.id, kolaborasiId: input.kolaborasiId ?? null, docNo, kol: kol.name, panjang: isi.length },
    });
    return { ok: true, id: catatan.id };
  });
}
