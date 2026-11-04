"use server";

import { prisma } from "@elorae/db";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { bacaSumberOperasional, type SumberOperasional } from "@/lib/finance/operasional/aturan";
import { lengkapiNilaiMasukRusak } from "@/lib/finance/operasional/nilai-rusak-queries";
import { dokumenOperasionalTanpaJurnal } from "@/lib/finance/operasional/sapuan";
import { postingJurnalOperasionalAman, type KodeGagalPostingOperasional } from "@/lib/finance/operasional/tertunda";

/*
 * Aksi jurnal operasional (Keuangan → Rekonsiliasi persediaan). Memposting
 * jurnal = pekerjaan keuangan: `journals:manage`. Tidak pernah melempar —
 * hasil berkode.
 */

type Gagal = { ok: false; kode: "TANPA_AKSES" | "PERMINTAAN_RUSAK" | "GAGAL" };

async function pelaku(): Promise<string | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return hasPermission(session.user.permissions ?? [], PERMISSIONS.JOURNALS_MANAGE) ? session.user.id : null;
}

function segarkan() {
  revalidatePath("/backoffice/finance/rekonsiliasi-persediaan");
  revalidatePath("/backoffice/finance/journals");
}

export type HasilPostingUlangOperasional =
  | { ok: true; created: boolean }
  | { ok: false; kode: KodeGagalPostingOperasional; peran?: string; detail?: string }
  | Gagal;

/** Posting (atau selaraskan) jurnal satu dokumen operasional. */
export async function postingUlangJurnalOperasionalAction(sumber: string, id: string): Promise<HasilPostingUlangOperasional> {
  const userId = await pelaku();
  if (!userId) return { ok: false, kode: "TANPA_AKSES" };
  const s = bacaSumberOperasional(sumber);
  if (!s || typeof id !== "string" || id === "") return { ok: false, kode: "PERMINTAAN_RUSAK" };
  try {
    const r = await postingJurnalOperasionalAman(s, id, userId);
    segarkan();
    if (r.ok) return { ok: true, created: r.created };
    return { ok: false, kode: r.code, ...(r.role ? { peran: r.role } : {}), ...(r.detail ? { detail: r.detail } : {}) };
  } catch (e) {
    console.error("[finance-operasional] posting ulang gagal", sumber, id, e);
    return { ok: false, kode: "GAGAL" };
  }
}

export type HasilMassalOperasional =
  | { ok: true; diperiksa: number; berubah: number; gagal: { sumber: SumberOperasional; id: string; kode: KodeGagalPostingOperasional }[] }
  | Gagal;

const BUKAN_GAGAL = new Set<KodeGagalPostingOperasional>(["NOTHING_TO_POST", "BELUM_BERLAKU", "GL_CUTOVER_NOT_CONFIGURED"]);

/** Posting setiap dokumen operasional yang belum berjurnal sejak tanggal mulai (100 per jenis per klik). */
export async function postingSemuaJurnalOperasionalAction(): Promise<HasilMassalOperasional> {
  const userId = await pelaku();
  if (!userId) return { ok: false, kode: "TANPA_AKSES" };
  try {
    const daftar = await dokumenOperasionalTanpaJurnal(100);
    const hasil = { diperiksa: 0, berubah: 0, gagal: [] as { sumber: SumberOperasional; id: string; kode: KodeGagalPostingOperasional }[] };
    for (const d of daftar) {
      hasil.diperiksa += 1;
      const r = await postingJurnalOperasionalAman(d.sumber, d.id, userId);
      if (r.ok) {
        if (r.created) hasil.berubah += 1;
      } else if (!BUKAN_GAGAL.has(r.code)) {
        hasil.gagal.push({ sumber: d.sumber, id: d.id, kode: r.code });
      }
    }
    segarkan();
    return { ok: true, ...hasil };
  } catch (e) {
    console.error("[finance-operasional] posting semua gagal", e);
    return { ok: false, kode: "GAGAL" };
  }
}

export type HasilLengkapiNilaiRusak = { ok: true; diisi: number } | Gagal;

/**
 * Isi nilai gerakan masuk gudang barang rusak lama yang masih kosong (qty ×
 * harga rata-rata barang itu sekarang) — supaya nilai gudang rusak tidak lagi
 * bergantung pada harga hari ini. Tidak pernah menimpa nilai yang sudah ada.
 */
export async function lengkapiNilaiGudangRusakAction(): Promise<HasilLengkapiNilaiRusak> {
  const userId = await pelaku();
  if (!userId) return { ok: false, kode: "TANPA_AKSES" };
  try {
    // Pengisian dan jejaknya di satu transaksi: nilai yang diisi selalu punya nama dan waktunya.
    const diisi = await prisma.$transaction(
      async (tx) => {
        const n = await lengkapiNilaiMasukRusak(tx);
        if (n > 0) {
          await tx.auditLog.create({
            data: {
              userId,
              action: "DAMAGED_STOCK_VALUES_FILLED",
              entityType: "DamagedStockMovement",
              entityId: "MASUK_RETUR",
              changes: { after: { diisi: n } },
            },
          });
        }
        return n;
      },
      { timeout: 60_000 },
    );
    segarkan();
    return { ok: true, diisi };
  } catch (e) {
    console.error("[finance-operasional] lengkapi nilai gudang rusak gagal", e);
    return { ok: false, kode: "GAGAL" };
  }
}
