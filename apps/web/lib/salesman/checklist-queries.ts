import { prisma } from "@elorae/db";
import { formatDisplayDate, formatDisplayDateTime } from "@/lib/date-only";
import {
  bacaPertanyaan,
  bacaSimpanan,
  panduanBerlaku,
  persenSkor,
  pertanyaanTerlemah,
  ringkasPerToko,
  templateBerlaku,
  type HasilUntukLaporan,
  type JawabanChecklist,
  type JenisPertanyaan,
  type JenisToko,
  type PertanyaanChecklist,
  type RincianPertanyaan,
} from "./checklist-toko";
import { kunciTeks, ringkasHargaPesaing, type RingkasHargaPesaing } from "./harga-pesaing";

/**
 * Bacaan eksekusi di toko: daftar periksa display, panduan display, dan harga
 * pesaing. Ketiga tabelnya tidak punya relasi Prisma (`relationMode =
 * "prisma"`, web-only), jadi toko, kunjungan, pengguna dan template digabung
 * di sini dengan kueri kedua — bukan `include`.
 *
 * Semua tanggal diformat DI SERVER dan dikirim sebagai teks: format tanggal di
 * klien bisa berbeda antara Node dan Safari (hydration error).
 */

/** Hasil/catatan boleh dikirim sampai sekian jam sesudah check-in (HP yang baru dapat sinyal sesudah check-out). */
export const JAM_TENGGANG_KUNJUNGAN = 24;

/**
 * Kunjungan yang sah untuk mencatat hasil di toko ini: milik pengguna, di toko
 * yang sama, dan check-in-nya belum lewat 24 jam. TIDAK harus masih terbuka —
 * sama seperti pesanan dan foto kunjungan: isian yang tertahan karena sinyal
 * lalu terkirim sesudah check-out tetap milik kunjungan tempat ia diisi.
 * Layarnya sendiri hanya terbuka saat check-in di toko ini.
 */
export async function kunjunganUntukCatat(userId: string, storeId: string, visitId: string, sekarang: Date) {
  const v = await prisma.storeVisit.findFirst({
    where: { id: visitId, userId, storeId },
    select: { id: true, storeId: true, checkinAt: true },
  });
  if (!v) return null;
  if (sekarang.getTime() - v.checkinAt.getTime() > JAM_TENGGANG_KUNJUNGAN * 3600_000) return null;
  return v;
}

async function namaPengguna(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unik = [...new Set(ids.filter((x): x is string => !!x))];
  if (unik.length === 0) return new Map();
  const rows = await prisma.user.findMany({ where: { id: { in: unik } }, select: { id: true, name: true, email: true } });
  return new Map(rows.map((u) => [u.id, u.name ?? u.email]));
}

// ─── Template (kantor) ───────────────────────────────────────────────────────

export type BarisTemplateChecklist = {
  id: string;
  nama: string;
  termsType: JenisToko | null;
  isActive: boolean;
  jumlahPertanyaan: number;
  totalBobot: number;
  jumlahHasil: number;
  diubah: string;
};

export async function daftarTemplateChecklist(): Promise<BarisTemplateChecklist[]> {
  const [rows, hitung] = await Promise.all([
    prisma.visitChecklistTemplate.findMany({ orderBy: [{ isActive: "desc" }, { name: "asc" }] }),
    prisma.visitChecklistResult.groupBy({ by: ["templateId"], _count: { _all: true } }),
  ]);
  const jumlah = new Map(hitung.map((h) => [h.templateId, h._count._all]));
  return rows.map((t) => {
    const p = bacaPertanyaan(t.questions);
    return {
      id: t.id,
      nama: t.name,
      termsType: t.termsType,
      isActive: t.isActive,
      jumlahPertanyaan: p.length,
      totalBobot: p.reduce((s, x) => s + x.bobot, 0),
      jumlahHasil: jumlah.get(t.id) ?? 0,
      diubah: formatDisplayDateTime(t.updatedAt),
    };
  });
}

export type TemplateChecklistLengkap = {
  id: string;
  nama: string;
  termsType: JenisToko | null;
  isActive: boolean;
  pertanyaan: PertanyaanChecklist[];
  jumlahHasil: number;
};

export async function ambilTemplateChecklist(id: string): Promise<TemplateChecklistLengkap | null> {
  const t = await prisma.visitChecklistTemplate.findUnique({ where: { id } });
  if (!t) return null;
  const jumlahHasil = await prisma.visitChecklistResult.count({ where: { templateId: id } });
  return { id: t.id, nama: t.name, termsType: t.termsType, isActive: t.isActive, pertanyaan: bacaPertanyaan(t.questions), jumlahHasil };
}

// ─── HP: layar daftar periksa ────────────────────────────────────────────────

export type SkorSebelumnya = { persen: number | null; score: number; maxScore: number; tanggal: string };

/**
 * Skor kunjungan SEBELUMNYA di toko ini untuk template yang sama — pembanding
 * yang ditampilkan begitu hasil baru dikirim. Diambil dari kunjungan terbaru
 * (menurut check-in) selain kunjungan ini yang punya hasil template itu.
 */
export async function skorSebelumnya(storeId: string, templateId: string, kecualiVisitId: string): Promise<SkorSebelumnya | null> {
  const kunjungan = await prisma.storeVisit.findMany({
    where: { storeId, id: { not: kecualiVisitId } },
    select: { id: true, checkinAt: true },
    orderBy: { checkinAt: "desc" },
    take: 100,
  });
  if (kunjungan.length === 0) return null;
  const hasil = await prisma.visitChecklistResult.findMany({
    where: { templateId, visitId: { in: kunjungan.map((k) => k.id) } },
    select: { visitId: true, score: true, maxScore: true },
  });
  if (hasil.length === 0) return null;
  const perKunjungan = new Map(hasil.map((h) => [h.visitId, h]));
  for (const k of kunjungan) {
    const h = perKunjungan.get(k.id);
    if (h) return { persen: persenSkor(h.score, h.maxScore), score: h.score, maxScore: h.maxScore, tanggal: formatDisplayDate(k.checkinAt) };
  }
  return null;
}

export type TemplatePwa = {
  id: string;
  nama: string;
  pertanyaan: PertanyaanChecklist[];
  /** Hasil kunjungan ini — ada bila sudah pernah dikirim (kirim ulang menimpanya). */
  hasilIni: { jawaban: JawabanChecklist; score: number; maxScore: number; persen: number | null } | null;
  sebelumnya: SkorSebelumnya | null;
};

export type PanduanPwa = {
  id: string;
  judul: string;
  isi: string;
  gambarUrl: string | null;
  /** Foto hasil display yang SUDAH naik untuk panduan ini di kunjungan ini. */
  foto: { clientId: string; url: string }[];
};

export type BahanChecklistPwa = {
  templat: TemplatePwa[];
  panduan: PanduanPwa[];
  /** Foto kunjungan ini yang sudah naik, per clientId — jawaban FOTO menunjuk clientId. */
  fotoKunjungan: Record<string, string>;
};

export async function bahanChecklistPwa(
  toko: { id: string; termsType: JenisToko; groupId: string | null },
  visitId: string,
  sekarang: Date,
): Promise<BahanChecklistPwa> {
  const [semuaTemplate, hasilIni, foto, panduan] = await Promise.all([
    prisma.visitChecklistTemplate.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.visitChecklistResult.findMany({ where: { visitId } }),
    prisma.visitPhoto.findMany({
      where: { visitId },
      select: { clientId: true, url: true, displayGuideId: true },
      orderBy: { capturedAt: "asc" },
    }),
    panduanUntukToko(toko, sekarang),
  ]);
  const berlaku = templateBerlaku(semuaTemplate, toko.termsType);
  const hasilPerTemplate = new Map(hasilIni.map((h) => [h.templateId, h]));
  const templat = await Promise.all(
    berlaku.map(async (t): Promise<TemplatePwa> => {
      const h = hasilPerTemplate.get(t.id);
      return {
        id: t.id,
        nama: t.name,
        pertanyaan: bacaPertanyaan(t.questions),
        hasilIni: h
          ? { jawaban: bacaSimpanan(h.answers).jawaban, score: h.score, maxScore: h.maxScore, persen: persenSkor(h.score, h.maxScore) }
          : null,
        sebelumnya: await skorSebelumnya(toko.id, t.id, visitId),
      };
    }),
  );
  return {
    // Template tanpa pertanyaan yang terbaca tidak bisa diisi — jangan ditawarkan.
    templat: templat.filter((t) => t.pertanyaan.length > 0),
    panduan: panduan.map((p) => ({
      ...p,
      foto: foto.filter((f) => f.displayGuideId === p.id).map((f) => ({ clientId: f.clientId, url: f.url })),
    })),
    fotoKunjungan: Object.fromEntries(foto.map((f) => [f.clientId, f.url])),
  };
}

// ─── Panduan display ─────────────────────────────────────────────────────────

/** Panduan yang berlaku di toko ini sekarang (jenis toko, area, rentang tanggal). */
export async function panduanUntukToko(
  toko: { termsType: JenisToko; groupId: string | null },
  sekarang: Date,
): Promise<Omit<PanduanPwa, "foto">[]> {
  const rows = await prisma.displayGuide.findMany({ where: { isActive: true }, orderBy: [{ createdAt: "desc" }] });
  return rows
    .filter((p) => panduanBerlaku(p, toko, sekarang))
    .map((p) => ({ id: p.id, judul: p.title, isi: p.body, gambarUrl: p.imageUrl }));
}

export type BarisPanduan = {
  id: string;
  judul: string;
  gambarUrl: string | null;
  termsType: JenisToko | null;
  area: string | null;
  mulai: string | null;
  selesai: string | null;
  isActive: boolean;
  /** Aktif, dan hari ini di dalam rentang tanggalnya. */
  berlakuSekarang: boolean;
  jumlahFoto: number;
  diubah: string;
};

export async function daftarPanduan(sekarang: Date): Promise<BarisPanduan[]> {
  const rows = await prisma.displayGuide.findMany({ orderBy: [{ isActive: "desc" }, { createdAt: "desc" }] });
  if (rows.length === 0) return [];
  const [area, foto] = await Promise.all([
    prisma.storeGroup.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.groupId).filter((x): x is string => !!x))] } },
      select: { id: true, code: true, name: true },
    }),
    prisma.visitPhoto.groupBy({
      by: ["displayGuideId"],
      where: { displayGuideId: { in: rows.map((r) => r.id) } },
      _count: { _all: true },
    }),
  ]);
  const namaArea = new Map(area.map((a) => [a.id, `${a.code} · ${a.name}`]));
  const jumlahFoto = new Map(foto.map((f) => [f.displayGuideId, f._count._all]));
  return rows.map((p) => ({
    id: p.id,
    judul: p.title,
    gambarUrl: p.imageUrl,
    termsType: p.termsType,
    // Area yang sudah dihapus tetap terlihat sebagai "area tidak ditemukan", bukan "semua area".
    area: p.groupId ? (namaArea.get(p.groupId) ?? "?") : null,
    mulai: p.activeFrom ? formatDisplayDate(p.activeFrom) : null,
    selesai: p.activeTo ? formatDisplayDate(p.activeTo) : null,
    isActive: p.isActive,
    berlakuSekarang:
      p.isActive &&
      (!p.activeFrom || p.activeFrom.getTime() <= sekarang.getTime()) &&
      (!p.activeTo || p.activeTo.getTime() >= sekarang.getTime()),
    jumlahFoto: jumlahFoto.get(p.id) ?? 0,
    diubah: formatDisplayDateTime(p.updatedAt),
  }));
}

export type PanduanLengkap = {
  id: string;
  judul: string;
  isi: string;
  gambarUrl: string | null;
  termsType: JenisToko | null;
  groupId: string | null;
  /** YYYY-MM-DD hari WIB, untuk isian tanggal. */
  mulai: string;
  selesai: string;
  isActive: boolean;
  jumlahFoto: number;
};

const hariWib = (d: Date | null) =>
  d
    ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(d)
    : "";

export async function ambilPanduan(id: string): Promise<PanduanLengkap | null> {
  const p = await prisma.displayGuide.findUnique({ where: { id } });
  if (!p) return null;
  const jumlahFoto = await prisma.visitPhoto.count({ where: { displayGuideId: id } });
  return {
    id: p.id,
    judul: p.title,
    isi: p.body,
    gambarUrl: p.imageUrl,
    termsType: p.termsType,
    groupId: p.groupId,
    mulai: hariWib(p.activeFrom),
    selesai: hariWib(p.activeTo),
    isActive: p.isActive,
    jumlahFoto,
  };
}

/** Foto hasil display terbaru untuk satu panduan — kantor melihat apakah panduannya dijalankan. */
export async function fotoPanduanTerbaru(guideId: string, jumlah = 24) {
  const foto = await prisma.visitPhoto.findMany({
    where: { displayGuideId: guideId },
    select: { id: true, url: true, capturedAt: true, visit: { select: { storeId: true, userId: true } } },
    orderBy: { capturedAt: "desc" },
    take: jumlah,
  });
  const [toko, nama] = await Promise.all([
    prisma.store.findMany({ where: { id: { in: [...new Set(foto.map((f) => f.visit.storeId))] } }, select: { id: true, name: true } }),
    namaPengguna(foto.map((f) => f.visit.userId)),
  ]);
  const namaToko = new Map(toko.map((s) => [s.id, s.name]));
  return foto.map((f) => ({
    id: f.id,
    url: f.url,
    toko: namaToko.get(f.visit.storeId) ?? "—",
    oleh: nama.get(f.visit.userId) ?? "—",
    pada: formatDisplayDateTime(f.capturedAt),
  }));
}

// ─── Laporan eksekusi toko (kantor) ──────────────────────────────────────────

/** Batas baris yang dibaca satu laporan — di atasnya laporan diberi tanda "terpotong". */
const BATAS_BARIS_LAPORAN = 5000;

export type SaringLaporanChecklist = {
  dari: Date;
  sampai: Date;
  groupId?: string | null;
  salesmanId?: string | null;
  templateId?: string | null;
};

export type BarisLaporanToko = {
  storeId: string;
  tokoNama: string;
  tokoKode: string;
  area: string | null;
  templateId: string;
  templateNama: string;
  terakhir: { id: string; persen: number | null; score: number; maxScore: number; tanggal: string; salesman: string };
  tren: (number | null)[];
  jumlah: number;
};

export type PertanyaanLemahLaporan = {
  templateNama: string;
  id: string;
  teks: string;
  jenis: JenisPertanyaan;
  persen: number;
  jumlah: number;
};

export type LaporanChecklist = {
  baris: BarisLaporanToko[];
  lemah: PertanyaanLemahLaporan[];
  jumlahHasil: number;
  rataRata: number | null;
  terpotong: boolean;
};

export async function laporanChecklist(s: SaringLaporanChecklist): Promise<LaporanChecklist> {
  const rows = await prisma.visitChecklistResult.findMany({
    where: { createdAt: { gte: s.dari, lte: s.sampai }, ...(s.templateId ? { templateId: s.templateId } : {}) },
    select: { id: true, visitId: true, templateId: true, score: true, maxScore: true, answers: true, createdById: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: BATAS_BARIS_LAPORAN + 1,
  });
  const terpotong = rows.length > BATAS_BARIS_LAPORAN;
  const dipakai = rows.slice(0, BATAS_BARIS_LAPORAN);

  const kunjungan = await prisma.storeVisit.findMany({
    where: { id: { in: [...new Set(dipakai.map((r) => r.visitId))] } },
    select: { id: true, storeId: true, userId: true, checkinAt: true },
  });
  const perKunjungan = new Map(kunjungan.map((k) => [k.id, k]));
  const toko = await prisma.store.findMany({
    where: { id: { in: [...new Set(kunjungan.map((k) => k.storeId))] } },
    select: { id: true, name: true, code: true, groupId: true },
  });
  const perToko = new Map(toko.map((t) => [t.id, t]));

  // Saringan area/salesman memakai kunjungan dan toko — keduanya bukan relasi,
  // jadi disaring sesudah digabung.
  const lolos = dipakai.filter((r) => {
    const k = perKunjungan.get(r.visitId);
    if (!k) return false;
    if (s.salesmanId && k.userId !== s.salesmanId) return false;
    if (s.groupId && perToko.get(k.storeId)?.groupId !== s.groupId) return false;
    return true;
  });

  const [templat, area, nama] = await Promise.all([
    prisma.visitChecklistTemplate.findMany({
      where: { id: { in: [...new Set(lolos.map((r) => r.templateId))] } },
      select: { id: true, name: true },
    }),
    prisma.storeGroup.findMany({ select: { id: true, code: true } }),
    namaPengguna(lolos.map((r) => perKunjungan.get(r.visitId)?.userId)),
  ]);
  const namaTemplate = new Map(templat.map((t) => [t.id, t.name]));
  const kodeArea = new Map(area.map((a) => [a.id, a.code]));

  const untukLaporan: HasilUntukLaporan[] = lolos.map((r) => {
    const k = perKunjungan.get(r.visitId)!;
    return {
      id: r.id,
      storeId: k.storeId,
      templateId: r.templateId,
      tanggal: k.checkinAt,
      score: r.score,
      maxScore: r.maxScore,
      persen: persenSkor(r.score, r.maxScore),
      rincian: bacaSimpanan(r.answers).rincian,
    };
  });
  const ringkas = ringkasPerToko(untukLaporan);

  const baris: BarisLaporanToko[] = ringkas.map((g) => {
    const t = perToko.get(g.storeId);
    const k = perKunjungan.get(lolos.find((r) => r.id === g.terakhir.id)!.visitId)!;
    return {
      storeId: g.storeId,
      tokoNama: t?.name ?? "—",
      tokoKode: t?.code ?? "",
      area: t?.groupId ? (kodeArea.get(t.groupId) ?? null) : null,
      templateId: g.templateId,
      templateNama: namaTemplate.get(g.templateId) ?? "—",
      terakhir: {
        id: g.terakhir.id,
        persen: g.terakhir.persen,
        score: g.terakhir.score,
        maxScore: g.terakhir.maxScore,
        tanggal: formatDisplayDate(g.terakhir.tanggal),
        salesman: nama.get(k.userId) ?? "—",
      },
      tren: g.tren,
      jumlah: g.jumlah,
    };
  });

  // Pertanyaan terlemah dibaca dari hasil TERAKHIR tiap toko — keadaan rak
  // sekarang, bukan toko yang kebetulan paling sering didatangi.
  const lemah = pertanyaanTerlemah(ringkas.map((g) => g.terakhir)).map((q) => ({
    templateNama: namaTemplate.get(q.templateId) ?? "—",
    id: q.id,
    teks: q.teks,
    jenis: q.jenis,
    persen: q.persen,
    jumlah: q.jumlah,
  }));

  const persenTerakhir = ringkas.map((g) => g.terakhir.persen).filter((p): p is number => p !== null);
  return {
    baris,
    lemah,
    jumlahHasil: lolos.length,
    rataRata: persenTerakhir.length ? Math.round(persenTerakhir.reduce((a, b) => a + b, 0) / persenTerakhir.length) : null,
    terpotong,
  };
}

export type FotoJawaban = { clientId: string; url: string | null };

export type RincianHasilChecklist = {
  id: string;
  toko: { id: string; nama: string; kode: string };
  templateNama: string;
  salesman: string;
  kunjungan: string;
  dikirim: string;
  score: number;
  maxScore: number;
  persen: number | null;
  rincian: (RincianPertanyaan & { foto: FotoJawaban[] })[];
  fotoPanduan: { id: string; url: string; judul: string }[];
  riwayat: { id: string; persen: number | null; tanggal: string }[];
};

export async function rincianHasilChecklist(id: string): Promise<RincianHasilChecklist | null> {
  const r = await prisma.visitChecklistResult.findUnique({ where: { id } });
  if (!r) return null;
  const k = await prisma.storeVisit.findUnique({ where: { id: r.visitId }, select: { id: true, storeId: true, userId: true, checkinAt: true } });
  const simpan = bacaSimpanan(r.answers);

  const [toko, template, nama, fotoJawaban, fotoPanduanRows] = await Promise.all([
    k ? prisma.store.findUnique({ where: { id: k.storeId }, select: { id: true, name: true, code: true } }) : null,
    prisma.visitChecklistTemplate.findUnique({ where: { id: r.templateId }, select: { name: true } }),
    namaPengguna([k?.userId ?? r.createdById]),
    simpan.fotoIds.length
      ? prisma.visitPhoto.findMany({ where: { clientId: { in: simpan.fotoIds } }, select: { clientId: true, url: true } })
      : Promise.resolve([]),
    prisma.visitPhoto.findMany({
      where: { visitId: r.visitId, displayGuideId: { not: null } },
      select: { id: true, url: true, displayGuideId: true },
      orderBy: { capturedAt: "asc" },
    }),
  ]);
  const urlFoto = new Map(fotoJawaban.map((f) => [f.clientId, f.url]));
  const panduan = fotoPanduanRows.length
    ? await prisma.displayGuide.findMany({
        where: { id: { in: [...new Set(fotoPanduanRows.map((f) => f.displayGuideId as string))] } },
        select: { id: true, title: true },
      })
    : [];
  const judulPanduan = new Map(panduan.map((p) => [p.id, p.title]));

  // Riwayat skor template yang sama di toko ini — konteks untuk satu hasil.
  const riwayat = k
    ? await (async () => {
        const kunj = await prisma.storeVisit.findMany({
          where: { storeId: k.storeId },
          select: { id: true, checkinAt: true },
          orderBy: { checkinAt: "desc" },
          take: 100,
        });
        const hasil = await prisma.visitChecklistResult.findMany({
          where: { templateId: r.templateId, visitId: { in: kunj.map((x) => x.id) } },
          select: { id: true, visitId: true, score: true, maxScore: true },
        });
        const perVisit = new Map(hasil.map((h) => [h.visitId, h]));
        return kunj
          .filter((x) => perVisit.has(x.id))
          .slice(0, 10)
          .map((x) => {
            const h = perVisit.get(x.id)!;
            return { id: h.id, persen: persenSkor(h.score, h.maxScore), tanggal: formatDisplayDate(x.checkinAt) };
          });
      })()
    : [];

  return {
    id: r.id,
    toko: toko ? { id: toko.id, nama: toko.name, kode: toko.code } : { id: "", nama: "—", kode: "" },
    templateNama: template?.name ?? "—",
    salesman: nama.get(k?.userId ?? r.createdById) ?? "—",
    kunjungan: k ? formatDisplayDateTime(k.checkinAt) : "—",
    dikirim: formatDisplayDateTime(r.createdAt),
    score: r.score,
    maxScore: r.maxScore,
    persen: persenSkor(r.score, r.maxScore),
    rincian: simpan.rincian.map((x) => ({
      ...x,
      foto:
        x.jenis === "FOTO" && Array.isArray(x.jawaban)
          ? x.jawaban.map((c) => ({ clientId: c, url: urlFoto.get(c) ?? null }))
          : [],
    })),
    fotoPanduan: fotoPanduanRows.map((f) => ({ id: f.id, url: f.url, judul: judulPanduan.get(f.displayGuideId as string) ?? "—" })),
    riwayat,
  };
}

// ─── Harga pesaing ───────────────────────────────────────────────────────────

export type BarisHargaPesaing = {
  id: string;
  merek: string;
  produk: string;
  kategori: string | null;
  harga: number;
  catatan: string | null;
  fotoUrl: string | null;
  tanggal: string;
  /** YYYY-MM-DD hari WIB — kolom tanggal di Excel. */
  hari: string;
  oleh: string;
  toko: string;
  area: string | null;
};

/** Catatan terakhir di satu toko — daftar di bawah formulir HP. */
export async function hargaPesaingToko(storeId: string, jumlah = 20): Promise<BarisHargaPesaing[]> {
  const rows = await prisma.competitorPrice.findMany({
    where: { storeId },
    orderBy: { createdAt: "desc" },
    take: jumlah,
  });
  const nama = await namaPengguna(rows.map((r) => r.createdById));
  return rows.map((r) => ({
    id: r.id,
    merek: r.brand,
    produk: r.productName,
    kategori: r.category,
    harga: Number(r.price),
    catatan: r.note,
    fotoUrl: r.photoUrl,
    tanggal: formatDisplayDateTime(r.createdAt),
    hari: hariWib(r.createdAt),
    oleh: nama.get(r.createdById) ?? "—",
    toko: "",
    area: null,
  }));
}

/** Saran isian HP: kategori barang Elorae (supaya pembandingnya sejajar) + merek & kategori yang pernah dicatat. */
export async function saranHargaPesaing(): Promise<{ merek: string[]; kategori: string[] }> {
  const [kategoriItem, terakhir] = await Promise.all([
    prisma.itemCategory.findMany({ where: { isActive: true }, select: { name: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.competitorPrice.findMany({ select: { brand: true, category: true }, orderBy: { createdAt: "desc" }, take: 500 }),
  ]);
  const unik = (xs: (string | null)[]) => {
    const lihat = new Map<string, string>();
    for (const x of xs) {
      if (!x) continue;
      const k = kunciTeks(x);
      if (k && !lihat.has(k)) lihat.set(k, x);
    }
    return [...lihat.values()];
  };
  return {
    merek: unik(terakhir.map((r) => r.brand)).slice(0, 50),
    kategori: unik([...kategoriItem.map((c) => c.name), ...terakhir.map((r) => r.category)]).slice(0, 80),
  };
}

export type SaringHargaPesaing = {
  dari: Date;
  sampai: Date;
  merek?: string | null;
  kategori?: string | null;
  groupId?: string | null;
};

export async function laporanHargaPesaing(
  s: SaringHargaPesaing,
): Promise<{ baris: BarisHargaPesaing[]; ringkas: RingkasHargaPesaing[]; terpotong: boolean }> {
  const rows = await prisma.competitorPrice.findMany({
    where: { createdAt: { gte: s.dari, lte: s.sampai } },
    orderBy: { createdAt: "desc" },
    take: BATAS_BARIS_LAPORAN + 1,
  });
  const terpotong = rows.length > BATAS_BARIS_LAPORAN;
  const dipakai = rows.slice(0, BATAS_BARIS_LAPORAN);

  const toko = await prisma.store.findMany({
    where: { id: { in: [...new Set(dipakai.map((r) => r.storeId))] } },
    select: { id: true, name: true, groupId: true },
  });
  const perToko = new Map(toko.map((t) => [t.id, t]));

  // Merek dan kategori diketik bebas: disaring dengan kunci yang sama dengan
  // pengelompokannya (tanpa beda huruf besar/kecil), di sini — bukan di SQL,
  // supaya berlaku sama di PostgreSQL maupun MariaDB.
  const cariMerek = kunciTeks(s.merek);
  const cariKategori = kunciTeks(s.kategori);
  const lolos = dipakai.filter((r) => {
    if (cariMerek && !kunciTeks(r.brand).includes(cariMerek)) return false;
    if (cariKategori && !kunciTeks(r.category).includes(cariKategori)) return false;
    if (s.groupId && perToko.get(r.storeId)?.groupId !== s.groupId) return false;
    return true;
  });

  const [area, nama] = await Promise.all([
    prisma.storeGroup.findMany({ select: { id: true, code: true } }),
    namaPengguna(lolos.map((r) => r.createdById)),
  ]);
  const kodeArea = new Map(area.map((a) => [a.id, a.code]));

  const baris: BarisHargaPesaing[] = lolos.map((r) => {
    const t = perToko.get(r.storeId);
    return {
      id: r.id,
      merek: r.brand,
      produk: r.productName,
      kategori: r.category,
      harga: Number(r.price),
      catatan: r.note,
      fotoUrl: r.photoUrl,
      tanggal: formatDisplayDateTime(r.createdAt),
      hari: hariWib(r.createdAt),
      oleh: nama.get(r.createdById) ?? "—",
      toko: t?.name ?? "—",
      area: t?.groupId ? (kodeArea.get(t.groupId) ?? null) : null,
    };
  });
  return {
    baris,
    ringkas: ringkasHargaPesaing(baris.map((b) => ({ brand: b.merek, category: b.kategori, price: b.harga }))),
    terpotong,
  };
}
