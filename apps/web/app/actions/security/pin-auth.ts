"use server";

import { prisma } from "@elorae/db";
import bcrypt from "bcryptjs";
import { auth } from "@/lib/auth";
import { runSerializable } from "@/lib/db/tx-retry";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { verifyPin, type PinAuthResult } from "@/lib/security/pin";
import { CHANGE_PASSWORD_ACTION } from "@/lib/security/attempt-throttle";
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
 *
 * Pencocokan PIN dan batas tiga salahnya ada di `verifyPin` (`lib/security/pin.ts`,
 * bukan server action): satu jendela percobaan untuk setiap gerbang PIN.
 */

export type { PinAuthResult };

type PenggunaSesi = { id: string; email: string | null; permissions: string[] };

async function penggunaSesi(): Promise<PenggunaSesi | null> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  return { id, email: session.user.email ?? null, permissions: session.user.permissions ?? [] };
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
  _reason?: string,
  ipAddress?: string,
  fallbackEmail?: string | null,
): Promise<PinAuthResult> {
  void _userId;
  void _reason;
  const sesi = await penggunaSesi();
  if (!sesi) return { success: false, messageKey: "userNotFound" };
  if (typeof pin !== "string" || !aksiSah(action)) return { success: false, messageKey: "pinInvalid" };

  let userId = sesi.id;
  if (fallbackEmail?.trim() && sesi.email && rapikanEmail(fallbackEmail) === rapikanEmail(sesi.email)) {
    const ada = await prisma.user.findUnique({ where: { id: sesi.id }, select: { id: true } });
    if (!ada) {
      const lewatEmail = await prisma.user.findUnique({ where: { email: sesi.email }, select: { id: true } });
      if (lewatEmail) userId = lewatEmail.id;
    }
  }
  return ipAddress ? verifyPin(userId, pin, action, { ipAddress }) : verifyPin(userId, pin, action);
}

const PIN_REGEX = /^\d{4,6}$/;

/**
 * Buat atau ganti PIN pengguna yang sedang masuk — hanya untuk diri sendiri.
 * Bila PIN sudah ada, PIN lama wajib dan tebakannya ikut batas tiga salah
 * (tanpa itu formulir ini adalah jalan menebak PIN tanpa batas).
 */
export async function setupPin(newPin: string, currentPin?: string): Promise<PinAuthResult> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, messageKey: "unauthorized" };
  const userId = session.user.id;

  if (typeof newPin !== "string" || !PIN_REGEX.test(newPin)) {
    return { success: false, messageKey: "pinFormatError" };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { pinHash: true },
  });
  if (!user) {
    return { success: false, messageKey: "userNotFound" };
  }

  if (user.pinHash) {
    if (typeof currentPin !== "string" || !currentPin) {
      return { success: false, messageKey: "enterCurrentPin" };
    }
    /* Through verifyPin, so a wrong current PIN spends the same attempt window as every other PIN gate. */
    const check = await verifyPin(userId, currentPin, "CHANGE_PIN");
    if (!check.success) {
      if (check.messageKey === "pinIncorrect") {
        return { success: false, messageKey: "currentPinIncorrect" };
      }
      return check;
    }
  }

  const pinHash = await bcrypt.hash(newPin, 10);
  await prisma.user.update({
    where: { id: userId },
    data: { pinHash },
  });
  return { success: true, messageKey: "pinSaved" };
}

/** Riwayat percobaan PIN milik pengguna yang sedang masuk. */
export async function getPinAttempts(
  limit = 20,
): Promise<{ id: string; action: string; success: boolean; ipAddress: string | null; createdAt: Date }[]> {
  const session = await auth();
  if (!session?.user?.id) return [];
  const userId = session.user.id;
  const take = Math.min(Math.max(Math.trunc(Number(limit)) || 20, 1), 100);
  return prisma.pinAttempt.findMany({
    /* The table also holds the password throttle's attempts; this is the PIN history. */
    where: { userId, action: { not: CHANGE_PASSWORD_ACTION } },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, action: true, success: true, ipAddress: true, createdAt: true },
  });
}

/** Verifikasi PIN berhasil terakhir per aksi, milik pengguna yang sedang masuk. */
export async function getLastSensitiveAccess(): Promise<{ action: string; at: Date }[]> {
  const session = await auth();
  if (!session?.user?.id) return [];
  const userId = session.user.id;
  const attempts = await prisma.pinAttempt.findMany({
    where: { userId, success: true, action: { in: [...SENSITIVE_ACTIONS] } },
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
