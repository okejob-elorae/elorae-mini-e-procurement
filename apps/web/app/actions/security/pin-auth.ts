"use server";

import { prisma } from "@elorae/db";
import bcrypt from "bcryptjs";
import { auth } from "@/lib/auth";
import { runSerializable } from "@/lib/db/tx-retry";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { tolakAkunSistem } from "@/lib/users/validasi";
import { SENSITIVE_ACTIONS } from "@/app/actions/security/pin-constants";

/**
 * PIN untuk aksi sensitif.
 *
 * Setiap ekspor di berkas ini adalah server action yang bisa dipanggil siapa
 * pun yang sudah masuk, dengan argumen apa pun. Karena itu pengguna yang
 * bertindak SELALU diambil dari sesi (`auth()`), tidak pernah dari id yang
 * dikirim pemanggil — dulu siapa pun yang tahu id admin bisa mengosongkan PIN
 * orang lain, membaca daftar pengguna, dan memverifikasi PIN atas nama orang lain.
 */

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 menit
const MAX_FAILED_ATTEMPTS = 3;

export type PinAuthResult = { success: boolean; message?: string; messageKey?: string; userId?: string };

type PenggunaSesi = { id: string; email: string | null; permissions: string[] };

async function penggunaSesi(): Promise<PenggunaSesi | null> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  return { id, email: session.user.email ?? null, permissions: session.user.permissions ?? [] };
}

/**
 * Satu tebakan PIN yang dihitung terhadap batas gagal.
 *
 * Barisnya dicatat DULU sebagai gagal, baru jumlah gagal dihitung, baru PIN
 * dicocokkan. Dengan urutan "hitung lalu catat" permintaan serentak semuanya
 * melihat nol gagal dan semuanya ikut menebak (terukur: 7 dari 8 lolos).
 * Dengan urutan ini, permintaan yang hitungannya dimulai paling akhir di antara
 * yang lolos melihat baris semua yang lolos — jadi paling banyak tiga yang
 * sampai ke bcrypt, tanpa perlu transaksi.
 *
 * Tebakan yang ditolak karena terkunci dihapus lagi, supaya tidak
 * memperpanjang kuncian (sama seperti dulu: yang terkunci tidak dicatat).
 */
async function cobaPin(
  userId: string,
  pinHash: string,
  pin: string,
  action: string,
  ipAddress?: string,
): Promise<"COCOK" | "SALAH" | "TERKUNCI"> {
  const percobaan = await prisma.pinAttempt.create({
    data: { userId, action, success: false, ipAddress: ipAddress ?? null },
    select: { id: true },
  });
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
  const gagal = await prisma.pinAttempt.count({
    where: { userId, success: false, createdAt: { gte: since } },
  });
  if (gagal > MAX_FAILED_ATTEMPTS) {
    await prisma.pinAttempt.delete({ where: { id: percobaan.id } });
    return "TERKUNCI";
  }
  const cocok = await bcrypt.compare(pin, pinHash);
  if (cocok) {
    await prisma.pinAttempt.update({ where: { id: percobaan.id }, data: { success: true } });
    return "COCOK";
  }
  return "SALAH";
}

function rapikanEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Aksi yang boleh dicatat: daftar tetap, bukan string bebas kiriman klien. */
function aksiSah(action: unknown): action is string {
  return typeof action === "string" && (SENSITIVE_ACTIONS as readonly string[]).includes(action);
}

/**
 * Verifikasi PIN pengguna yang sedang masuk.
 *
 * `_userId` dipertahankan supaya pemanggil lama tidak perlu diubah, tetapi
 * TIDAK dipakai: PIN yang diperiksa selalu milik pengguna sesi.
 * `fallbackEmail` hanya berlaku untuk email sesi itu sendiri (JWT basi yang
 * id-nya sudah tidak ada di basis data) — email lain diabaikan.
 * PIN yang bukan string dan aksi di luar `SENSITIVE_ACTIONS` ditolak sebelum
 * apa pun dicatat (keduanya hanya datang dari klien yang diutak-atik).
 */
export async function verifyPinForAction(
  _userId: string,
  pin: string,
  action: string,
  reason?: string,
  ipAddress?: string,
  fallbackEmail?: string | null,
): Promise<PinAuthResult> {
  const sesi = await penggunaSesi();
  if (!sesi) return { success: false, messageKey: "userNotFound" };
  if (typeof pin !== "string" || !aksiSah(action)) return { success: false, messageKey: "pinInvalid" };

  let user = await prisma.user.findUnique({
    where: { id: sesi.id },
    select: { id: true, pinHash: true },
  });
  if (!user && fallbackEmail?.trim() && sesi.email && rapikanEmail(fallbackEmail) === rapikanEmail(sesi.email)) {
    user = await prisma.user.findUnique({
      where: { email: sesi.email },
      select: { id: true, pinHash: true },
    });
  }
  if (!user) {
    return { success: false, messageKey: "userNotFound" };
  }
  if (!user.pinHash) {
    return { success: false, messageKey: "pinNotSet" };
  }

  const hasil = await cobaPin(user.id, user.pinHash, pin, action, ipAddress);
  if (hasil === "TERKUNCI") return { success: false, messageKey: "tooManyAttempts" };
  if (hasil === "SALAH") return { success: false, messageKey: "pinIncorrect" };
  return { success: true, messageKey: "ok", userId: user.id };
}

const PIN_REGEX = /^\d{4,6}$/;

/**
 * Buat atau ganti PIN pengguna yang sedang masuk — hanya untuk diri sendiri.
 * Bila PIN sudah ada, PIN lama wajib dan tebakannya ikut batas tiga salah
 * (tanpa itu formulir ini adalah jalan menebak PIN tanpa batas).
 */
export async function setupPin(newPin: string, currentPin?: string): Promise<PinAuthResult> {
  const sesi = await penggunaSesi();
  if (!sesi) return { success: false, messageKey: "userNotFound" };
  if (typeof newPin !== "string" || !PIN_REGEX.test(newPin)) {
    return { success: false, messageKey: "pinFormatError" };
  }

  const user = await prisma.user.findUnique({
    where: { id: sesi.id },
    select: { id: true, pinHash: true },
  });
  if (!user) {
    return { success: false, messageKey: "userNotFound" };
  }

  if (user.pinHash) {
    if (typeof currentPin !== "string" || !currentPin) {
      return { success: false, messageKey: "enterCurrentPin" };
    }
    const hasil = await cobaPin(user.id, user.pinHash, currentPin, "SETUP_PIN");
    if (hasil === "TERKUNCI") return { success: false, messageKey: "tooManyAttempts" };
    if (hasil === "SALAH") return { success: false, messageKey: "currentPinIncorrect" };
  }

  const pinHash = await bcrypt.hash(newPin, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: { pinHash },
  });
  return { success: true, messageKey: "pinSaved" };
}

/** Riwayat percobaan PIN milik pengguna yang sedang masuk. */
export async function getPinAttempts(
  limit = 20,
): Promise<{ id: string; action: string; success: boolean; ipAddress: string | null; createdAt: Date }[]> {
  const sesi = await penggunaSesi();
  if (!sesi) return [];
  const take = Math.min(Math.max(Math.trunc(Number(limit)) || 20, 1), 100);
  return prisma.pinAttempt.findMany({
    where: { userId: sesi.id },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, action: true, success: true, ipAddress: true, createdAt: true },
  });
}

/** Verifikasi PIN berhasil terakhir per aksi, milik pengguna yang sedang masuk. */
export async function getLastSensitiveAccess(): Promise<{ action: string; at: Date }[]> {
  const sesi = await penggunaSesi();
  if (!sesi) return [];
  const attempts = await prisma.pinAttempt.findMany({
    where: { userId: sesi.id, success: true, action: { in: [...SENSITIVE_ACTIONS] } },
    orderBy: { createdAt: "desc" },
    select: { action: true, createdAt: true },
  });
  const seen = new Set<string>();
  return attempts
    .filter((a) => {
      if (seen.has(a.action)) return false;
      seen.add(a.action);
      return true;
    })
    .map((a) => ({ action: a.action, at: a.createdAt }));
}

/** Admin: daftar pengguna untuk pilihan reset PIN. Butuh `settings_security:manage`. */
export async function getUsersForAdmin(): Promise<{ id: string; name: string | null; email: string }[]> {
  const sesi = await penggunaSesi();
  if (!sesi || !hasPermission(sesi.permissions, PERMISSIONS.SETTINGS_SECURITY_MANAGE)) return [];
  return prisma.user.findMany({
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });
}

/**
 * Admin: kosongkan PIN pengguna lain agar ia membuat yang baru.
 *
 * Butuh `settings_security:manage`. Tidak untuk PIN sendiri — jalur ini
 * melompati syarat PIN lama di `setupPin`, jadi sesi admin yang dicuri bisa
 * mengganti PIN pemiliknya. Akun berperan sistem hanya boleh direset admin
 * sistem (peran pelaku dibaca dari basis data, sama dengan Pengaturan →
 * Pengguna). Setiap reset menulis jejak audit dalam transaksi yang sama.
 */
export async function adminForcePinReset(targetUserId: string): Promise<PinAuthResult> {
  const sesi = await penggunaSesi();
  if (!sesi || !hasPermission(sesi.permissions, PERMISSIONS.SETTINGS_SECURITY_MANAGE)) {
    return { success: false, messageKey: "adminOnlyReset" };
  }
  if (typeof targetUserId !== "string" || !targetUserId) {
    return { success: false, messageKey: "userNotFound" };
  }
  if (targetUserId === sesi.id) {
    return { success: false, messageKey: "ownPinReset" };
  }

  // Peran pelaku dan target dibaca DI DALAM transaksi serializable: akun yang
  // sedang diangkat menjadi admin sistem oleh orang lain tidak boleh direset
  // berdasarkan pemeriksaan yang dibaca sebelum pengangkatan itu di-commit.
  const tolakan = await runSerializable(async (tx): Promise<string | null> => {
    const pelaku = await tx.user.findUnique({
      where: { id: sesi.id },
      select: { roleDefinition: { select: { isSystem: true } } },
    });
    const target = await tx.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, roleDefinition: { select: { isSystem: true } } },
    });
    if (!target) return "userNotFound";
    const tolak = tolakAkunSistem({
      pelakuSistem: pelaku?.roleDefinition?.isSystem === true,
      targetSistem: target.roleDefinition?.isSystem === true,
      peranSistem: false,
    });
    if (tolak) return "systemAccountPinReset";
    await tx.user.update({
      where: { id: target.id },
      data: { pinHash: null },
    });
    await tx.auditLog.create({
      data: {
        userId: sesi.id,
        action: "USER_PIN_RESET",
        entityType: "User",
        entityId: target.id,
      },
    });
    return null;
  });
  if (tolakan) return { success: false, messageKey: tolakan };
  return { success: true, messageKey: "userPinReset" };
}
