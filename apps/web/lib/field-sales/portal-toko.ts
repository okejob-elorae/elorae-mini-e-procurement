import { createHash, randomBytes } from "node:crypto";
import { prisma, type Prisma } from "@elorae/db";
import {
  bacaAturanPortalToko,
  bentukTokenSah,
  BATAS_MASA_BERLAKU,
  KUNCI_PORTAL_TOKO,
  keadaanTautan,
  MAKS_TAUTAN_AKTIF,
  masaBerlakuDari,
  periksaTautan,
  type AturanPortalToko,
  type KeadaanTautan,
  type PenolakanTautan,
} from "./portal-toko-aturan";

/**
 * Portal pesan mandiri toko — token tautan, pembuka tautan, dan pengelolaan
 * tautan (buat / cabut / daftar). Hanya untuk server.
 *
 * Token: 32 bita acak (base64url). Yang DISIMPAN hanya sha256 heksnya di
 * `StorePortalLink.tokenHash`; token mentah hanya hidup di tautan yang dibagikan
 * dan dikembalikan SEKALI ke orang yang membuatnya. Basis data yang bocor tidak
 * membocorkan tautan yang bisa dipakai. Mencari lewat hash yang unik tidak
 * butuh pembanding waktu-konstan: waktu pencarian tidak membuka apa pun tentang
 * token yang dicari.
 *
 * Token TIDAK PERNAH ditulis ke log, ke `AuditLog`, atau ke pesan galat.
 */

export function hashTokenPortal(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function buatTokenPortal(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashTokenPortal(token) };
}

type KlienAturan = { systemSetting: Pick<typeof prisma.systemSetting, "findUnique"> };

export async function muatAturanPortalToko(client: KlienAturan = prisma): Promise<AturanPortalToko> {
  const s = await client.systemSetting.findUnique({ where: { key: KUNCI_PORTAL_TOKO }, select: { value: true } });
  return bacaAturanPortalToko(s?.value ?? null);
}

// ── Membuka tautan ───────────────────────────────────────────────────────

export type TokoPortal = {
  id: string;
  name: string;
  termsType: "PUTUS" | "KONSI";
  /** Pemegang toko — pesanan portal dicatat atas namanya. Selalu terisi bila tautan sah. */
  salesmanId: string;
  /** Nama pemegang untuk kepala halaman ("Salesman Anda"). Bukan surel, bukan nomor. */
  namaSalesman: string | null;
};

export type AksesPortal = { linkId: string; toko: TokoPortal; aturan: AturanPortalToko };

export type HasilBukaTautan = { ok: true; akses: AksesPortal } | { ok: false; code: PenolakanTautan };

/**
 * Token → tautan → toko, dengan seluruh pemeriksaan. Dipanggil di SETIAP
 * permintaan publik (halaman maupun aksi) — tidak ada sesi yang mengingat
 * bahwa tautan ini pernah sah, jadi pencabutan berlaku seketika.
 */
export async function bukaTautanPortal(
  token: unknown,
  opsi: { sekarang?: Date; aturan?: AturanPortalToko } = {},
): Promise<HasilBukaTautan> {
  const sekarang = opsi.sekarang ?? new Date();
  // `aturan` hanya diisi tes — supaya tidak bergantung pada pengaturan bersama di basis data.
  const aturan = opsi.aturan ?? (await muatAturanPortalToko());
  // Portal dimatikan: tolak sebelum token dicari sama sekali.
  if (!aturan.aktif) return { ok: false, code: "PORTAL_NONAKTIF" };
  if (!bentukTokenSah(token)) return { ok: false, code: "TIDAK_DIKENAL" };

  const tautan = await prisma.storePortalLink.findUnique({
    where: { tokenHash: hashTokenPortal(token) },
    select: { id: true, storeId: true, revokedAt: true, expiresAt: true },
  });
  const toko = tautan
    ? await prisma.store.findUnique({
        where: { id: tautan.storeId },
        select: { id: true, name: true, termsType: true, isActive: true, salesmanId: true, salesman: { select: { name: true } } },
      })
    : null;
  const tolak = periksaTautan({ aturan, tautan, toko, sekarang });
  if (tolak) return { ok: false, code: tolak };
  return {
    ok: true,
    akses: {
      linkId: tautan!.id,
      aturan,
      toko: {
        id: toko!.id,
        name: toko!.name,
        termsType: toko!.termsType,
        salesmanId: toko!.salesmanId!,
        namaSalesman: toko!.salesman?.name ?? null,
      },
    },
  };
}

/** Jeda minimum antar-cap `lastUsedAt`: membuka halaman berkali-kali tidak menulis berkali-kali. */
const JEDA_CAP_MS = 5 * 60_000;

/** Cap "terakhir dipakai". Gagal di sini tidak pernah menggagalkan permintaan toko. */
export async function capTautanDipakai(linkId: string, opsi: { paksa?: boolean; sekarang?: Date } = {}): Promise<void> {
  const sekarang = opsi.sekarang ?? new Date();
  try {
    await prisma.storePortalLink.updateMany({
      where: opsi.paksa
        ? { id: linkId }
        : { id: linkId, OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: new Date(sekarang.getTime() - JEDA_CAP_MS) } }] },
      data: { lastUsedAt: sekarang },
    });
  } catch (err) {
    console.error("[portal-toko] cap lastUsedAt gagal", linkId, err);
  }
}

// ── Pengelolaan tautan (kantor / pemegang toko) ──────────────────────────

export const AKSI_TAUTAN_DIBUAT = "STORE_PORTAL_LINK_CREATED";
export const AKSI_TAUTAN_DICABUT = "STORE_PORTAL_LINK_REVOKED";
export const ENTITAS_TAUTAN = "StorePortalLink";

export type GagalBuatTautan = "PORTAL_NONAKTIF" | "TOKO_TIDAK_ADA" | "TOKO_NONAKTIF" | "TANPA_PEMEGANG" | "TERLALU_BANYAK" | "TIDAK_SAH";

export type HasilBuatTautan =
  | { ok: true; token: string; linkId: string; expiresAt: Date }
  | { ok: false; code: GagalBuatTautan };

/** Label dirapikan: kosong → null, dipotong 60 karakter. */
export function rapikanLabel(label: unknown): string | null {
  if (typeof label !== "string") return null;
  const l = label.trim().replace(/\s+/g, " ");
  return l ? l.slice(0, 60) : null;
}

/**
 * Tautan baru untuk satu toko. Token mentah dikembalikan SEKALI ke pembuatnya
 * dan tidak disimpan di mana pun. Baris `AuditLog` ditulis di transaksi yang
 * sama dengan tautannya — tanpa token, tanpa hash.
 */
export async function buatTautanPortal(input: {
  storeId: string;
  createdById: string;
  label?: string | null;
  /** Masa berlaku dalam hari; kosong = bawaan pemilik. */
  hari?: number | null;
  sekarang?: Date;
  /** Hanya untuk tes — lihat `bukaTautanPortal`. */
  aturan?: AturanPortalToko;
}): Promise<HasilBuatTautan> {
  const sekarang = input.sekarang ?? new Date();
  const aturan = input.aturan ?? (await muatAturanPortalToko());
  if (!aturan.aktif) return { ok: false, code: "PORTAL_NONAKTIF" };
  const hari = input.hari ?? aturan.masaBerlakuHari;
  if (!Number.isInteger(hari) || hari < BATAS_MASA_BERLAKU.min || hari > BATAS_MASA_BERLAKU.maks) return { ok: false, code: "TIDAK_SAH" };
  const label = rapikanLabel(input.label);
  const expiresAt = masaBerlakuDari(sekarang, hari);
  const { token, tokenHash } = buatTokenPortal();

  return prisma.$transaction(async (tx) => {
    const toko = await tx.store.findUnique({ where: { id: input.storeId }, select: { id: true, isActive: true, salesmanId: true } });
    if (!toko) return { ok: false as const, code: "TOKO_TIDAK_ADA" as const };
    if (!toko.isActive) return { ok: false as const, code: "TOKO_NONAKTIF" as const };
    if (!toko.salesmanId) return { ok: false as const, code: "TANPA_PEMEGANG" as const };
    const aktif = await tx.storePortalLink.count({
      where: { storeId: toko.id, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: sekarang } }] },
    });
    if (aktif >= MAKS_TAUTAN_AKTIF) return { ok: false as const, code: "TERLALU_BANYAK" as const };

    const tautan = await tx.storePortalLink.create({
      data: { storeId: toko.id, tokenHash, label, createdById: input.createdById, expiresAt },
      select: { id: true },
    });
    await tx.auditLog.create({
      data: {
        userId: input.createdById,
        action: AKSI_TAUTAN_DIBUAT,
        entityType: ENTITAS_TAUTAN,
        entityId: tautan.id,
        changes: { sebelum: null, sesudah: { storeId: toko.id, label, expiresAt: expiresAt.toISOString() } } as Prisma.InputJsonValue,
        metadata: { storeId: toko.id, hari } as Prisma.InputJsonValue,
      },
    });
    return { ok: true as const, token, linkId: tautan.id, expiresAt };
  });
}

export type HasilCabutTautan = { ok: true; sudahDicabut: boolean } | { ok: false; code: "TIDAK_ADA" };

/**
 * Mencabut tautan: berlaku SEKETIKA, karena setiap permintaan publik membuka
 * tautan dari awal. Mencabut yang sudah dicabut tidak menulis apa pun dan tidak
 * dianggap galat. Tukar-banding (`updateMany … revokedAt: null`) menjamin dua
 * pencabutan bersamaan hanya menulis satu baris jejak.
 */
export async function cabutTautanPortal(input: { linkId: string; userId: string; sekarang?: Date }): Promise<HasilCabutTautan> {
  const sekarang = input.sekarang ?? new Date();
  return prisma.$transaction(async (tx) => {
    const tautan = await tx.storePortalLink.findUnique({
      where: { id: input.linkId },
      select: { id: true, storeId: true, revokedAt: true, label: true },
    });
    if (!tautan) return { ok: false as const, code: "TIDAK_ADA" as const };
    if (tautan.revokedAt) return { ok: true as const, sudahDicabut: true };
    const r = await tx.storePortalLink.updateMany({ where: { id: tautan.id, revokedAt: null }, data: { revokedAt: sekarang } });
    if (r.count === 0) return { ok: true as const, sudahDicabut: true };
    await tx.auditLog.create({
      data: {
        userId: input.userId,
        action: AKSI_TAUTAN_DICABUT,
        entityType: ENTITAS_TAUTAN,
        entityId: tautan.id,
        changes: { sebelum: { revokedAt: null }, sesudah: { revokedAt: sekarang.toISOString() } } as Prisma.InputJsonValue,
        metadata: { storeId: tautan.storeId, label: tautan.label } as Prisma.InputJsonValue,
      },
    });
    return { ok: true as const, sudahDicabut: false };
  });
}

export type BarisTautan = {
  id: string;
  label: string | null;
  keadaan: KeadaanTautan;
  createdAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  pembuat: string | null;
};

/** Tautan satu toko, terbaru dulu. Tidak pernah membawa token atau hash-nya. */
export async function daftarTautanPortal(storeId: string, sekarang: Date = new Date(), batas = 50): Promise<BarisTautan[]> {
  const baris = await prisma.storePortalLink.findMany({
    where: { storeId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: batas,
    select: { id: true, label: true, createdAt: true, expiresAt: true, revokedAt: true, lastUsedAt: true, createdById: true },
  });
  const pembuatIds = [...new Set(baris.map((b) => b.createdById))];
  const pengguna = pembuatIds.length
    ? await prisma.user.findMany({ where: { id: { in: pembuatIds } }, select: { id: true, name: true, email: true } })
    : [];
  const nama = new Map(pengguna.map((u) => [u.id, u.name ?? u.email]));
  return baris.map((b) => ({
    id: b.id,
    label: b.label,
    keadaan: keadaanTautan(b, sekarang),
    createdAt: b.createdAt,
    expiresAt: b.expiresAt,
    revokedAt: b.revokedAt,
    lastUsedAt: b.lastUsedAt,
    pembuat: nama.get(b.createdById) ?? null,
  }));
}
