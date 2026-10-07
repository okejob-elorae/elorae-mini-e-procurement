import { prisma } from "@elorae/db";
import { daftarSalesman } from "@/lib/salesman/queries";
import { daftarPiutang, type BarisPiutang } from "./queries";
import { returTertahan } from "./rules";
import { PILIH_POTONGAN, potonganRetur } from "./deductions";
import {
  STATUS_TUGAS,
  bacaIdFaktur,
  bacaStatusTugas,
  keadaanTugas,
  perluDitagih,
  petugasBawaan,
  type KeadaanTugas,
  type StatusTugas,
} from "./tugas-tagih";
import { JEJAK_TUGAS_TAGIH } from "./tugas-tagih-writer";
import { penerjemahPesanToko, pesanUntukKlaim, tautanPesanToko } from "./pesan-toko";

/**
 * Kueri tugas tagih — dan, berdampingan, bahan pesan WhatsApp ke toko atas
 * sebuah BKM. Keduanya pekerjaan penagihan ke toko; dipisah ke berkasnya
 * sendiri kalau salah satunya tumbuh.
 */

/**
 * Berapa banyak tugas yang ditutup/dibatalkan yang dibawa ke layar kantor.
 * Yang masih TERBUKA selalu dibawa semua — itulah pekerjaannya.
 */
const BATAS_RIWAYAT = 200;

export type FakturTugasTampil = {
  id: string;
  invoiceNo: string;
  dueDate: string;
  amount: number;
  /** Sisa yang DIHITUNG ULANG, bukan kolom cache. */
  sisa: number;
  keadaan: BarisPiutang["keadaan"];
  noKlaim: string | null;
};

export type BarisTugasTagih = {
  id: string;
  storeId: string;
  storeName: string;
  assigneeId: string;
  assigneeName: string;
  createdByName: string;
  status: StatusTugas;
  keadaan: KeadaanTugas;
  dueDate: string | null;
  createdAt: string;
  completedAt: string | null;
  note: string | null;
  faktur: FakturTugasTampil[];
  totalSisa: number;
  /** Id faktur yang tercatat di tugas tapi barisnya sudah tidak ada. */
  hilang: number;
  /** Hasil tagih / alasan batal dari jejaknya; `null` selama masih terbuka. */
  penutup: { catatan: string | null; oleh: string | null; otomatis: boolean; pada: string } | null;
};

export type SaringTugas = {
  assigneeId?: string;
  status?: StatusTugas | "SEMUA";
  hanyaTerlambat?: boolean;
  storeId?: string;
};

const nama = (u: { name: string | null; email: string } | undefined) => u?.name ?? u?.email ?? "—";

/**
 * Daftar tugas tagih, dengan keadaan yang diturunkan dari faktur-fakturnya.
 *
 * Murni bacaan — penutupan otomatis tugas yang lunas dikerjakan pemanggil
 * (halaman kantor) lewat `tutupTugasLunasOtomatis`, supaya fungsi baca tidak
 * diam-diam menulis.
 */
export async function daftarTugasTagih(saring: SaringTugas = {}, hariIni = new Date()): Promise<BarisTugasTagih[]> {
  const status = saring.status ?? STATUS_TUGAS.TERBUKA;
  const rows = await prisma.collectionTask.findMany({
    where: {
      ...(saring.assigneeId ? { assigneeId: saring.assigneeId } : {}),
      ...(saring.storeId ? { storeId: saring.storeId } : {}),
      ...(status !== "SEMUA" ? { status } : {}),
    },
    orderBy: [{ createdAt: "desc" }],
    ...(status === STATUS_TUGAS.TERBUKA ? {} : { take: BATAS_RIWAYAT }),
  });
  if (rows.length === 0) return [];

  const idsPerTugas = new Map(rows.map((r) => [r.id, bacaIdFaktur(r.receivableIds)]));
  const semuaId = [...new Set([...idsPerTugas.values()].flat())];
  const userIds = [...new Set(rows.flatMap((r) => [r.assigneeId, r.createdById]))];
  const storeIds = [...new Set(rows.map((r) => r.storeId))];
  const tertutup = rows.filter((r) => bacaStatusTugas(r.status) !== STATUS_TUGAS.TERBUKA).map((r) => r.id);

  const [piutang, users, stores, jejak] = await Promise.all([
    semuaId.length ? daftarPiutang({ receivableIds: semuaId }) : Promise.resolve([] as BarisPiutang[]),
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }),
    prisma.store.findMany({ where: { id: { in: storeIds } }, select: { id: true, name: true } }),
    tertutup.length
      ? prisma.auditLog.findMany({
          where: {
            entityType: "CollectionTask",
            entityId: { in: tertutup },
            action: {
              in: [JEJAK_TUGAS_TAGIH.SELESAI, JEJAK_TUGAS_TAGIH.SELESAI_OTOMATIS, JEJAK_TUGAS_TAGIH.DIBATALKAN],
            },
          },
          orderBy: { createdAt: "desc" },
          select: { entityId: true, action: true, reason: true, createdAt: true, user: { select: { name: true, email: true } } },
        })
      : Promise.resolve([]),
  ]);

  const piutangById = new Map(piutang.map((p) => [p.id, p]));
  const userById = new Map(users.map((u) => [u.id, u]));
  const tokoById = new Map(stores.map((s) => [s.id, s.name]));
  const jejakTerakhir = new Map<string, (typeof jejak)[number]>();
  for (const j of jejak) if (!jejakTerakhir.has(j.entityId)) jejakTerakhir.set(j.entityId, j);

  const hasil = rows.map((r): BarisTugasTagih => {
    const ids = idsPerTugas.get(r.id) ?? [];
    const faktur = ids
      .map((id) => piutangById.get(id))
      .filter((p): p is BarisPiutang => p !== undefined)
      .map((p) => ({
        id: p.id,
        invoiceNo: p.invoiceNo,
        dueDate: p.dueDate,
        amount: p.amount,
        sisa: p.outstanding,
        keadaan: p.keadaan,
        noKlaim: p.alasan.noKlaim ?? null,
      }));
    const st = bacaStatusTugas(r.status);
    const j = jejakTerakhir.get(r.id);
    return {
      id: r.id,
      storeId: r.storeId,
      storeName: tokoById.get(r.storeId) ?? "—",
      assigneeId: r.assigneeId,
      assigneeName: nama(userById.get(r.assigneeId)),
      createdByName: nama(userById.get(r.createdById)),
      status: st,
      keadaan: keadaanTugas({ status: st, tenggat: r.dueDate, faktur, hariIni }),
      dueDate: r.dueDate?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
      note: r.note,
      faktur,
      totalSisa: faktur.reduce((s, f) => s + f.sisa, 0),
      hilang: ids.length - faktur.length,
      penutup: j
        ? {
            catatan: j.reason,
            oleh: j.user ? nama(j.user) : null,
            otomatis: j.action === JEJAK_TUGAS_TAGIH.SELESAI_OTOMATIS,
            pada: j.createdAt.toISOString(),
          }
        : null,
    };
  });

  const tampil = saring.hanyaTerlambat ? hasil.filter((b) => b.keadaan === "TERLAMBAT") : hasil;
  // Yang terlambat dulu, lalu tenggat terdekat — urutan kerja, bukan urutan dibuat.
  const URUT: KeadaanTugas[] = ["TERLAMBAT", "BERJALAN", "DILAPORKAN", "LUNAS", "SELESAI", "DIBATALKAN"];
  return tampil.sort(
    (a, b) =>
      URUT.indexOf(a.keadaan) - URUT.indexOf(b.keadaan) ||
      (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") ||
      b.createdAt.localeCompare(a.createdAt),
  );
}

/** Tugas terbuka milik satu orang lapangan — untuk layar Tagihan di HP. */
export function tugasTagihSaya(userId: string, hariIni = new Date()): Promise<BarisTugasTagih[]> {
  return daftarTugasTagih({ assigneeId: userId, status: STATUS_TUGAS.TERBUKA }, hariIni);
}

/**
 * Ringkasan untuk baris tugas di beranda HP: berapa tugas tagih yang masih
 * menuntut datang ke toko, dan berapa di antaranya lewat tenggat.
 * Tugas yang sudah dilaporkan bayar atau sudah lunas tidak dihitung.
 */
export async function ringkasTugasTagihSaya(userId: string): Promise<{ perluDitagih: number; terlambat: number }> {
  const terbuka = await prisma.collectionTask.count({ where: { assigneeId: userId, status: STATUS_TUGAS.TERBUKA } });
  if (terbuka === 0) return { perluDitagih: 0, terlambat: 0 };
  const tugas = await tugasTagihSaya(userId);
  return {
    perluDitagih: tugas.filter((t) => perluDitagih(t.keadaan)).length,
    terlambat: tugas.filter((t) => t.keadaan === "TERLAMBAT").length,
  };
}

export type FakturCalonTugas = {
  id: string;
  invoiceNo: string;
  dueDate: string;
  sisa: number;
  keadaan: BarisPiutang["keadaan"];
  /** Keadaan untuk layar kantor — `belum` yang lewat jatuh tempo menjadi `jatuh_tempo`. */
  keadaanTampil: BarisPiutang["keadaanTampil"];
  /** Nomor BKM / kontrabon yang menempel pada keadaannya. */
  doc: string | null;
  /** Nama petugas kalau faktur ini sudah berada di tugas terbuka lain. */
  ditugaskanKe: string | null;
};

export type BahanTugasBaru = {
  toko: { id: string; name: string; total: number; jumlah: number; petugasBawaan: string }[];
  fakturPerToko: Record<string, FakturCalonTugas[]>;
  petugas: { id: string; nama: string }[];
};

/** Bahan formulir tugas baru: toko yang punya faktur terbuka, fakturnya, dan orang lapangan. */
export async function bahanTugasBaru(): Promise<BahanTugasBaru> {
  const [semua, petugas, tugasTerbuka] = await Promise.all([
    daftarPiutang({ hanyaTerbuka: true }),
    daftarSalesman(),
    prisma.collectionTask.findMany({
      where: { status: STATUS_TUGAS.TERBUKA },
      select: { assigneeId: true, receivableIds: true },
    }),
  ]);
  const terbuka = semua.filter((p) => p.outstanding > 0);

  const lapangan = new Set(petugas.map((p) => p.id));
  const namaPetugas = new Map(petugas.map((p) => [p.id, p.nama]));
  const ditugaskan = new Map<string, string>();
  const pemegangLain = [...new Set(tugasTerbuka.map((t) => t.assigneeId).filter((id) => !namaPetugas.has(id)))];
  if (pemegangLain.length) {
    const lain = await prisma.user.findMany({
      where: { id: { in: pemegangLain } },
      select: { id: true, name: true, email: true },
    });
    for (const u of lain) namaPetugas.set(u.id, nama(u));
  }
  for (const t of tugasTerbuka) {
    for (const id of bacaIdFaktur(t.receivableIds)) ditugaskan.set(id, namaPetugas.get(t.assigneeId) ?? "—");
  }

  const storeIds = [...new Set(terbuka.map((p) => p.storeId))];
  const [stores, penjual] = await Promise.all([
    storeIds.length
      ? prisma.store.findMany({ where: { id: { in: storeIds } }, select: { id: true, salesmanId: true } })
      : Promise.resolve([]),
    terbuka.length
      ? prisma.receivable.findMany({ where: { id: { in: terbuka.map((p) => p.id) } }, select: { id: true, salesmanId: true } })
      : Promise.resolve([]),
  ]);
  const pemegang = new Map(stores.map((s) => [s.id, s.salesmanId]));
  const penjualById = new Map(penjual.map((p) => [p.id, p.salesmanId]));

  const fakturPerToko: Record<string, FakturCalonTugas[]> = {};
  const toko = new Map<string, BahanTugasBaru["toko"][number]>();
  for (const p of terbuka) {
    (fakturPerToko[p.storeId] ??= []).push({
      id: p.id,
      invoiceNo: p.invoiceNo,
      dueDate: p.dueDate,
      sisa: p.outstanding,
      keadaan: p.keadaan,
      keadaanTampil: p.keadaanTampil,
      doc: p.alasan.noKlaim ?? p.alasan.noKontrabon ?? null,
      ditugaskanKe: ditugaskan.get(p.id) ?? null,
    });
    const t = toko.get(p.storeId) ?? { id: p.storeId, name: p.storeName, total: 0, jumlah: 0, petugasBawaan: "" };
    t.total += p.outstanding;
    t.jumlah += 1;
    toko.set(p.storeId, t);
  }
  for (const t of toko.values()) {
    t.petugasBawaan = petugasBawaan({
      pemegangId: pemegang.get(t.id) ?? null,
      penjualIds: (fakturPerToko[t.id] ?? []).map((f) => penjualById.get(f.id) ?? null),
      petugasLapangan: lapangan,
    });
  }

  return {
    toko: [...toko.values()].sort((a, b) => a.name.localeCompare(b.name)),
    fakturPerToko,
    petugas,
  };
}

/* ------------------------------------------------------------------------ */
/* Pesan WhatsApp ke toko atas sebuah BKM                                    */
/* ------------------------------------------------------------------------ */

export type TautanPesanKlaim = {
  jenis: "TANDA_TERIMA" | "KONFIRMASI";
  url: string;
  /** `false` = nomor HP toko tidak tercatat; tautannya membuka pemilih kontak WhatsApp. */
  adaNomor: boolean;
};

const angka = (v: unknown): number => Number(v ?? 0);

/**
 * Tautan pesan WhatsApp untuk beberapa BKM sekaligus (daftar "BKM saya").
 *
 * Jenisnya ditentukan keadaan klaim SEKARANG (`pesanUntukKlaim`): DIKIRIM →
 * tanda terima tanpa kata lunas, TERVERIFIKASI → konfirmasi dengan sisa yang
 * dihitung ulang, selebihnya tidak ada. Bahasa pesan dipatok Indonesia —
 * penerimanya toko.
 *
 * `pemilik`: kalau diisi, hanya BKM yang dilaporkan orang ini yang dibuatkan
 * tautan — layar HP tidak boleh membocorkan nomor toko lewat id klaim orang lain.
 */
export async function tautanPesanKlaim(
  claimIds: readonly string[],
  opsi: { pemilik?: string } = {},
): Promise<Map<string, TautanPesanKlaim>> {
  const hasil = new Map<string, TautanPesanKlaim>();
  if (claimIds.length === 0) return hasil;

  const klaim = await prisma.paymentClaim.findMany({
    where: { id: { in: [...claimIds] }, ...(opsi.pemilik ? { salesmanId: opsi.pemilik } : {}) },
    select: {
      id: true,
      docNo: true,
      status: true,
      method: true,
      claimedTransferAt: true,
      invoiceAmount: true,
      deductionTotal: true,
      receivedAmount: true,
      giroNo: true,
      giroBank: true,
      giroEffectiveDate: true,
      giroStatus: true,
      store: { select: { name: true, phone: true } },
      salesman: { select: { name: true } },
      receivableLinks: { select: { settledAmount: true, receivable: { select: { id: true, invoiceNo: true } } } },
      deductions: { select: PILIH_POTONGAN },
    },
  });

  // Sisa sekarang hanya dibutuhkan konfirmasi; tanda terima tidak pernah membacanya.
  const idTerverifikasi = klaim
    .filter((k) => k.status === "TERVERIFIKASI")
    .flatMap((k) => k.receivableLinks.map((l) => l.receivable.id));
  const sisa = new Map(
    (idTerverifikasi.length ? await daftarPiutang({ receivableIds: [...new Set(idTerverifikasi)] }) : []).map((p) => [
      p.id,
      p.outstanding,
    ]),
  );

  const { t, locale } = penerjemahPesanToko("id");
  for (const k of klaim) {
    const giro = k.method === "giro" ? { nomor: k.giroNo, bank: k.giroBank } : null;
    const pesan = pesanUntukKlaim(
      k.status,
      {
        tandaTerima: {
          toko: k.store.name,
          docNo: k.docNo,
          tanggal: k.claimedTransferAt,
          cara: k.method,
          faktur: k.receivableLinks.map((l) => ({ invoiceNo: l.receivable.invoiceNo, nilai: angka(l.settledAmount) })),
          nilaiFaktur: angka(k.invoiceAmount),
          potongan: angka(k.deductionTotal),
          diterima: angka(k.receivedAmount),
          giro: giro ? { ...giro, efektif: k.giroEffectiveDate } : null,
          diterimaOleh: k.salesman?.name ?? null,
        },
        konfirmasi: {
          toko: k.store.name,
          docNo: k.docNo,
          tanggal: k.claimedTransferAt,
          diterima: angka(k.receivedAmount),
          giro: giro && k.giroStatus === "CAIR" ? giro : null,
          // Faktur yang tidak lagi terbaca (impor dibatalkan) dianggap masih bersisa
          // penuh nilainya — arah yang aman: tidak pernah menyebut lunas tanpa bukti.
          faktur: k.receivableLinks.map((l) => ({
            invoiceNo: l.receivable.invoiceNo,
            sisa: sisa.get(l.receivable.id) ?? angka(l.settledAmount),
          })),
          tertahan: returTertahan(potonganRetur(k.deductions)),
        },
      },
      t,
      locale,
    );
    if (!pesan) continue;
    const tautan = tautanPesanToko(k.store.phone, pesan.pesan);
    hasil.set(k.id, { jenis: pesan.jenis, ...tautan });
  }
  return hasil;
}

/** Id klaim dari nomor dokumennya — formulir BKM hanya menerima `docNo` dari penulisnya. */
export async function idKlaimDariNomor(docNo: string): Promise<{ id: string; salesmanId: string; createdById: string } | null> {
  return prisma.paymentClaim.findUnique({
    where: { docNo },
    select: { id: true, salesmanId: true, createdById: true },
  });
}
