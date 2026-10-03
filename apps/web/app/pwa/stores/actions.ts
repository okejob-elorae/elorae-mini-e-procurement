"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma, prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { planCheckIn } from "@/lib/pwa/visit-transitions";
import { submitStoreChangeRequest } from "@/lib/store-changes/writer";
import { parseRadiusSetting, resolveEffectiveRadius, evaluateCheckinRadius } from "@/lib/pwa/checkin-radius";
import { tokoTerkunci } from "@/lib/salesman/queries";
import { bolehPegangToko } from "@/lib/stores/penanggung-jawab";
import {
  bacaAturanCheckin,
  bacaAturanHasilKunjungan,
  KUNCI_ATURAN_CHECKIN,
  KUNCI_HASIL_KUNJUNGAN,
  KUNCI_RADIUS_GLOBAL,
} from "@/lib/salesman/aturan-kunjungan";
import { putuskanHasilCheckout } from "@/lib/salesman/hasil-kunjungan";
import {
  HARI_KOORDINAT_KEMBAR,
  nilaiCheckinJanggal,
  normalkanAkurasi,
  type TandaCheckin,
} from "@/lib/salesman/checkin-janggal";
import { absenMasukLewatCheckin, absenPulangLewatCheckout } from "@/lib/salesman/absensi-writer";
import { runSerializable } from "@/lib/db/tx-retry";
import { BATAS_CHECKIN_LURING_MS, jepitWaktuLuring } from "@/lib/pwa/waktu-luring";

const checkInSchema = z.object({
  storeId: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  clientId: z.string().min(1).max(100).nullable().optional(),
});

const checkOutSchema = z.object({
  visitId: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  outcome: z.string().max(40).nullable().optional(),
  outcomeNote: z.string().max(2000).nullable().optional(),
  transaksiTertunda: z.boolean().optional(),
});

async function bacaSetelan(key: string): Promise<string | null> {
  const baris = await prisma.systemSetting.findUnique({ where: { key }, select: { value: true } });
  return baris?.value ?? null;
}

/**
 * Apakah kunjungan ini sudah menghasilkan transaksi yang tercatat di server:
 * pesanan yang terikat kunjungannya, atau klaim bayar / retur toko / penjualan
 * kanvas / tukar faktur oleh orang ini di toko ini sejak check-in.
 */
async function adaTransaksiKunjungan(k: { visitId: string; userId: string; storeId: string; sejak: Date }): Promise<boolean> {
  const sejak = { gte: k.sejak };
  const jumlah = await Promise.all([
    prisma.fieldSalesOrder.count({ where: { visitId: k.visitId } }),
    prisma.paymentClaim.count({
      where: { storeId: k.storeId, createdAt: sejak, OR: [{ createdById: k.userId }, { salesmanId: k.userId }] },
    }),
    prisma.storeReturn.count({ where: { storeId: k.storeId, salesmanId: k.userId, createdAt: sejak } }),
    prisma.vanSale.count({ where: { storeId: k.storeId, salesmanId: k.userId, createdAt: sejak } }),
    prisma.collectionNote.count({ where: { storeId: k.storeId, salesmanId: k.userId, createdAt: sejak } }),
  ]);
  return jumlah.some((n) => n > 0);
}

export type CheckInHasil =
  | { ok: false; code: "UNAUTHORIZED" | "NOT_FOUND" | "STORE_NOT_ASSIGNED" }
  | { ok: false; code: "DI_LUAR_RADIUS"; jarakMeter: number; radiusMeter: number; akurasiMeter: number | null };

/**
 * Penilaian check-in yang sama untuk check-in dengan sinyal dan dari antrean
 * HP: toko tetap SPG, toko aktif, kunci "hanya toko sendiri", radius (mode
 * TOLAK menolak), tanda janggal, dan kunjungan terbuka yang akan ditutup
 * otomatis. Semuanya dinilai dengan koordinat dan WAKTU tangkapan — untuk
 * antrean, `waktu` adalah saat check-in ditekan di HP, dan kunjungan
 * "sebelumnya" adalah yang sebelum waktu itu.
 */
type PenilaianCheckIn =
  | { ok: false; hasil: CheckInHasil }
  | {
      ok: true;
      spg: boolean;
      radius: { distanceMeters: number | null; outOfRadius: boolean };
      tanda: TandaCheckin[] | null;
      tutupOtomatisBertransaksi: string | null;
    };

async function nilaiCheckIn(
  userId: string,
  p: { storeId: string; lat: number; lng: number },
  akurasi: number | null,
  waktu: Date,
  luring: boolean,
): Promise<PenilaianCheckIn> {
  // An SPG is stationed at one store — they may only check in there, even if they
  // reach another store's route directly. Non-SPG users have no assignedStoreId.
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { assignedStoreId: true } });
  if (me?.assignedStoreId && me.assignedStoreId !== p.storeId) {
    return { ok: false, hasil: { ok: false, code: "STORE_NOT_ASSIGNED" } };
  }
  const spg = Boolean(me?.assignedStoreId);

  const store = await prisma.store.findUnique({
    where: { id: p.storeId },
    select: { id: true, isActive: true, lat: true, lng: true, checkinRadiusMeters: true, salesmanId: true },
  });
  if (!store || !store.isActive) return { ok: false, hasil: { ok: false, code: "NOT_FOUND" } };

  // Kunci "hanya toko sendiri" (salesman). Dijaga DI SINI, bukan hanya di
  // layar: menyembunyikan toko dari daftar tidak mencegah check-in lewat
  // tautan lama atau alamat yang diketik.
  if (!spg) {
    const terkunci = await tokoTerkunci();
    if (!bolehPegangToko({ terkunci, penanggungJawabId: store.salesmanId, userId })) {
      return { ok: false, hasil: { ok: false, code: "STORE_NOT_ASSIGNED" } };
    }
  }

  const [radiusGlobal, aturanCheckinMentah] = await Promise.all([
    bacaSetelan(KUNCI_RADIUS_GLOBAL),
    bacaSetelan(KUNCI_ATURAN_CHECKIN),
  ]);
  const aturan = bacaAturanCheckin(aturanCheckinMentah);
  const effectiveRadius = resolveEffectiveRadius(store.checkinRadiusMeters, parseRadiusSetting(radiusGlobal));
  const radius = evaluateCheckinRadius({
    checkin: { lat: p.lat, lng: p.lng },
    store: { lat: store.lat === null ? null : store.lat.toNumber(), lng: store.lng === null ? null : store.lng.toNumber() },
    effectiveRadiusMeters: effectiveRadius,
  });

  // Mode TOLAK berlaku untuk salesman DAN SPG. Toko tanpa pin peta tidak
  // pernah "di luar radius", jadi tidak pernah ditolak di sini.
  if (aturan.modeRadius === "TOLAK" && radius.outOfRadius && radius.distanceMeters !== null) {
    return {
      ok: false,
      hasil: {
        ok: false,
        code: "DI_LUAR_RADIUS",
        jarakMeter: radius.distanceMeters,
        radiusMeter: effectiveRadius,
        akurasiMeter: akurasi,
      },
    };
  }

  // Tanda janggal dan hasil kunjungan yang ditutup otomatis adalah pelengkap:
  // kalau bacaannya gagal, check-in tetap jalan tanpa keduanya.
  let tanda: TandaCheckin[] | null = null;
  let tutupOtomatisBertransaksi: string | null = null;
  try {
    const sejakKembar = new Date(waktu.getTime() - HARI_KOORDINAT_KEMBAR * 86_400_000);
    // ±0,000001° menangkap semua titik yang bisa jatuh ke kunci 6 desimal yang
    // sama; perbandingan pastinya di `nilaiCheckinJanggal`.
    const d = 0.000001;
    // Antrean HP: yang "sebelumnya" adalah kunjungan sebelum waktu tangkap —
    // kunjungan yang tercatat sesudahnya (sinyal kembali di toko berikutnya)
    // bukan pembanding check-in ini.
    const sebelumWaktu = luring ? { checkinAt: { lt: waktu } } : {};
    const [sebelumnya, terbaru] = await Promise.all([
      prisma.storeVisit.findFirst({
        where: { userId, ...sebelumWaktu },
        orderBy: { checkinAt: "desc" },
        select: {
          id: true,
          storeId: true,
          checkinLat: true,
          checkinLng: true,
          checkinAt: true,
          checkoutLat: true,
          checkoutLng: true,
          checkoutAt: true,
        },
      }),
      prisma.storeVisit.findMany({
        where: {
          userId,
          storeId: { not: p.storeId },
          checkinAt: luring ? { gte: sejakKembar, lt: waktu } : { gte: sejakKembar },
          checkinLat: { gte: p.lat - d, lte: p.lat + d },
          checkinLng: { gte: p.lng - d, lte: p.lng + d },
        },
        orderBy: { checkinAt: "desc" },
        take: 5,
        select: { storeId: true, checkinLat: true, checkinLng: true, checkinAt: true, store: { select: { name: true } } },
      }),
    ]);
    tanda = nilaiCheckinJanggal({
      storeId: p.storeId,
      lat: p.lat,
      lng: p.lng,
      waktu,
      akurasiMeter: akurasi,
      batasAkurasiMeter: aturan.akurasiMaksMeter,
      sebelumnya: sebelumnya
        ? {
            checkinLat: sebelumnya.checkinLat.toNumber(),
            checkinLng: sebelumnya.checkinLng.toNumber(),
            checkinAt: sebelumnya.checkinAt,
            checkoutLat: sebelumnya.checkoutLat ? sebelumnya.checkoutLat.toNumber() : null,
            checkoutLng: sebelumnya.checkoutLng ? sebelumnya.checkoutLng.toNumber() : null,
            checkoutAt: sebelumnya.checkoutAt,
          }
        : null,
      checkinTerbaru: terbaru.map((v) => ({
        storeId: v.storeId,
        namaToko: v.store?.name ?? null,
        lat: v.checkinLat.toNumber(),
        lng: v.checkinLng.toNumber(),
        waktu: v.checkinAt,
      })),
    });

    // Kunjungan yang masih terbuka di toko lain akan ditutup otomatis oleh
    // check-in ini. Salesman tidak ditanya alasannya, tapi kalau kunjungan itu
    // menghasilkan transaksi, hasilnya tetap dicatat supaya angka "kunjungan
    // jadi transaksi" tidak bolong.
    if (!spg && sebelumnya && sebelumnya.checkoutAt === null && sebelumnya.storeId !== p.storeId) {
      const jadi = await adaTransaksiKunjungan({
        visitId: sebelumnya.id,
        userId,
        storeId: sebelumnya.storeId,
        sejak: sebelumnya.checkinAt,
      });
      if (jadi) tutupOtomatisBertransaksi = sebelumnya.id;
    }
  } catch (e) {
    console.error("checkIn: tanda janggal tidak terbaca", e);
  }

  return { ok: true, spg, radius, tanda, tutupOtomatisBertransaksi };
}

export async function checkIn(input: {
  storeId: string;
  lat: number;
  lng: number;
  /** `pos.coords.accuracy` (meter). Aplikasi lama tidak mengirimnya — ditandai, tidak ditolak. */
  accuracy?: number | null;
  /**
   * Id buatan HP untuk check-in ini. Kalau jawabannya tidak sampai (sinyal
   * putus di tengah jalan), HP mengantrekan check-in yang sama dengan id ini —
   * antrean lalu mengenali kunjungan yang ternyata sudah tercatat.
   */
  clientId?: string | null;
}): Promise<CheckInHasil | void> {
  const parsed = checkInSchema.parse(input);
  const akurasi = normalkanAkurasi(input.accuracy);
  const session = await auth();
  if (!session?.user?.id) return { ok: false, code: "UNAUTHORIZED" };
  const userId = session.user.id;

  const sekarang = new Date();
  const nilai = await nilaiCheckIn(userId, parsed, akurasi, sekarang, false);
  if (!nilai.ok) return nilai.hasil;
  const { spg, radius, tanda, tutupOtomatisBertransaksi } = nilai;
  const clientId = parsed.clientId ?? null;

  await prisma.$transaction(async (tx) => {
    // Check-in yang sama sudah tercatat (ketukan ulang dengan id yang sama).
    if (clientId && (await tx.storeVisit.findUnique({ where: { clientId }, select: { id: true } }))) return;

    const active = await tx.storeVisit.findFirst({
      where: { userId, checkoutAt: null },
      select: { id: true, storeId: true },
    });

    const plan = planCheckIn(
      parsed.storeId,
      active ? { id: active.id, storeId: active.storeId } : null,
    );

    if (plan.kind === "no-op-same-store") return;

    if (plan.kind === "auto-close-and-open") {
      await tx.storeVisit.updateMany({
        where: { userId, checkoutAt: null },
        data: { checkoutAt: sekarang, autoClosed: true },
      });
      if (tutupOtomatisBertransaksi) {
        await tx.storeVisit.updateMany({
          where: { id: tutupOtomatisBertransaksi, outcome: null },
          data: { outcome: "TRANSAKSI" },
        });
      }
    }

    await tx.storeVisit.create({
      data: {
        storeId: parsed.storeId,
        userId,
        checkinLat: new Prisma.Decimal(parsed.lat),
        checkinLng: new Prisma.Decimal(parsed.lng),
        checkinDistanceMeters: radius.distanceMeters,
        checkinOutOfRadius: radius.outOfRadius,
        checkinAccuracyMeters: akurasi,
        // `[]` = sudah diperiksa dan bersih; kosong (null) = tidak diperiksa.
        ...(tanda ? { checkinFlags: tanda as Prisma.InputJsonValue } : {}),
        ...(clientId ? { clientId } : {}),
      },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  // SPG: check-in di toko tetapnya = absen masuk (bila absensi menyala). Sesudah
  // kunjungannya tercatat, dan tidak pernah menggagalkannya.
  if (spg) {
    await absenMasukLewatCheckin({ userId, lat: parsed.lat, lng: parsed.lng, akurasi, sekarang });
    revalidatePath("/pwa/absen");
  }

  revalidatePath("/pwa");
  revalidatePath(`/pwa/stores/${parsed.storeId}`);
  redirect(`/pwa/stores/${parsed.storeId}`);
}

export type SyaratCheckOut =
  | { ok: true; selesai: true; storeId: string }
  | {
      ok: true;
      selesai: false;
      storeId: string;
      /** Waktu check-in (ms) — batas bawah antrean klaim/retur di HP. */
      checkinAtMs: number;
      spg: boolean;
      /** Belum ada transaksi tercatat di server untuk kunjungan ini. */
      perluAlasan: boolean;
      alasanWajib: boolean;
      fotoWajib: boolean;
      /** Foto kunjungan yang sudah sampai di server. */
      fotoTerkirim: number;
    }
  | { ok: false; code: "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" };

/**
 * Dibaca HP SEBELUM check-out: apakah perlu menanyakan alasan dan apakah foto
 * wajib. Menanyakan alasan lebih dulu berarti GPS hanya diambil sekali.
 * `checkOut` tetap memeriksa ulang aturannya sendiri — ini hanya penunjuk jalan.
 */
export async function bacaSyaratCheckOut(visitId: string): Promise<SyaratCheckOut> {
  if (typeof visitId !== "string" || visitId === "") return { ok: false, code: "NOT_FOUND" };
  const session = await auth();
  if (!session?.user?.id) return { ok: false, code: "UNAUTHORIZED" };
  const userId = session.user.id;

  const visit = await prisma.storeVisit.findUnique({
    where: { id: visitId },
    select: { id: true, userId: true, storeId: true, checkinAt: true, checkoutAt: true },
  });
  if (!visit) return { ok: false, code: "NOT_FOUND" };
  if (visit.userId !== userId) return { ok: false, code: "FORBIDDEN" };
  if (visit.checkoutAt) return { ok: true, selesai: true, storeId: visit.storeId };

  const me = await prisma.user.findUnique({ where: { id: userId }, select: { assignedStoreId: true } });
  const dasar = { ok: true as const, selesai: false as const, storeId: visit.storeId, checkinAtMs: visit.checkinAt.getTime() };
  if (me?.assignedStoreId) {
    return { ...dasar, spg: true, perluAlasan: false, alasanWajib: false, fotoWajib: false, fotoTerkirim: 0 };
  }

  const [adaTransaksi, aturanMentah, fotoTerkirim] = await Promise.all([
    adaTransaksiKunjungan({ visitId: visit.id, userId, storeId: visit.storeId, sejak: visit.checkinAt }),
    bacaSetelan(KUNCI_HASIL_KUNJUNGAN),
    prisma.visitPhoto.count({ where: { visitId: visit.id } }),
  ]);
  const aturan = bacaAturanHasilKunjungan(aturanMentah);
  return {
    ...dasar,
    spg: false,
    perluAlasan: !adaTransaksi,
    alasanWajib: aturan.alasanWajib,
    fotoWajib: aturan.fotoWajib,
    fotoTerkirim,
  };
}

export type CheckOutHasil =
  | { alreadyClosed: boolean; storeId: string }
  | { ok: false; code: "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "HASIL_WAJIB" | "HASIL_TIDAK_SAH" | "CATATAN_WAJIB" };

/**
 * Check-out. Untuk salesman, hasil kunjungan diputuskan di sini: ada transaksi
 * → `TRANSAKSI` otomatis; tanpa transaksi → alasan wajib (bila pemilik
 * mewajibkan). SPG tidak disentuh — check-in mereka absensi.
 *
 * Aturan "wajib foto sebelum check-out" TIDAK dijaga di sini: foto yang diambil
 * tanpa sinyal masih di antrean HP dan belum terlihat server, jadi server tidak
 * bisa membedakan "belum memotret" dari "belum terkirim". Aturan itu dijaga di
 * HP (`CheckOutButton`) yang bisa melihat kedua-duanya.
 */
export async function checkOut(input: {
  visitId: string;
  lat: number;
  lng: number;
  outcome?: string | null;
  outcomeNote?: string | null;
  transaksiTertunda?: boolean;
}): Promise<CheckOutHasil> {
  const parsed = checkOutSchema.parse(input);
  const session = await auth();
  if (!session?.user?.id) return { ok: false, code: "UNAUTHORIZED" };
  const userId = session.user.id;

  const visit = await prisma.storeVisit.findUnique({
    where: { id: parsed.visitId },
    select: { id: true, userId: true, storeId: true, checkinAt: true, checkoutAt: true },
  });
  if (!visit) return { ok: false, code: "NOT_FOUND" };
  if (visit.userId !== userId) return { ok: false, code: "FORBIDDEN" };
  // Sudah ditutup (ketuk dua kali, atau ditutup otomatis): jangan tanya alasan lagi.
  if (visit.checkoutAt) return { alreadyClosed: true, storeId: visit.storeId };

  const me = await prisma.user.findUnique({ where: { id: userId }, select: { assignedStoreId: true } });
  const spg = Boolean(me?.assignedStoreId);

  let hasil: { outcome: string | null; outcomeNote: string | null } = { outcome: null, outcomeNote: null };
  if (!spg) {
    const [adaTransaksi, aturanMentah] = await Promise.all([
      adaTransaksiKunjungan({ visitId: visit.id, userId, storeId: visit.storeId, sejak: visit.checkinAt }),
      bacaSetelan(KUNCI_HASIL_KUNJUNGAN),
    ]);
    const putusan = putuskanHasilCheckout({
      spg,
      adaTransaksi,
      transaksiTertunda: parsed.transaksiTertunda ?? false,
      alasanWajib: bacaAturanHasilKunjungan(aturanMentah).alasanWajib,
      alasan: parsed.outcome,
      catatan: parsed.outcomeNote,
    });
    if (!putusan.ok) return { ok: false, code: putusan.code };
    hasil = { outcome: putusan.outcome, outcomeNote: putusan.outcomeNote };
  }

  const waktuCheckout = new Date();
  const result = await prisma.storeVisit.updateMany({
    where: { id: parsed.visitId, checkoutAt: null },
    data: {
      checkoutAt: waktuCheckout,
      checkoutLat: new Prisma.Decimal(parsed.lat),
      checkoutLng: new Prisma.Decimal(parsed.lng),
      ...(hasil.outcome !== null ? { outcome: hasil.outcome, outcomeNote: hasil.outcomeNote } : {}),
    },
  });

  if (result.count === 0) {
    return { alreadyClosed: true, storeId: visit.storeId };
  }

  // SPG: check-out = absen pulang. Tidak pernah menggagalkan check-out.
  if (spg) {
    await absenPulangLewatCheckout({ userId, lat: parsed.lat, lng: parsed.lng, sekarang: waktuCheckout });
    revalidatePath("/pwa/absen");
  }

  revalidatePath("/pwa");
  revalidatePath(`/pwa/stores/${visit.storeId}`);
  revalidatePath(`/backoffice/stores/${visit.storeId}`);
  return { alreadyClosed: false, storeId: visit.storeId };
}

// ─── Check-in / check-out dari antrean HP (dicatat tanpa sinyal) ─────────────

const checkInLuringSchema = z.object({
  /** Id buatan HP (`StoreVisit.clientId`) — kunci kiriman, sekali per check-in. */
  clientId: z.string().min(1).max(100),
  storeId: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().nullable().optional(),
  /** Saat check-in ditekan di HP (ISO). */
  waktu: z.string().datetime(),
});

export type CheckInLuringHasil =
  | { ok: true; visitId: string; storeId: string }
  | { ok: false; code: "VALIDATION" | "UNAUTHORIZED" | "NOT_FOUND" | "STORE_NOT_ASSIGNED" | "WAKTU_TIDAK_VALID" | "KUNCI_DIPAKAI" }
  | { ok: false; code: "DI_LUAR_RADIUS"; jarakMeter: number; radiusMeter: number; akurasiMeter: number | null };

/** Kunjungan yang sudah dicatat dengan id buatan HP ini — hasil yang sama untuk kiriman ulang. */
async function kunjunganDenganClientId(clientId: string, userId: string): Promise<CheckInLuringHasil | null> {
  const ada = await prisma.storeVisit.findUnique({ where: { clientId }, select: { id: true, userId: true, storeId: true } });
  if (!ada) return null;
  return ada.userId === userId ? { ok: true, visitId: ada.id, storeId: ada.storeId } : { ok: false, code: "KUNCI_DIPAKAI" };
}

/**
 * Check-in yang dicatat TANPA sinyal, dikirim antrean HP saat sinyal kembali.
 *
 * Idempoten per `clientId` (diperiksa PALING DULU): kiriman ulang mendapat
 * kunjungan yang sama. `checkinAt` = waktu di HP: lebih dari
 * `BATAS_UMUR_CHECKIN_LURING_HARI` hari lalu ditolak, jam yang maju dijepit ke
 * sekarang. Semua aturan check-in (toko tetap SPG, kunci toko sendiri, radius
 * PERINGATAN/TOLAK, tanda janggal) dinilai dengan koordinat dan waktu
 * tangkapan. Kunjungan dicatat `capturedOffline` + `syncedAt`.
 *
 * Urutan waktu dijaga, karena check-in ini bisa tiba SESUDAH kunjungan yang
 * lebih baru tercatat:
 * - ada kunjungan sesudah waktu ini → kunjungan ini dicatat sudah selesai,
 *   ditutup otomatis pada check-in berikutnya (check-out yang diantrekan
 *   sesudahnya meluruskan jamnya);
 * - kunjungan terbuka di toko yang SAMA yang belum punya id HP → itulah
 *   kunjungan ini (check-in dengan sinyal yang jawabannya tidak sampai) —
 *   ditautkan, tidak digandakan;
 * - kunjungan terbuka lain → ditutup otomatis pada waktu check-in ini.
 *
 * SPG: kunjungan yang menjadi kunjungan berjalan = absen masuk pada waktu HP.
 * Tidak pernah mengalihkan halaman — antrean berjalan di latar.
 */
export async function checkInLuringAction(input: unknown): Promise<CheckInLuringHasil> {
  const parsed = checkInLuringSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "VALIDATION" };
  const session = await auth();
  if (!session?.user?.id) return { ok: false, code: "UNAUTHORIZED" };
  const userId = session.user.id;
  const d = parsed.data;

  const ada = await kunjunganDenganClientId(d.clientId, userId);
  if (ada) return ada;

  const sekarang = new Date();
  const waktu = jepitWaktuLuring(d.waktu, sekarang, BATAS_CHECKIN_LURING_MS);
  if (!waktu) return { ok: false, code: "WAKTU_TIDAK_VALID" };
  const akurasi = normalkanAkurasi(d.accuracy);

  const nilai = await nilaiCheckIn(userId, d, akurasi, waktu, true);
  if (!nilai.ok) return nilai.hasil;
  const { spg, radius, tanda, tutupOtomatisBertransaksi } = nilai;

  let hasil: { visitId: string; berjalan: boolean };
  try {
    hasil = await runSerializable(async (tx) => {
      const sama = await tx.storeVisit.findUnique({ where: { clientId: d.clientId }, select: { id: true } });
      if (sama) return { visitId: sama.id, berjalan: false };

      const dasar = {
        storeId: d.storeId,
        userId,
        checkinAt: waktu,
        checkinLat: new Prisma.Decimal(d.lat),
        checkinLng: new Prisma.Decimal(d.lng),
        checkinDistanceMeters: radius.distanceMeters,
        checkinOutOfRadius: radius.outOfRadius,
        checkinAccuracyMeters: akurasi,
        ...(tanda ? { checkinFlags: tanda as Prisma.InputJsonValue } : {}),
        clientId: d.clientId,
        capturedOffline: true,
        syncedAt: sekarang,
      };

      const berikut = await tx.storeVisit.findFirst({
        where: { userId, checkinAt: { gt: waktu } },
        orderBy: { checkinAt: "asc" },
        select: { checkinAt: true },
      });
      if (berikut) {
        const v = await tx.storeVisit.create({
          data: { ...dasar, checkoutAt: berikut.checkinAt, autoClosed: true },
          select: { id: true },
        });
        return { visitId: v.id, berjalan: false };
      }

      const aktif = await tx.storeVisit.findFirst({
        where: { userId, checkoutAt: null },
        orderBy: { checkinAt: "desc" },
        select: { id: true, storeId: true, clientId: true },
      });
      if (aktif && aktif.storeId === d.storeId && aktif.clientId === null) {
        await tx.storeVisit.update({ where: { id: aktif.id }, data: { clientId: d.clientId } });
        return { visitId: aktif.id, berjalan: false };
      }
      if (aktif) {
        await tx.storeVisit.updateMany({
          where: { userId, checkoutAt: null },
          data: { checkoutAt: waktu, autoClosed: true },
        });
        if (tutupOtomatisBertransaksi) {
          await tx.storeVisit.updateMany({
            where: { id: tutupOtomatisBertransaksi, outcome: null },
            data: { outcome: "TRANSAKSI" },
          });
        }
      }
      const v = await tx.storeVisit.create({ data: dasar, select: { id: true } });
      return { visitId: v.id, berjalan: true };
    });
  } catch (err) {
    // Dua kiriman dengan id yang sama tiba bersamaan: yang kalah mendapat kunjungan pemenang.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const pemenang = await kunjunganDenganClientId(d.clientId, userId);
      if (pemenang) return pemenang;
    }
    throw err;
  }

  if (spg && hasil.berjalan) {
    await absenMasukLewatCheckin({ userId, lat: d.lat, lng: d.lng, akurasi, sekarang: waktu });
    revalidatePath("/pwa/absen");
  }
  revalidatePath("/pwa");
  revalidatePath(`/pwa/stores/${d.storeId}`);
  return { ok: true, visitId: hasil.visitId, storeId: d.storeId };
}

const checkOutLuringSchema = z.object({
  /** Kunjungan yang check-in-nya tercatat dengan sinyal. */
  visitId: z.string().min(1).max(100).nullable().optional(),
  /** Kunjungan yang check-in-nya juga dicatat tanpa sinyal (`StoreVisit.clientId`). */
  visitClientId: z.string().min(1).max(100).nullable().optional(),
  /** Saat check-out ditekan di HP (ISO). */
  waktu: z.string().datetime(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  outcome: z.string().max(40).nullable().optional(),
  outcomeNote: z.string().max(2000).nullable().optional(),
  transaksiTertunda: z.boolean().optional(),
});

export type CheckOutLuringHasil =
  | { ok: true; storeId: string; sudahTertutup: boolean }
  | {
      ok: false;
      code: "VALIDATION" | "UNAUTHORIZED" | "FORBIDDEN" | "KUNJUNGAN_TIDAK_SAH" | "HASIL_WAJIB" | "HASIL_TIDAK_SAH" | "CATATAN_WAJIB";
    };

/**
 * Check-out yang dicatat TANPA sinyal. Antrean HP mengirimnya PALING AKHIR —
 * sesudah check-in, pesanan/nota, dan pekerjaan stok — supaya hasil kunjungan
 * salesman ("ada transaksi?") dinilai sesudah transaksinya sampai.
 *
 * `checkoutAt` = waktu di HP, dijepit antara check-in dan sekarang.
 * Kunjungan yang sudah ditutup tidak disentuh — KECUALI ditutup otomatis oleh
 * check-in berikutnya pada waktu yang lebih lambat dari check-out ini (urutan
 * antrean: semua check-in terkirim lebih dulu): jam, koordinat, dan hasilnya
 * diluruskan ke check-out yang sebenarnya. Kiriman ulang aman: kunjungan yang
 * sudah ditutup check-out ini sendiri terbaca `sudahTertutup`.
 */
export async function checkOutLuringAction(input: unknown): Promise<CheckOutLuringHasil> {
  const parsed = checkOutLuringSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "VALIDATION" };
  const session = await auth();
  if (!session?.user?.id) return { ok: false, code: "UNAUTHORIZED" };
  const userId = session.user.id;
  const d = parsed.data;
  const clientId = d.visitClientId?.trim() || null;
  const id = d.visitId?.trim() || null;
  if (!clientId && !id) return { ok: false, code: "VALIDATION" };

  const visit = await prisma.storeVisit.findFirst({
    where: clientId ? { clientId } : { id: id as string },
    select: { id: true, userId: true, storeId: true, checkinAt: true, checkoutAt: true, autoClosed: true },
  });
  if (!visit) return { ok: false, code: "KUNJUNGAN_TIDAK_SAH" };
  if (visit.userId !== userId) return { ok: false, code: "FORBIDDEN" };

  const sekarang = new Date();
  const waktuKeluar = new Date(Math.min(Math.max(Date.parse(d.waktu), visit.checkinAt.getTime()), sekarang.getTime()));
  const luruskan = visit.checkoutAt !== null && visit.autoClosed && waktuKeluar.getTime() <= visit.checkoutAt.getTime();
  if (visit.checkoutAt && !luruskan) return { ok: true, storeId: visit.storeId, sudahTertutup: true };

  const me = await prisma.user.findUnique({ where: { id: userId }, select: { assignedStoreId: true } });
  const spg = Boolean(me?.assignedStoreId);

  let hasil: { outcome: string | null; outcomeNote: string | null } = { outcome: null, outcomeNote: null };
  if (!spg) {
    const [adaTransaksi, aturanMentah] = await Promise.all([
      adaTransaksiKunjungan({ visitId: visit.id, userId, storeId: visit.storeId, sejak: visit.checkinAt }),
      bacaSetelan(KUNCI_HASIL_KUNJUNGAN),
    ]);
    const putusan = putuskanHasilCheckout({
      spg,
      adaTransaksi,
      transaksiTertunda: d.transaksiTertunda ?? false,
      alasanWajib: bacaAturanHasilKunjungan(aturanMentah).alasanWajib,
      alasan: d.outcome,
      catatan: d.outcomeNote,
    });
    if (!putusan.ok) return { ok: false, code: putusan.code };
    hasil = { outcome: putusan.outcome, outcomeNote: putusan.outcomeNote };
  }

  // Bandingkan-lalu-tukar DI DALAM runSerializable: `updateMany where …`
  // Prisma 7 bukan CAS atomik di luar transaksi serializable.
  const berubah = await runSerializable(async (tx) => {
    const r = await tx.storeVisit.updateMany({
      where: luruskan ? { id: visit.id, autoClosed: true, checkoutAt: visit.checkoutAt } : { id: visit.id, checkoutAt: null },
      data: {
        checkoutAt: waktuKeluar,
        checkoutLat: new Prisma.Decimal(d.lat),
        checkoutLng: new Prisma.Decimal(d.lng),
        autoClosed: false,
        ...(hasil.outcome !== null ? { outcome: hasil.outcome, outcomeNote: hasil.outcomeNote } : {}),
      },
    });
    return r.count;
  });
  if (berubah === 0) return { ok: true, storeId: visit.storeId, sudahTertutup: true };

  // SPG: check-out = absen pulang pada waktu HP. Hanya untuk kunjungan yang
  // memang masih berjalan — kunjungan yang diluruskan sudah lewat harinya.
  if (spg && !luruskan) {
    await absenPulangLewatCheckout({ userId, lat: d.lat, lng: d.lng, sekarang: waktuKeluar });
    revalidatePath("/pwa/absen");
  }
  revalidatePath("/pwa");
  revalidatePath(`/pwa/stores/${visit.storeId}`);
  revalidatePath(`/backoffice/stores/${visit.storeId}`);
  return { ok: true, storeId: visit.storeId, sudahTertutup: false };
}

export type AturanKunjunganSaya = { ok: true; spg: boolean; alasanWajib: boolean; fotoWajib: boolean } | { ok: false };

/**
 * Aturan check-out untuk pengguna ini — disimpan HP supaya check-out TANPA
 * sinyal tetap tahu apakah harus menanyakan alasan (salesman) atau tidak (SPG).
 * Hanya penunjuk jalan: server menilai ulang saat check-out terkirim.
 */
export async function aturanKunjunganSaya(): Promise<AturanKunjunganSaya> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false };
  const [me, aturanMentah] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.user.id }, select: { assignedStoreId: true } }),
    bacaSetelan(KUNCI_HASIL_KUNJUNGAN),
  ]);
  const aturan = bacaAturanHasilKunjungan(aturanMentah);
  return { ok: true, spg: Boolean(me?.assignedStoreId), alasanWajib: aturan.alasanWajib, fotoWajib: aturan.fotoWajib };
}

const storeChangeSchema = z.object({
  storeId: z.string().min(1),
  visitId: z.string().min(1),
  name: z.string().min(1).max(191),
  address: z.string().min(1),
  phone: z.string().max(64).nullable(),
  contactName: z.string().max(191).nullable(),
  lat: z.number().min(-90).max(90).nullable(),
  lng: z.number().min(-180).max(180).nullable(),
});

export type StoreChangeSubmitActionResult =
  | { ok: true }
  | { ok: false; code: "UNAUTHORIZED" | "NO_ACTIVE_VISIT" | "ALREADY_PENDING" | "NO_CHANGES" | "VALIDATION" };

export async function submitStoreChangeRequestAction(input: {
  storeId: string; visitId: string;
  name: string; address: string; phone: string | null; contactName: string | null; lat: number | null; lng: number | null;
}): Promise<StoreChangeSubmitActionResult> {
  const parsed = storeChangeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "VALIDATION" };
  const session = await auth();
  if (!session?.user?.id) return { ok: false, code: "UNAUTHORIZED" };

  const { storeId, visitId, ...proposed } = parsed.data;
  const res = await submitStoreChangeRequest({ storeId, visitId, userId: session.user.id, proposed });
  if (!res.ok) return { ok: false, code: res.code };

  revalidatePath(`/pwa/stores/${storeId}`);
  return { ok: true };
}
