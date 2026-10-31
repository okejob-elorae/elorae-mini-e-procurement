"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import {
  bacaAturanPeringkat,
  bacaSkemaKomisi,
  KUNCI_PERINGKAT,
  KUNCI_SKEMA_KOMISI,
  tulisSkemaKomisi,
  validasiSkemaKomisi,
  type AturanPeringkat,
} from "@/lib/salesman/komisi";

/**
 * Skema komisi salesman dan pengaturan papan peringkat.
 *
 * Dijaga `field_sales_orders:approve`, sama dengan pengaturan salesman
 * lainnya — orang yang menetapkan target adalah orang yang menetapkan komisi
 * atas target itu. Izinnya sudah ada di prod, tidak ada yang perlu di-seed.
 *
 * Setiap simpanan meninggalkan satu baris `AuditLog` (sebelum/sesudah) DI
 * DALAM transaksi yang sama: baris `SystemSetting` hanya menyimpan skema
 * terakhir, jadi jejak itulah satu-satunya tempat tarif lama masih bisa dibaca
 * saat ada yang bertanya kenapa komisi bulan lalu sekian.
 */

export type HasilSimpanKomisi = { ok: true } | { ok: false; code: "UNAUTHORIZED" | "FORBIDDEN" | "INVALID" };

export async function simpanSkemaKomisi(isi: { skema: unknown; peringkat: unknown }): Promise<HasilSimpanKomisi> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, code: "UNAUTHORIZED" };
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.FIELD_SALES_ORDERS_APPROVE)) {
    return { ok: false, code: "FORBIDDEN" };
  }

  const skema = validasiSkemaKomisi(isi?.skema);
  if (!skema) return { ok: false, code: "INVALID" };
  const p = isi?.peringkat as Partial<AturanPeringkat> | null | undefined;
  if (!p || typeof p !== "object" || typeof p.tampilkanNama !== "boolean") return { ok: false, code: "INVALID" };
  const peringkat: AturanPeringkat = { tampilkanNama: p.tampilkanNama };

  // Tarif khusus hanya untuk pengguna yang ada — id asal akan diam di skema
  // selamanya tanpa pernah terlihat di layar.
  const idKhusus = Object.keys(skema.perSalesman);
  if (idKhusus.length) {
    const ada = await prisma.user.count({ where: { id: { in: idKhusus } } });
    if (ada !== idKhusus.length) return { ok: false, code: "INVALID" };
  }

  const nilaiSkema = tulisSkemaKomisi(skema);
  const nilaiPeringkat = JSON.stringify(peringkat);
  // Yang disimpan harus terbaca kembali persis sama oleh pembaca yang dipakai
  // HP dan laporan — kalau tidak, layar ini menampilkan skema yang bukan skema berlaku.
  if (JSON.stringify(bacaSkemaKomisi(nilaiSkema)) !== JSON.stringify(skema)) return { ok: false, code: "INVALID" };
  if (JSON.stringify(bacaAturanPeringkat(nilaiPeringkat)) !== nilaiPeringkat) return { ok: false, code: "INVALID" };

  await prisma.$transaction(async (tx) => {
    const lama = await tx.systemSetting.findMany({
      where: { key: { in: [KUNCI_SKEMA_KOMISI, KUNCI_PERINGKAT] } },
      select: { key: true, value: true },
    });
    const nilaiLama = (k: string) => lama.find((b) => b.key === k)?.value ?? null;

    await tx.systemSetting.upsert({
      where: { key: KUNCI_SKEMA_KOMISI },
      create: { key: KUNCI_SKEMA_KOMISI, value: nilaiSkema },
      update: { value: nilaiSkema },
    });
    await tx.systemSetting.upsert({
      where: { key: KUNCI_PERINGKAT },
      create: { key: KUNCI_PERINGKAT, value: nilaiPeringkat },
      update: { value: nilaiPeringkat },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "SALESMAN_COMMISSION_UPDATED",
        entityType: "SystemSetting",
        entityId: KUNCI_SKEMA_KOMISI,
        changes: {
          before: {
            skema: bacaSkemaKomisi(nilaiLama(KUNCI_SKEMA_KOMISI)),
            peringkat: bacaAturanPeringkat(nilaiLama(KUNCI_PERINGKAT)),
          },
          after: { skema, peringkat },
        },
      },
    });
  });

  revalidatePath("/backoffice/settings/salesman");
  revalidatePath("/backoffice/laporan/komisi-salesman");
  revalidatePath("/pwa");
  revalidatePath("/pwa/insentif");
  revalidatePath("/pwa/peringkat");
  return { ok: true };
}
